# `discord-bot`

Allow アイリ to talk to you and many other users in Discord voice channels.

## Getting started

```shell
git clone git@github.com:moeru-ai/airi.git
pnpm i
```

Create a `.env.local` file:

```shell
cd services/discord-bot
cp .env .env.local
```

Fill-in the following credentials as configurations:

```shell
DISCORD_TOKEN=''
DISCORD_BOT_CLIENT_ID=''

OPENAI_MODEL=''
OPENAI_API_KEY=''
OPENAI_API_BASE_URL=''

# Speech-to-Text (STT) Configuration
OPENAI_STT_API_KEY=''
OPENAI_STT_API_BASE_URL=''
OPENAI_STT_MODEL='whisper-1'

# Text-to-Speech (TTS) Configuration
OPENAI_TTS_API_KEY=''  # Falls back to OPENAI_STT_API_KEY if not set
OPENAI_TTS_API_BASE_URL=''  # Falls back to OPENAI_STT_API_BASE_URL if not set
OPENAI_TTS_MODEL='tts-1'  # Options: tts-1, tts-1-hd
OPENAI_TTS_VOICE='alloy'  # Options: alloy, echo, fable, onyx, nova, shimmer

ELEVENLABS_API_KEY=''
ELEVENLABS_API_BASE_URL=''
```

```shell
pnpm run -F @proj-airi/discord-bot start
```

## Features

### Voice Communication

The Discord bot supports both listening and speaking in Discord voice channels:

- **Speech-to-Text (STT)**: Listens to users in voice channels and transcribes their speech using OpenAI Whisper
- **Text-to-Speech (TTS)**: Automatically speaks AIRI's responses in voice channels when the bot is present

### How to Use

1. **Invite the bot to a voice channel**: Use the `/summon` command while you're in a voice channel
2. **Talk to AIRI**: Speak in the voice channel - the bot will transcribe your speech and send it to AIRI
3. **Hear responses**: When AIRI responds, if the bot is in a voice channel, it will automatically speak the response using TTS
4. **Text chat also works**: You can also mention the bot in text channels or DM it directly

The bot will automatically:
- Transcribe voice input from users in the channel
- Send transcriptions to AIRI for processing
- Speak AIRI's responses back in the voice channel
- Send text responses to the appropriate Discord text channel

## Other similar projects

- [pladisdev/Discord-AI-With-STT](https://github.com/pladisdev/Discord-AI-With-STT)

## Acknowledgements

- Implementation of Audio handling and processing https://github.com/TheTrueSCP/CharacterAIVoice/blob/54d6a41b4e0eba9ad996c5f9ddcc6230277af2f8/src/VoiceHandler.js
- Example of usage https://github.com/discordjs/voice-examples/blob/da0c3b419107d41053501a4dddf3826ad53c03f7/radio-bot/src/bot.ts
- Excellent library https://github.com/discordjs/discord.js
