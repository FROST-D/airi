import type { PipelineType } from '@huggingface/transformers'

import { Buffer } from 'node:buffer'
import { env } from 'node:process'

import wavefile from 'wavefile'

import { useLogg } from '@guiiai/logg'
import { pipeline } from '@huggingface/transformers'
import { toWav } from '@proj-airi/audio'
import { createOpenAI } from '@xsai-ext/providers/create'
import { generateSpeech } from '@xsai/generate-speech'
import { generateText } from '@xsai/generate-text'
import { generateTranscription } from '@xsai/generate-transcription'

export class WhisperLargeV3Pipeline {
  static task: PipelineType = 'automatic-speech-recognition'
  static model = 'Xenova/whisper-medium.en'
  static instance = null

  static async getInstance(progress_callback = null) {
    if (this.instance === null) {
      this.instance = await pipeline(this.task, this.model, { progress_callback })
    }

    return this.instance
  }
}

export function textFromResult(result: Array<{ text: string }> | { text: string }) {
  if (Array.isArray(result)) {
    const arrayResult = result as { text: string }[]
    if (arrayResult.length === 0) {
      return ''
    }

    return result[0].text
  }
  else {
    if ('text' in result) {
      return result.text
    }
    else {
      return ''
    }
  }
}

/**
 * Calculate RMS (Root Mean Square) volume of audio samples
 * Returns a value between 0 and 1
 */
export function calculateRMS(samples: Float32Array | Float64Array): number {
  let sum = 0
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i]
  }
  return Math.sqrt(sum / samples.length)
}

/**
 * Check if audio has sufficient volume/quality for transcription
 * @param wavBuffer - WAV audio buffer
 * @param minRMS - Minimum RMS volume threshold (default: 0.01)
 * @returns true if audio quality is sufficient, false otherwise
 */
export function hasValidAudioLevel(wavBuffer: Buffer, minRMS = 0.01): boolean {
  try {
    const wav = new wavefile.WaveFile(new Uint8Array(wavBuffer))
    wav.toBitDepth('32f') // Convert to Float32
    const audioData = wav.getSamples()

    const rms = calculateRMS(audioData as Float32Array | Float64Array)
    const log = useLogg('Audio:VolumeCheck').useGlobalConfig()
    log.withFields({ rms, minRMS, valid: rms >= minRMS }).log('Audio level check')

    return rms >= minRMS
  }
  catch (err) {
    // If we can't analyze, allow transcription to proceed
    return true
  }
}

export async function transcribe(pcmBuffer: Buffer) {
  const log = useLogg('Memory:Transcribe').useGlobalConfig()

  const pcmConvertedWav = toWav(pcmBuffer.buffer, 48000, 2)
  log.withFields({ from: pcmBuffer.byteLength, to: pcmConvertedWav.byteLength }).log('Audio data received')

  // Check audio volume before transcription
  if (!hasValidAudioLevel(Buffer.from(pcmConvertedWav))) {
    log.log('Audio level too low, skipping transcription')
    return ''
  }

  const transcriber = await WhisperLargeV3Pipeline.getInstance() as (audio: Float32Array | Float64Array) => Promise<Array<{ text: string }> | { text: string }>
  log.log('Transcribing audio')

  const wav = new wavefile.WaveFile(new Uint8Array(pcmConvertedWav))
  wav.toBitDepth('32f') // Pipeline expects input as a Float32Array
  wav.toSampleRate(16000) // Whisper expects audio with a sampling rate of 16000
  const audioData = wav.getSamples()

  const result = await transcriber(audioData)
  const text = textFromResult(result)
  if (!text) {
    log.log('No transcription result')
    return ''
  }

  log.withField('result', text).log('Transcription result')
  return text
}

export async function openaiTranscribe(wavBuffer: Buffer) {
  const log = useLogg('Remote:Transcribe').useGlobalConfig()

  // Check audio volume before transcription
  if (!hasValidAudioLevel(wavBuffer)) {
    log.log('Audio level too low, skipping transcription')
    return ''
  }

  log.log('Transcribing audio...')

  const wavFile = new Blob([wavBuffer], { type: 'audio/wav' })
  const openai = createOpenAI(env.OPENAI_STT_API_KEY, env.OPENAI_STT_API_BASE_URL)

  try {
    const result = await generateTranscription({
      ...openai.transcription(env.OPENAI_STT_MODEL),
      file: wavFile,
      language: env.OPENAI_STT_LANGUAGE || 'en',
    })

    log.withField('result', result.text).log('Transcription result')
    return result.text
  }
  catch (err) {
    log.withError(err).error('Failed to transcribe audio')
  }

  return ''
}

export async function openaiTextToSpeech(text: string): Promise<Buffer | null> {
  const log = useLogg('Remote:TTS').useGlobalConfig()

  const apiKey = env.OPENAI_TTS_API_KEY || env.OPENAI_STT_API_KEY
  const baseUrl = env.OPENAI_TTS_API_BASE_URL || env.OPENAI_STT_API_BASE_URL
  const model = env.OPENAI_TTS_MODEL || 'tts-1'
  const voice = env.OPENAI_TTS_VOICE || 'alloy'

  log.log('Generating speech from text...', { model, voice, textLength: text.length })

  if (!apiKey) {
    log.error('No OpenAI API key configured for TTS')
    return null
  }

  const openai = createOpenAI(apiKey, baseUrl)

  try {
    const result = await generateSpeech({
      ...openai.speech(model),
      input: text,
      voice: voice as any,
      response_format: 'mp3',
    })

    const arrayBuffer = await result
    const buffer = Buffer.from(arrayBuffer)

    log.withField('size', buffer.length).log('Speech generated successfully (mp3 format)')
    return buffer
  }
  catch (err) {
    log.withError(err).error('Failed to generate speech', { model, voice })
  }

  return null
}
// NOTICE: Original openaiTranscribe function preserved above
// The new multi-user transcription approach is implemented below
/**
 * New multi-user transcription pipeline
 * Transcribes audio from multiple users and summarizes into a single message
 */
export interface UserAudioData {
  userId: string
  displayName: string
  wavBuffer: Buffer
}

export async function multiUserTranscribeThenSummarize(
  usersAudio: UserAudioData[],
): Promise<string> {
  const log = useLogg('Remote:MultiUserTranscribe').useGlobalConfig()

  if (usersAudio.length === 0) {
    log.warn('No user audio provided')
    return ''
  }

  log.log(`Transcribing audio for ${usersAudio.length} user(s)...`)

  // Step 1: Transcribe each user's audio
  const transcriptions: Array<{ displayName: string, text: string }> = []

  const apiKey = env.OPENAI_STT_API_KEY
  const baseUrl = env.OPENAI_STT_API_BASE_URL
  const model = env.OPENAI_STT_MODEL
  const language = env.OPENAI_STT_LANGUAGE || 'en'

  if (!apiKey) {
    log.error('No OpenAI API key configured for STT')
    return ''
  }

  const openai = createOpenAI(apiKey, baseUrl)

  for (const userData of usersAudio) {
    try {
      // Check audio volume before transcription
      if (!hasValidAudioLevel(userData.wavBuffer)) {
        log.withField('user', userData.displayName).log('Audio level too low, skipping transcription')
        continue
      }

      const wavFile = new Blob([userData.wavBuffer], { type: 'audio/wav' })

      const result = await generateTranscription({
        ...openai.transcription(model),
        file: wavFile,
        language,
      })

      if (result.text && result.text.trim()) {
        transcriptions.push({
          displayName: userData.displayName,
          text: result.text.trim(),
        })
        log.withFields({ user: userData.displayName, text: result.text }).log('User transcription')
      }
    }
    catch (err) {
      log.withError(err).error(`Failed to transcribe audio for ${userData.displayName}`)
    }
  }

  if (transcriptions.length === 0) {
    log.warn('No valid transcriptions found')
    return ''
  }

  // Step 2: If only one user spoke, return their transcription directly
  if (transcriptions.length === 1) {
    const result = `User talking "${transcriptions[0].displayName}" said : ${transcriptions[0].text}`
    log.withField('result', result).log('Single user - no summarization needed')
    return result
  }

  // Step 3: Summarize multiple transcriptions into a cohesive message
  log.log('Summarizing multiple transcriptions...')

  const conversationText = transcriptions
    .map(t => `${t.displayName}: ${t.text}`)
    .join('\n')

  try {
    const summaryApiKey = env.OPENAI_API_KEY || apiKey
    const summaryBaseUrl = env.OPENAI_API_BASE_URL || baseUrl
    const summaryModel = env.OPENAI_MODEL || 'gpt-4o-mini'

    const result = await generateText({
      apiKey: summaryApiKey,
      baseURL: summaryBaseUrl,
      model: summaryModel,
      messages: [
        {
          role: 'system',
          content: 'You are AIRI, an AI assistant connected to a Discord voice channel. Users are currently in the voice channel with you, speaking to you and to each other. Your task is to summarize multi-user voice conversations into a single coherent message that preserves the key information and context. Combine multiple speakers\' statements naturally, keeping it concise but complete. Format: "User1 said X, User2 responded Y" or similar natural phrasing that reflects the Discord voice chat context.',
        },
        {
          role: 'user',
          content: `Summarize this conversation into a single coherent message:\n\n${conversationText}`,
        },
      ],
    })

    const summarizedText = result.text.trim()
    log.withField('summary', summarizedText).log('Conversation summarized')
    return summarizedText
  }
  catch (err) {
    log.withError(err).error('Failed to summarize transcriptions, falling back to concatenation')
    // Fallback: just concatenate all transcriptions
    return conversationText
  }
}

// Override the old openaiTranscribe with new multi-user version for single user case
const _originalOpenaiTranscribe = openaiTranscribe
export async function openaiTranscribeSingleUser(wavBuffer: Buffer, displayName: string = 'User'): Promise<string> {
  return multiUserTranscribeThenSummarize([{
    userId: 'single',
    displayName,
    wavBuffer,
  }])
}
