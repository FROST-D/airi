import type { Readable } from 'node:stream'

import type { AudioPlayer, VoiceConnection, VoiceConnectionState } from '@discordjs/voice'
import type { Logg } from '@guiiai/logg'
import type { Client as AiriClient } from '@proj-airi/server-sdk'
import type { Discord } from '@proj-airi/server-shared/types'
import type {
  BaseGuildVoiceChannel,
  CacheType,
  ChatInputCommandInteraction,
  Client as DiscordClient,
  GuildMember,
} from 'discord.js'

import type { UserAudioData } from '../../../pipelines/tts'

import { Buffer } from 'node:buffer'
import { EventEmitter } from 'node:events'
import { pipeline } from 'node:stream'

import {
  createAudioPlayer,
  createAudioResource,
  entersState,
  getVoiceConnections,
  joinVoiceChannel,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
} from '@discordjs/voice'
import { useLogg } from '@guiiai/logg'

import { DECODE_SAMPLE_RATE } from '../../../constants/audio'
import { multiUserTranscribeThenSummarize, openaiTranscribe } from '../../../pipelines/tts'
import { convertOpusToWav } from '../../../utils/audio'
import { AudioMonitor } from '../../../utils/audio-monitor'
import { OpusDecoder } from '../../../utils/opus'

function isValidTranscription(text: string): boolean {
  if (!text || text.includes('[BLANK_AUDIO]'))
    return false
  return true
}

async function setSelfVoice(logger: Logg, me?: GuildMember | null) {
  if (me?.voice && me.permissions.has('DeafenMembers')) {
    try {
      await me.voice.setDeaf(false)
      await me.voice.setMute(false)
    }
    catch (error) {
      logger.withError(error).log('Failed to modify voice state') // Continue anyway
    }
  }
}

// eliza/packages/client-discord/src/voice.ts at develop · elizaOS/eliza
// https://github.com/elizaOS/eliza/blob/develop/packages/client-discord/src/voice.ts

export class VoiceManager extends EventEmitter {
  private logger = useLogg('VoiceManager').useGlobalConfig()
  private processingVoice: boolean = false
  private transcriptionTimeout: NodeJS.Timeout | null = null
  private userStates: Map<
    string,
    {
      buffers: Buffer[]
      totalLength: number
      lastActive: number
      transcriptionText: string
    }
  > = new Map()

  private activeAudioPlayer: AudioPlayer | null = null
  private activeSubscription: any = null
  private client: DiscordClient
  private airiClient: AiriClient
  private streams: Map<string, Readable> = new Map()
  private connections: Map<string, VoiceConnection> = new Map()
  private activeMonitors: Map<
    string,
    { channel: BaseGuildVoiceChannel, monitor: AudioMonitor }
  > = new Map()

  constructor(client: DiscordClient, airiClient: AiriClient) {
    super()
    this.client = client
    this.airiClient = airiClient

    // Check for ffmpeg availability (needed for audio playback)
    this.checkFfmpegAvailability()
  }

  private async checkFfmpegAvailability() {
    try {
      const { exec } = await import('node:child_process')
      const { promisify } = await import('node:util')
      const execAsync = promisify(exec)

      await execAsync('ffmpeg -version')
      this.logger.log('ffmpeg is available for audio processing')
    }
    catch (err) {
      this.logger.warn('ffmpeg not found - TTS audio playback may not work. Please install ffmpeg.')
    }
  }

  handleVoiceConnectionStateChange(channel: BaseGuildVoiceChannel, connection: VoiceConnection): (oldState: VoiceConnectionState, newState: VoiceConnectionState) => Promise<void> {
    return async (oldState, newState) => {
      this.logger.withFields({ old: oldState.status, new: newState.status }).log(
        `Voice connection state changed from ${oldState.status} to ${newState.status}`,
      )

      if (newState.status === VoiceConnectionStatus.Destroyed) {
        this.connections.delete(channel.id)
      }
      else if (!this.connections.has(channel.id) && (newState.status === VoiceConnectionStatus.Ready || newState.status === VoiceConnectionStatus.Signalling)) {
        this.connections.set(channel.id, connection)
      }
      else if (newState.status === VoiceConnectionStatus.Disconnected) {
        this.logger.log('Handling disconnection...')

        try {
        // Try to reconnect if disconnected
          await Promise.race([
            entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
            entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
          ])
          // Seems to be reconnecting to a new channel
          this.logger.log('Reconnecting to channel...')
        }
        catch (e) {
        // Seems to be a real disconnect, destroy and cleanup
          this.logger.log(`Disconnection confirmed - cleaning up...${e}`)
          connection.destroy()
          this.connections.delete(channel.id)
        }
      }
    }
  }

  handleVoiceConnectionError(error: unknown) {
    this.logger.withError(error).log('Voice connection error')
    // Don't immediately destroy - let the state change handler deal with it
    this.logger.log('Connection error - will attempt to recover...')
  }

  handleAudioReceiveStreamStart(channel: BaseGuildVoiceChannel): (userId: string) => Promise<void> {
    return async (userId) => {
      let user = channel.members.get(userId)
      if (!user) {
        try {
          user = await channel.guild.members.fetch(userId)
        }
        catch (error) {
          this.logger.withError(error).error('Failed to fetch user')
        }
      }
      if (user && !user?.user.bot) {
        this.logger.log(`User speaking: ${user.displayName}`)
        this.monitorMember(user as GuildMember, channel.id)
        this.streams.get(userId)?.emit('speakingStarted')
      }
    }
  }

  handleAudioReceiveStreamEnd(channel: BaseGuildVoiceChannel): (userId: string) => void {
    return async (userId: string) => {
      const user = channel.members.get(userId)
      if (user && !user.user.bot) {
        this.logger.log(`User stopped speaking: ${user.displayName}`)
        this.streams.get(userId)?.emit('speakingStopped')
      }
      else if (!user) {
        this.logger.log(`User stopped speaking but is no longer in channel: ${userId}`)
        this.streams.get(userId)?.emit('speakingStopped')
      }
    }
  }

  async joinChannel(interaction: ChatInputCommandInteraction<CacheType>, channel: BaseGuildVoiceChannel) {
    const oldConnection = this.getVoiceConnection(
      channel.guildId as string,
    )
    if (oldConnection) {
      try {
        oldConnection.destroy()
        // Remove all associated streams and monitors
        this.streams.clear()
        this.activeMonitors.clear()
      }
      catch (error) {
        this.logger.withError(error).log('Error leaving voice channel')
      }
    }

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator as any,
      selfDeaf: false,
      selfMute: false,
      group: this.client.user.id,
    })

    try {
      this.logger.log('Attempting to join voice channel...', { channelId: channel.id, guildId: channel.guild.id })

      // Wait for Ready state with extended timeout and better error handling
      try {
        await entersState(connection, VoiceConnectionStatus.Ready, 30_000)
        this.logger.log('Voice connection reached Ready state')
      }
      catch (readyError) {
        // If Ready times out but we're at least Signalling, that's acceptable
        if (connection.state.status === VoiceConnectionStatus.Signalling) {
          this.logger.warn('Connection is Signalling but not yet Ready - proceeding anyway', { status: connection.state.status })
        }
        else {
          this.logger.error('Connection failed to establish', { status: connection.state.status, error: readyError })
          throw readyError
        }
      }

      // Log connection success
      this.logger.withField('state', connection.state.status).log('Voice connection established in state')
      await interaction.editReply(`Joined: ${channel.name}.`)

      // Set up ongoing state change monitoring
      connection.on('stateChange', this.handleVoiceConnectionStateChange(channel, connection))
      connection.on('error', this.handleVoiceConnectionError)

      // Store the connection
      this.connections.set(channel.id, connection)

      connection.receiver.speaking.on('start', this.handleAudioReceiveStreamStart(channel))
      connection.receiver.speaking.on('end', this.handleAudioReceiveStreamEnd(channel))

      // Continue with voice state modifications
      await setSelfVoice(this.logger, channel.guild.members.me)
    }
    catch (error) {
      this.logger.withError(error as Error).error('Failed to establish voice connection')

      connection.destroy()
      this.connections.delete(channel.id)
      throw error
    }
  }

  private getVoiceConnection(guildId: string) {
    // First check local connections map (indexed by channel ID)
    for (const [, connection] of this.connections) {
      if (connection.joinConfig?.guildId === guildId) {
        return connection
      }
    }

    // Fallback to library function
    const connections = getVoiceConnections(this.client.user.id)
    if (!connections) {
      this.logger.debug('No voice connections found via library')
      return
    }
    const connection = [...connections.values()].find(
      connection => connection.joinConfig.guildId === guildId,
    )
    if (!connection) {
      this.logger.debug('No voice connection found for guild via library')
    }

    return connection
  }

  getVoiceConnectionForGuild(guildId: string): VoiceConnection | undefined {
    return this.getVoiceConnection(guildId)
  }

  async playAudioInGuild(guildId: string, audioStream: Readable): Promise<void> {
    const connection = this.getVoiceConnection(guildId)
    if (!connection) {
      this.logger.warn(`No voice connection for guild ${guildId}`)
      return
    }

    // Ensure connection is ready
    if (connection.state.status !== VoiceConnectionStatus.Ready) {
      this.logger.log(`Connection not ready (${connection.state.status}), waiting...`)
      try {
        await entersState(connection, VoiceConnectionStatus.Ready, 5000)
      }
      catch (err) {
        this.logger.withError(err).error('Connection did not become ready in time')
        return
      }
    }

    this.logger.log(`Playing TTS audio in guild ${guildId}`, {
      connectionStatus: connection.state.status,
    })

    // Wait a bit if bot is currently processing transcription
    if (this.processingVoice) {
      this.logger.log('Waiting for transcription processing to complete...')
      await new Promise(resolve => setTimeout(resolve, 500))
    }

    // Clear all pending audio buffers to prevent echo loop
    this.logger.log('Clearing all audio buffers before TTS playback to prevent echo')
    this.userStates.forEach((state) => {
      state.buffers.length = 0
      state.totalLength = 0
    })

    // Cancel any pending transcription timeout
    if (this.transcriptionTimeout) {
      clearTimeout(this.transcriptionTimeout)
      this.transcriptionTimeout = null
    }

    this.cleanupAudioPlayer(this.activeAudioPlayer)
    const audioPlayer = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Play,
      },
    })

    this.activeAudioPlayer = audioPlayer

    const subscription = connection.subscribe(audioPlayer)
    if (!subscription) {
      this.logger.error('Failed to subscribe audio player to voice connection')
      return
    }

    // Store subscription to prevent garbage collection
    this.activeSubscription = subscription
    this.logger.log('Audio player subscribed to voice connection')

    const audioStartTime = Date.now()

    // Create resource - using Arbitrary to let ffmpeg handle MP3 decoding
    const resource = createAudioResource(audioStream, {
      inputType: StreamType.Arbitrary,
    })

    audioPlayer.on('error', (error) => {
      this.logger.withError(error).error('Audio player error')
      this.cleanupAudioPlayer(audioPlayer)
    })
    audioPlayer.on('stateChange', (oldState: any, newState: { status: string }) => {
      this.logger.log(`Audio player state: ${oldState.status} -> ${newState.status}`)
      if (newState.status === 'playing') {
        this.logger.log('TTS audio is now playing in voice channel')
        // Clear buffers again while playing to prevent echo
        this.userStates.forEach((state) => {
          state.buffers.length = 0
          state.totalLength = 0
        })
      }
      if (newState.status === 'idle') {
        const idleTime = Date.now()
        this.logger.withField('elapsed', idleTime - audioStartTime).log(`TTS audio playback completed`)
        // Give a small delay after playback before accepting audio input again
        setTimeout(() => {
          this.logger.log('Audio playback buffer delay complete - accepting audio input again')
        }, 1000)
        this.cleanupAudioPlayer(audioPlayer)
      }
    })

    this.logger.log('Starting TTS audio playback', {
      resourceReadable: !!resource.readable,
      playerState: audioPlayer.state.status,
      hasMetadata: !!resource.metadata,
      streamType: 'Arbitrary (MP3)',
    })

    try {
      audioPlayer.play(resource)
      this.logger.log('Audio player play() called successfully')
    }
    catch (err) {
      this.logger.withError(err).error('Failed to call audioPlayer.play()')
      this.cleanupAudioPlayer(audioPlayer)
    }
  }

  private async monitorMember(
    member: GuildMember,
    channelId: string,
  ) {
    const userId = member?.id
    const connection = this.getVoiceConnection(member?.guild?.id)
    const receiveStream = connection?.receiver.subscribe(userId, {
      autoDestroy: true,
      emitClose: true,
    })
    if (!receiveStream) {
      this.logger.warn('No voice data received')
      return
    }

    // Increase max listeners to prevent warnings (we add multiple handlers)
    receiveStream.setMaxListeners(20)

    const opusDecoder = new OpusDecoder(DECODE_SAMPLE_RATE, 1)
    const volumeBuffer: number[] = []
    const VOLUME_WINDOW_SIZE = 30
    const SPEAKING_THRESHOLD = 0.05

    const dataHandler = (pcmData: Buffer) => {
      // IMPORTANT: Don't process any audio if bot is currently playing TTS
      // This prevents echo loop from bot's own output
      if (this.activeAudioPlayer && this.activeAudioPlayer.state.status === 'playing') {
        return
      }

      // Monitor the audio volume while the agent is speaking.
      // If the average volume of the user's audio exceeds the defined threshold, it indicates active speaking.
      // When active speaking is detected, stop the agent's current audio playback to avoid overlap.

      if (this.activeAudioPlayer) {
        const samples = new Int16Array(pcmData.buffer, pcmData.byteOffset, pcmData.length / 2)
        const maxAmplitude = Math.max(...samples.map(Math.abs)) / 32768
        volumeBuffer.push(maxAmplitude)

        if (volumeBuffer.length > VOLUME_WINDOW_SIZE) {
          volumeBuffer.shift()
        }

        const avgVolume
          = volumeBuffer.reduce((sum, v) => sum + v, 0) / VOLUME_WINDOW_SIZE

        if (avgVolume > SPEAKING_THRESHOLD) {
          volumeBuffer.length = 0
          this.cleanupAudioPlayer(this.activeAudioPlayer)
          this.processingVoice = false
        }
      }
    }

    this.streams.set(userId, opusDecoder)
    this.connections.set(userId, connection as VoiceConnection)

    const errorHandler = (err: Error) => {
      // Log but don't crash on Opus decoding errors (common with packet loss)
      if (!err.message.includes('memory access out of bounds')) {
        this.logger.withError(err).error('Opus decoding error')
      }
    }

    const cleanup = () => {
      this.logger.withField('displayName', member?.displayName).log('Cleaning up voice stream')

      opusDecoder.removeListener('data', dataHandler)
      opusDecoder.removeListener('error', errorHandler)
      opusDecoder.removeListener('close', cleanup)
      opusDecoder.removeListener('end', cleanup)
      receiveStream?.removeListener('close', cleanup)
      receiveStream?.removeListener('end', cleanup)
      receiveStream?.removeListener('error', cleanup)

      // REVIEW: Stop the AudioMonitor when stream ends
      this.stopMonitoringMember(userId)

      this.streams.delete(userId)
      this.connections.delete(userId)
    }

    opusDecoder.on('data', dataHandler)
    opusDecoder.on('error', errorHandler)
    opusDecoder.on('close', cleanup)
    opusDecoder.on('end', cleanup)
    receiveStream?.on('close', cleanup)
    receiveStream?.on('end', cleanup)
    receiveStream?.on('error', cleanup)

    pipeline(receiveStream, opusDecoder, (err) => {
      if (err) {
        // Log pipeline errors but don't crash
        this.logger.withError(err).error('Opus decoding pipeline error')
      }
      cleanup()
    })

    this.logger.log(`Monitoring user: ${member.displayName}`)
    await this.handleUserStream(userId, member, member.guild.id, channelId, opusDecoder)
  }

  leaveChannel(channel: BaseGuildVoiceChannel) {
    const connection = this.connections.get(channel.id)
    if (connection) {
      connection.destroy()
      this.connections.delete(channel.id)
    }

    // Stop monitoring all members in this channel
    for (const [memberId, monitorInfo] of this.activeMonitors) {
      if (monitorInfo.channel.id === channel.id && memberId !== this.client.user?.id) {
        this.stopMonitoringMember(memberId)
      }
    }

    this.logger.log(`Left voice channel: ${channel.name} (${channel.id})`)
  }

  stopMonitoringMember(memberId: string) {
    const monitorInfo = this.activeMonitors.get(memberId)
    if (!monitorInfo) {
      return
    }

    monitorInfo.monitor.stop()
    this.activeMonitors.delete(memberId)
    this.streams.delete(memberId)
    this.logger.log(`Stopped monitoring user ${memberId}`)
  }

  async debouncedProcessTranscription(
    userId: string,
    member: GuildMember,
    guildId: string,
    channelId: string,
  ) {
    const DEBOUNCE_TRANSCRIPTION_THRESHOLD = 1500 // wait for 1.5 seconds of silence

    if (this.activeAudioPlayer?.state?.status === 'idle') {
      this.logger.log('Cleaning up idle audio player.')
      this.cleanupAudioPlayer(this.activeAudioPlayer)
    }
    if (this.activeAudioPlayer || this.processingVoice) {
      const state = this.userStates.get(userId)
      state.buffers.length = 0
      state.totalLength = 0
      return
    }
    if (this.transcriptionTimeout) {
      clearTimeout(this.transcriptionTimeout)
    }

    this.transcriptionTimeout = setTimeout(async () => {
      this.processingVoice = true
      try {
        await this.processTranscription(userId, member, guildId, channelId)
        // Clean all users' previous buffers
        this.userStates.forEach((state, _) => {
          state.buffers.length = 0
          state.totalLength = 0
        })
      }
      finally {
        this.processingVoice = false
      }
    }, DEBOUNCE_TRANSCRIPTION_THRESHOLD)
  }

  // NOTICE: Original single-user transcription methods preserved above
  // New multi-user transcription methods implemented below

  /**
   * NEW: Multi-user transcription with summarization
   * Waits for ALL users to stop talking before processing
   */
  async debouncedProcessAllUsersTranscription(
    guildId: string,
    channelId: string,
  ) {
    const DEBOUNCE_TRANSCRIPTION_THRESHOLD = 500 // wait for 0.5 seconds of silence from ALL users

    if (this.activeAudioPlayer?.state?.status === 'idle') {
      this.logger.log('Cleaning up idle audio player.')
      this.cleanupAudioPlayer(this.activeAudioPlayer)
    }

    // If bot is talking or already processing, clear buffers and skip
    // if (this.activeAudioPlayer || this.processingVoice) {
    //   this.logger.log('Bot is currently talking or processing - clearing audio buffers to prevent echo loop')
    //   this.userStates.forEach((state) => {
    //     state.buffers.length = 0
    //     state.totalLength = 0
    //   })
    //   return
    // }

    // Clear any existing timeout and set a new one
    if (this.transcriptionTimeout) {
      clearTimeout(this.transcriptionTimeout)
    }

    this.transcriptionTimeout = setTimeout(async () => {
      // Double-check the bot isn't playing audio before we start processing
      // if (this.activeAudioPlayer && this.activeAudioPlayer.state.status !== 'idle') {
      //   this.logger.log('Bot started playing audio - aborting transcription to prevent echo')
      //   this.userStates.forEach((state) => {
      //     state.buffers.length = 0
      //     state.totalLength = 0
      //   })
      //   return
      // }

      this.processingVoice = true
      try {
        await this.processAllUsersTranscription(guildId, channelId)
      }
      finally {
        this.processingVoice = false
      }
    }, DEBOUNCE_TRANSCRIPTION_THRESHOLD)
  }

  private async handleUserStream(
    userId: string,
    member: GuildMember,
    guildId: string,
    channelId: string,
    audioStream: Readable,
  ) {
    this.logger.log(`Starting audio monitor for user: ${userId}`)

    // // REVIEW: Each speaking session creates a new stream, so we need a new monitor
    // // Stop the old monitor if it exists (from a previous speaking session)
    // if (this.activeMonitors.has(userId)) {
    //   this.logger.log(`Replacing existing monitor for user: ${userId} with new monitor for new speaking session`)
    //   const oldMonitor = this.activeMonitors.get(userId)
    //   if (oldMonitor) {
    //     oldMonitor.monitor.stop()
    //   }
    //   this.activeMonitors.delete(userId)
    // }

    if (!this.userStates.has(userId)) {
      this.userStates.set(userId, {
        buffers: [],
        totalLength: 0,
        lastActive: Date.now(),
        transcriptionText: '',
      })
    }

    const state = this.userStates.get(userId)

    const processBuffer = async (buffer: Buffer) => {
      try {
        state!.buffers.push(buffer)
        state!.totalLength += buffer.length
        state!.lastActive = Date.now()

        // NEW: Use multi-user transcription that waits for ALL users to stop
        this.debouncedProcessAllUsersTranscription(guildId, channelId)
      }
      catch (error) {
        this.logger.withError(error).withField('userId', userId).error('Error processing buffer')
      }
    }

    const monitor = new AudioMonitor(
      audioStream,
      10000000,
      () => {
        if (this.transcriptionTimeout)
          clearTimeout(this.transcriptionTimeout)
      },
      async (buffer) => {
        if (!buffer) {
          this.logger.error('Received empty buffer')
          return
        }

        await processBuffer(buffer)
      },
    )

    // REVIEW: Store monitor so it can be properly stopped later
    const channel = this.client.channels.cache.get(channelId) as BaseGuildVoiceChannel
    if (channel) {
      this.activeMonitors.set(userId, { channel, monitor })
    }
  }

  private async processTranscription(
    userId: string,
    member: GuildMember,
    guildId: string,
    channelId: string,
  ) {
    // Safety check: don't process bot's own audio
    if (member.user.bot) {
      this.logger.log('Skipping transcription for bot user')
      return
    }

    const state = this.userStates.get(userId)
    if (!state || state.buffers.length === 0)
      return

    try {
      const inputBuffer = Buffer.concat(state.buffers, state.totalLength)

      state.buffers.length = 0 // Clear the buffers
      state.totalLength = 0

      // Convert Opus to WAV
      const wavBuffer = await convertOpusToWav(inputBuffer)
      const result = await openaiTranscribe(wavBuffer)
      const transcriptionText = result
      console.debug('Transcription result:', transcriptionText)

      if (transcriptionText && isValidTranscription(transcriptionText)) {
        state.transcriptionText += transcriptionText

        const discordContext = {
          channelId,
          guildId,
          guildMember: member,
        } satisfies Discord

        this.airiClient.send({
          type: 'input:text:voice',
          data: { transcription: transcriptionText, discord: discordContext },
        })

        // this.airiClient.send({
        //   type: 'input:text',
        //   data: { text: transcriptionText, discord: discordContext },
        // })

        this.logger.log('Transcription sent to AIRI', { text: transcriptionText })
      }
      if (state.transcriptionText.length) {
        this.cleanupAudioPlayer(this.activeAudioPlayer)
        const finalText = state.transcriptionText
        state.transcriptionText = ''

        this.logger.withField('transcription', finalText).log('Transcription complete')
      }
    }
    catch (error) {
      this.logger.withError(error).withField('userId', userId).error('Error processing transcription')
    }
  }

  /**
   * NEW: Process transcriptions from ALL users who have spoken
   * Transcribes each user's audio and summarizes into a single message
   */
  private async processAllUsersTranscription(
    guildId: string,
    channelId: string,
  ) {
    this.logger.log('Processing multi-user transcription...')

    // Collect all users with audio buffers
    const usersWithAudio: UserAudioData[] = []
    const channel = this.client.channels.cache.get(channelId) as BaseGuildVoiceChannel

    if (!channel) {
      this.logger.error('Channel not found for multi-user transcription')
      return
    }

    for (const [userId, state] of this.userStates.entries()) {
      if (state.buffers.length === 0) {
        continue
      }

      try {
        // Get member info
        let member = channel.members.get(userId)
        if (!member) {
          try {
            member = await channel.guild.members.fetch(userId)
          }
          catch (err) {
            this.logger.withError(err).warn(`Could not fetch member ${userId}`)
            continue
          }
        }

        // IMPORTANT: Skip bot users (including our own bot)
        if (member.user.bot) {
          this.logger.log(`Skipping bot user: ${member.displayName}`)
          state.buffers.length = 0
          state.totalLength = 0
          continue
        }

        // Concatenate all buffers for this user
        const inputBuffer = Buffer.concat(state.buffers, state.totalLength)

        // Convert Opus to WAV
        const wavBuffer = await convertOpusToWav(inputBuffer)

        usersWithAudio.push({
          userId,
          displayName: member.displayName,
          wavBuffer,
        })

        // save the buffer to disk for debugging
        // DEBUG:ONLY
        const fsp = await import('node:fs/promises')
        try {
          await fsp.stat('./debug')
        }
        catch {
          await fsp.mkdir('./debug')
        }
        await fsp.writeFile(`./debug/debug-${member.displayName}-${userId}.wav`, wavBuffer)

        this.logger.log(`Prepared audio for user: ${member.displayName}`)

        // Clear buffers for this user
        state.buffers.length = 0
        state.totalLength = 0
      }
      catch (error) {
        this.logger.withError(error).withField('userId', userId).error('Error preparing user audio')
      }
    }

    if (usersWithAudio.length === 0) {
      this.logger.log('No users with valid audio buffers')
      return
    }

    try {
      // Transcribe all users and get summarized result
      const summarizedText = await multiUserTranscribeThenSummarize(usersWithAudio)

      if (summarizedText && isValidTranscription(summarizedText)) {
        // Get a representative member for Discord context (use first speaker)
        const firstUserId = usersWithAudio[0].userId
        let member = channel.members.get(firstUserId)
        if (!member) {
          member = await channel.guild.members.fetch(firstUserId)
        }

        const discordContext = {
          channelId,
          guildId,
          guildMember: member,
        } satisfies Discord

        this.airiClient.send({
          type: 'input:text:voice',
          data: { transcription: summarizedText, discord: discordContext },
        })

        // this.airiClient.send({
        //   type: 'input:text',
        //   data: { text: summarizedText, discord: discordContext },
        // })

        this.logger.log('Multi-user transcription sent to AIRI', {
          text: summarizedText,
          userCount: usersWithAudio.length,
        })
      }
      else {
        this.logger.warn('No valid transcription from multi-user processing')
      }
    }
    catch (error) {
      this.logger.withError(error).error('Error processing multi-user transcription')
    }
  }

  async playAudioStream(userId: string, audioStream: Readable) {
    const connection = this.connections.get(userId)
    if (connection == null) {
      this.logger.log(`No connection for user ${userId}`)
      return
    }

    this.cleanupAudioPlayer(this.activeAudioPlayer)
    const audioPlayer = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Pause,
      },
    })

    this.activeAudioPlayer = audioPlayer
    connection.subscribe(audioPlayer)

    const audioStartTime = Date.now()
    const resource = createAudioResource(audioStream, {
      inputType: StreamType.Arbitrary,
    })

    audioPlayer.on('error', error => this.logger.withError(error).log('Audio player error'))
    audioPlayer.on('stateChange', (_oldState: any, newState: { status: string }) => {
      if (newState.status === 'idle') {
        const idleTime = Date.now()
        this.logger.withField('elapsed', idleTime - audioStartTime).log(`Audio playback done`)
      }
    })

    audioPlayer.play(resource)
  }

  cleanupAudioPlayer(audioPlayer: AudioPlayer) {
    if (!audioPlayer)
      return

    audioPlayer.stop()
    audioPlayer.removeAllListeners()

    // Unsubscribe if we have an active subscription
    if (this.activeSubscription) {
      try {
        this.activeSubscription.unsubscribe()
      }
      catch (e) {
        // Ignore unsubscribe errors
      }
      this.activeSubscription = null
    }

    if (audioPlayer === this.activeAudioPlayer) {
      this.activeAudioPlayer = null
    }
  }

  async handleJoinChannelCommand(interaction: ChatInputCommandInteraction<CacheType>) {
    try {
      const currVoiceChannel = (interaction.member as GuildMember).voice.channel
      if (!currVoiceChannel) {
        return await interaction.reply('Please join a voice channel first.')
      }

      // Defer the interaction immediately to prevent timeout
      await interaction.deferReply()
      await this.joinChannel(interaction, currVoiceChannel)
    }
    catch (error) {
      this.logger.withError(error).log('Error joining voice channel')
      // Try to send error message if interaction hasn't been replied to
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'Failed to join voice channel.', ephemeral: true })
        }
        else if (interaction.deferred) {
          await interaction.editReply('Failed to join voice channel.')
        }
      }
      catch (e) {
        this.logger.withError(e).log('Failed to send error reply')
      }
    }
  }

  async handleLeaveChannelCommand(interaction: any) {
    const connection = this.getVoiceConnection(interaction.guildId as any)

    if (!connection) {
      await interaction.reply('Not currently in a voice channel.')
      return
    }

    try {
      connection.destroy()
      await interaction.reply('Left the voice channel.')
    }
    catch (error) {
      this.logger.withError(error).log('Error leaving voice channel')

      await interaction.reply('Failed to leave the voice channel.')
    }
  }
}
