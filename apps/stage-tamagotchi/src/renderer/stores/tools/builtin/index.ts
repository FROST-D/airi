import type { Tool } from '@xsai/shared-chat'

import { memoryTools } from './memory'
import { widgetsTools } from './widgets'

/**
 * Returns all built-in tools for the Tamagotchi desktop app.
 * This combines memory tools, widget tools, and any other app-specific tools.
 */
export async function builtinTools(): Promise<Tool[]> {
  const [memoryToolsList, widgetsToolsList] = await Promise.all([
    memoryTools(),
    widgetsTools(),
  ])

  return [
    ...memoryToolsList,
    ...widgetsToolsList,
  ]
}
