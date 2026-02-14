/**
 * Response categorizer for LLM outputs
 *
 * This module processes LLM responses to separate speech content from internal reasoning/thinking,
 * and to remove roleplay formatting markers.
 *
 * ## Handled Formats
 *
 * ### 1. XML Tags (filtered from speech, treated as reasoning)
 * Examples: `<thinking>...`, `<reasoning>...`, `<thought>...`, `<RESPONSE>...</RESPONSE>`
 * These are extracted and categorized as "reasoning" - not displayed to user or sent to TTS.
 *
 * ### 2. Roleplay Formatting Markers (removed entirely)
 * Examples: `{{RESPONSE_AGENT}}:`, `{{char}}:`, `{{user}}`, `{{message}}`
 * These are stripped using `preprocessRoleplayFormat()` in the streaming categorizer.
 *
 * ## Example Input
 * ```
 * {{RESPONSE_AGENT}}: Ciao! Sono AIRI. <thinking>Should I be more friendly?</thinking> Come stai? <RESPONSE>AI</RESPONSE>
 * ```
 *
 * ## Example Output
 * ```typescript
 * {
 *   speech: "Ciao! Sono AIRI. Come stai?",
 *   reasoning: "Should I be more friendly?\n\nAI",
 *   segments: [...]
 * }
 * ```
 *
 * The `speech` field contains only what should be displayed/spoken to the user.
 */

import type { Element, Root } from 'hast'
import type { Position } from 'unist'

import rehypeParse from 'rehype-parse'
import rehypeStringify from 'rehype-stringify'

import { unified } from 'unified'
import { visit } from 'unist-util-visit'

export type ResponseCategory = 'speech' | 'reasoning' | 'unknown'

export interface CategorizedSegment {
  category: ResponseCategory
  content: string
  startIndex: number
  endIndex: number
  raw: string // Original tagged content including tags
  tagName: string // The actual tag name found (e.g., "think", "thought", "reasoning")
}

export interface CategorizedResponse {
  segments: CategorizedSegment[]
  speech: string // Combined speech content (everything outside tags)
  reasoning: string // Combined reasoning/thought content
  raw: string // Original full response
}

/**
 * Preprocesses LLM responses to remove roleplay/formatting markers that are not XML tags
 * Handles patterns like:
 * - {{RESPONSE_AGENT}}: prefix
 * - {{user}}/{{char}} or similar roleplay markers
 *
 * Note: XML-style tags like <RESPONSE>, <thinking>, etc. are handled by the main categorizer
 */
export function preprocessRoleplayFormat(response: string): string {
  const original = response
  let cleaned = response

  // Remove roleplay prefix patterns at the start of the response
  // Handles: {{RESPONSE_AGENT}}:, {{RESPONSE_AGENT}}, {{char}}:, etc.
  cleaned = cleaned.replace(/^\{\{[^}]+\}\}\s*:?\s*/, '')

  // Remove other common roleplay metadata patterns throughout the text
  // Handles: {{user}}, {{char}}, {{message}}, etc.
  cleaned = cleaned.replace(/\{\{(?:user|char|message|system|name)\}\}/gi, '')

  // Only trim if we actually removed something
  return cleaned !== original ? cleaned.trim() : cleaned
}

export function normalizeForTTS(input: string): string {
  let text = input

  // 0) Normalize unicode ellipsis to three dots
  text = text.replace(/\u2026/g, '...')

  // 1) Replace ellipses / many dots with a single period (safer pause)
  //    "...." "..." ".." -> "."
  text = text.replace(/\.{2,}/g, '.')

  // 2) Collapse repeated punctuation
  //    "!!!" -> "!" , ",,," -> "," , "??" -> "?"
  text = text.replace(/([,!?;:])\1+/g, '$1')

  // 3) Replace repeated dashes with a spaced em dash (optional but helps pacing)
  //    "--" "———" "––" -> " — "
  text = text.replace(/[-‐-‒–—]{2,}/g, ' — ')

  // 4) Clean up mixed punctuation runs
  //    ",." ".," "?!?!" "!!?" etc -> keep one mark, preferring ? then ! then . then ,
  text = text.replace(/[!?.,]{2,}/g, (run) => {
    if (run.includes('?'))
      return '?'
    if (run.includes('!'))
      return '!'
    if (run.includes('.'))
      return '.'
    if (run.includes(','))
      return ','
    return run[0]
  })

  // 5) Remove leading punctuation at the start of each line/chunk
  //    ", ... hello" -> "hello"
  text = text.replace(/^[\s,.;:!?—–-]+/gm, '')

  // 6) Normalize spacing around punctuation
  //    "hello ,  world" -> "hello, world"
  text = text.replace(/\s+([,.;:!?])/g, '$1')
  text = text.replace(/([,.;:!?])(?=\S)/g, '$1 ')

  // 7) Collapse whitespace
  text = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n')

  // 8) …
  text = text.replace(/…/g, '-')

  return text.trim()
}

/**
 * Maps tag names to categories
 * All tags are treated as reasoning (filtered from TTS)
 */
function mapTagNameToCategory(_tagName: string): ResponseCategory {
  // All tags are reasoning - no need to distinguish tag names
  return 'reasoning'
}

interface ExtractedTag {
  tagName: string
  content: string
  fullMatch: string
  startIndex: number
  endIndex: number
}

/**
 * Extracts all XML-like tags from a response using rehype pipeline
 * Works with any tag format: <tag>content</tag>
 * Only extracts tags that are actually complete (have closing tags in source)
 */
function extractAllTags(response: string): ExtractedTag[] {
  const tags: ExtractedTag[] = []

  try {
    const tree = unified().use(rehypeParse, { fragment: true }).parse(response) as Root

    visit(tree, 'element', (node: Element) => {
      const position = node.position
      if (!position?.start || !position?.end)
        return

      const startIndex = getOffsetFromPosition(response, position.start)
      const endIndex = getOffsetFromPosition(response, position.end)

      if (startIndex === -1 || endIndex === -1)
        return

      // Extract the actual tag content from source
      const fullMatch = response.slice(startIndex, endIndex)

      // Only include tags that have a closing tag in the source (not auto-closed by rehype)
      // Check if the source actually contains the closing tag
      const expectedClosingTag = `</${node.tagName}>`
      if (!fullMatch.includes(expectedClosingTag)) {
        // This tag was auto-closed by rehype, so it's incomplete - skip it
        return
      }

      tags.push({
        tagName: node.tagName,
        content: extractTextContent(node),
        fullMatch,
        startIndex,
        endIndex,
      })
    })
  }
  catch (error) {
    console.error('Failed to parse response for tag extraction:', error)
    // If parsing fails, return empty array (no tags found)
  }

  return tags
}

/**
 * Converts a position (line/column) to a character offset in the string
 */
function getOffsetFromPosition(text: string, position: Position['start']): number {
  if (!position || typeof position.line !== 'number' || typeof position.column !== 'number')
    return -1

  const lines = text.split('\n')
  let offset = 0

  // Sum up lengths of all lines before the target line
  for (let i = 0; i < position.line - 1 && i < lines.length; i++) {
    offset += lines[i].length + 1 // +1 for the newline character
  }

  // Add the column offset (subtract 1 because columns are 1-indexed)
  offset += position.column - 1

  return offset
}

/**
 * Extracts text content from an element node
 */
function extractTextContent(node: Element): string {
  const textParts: string[] = []

  if (node.children) {
    for (const child of node.children) {
      if (child.type === 'text') {
        textParts.push(child.value)
      }
      else if (child.type === 'element') {
        textParts.push(extractTextContent(child))
      }
    }
  }

  return textParts.join('')
}

/**
 * Categorizes a model response by dynamically extracting any XML-like tags
 * Works with any tag format the model uses
 */
export function categorizeResponse(
  response: string,
  _providerId?: string,
): CategorizedResponse {
  // Extract all tags dynamically
  const extractedTags = extractAllTags(response)

  if (extractedTags.length === 0) {
    // No tags found, treat everything as speech
    return {
      segments: [],
      speech: response,
      reasoning: '',
      raw: response,
    }
  }

  // Convert extracted tags to categorized segments
  const segments: CategorizedSegment[] = extractedTags.map(tag => ({
    category: mapTagNameToCategory(tag.tagName),
    content: tag.content.trim(),
    startIndex: tag.startIndex,
    endIndex: tag.endIndex,
    raw: tag.fullMatch,
    tagName: tag.tagName,
  }))

  // Sort segments by position
  segments.sort((a, b) => a.startIndex - b.startIndex)

  // Extract speech content (everything outside tags)
  const speechParts: string[] = []
  let lastEnd = 0

  for (const segment of segments) {
    // Add text before this segment
    if (segment.startIndex > lastEnd) {
      const text = response.slice(lastEnd, segment.startIndex).trim()
      if (text) {
        speechParts.push(text)
      }
    }
    lastEnd = segment.endIndex
  }

  // Add remaining text after last segment
  if (lastEnd < response.length) {
    const text = response.slice(lastEnd).trim()
    if (text) {
      speechParts.push(text)
    }
  }

  // Combine segments by category
  const reasoning = segments
    .filter(s => s.category === 'reasoning')
    .map(s => s.content)
    .join('\n\n')

  // Speech is everything outside tags
  const speech = speechParts.join(' ').trim()

  return {
    segments,
    speech: speech || '',
    reasoning,
    raw: response,
  }
}

/**
 * Note: This receives literal text from useLlmmarkerParser (special tokens <|...|> are already extracted).
 * Only XML/HTML tags like <think>, <reasoning> need to be parsed here.
 */
export function createStreamingCategorizer(
  providerId?: string,
  onSegment?: (segment: CategorizedSegment) => void,
) {
  let buffer = ''
  let categorized: CategorizedResponse | null = null
  let lastEmittedSegmentIndex = -1
  let lastParsedLength = 0

  // Lightweight state machine to detect tag closures without parsing entire buffer
  type TagState = 'outside' | 'in-opening-tag' | 'in-content' | 'in-closing-tag'
  let tagState: TagState = 'outside'
  let tagStackDepth = 0

  // Fallback for filterToSpeech - uses rehype for robust incomplete tag detection
  function checkIncompleteTag(): boolean {
    try {
      const tree = unified().use(rehypeParse, { fragment: true }).parse(buffer) as Root
      const stringified = unified().use(rehypeStringify).stringify(tree).toString()

      if (stringified !== buffer) {
        const bufferEnd = buffer.trim().slice(-30)
        const stringifiedEnd = stringified.trim().slice(-30)
        return bufferEnd !== stringifiedEnd
      }

      return false
    }
    catch {
      // If parsing fails, assume incomplete
      return true
    }
  }

  // Tracks tag state incrementally (O(chunk.length)) to detect when tags close
  // Returns true when the outermost tag just closed
  function processChunkIncrementally(chunk: string): boolean {
    let tagJustClosed = false

    for (let i = 0; i < chunk.length; i++) {
      const char = chunk[i]

      switch (tagState) {
        case 'outside': {
          if (char === '<') {
            if (i + 1 < chunk.length && chunk[i + 1] === '/') {
              tagState = 'in-closing-tag'
              i++
            }
            else {
              tagState = 'in-opening-tag'
            }
          }
          break
        }

        case 'in-opening-tag': {
          if (char === '>') {
            tagState = 'in-content'
            tagStackDepth++
          }
          break
        }

        case 'in-content': {
          if (char === '<') {
            if (i + 1 < chunk.length && chunk[i + 1] === '/') {
              tagState = 'in-closing-tag'
              i++
            }
            else {
              tagState = 'in-opening-tag'
            }
          }
          break
        }

        case 'in-closing-tag': {
          if (char === '>') {
            tagStackDepth--
            if (tagStackDepth === 0) {
              tagState = 'outside'
              tagJustClosed = true
            }
            else {
              tagState = 'in-content'
            }
          }
          break
        }
      }
    }

    return tagJustClosed
  }

  return {
    consume(chunk: string) {
      // Preprocess chunk to remove roleplay formatting before processing
      // Note: We only preprocess if buffer is empty (first chunk) to avoid removing formatting mid-stream
      const processedChunk = buffer.length === 0 ? preprocessRoleplayFormat(chunk) : chunk

      // Process before adding to buffer to detect tag closure in this chunk
      const tagJustClosed = processChunkIncrementally(processedChunk)
      buffer += processedChunk

      // Re-categorize on first chunk, tag closure, or every 1KB (periodic fallback)
      const shouldRecategorize = !categorized
        || tagJustClosed
        || buffer.length - lastParsedLength > 1000

      if (shouldRecategorize) {
        categorized = categorizeResponse(buffer, providerId)
        lastParsedLength = buffer.length
      }

      // Type guard for TypeScript (shouldRecategorize handles !categorized, but TS doesn't know)
      if (!categorized) {
        categorized = categorizeResponse(buffer, providerId)
        lastParsedLength = buffer.length
      }

      if (onSegment && categorized.segments.length > 0) {
        for (let i = lastEmittedSegmentIndex + 1; i < categorized.segments.length; i++) {
          const segment = categorized.segments[i]
          if (buffer.length >= segment.endIndex) {
            onSegment(segment)
            lastEmittedSegmentIndex = i
          }
        }
      }
    },
    /**
     * Checks if the current position in the stream is part of speech content
     * Returns true if the text should be sent to TTS
     */
    isSpeechAt(position: number): boolean {
      if (!categorized || categorized.segments.length === 0) {
        // No categorization yet, assume it's speech
        return true
      }

      // Check if position falls within any non-speech segment
      for (const segment of categorized.segments) {
        if (position >= segment.startIndex && position < segment.endIndex) {
          // Position is within a tagged segment (thought/reasoning)
          return false
        }
      }

      // Position is not in any tagged segment, so it's speech
      return true
    },
    /**
     * Filters text to only include speech parts
     * Removes content that falls within thought/reasoning segments
     */
    filterToSpeech(text: string, startPosition: number): string {
      // Check if we're currently inside an incomplete tag
      console.debug('[ResponseCategorizer] filterToSpeech called with text:', { text, startPosition, bufferEnd: buffer.length, tagState, tagStackDepth })
      if (checkIncompleteTag()) {
        // Try to find where the tag closes in the combined buffer + text
        const fullText = buffer + text
        try {
          const tree = unified().use(rehypeParse, { fragment: true }).parse(fullText) as Root
          let closingOffset = -1

          visit(tree, 'element', (node: Element) => {
            const position = node.position
            if (position?.end && closingOffset === -1) {
              const endOffset = getOffsetFromPosition(fullText, position.end)
              // Check if this element actually has a closing tag in the source
              const elementSource = fullText.slice(
                getOffsetFromPosition(fullText, position.start),
                endOffset,
              )
              const expectedClosingTag = `</${node.tagName}>`

              // Only consider it complete if the closing tag exists in source
              if (elementSource.includes(expectedClosingTag)) {
                // If this element closes within the new text chunk
                if (endOffset >= buffer.length && endOffset <= fullText.length) {
                  closingOffset = endOffset - buffer.length
                }
              }
            }
          })

          if (closingOffset === -1)
            return '' // Still incomplete, filter everything

          // Return only content after the closing tag
          // The buffer already includes text up to closingOffset (from consume())
          text = text.slice(closingOffset)
          startPosition += closingOffset
          // Re-categorize with the complete tag now in buffer
          categorized = categorizeResponse(buffer, providerId)
        }
        catch {
          return '' // Parsing failed, filter everything
        }
      }

      if (!categorized || categorized.segments.length === 0) {
        // No segments detected, all text is speech
        console.debug('[ResponseCategorizer] No segments detected, treating all text as speech. This may be due to incomplete tags or parsing issues.', { text, startPosition, bufferEnd: buffer.length, tagState, tagStackDepth })
        console.debug('[ResponseCategorizer] filterToSpeech:', {
          inputText: text,
          startPosition,
          categorized,
          ttsVersion: normalizeForTTS(text),
        })
        return normalizeForTTS(text)
      }

      let filtered = ''
      const endPosition = startPosition + text.length

      // Find all non-speech segments that overlap with this text
      // Note: segments are already filtered to be complete by extractAllTags
      const overlappingSegments = categorized.segments.filter(
        segment => segment.endIndex > startPosition && segment.startIndex < endPosition,
      )

      if (overlappingSegments.length === 0) {
        console.debug('[ResponseCategorizer] No overlapping segments found, treating all text as speech. This may be due to incomplete tags or parsing issues.', { text, startPosition, endPosition, categorized })
        // No overlapping segments, all text is speech
        console.debug('[ResponseCategorizer] filterToSpeech:', {
          inputText: text,
          startPosition,
          categorized,
          ttsVersion: normalizeForTTS(text),
        })
        return normalizeForTTS(text)
      }

      // Build filtered text by excluding non-speech segments
      let currentPos = startPosition
      for (const segment of overlappingSegments) {
        const segmentStart = Math.max(segment.startIndex, startPosition)
        const segmentEnd = Math.min(segment.endIndex, endPosition)

        // Add text before this segment
        if (segmentStart > currentPos) {
          const beforeStart = currentPos - startPosition
          const beforeEnd = segmentStart - startPosition
          filtered += text.slice(beforeStart, beforeEnd)
        }

        // Skip the segment content (don't add to filtered)
        currentPos = segmentEnd
      }

      // Add remaining text after last segment
      if (currentPos < endPosition) {
        const afterStart = currentPos - startPosition
        filtered += text.slice(afterStart)
      }

      console.debug('[ResponseCategorizer] filterToSpeech:', {
        inputText: filtered,
        startPosition,
        categorized,
        ttsVersion: normalizeForTTS(filtered),
      })

      return normalizeForTTS(filtered)
    },
    getCurrentPosition(): number {
      return buffer.length
    },
    end(): CategorizedResponse {
      return categorizeResponse(buffer, providerId)
    },
    getCurrent(): CategorizedResponse | null {
      return categorized
    },
  }
}
