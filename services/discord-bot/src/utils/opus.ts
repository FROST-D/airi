import { Buffer } from 'node:buffer'
import { Transform } from 'node:stream'

import OpusScript from 'opusscript'

export class OpusDecoder extends Transform {
  private decoder: OpusScript

  /**
   * @param sampleRate - The audio sample rate (e.g., 16000 Hz)
   * @param channels - Number of audio channels (e.g., 1 for mono)
   */
  constructor(sampleRate: 8000 | 12000 | 16000 | 24000 | 48000, channels: number) {
    super()
    this.decoder = new OpusScript(sampleRate, channels)
  }

  _transform(chunk: Buffer, encoding: BufferEncoding, callback: (...args: any[]) => void) {
    try {
      // Validate chunk size before decoding
      if (!chunk || chunk.length === 0) {
        callback()
        return
      }

      // NOTICE: Create a copy to prevent ArrayBuffer detachment issues
      // Node.js streams can reuse buffers, causing "detached ArrayBuffer" errors
      const chunkCopy = Buffer.from(chunk)

      // Decode Opus chunk to PCM
      const pcm = this.decoder.decode(chunkCopy)
      if (pcm) {
        this.push(Buffer.from(pcm))
      }
      callback()
    }
    catch (error) {
      // Skip invalid frames instead of crashing
      // Common with network packet loss or invalid Opus data
      if (error instanceof Error && error.message.includes('memory access out of bounds')) {
        // Silently skip corrupted frames
        callback()
      }
      else {
        this.emit('error', error)
        callback(error)
      }
    }
  }

  _flush(callback: (...args: any[]) => void) {
    callback()
  }
}
