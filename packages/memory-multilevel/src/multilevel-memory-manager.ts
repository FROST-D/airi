import type { IL0Provider, IL1Provider, IL2Provider, IL3Provider, IMultilevelMemoryProvider } from './interfaces/multilevel-memory.interface'
import type { MultilevelMemoryConfig } from './types/multilevel-config'

import { L0Provider } from './providers/L0-provider'
import { L1Provider } from './providers/L1-provider'
import { L2Provider } from './providers/L2-provider'
import { L3Provider } from './providers/L3-provider'

export interface MultilevelMemoryManagerOptions {
  config: MultilevelMemoryConfig
  onError?: (error: unknown, context: { level: string, operation: string, payload?: unknown }) => void
}

export class MultilevelMemoryManager implements IMultilevelMemoryProvider {
  public readonly L0: IL0Provider
  public readonly L1?: IL1Provider
  public readonly L2?: IL2Provider
  public readonly L3?: IL3Provider

  private readonly onError?: (error: unknown, context: { level: string, operation: string, payload?: unknown }) => void

  constructor(options: MultilevelMemoryManagerOptions) {
    this.onError = options.onError

    // L0 is always required
    if (!options.config.L0.enabled) {
      throw new Error('L0 (working set) must be enabled')
    }
    this.L0 = new L0Provider(options.config.L0)

    // L1 is optional
    if (options.config.L1?.enabled) {
      this.L1 = new L1Provider(options.config.L1)
    }

    // L2 is optional
    if (options.config.L2?.enabled) {
      this.L2 = new L2Provider(options.config.L2)
    }

    // L3 is optional
    if (options.config.L3?.enabled) {
      this.L3 = new L3Provider(options.config.L3)
    }
  }

  async initialize(): Promise<void> {
    console.info('[MultilevelMemoryManager] Initializing all levels...')

    try {
      await this.L0.initialize()
      console.info('[MultilevelMemoryManager] L0 initialized')
    }
    catch (error) {
      this.handleError(error, { level: 'L0', operation: 'initialize' })
      throw error
    }

    if (this.L1) {
      try {
        await this.L1.initialize()
        console.info('[MultilevelMemoryManager] L1 initialized')
      }
      catch (error) {
        this.handleError(error, { level: 'L1', operation: 'initialize' })
        throw error
      }
    }

    if (this.L2) {
      try {
        await this.L2.initialize()
        console.info('[MultilevelMemoryManager] L2 initialized')
      }
      catch (error) {
        this.handleError(error, { level: 'L2', operation: 'initialize' })
        throw error
      }
    }

    if (this.L3) {
      try {
        await this.L3.initialize()
        console.info('[MultilevelMemoryManager] L3 initialized')
      }
      catch (error) {
        this.handleError(error, { level: 'L3', operation: 'initialize' })
        throw error
      }
    }

    console.info('[MultilevelMemoryManager] All levels initialized successfully')
  }

  private handleError(error: unknown, context: { level: string, operation: string, payload?: unknown }) {
    if (this.onError) {
      this.onError(error, context)
      return
    }

    console.error(`[MultilevelMemoryManager] ${context.level} failed during ${context.operation}`, error)
  }
}

export function createMultilevelMemory(config: MultilevelMemoryConfig): MultilevelMemoryManager {
  return new MultilevelMemoryManager({ config })
}
