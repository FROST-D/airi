import type { Pool, PoolConfig } from 'pg'

import type { IL2Provider } from '../interfaces/multilevel-memory.interface'
import type { L2Config } from '../types/multilevel-config'
import type { L2Chunk, L2SearchResult, SearchOptions } from '../types/multilevel-types'

import OpenAI from 'openai'

import { Pool as PgPool } from 'pg'

const DEFAULT_CHUNK_SIZE = 1000
const DEFAULT_CHUNK_OVERLAP = 200

export interface L2ProviderOptions extends L2Config {
  postgresPool?: Pool
}

export class L2Provider implements IL2Provider {
  private readonly config: L2Config
  private readonly postgres: Pool
  private readonly openai?: OpenAI
  private readonly embeddingModel: string
  private embeddingDimensions: number

  constructor(options: L2ProviderOptions) {
    this.config = {
      enabled: true,
      chunkSize: options.chunkSize ?? DEFAULT_CHUNK_SIZE,
      chunkOverlap: options.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP,
      hybridSearch: options.hybridSearch ?? true,
      storage: options.storage,
      embedding: options.embedding,
      postgres: options.postgres,
      paradedb: options.paradedb,
    }

    this.postgres = options.postgresPool ?? this.createPostgresPool()
    this.embeddingModel = this.config.embedding?.model ?? 'text-embedding-3-small'
    this.embeddingDimensions = this.config.embedding?.dimensions ?? this.getDefaultDimensions(this.embeddingModel)

    if (this.config.embedding) {
      this.openai = this.createEmbeddingClient()
    }
  }

  async initialize(): Promise<void> {
    console.info('[L2Provider] Initializing...')
    console.info('[L2Provider] Table name:', this.config.postgres?.tableName ?? 'l2_chunks')
    console.info('[L2Provider] Embedding dimensions:', this.embeddingDimensions)

    try {
      await this.createTablesIfNotExists()
      console.info('[L2Provider] Tables created or verified')
      await this.createIndexesIfNotExists()
      console.info('[L2Provider] Indexes created or verified')
      console.info('[L2Provider] Postgres connection established and tables ready')
    }
    catch (error) {
      console.error('[L2Provider] Postgres initialization failed:', error)
      throw error
    }
  }

  async addChunk(chunk: L2Chunk): Promise<void> {
    const tableName = this.config.postgres?.tableName ?? 'l2_chunks'

    // Generate embedding if not provided
    let embedding = chunk.embedding
    if (!embedding && this.openai && chunk.content) {
      embedding = await this.generateEmbedding(chunk.content)
    }

    const query = `
      INSERT INTO ${tableName} 
      (chunk_id, content, embedding, source, source_id, tenant_id, workspace_id, timestamp, metadata, keywords)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (chunk_id) DO UPDATE SET
        content = EXCLUDED.content,
        embedding = EXCLUDED.embedding,
        metadata = EXCLUDED.metadata,
        keywords = EXCLUDED.keywords,
        timestamp = EXCLUDED.timestamp
    `

    const values = [
      chunk.chunkId,
      chunk.content,
      embedding ? `[${embedding.join(',')}]` : null,
      chunk.source,
      chunk.sourceId,
      chunk.tenantId,
      chunk.workspaceId ?? null,
      chunk.timestamp,
      JSON.stringify(chunk.metadata ?? {}),
      chunk.keywords?.join(',') ?? null,
    ]

    await this.postgres.query(query, values)
  }

  async addChunks(chunks: L2Chunk[]): Promise<void> {
    for (const chunk of chunks) {
      await this.addChunk(chunk)
    }
  }

  async searchSimilar(query: string, options?: SearchOptions): Promise<L2SearchResult[]> {
    if (!this.openai) {
      throw new Error('Embedding provider not configured')
    }

    const queryEmbedding = await this.generateEmbedding(query)
    const tableName = this.config.postgres?.tableName ?? 'l2_chunks'
    const limit = options?.limit ?? 10
    const minSimilarity = options?.minSimilarity ?? 0.5

    let sqlQuery = `
      SELECT *, 
             1 - (embedding <=> $1::vector) as similarity
      FROM ${tableName}
      WHERE 1 - (embedding <=> $1::vector) >= $2
    `

    const params: unknown[] = [`[${queryEmbedding.join(',')}]`, minSimilarity]
    let paramIndex = 3

    // Apply filters
    if (options?.filters) {
      if (options.filters.tenantId) {
        sqlQuery += ` AND tenant_id = $${paramIndex}`
        params.push(options.filters.tenantId)
        paramIndex += 1
      }

      if (options.filters.workspaceId) {
        sqlQuery += ` AND workspace_id = $${paramIndex}`
        params.push(options.filters.workspaceId)
        paramIndex += 1
      }

      if (options.filters.source) {
        sqlQuery += ` AND source = $${paramIndex}`
        params.push(options.filters.source)
        paramIndex += 1
      }

      if (options.filters.startDate) {
        sqlQuery += ` AND timestamp >= $${paramIndex}`
        params.push(options.filters.startDate)
        paramIndex += 1
      }

      if (options.filters.endDate) {
        sqlQuery += ` AND timestamp <= $${paramIndex}`
        params.push(options.filters.endDate)
        paramIndex += 1
      }
    }

    sqlQuery += ` ORDER BY similarity DESC LIMIT $${paramIndex}`
    params.push(limit)

    const result = await this.postgres.query(sqlQuery, params)

    return result.rows.map(row => ({
      chunk: this.parseDbRow(row),
      similarity: Number.parseFloat(row.similarity),
    }))
  }

  async searchHybrid(query: string, options?: SearchOptions): Promise<L2SearchResult[]> {
    if (!this.config.hybridSearch) {
      return this.searchSimilar(query, options)
    }

    const [vectorResults, keywordResults] = await Promise.all([
      this.searchSimilar(query, options),
      this.searchKeyword(query, options),
    ])

    // Combine and re-rank results
    const combinedMap = new Map<string, L2SearchResult>()

    for (const result of vectorResults) {
      combinedMap.set(result.chunk.chunkId, {
        ...result,
        hybridScore: result.similarity * 0.7,
      })
    }

    for (const result of keywordResults) {
      const existing = combinedMap.get(result.chunk.chunkId)
      if (existing) {
        existing.keywordScore = result.keywordScore
        existing.hybridScore = (existing.hybridScore ?? 0) + (result.keywordScore ?? 0) * 0.3
      }
      else {
        combinedMap.set(result.chunk.chunkId, {
          ...result,
          hybridScore: (result.keywordScore ?? 0) * 0.3,
        })
      }
    }

    return Array.from(combinedMap.values())
      .sort((a, b) => (b.hybridScore ?? 0) - (a.hybridScore ?? 0))
      .slice(0, options?.limit ?? 10)
  }

  async getChunk(chunkId: string): Promise<L2Chunk | null> {
    const tableName = this.config.postgres?.tableName ?? 'l2_chunks'
    const result = await this.postgres.query(
      `SELECT * FROM ${tableName} WHERE chunk_id = $1`,
      [chunkId],
    )

    return result.rows.length > 0 ? this.parseDbRow(result.rows[0]) : null
  }

  async deleteChunk(chunkId: string): Promise<void> {
    const tableName = this.config.postgres?.tableName ?? 'l2_chunks'
    await this.postgres.query(`DELETE FROM ${tableName} WHERE chunk_id = $1`, [chunkId])
  }

  async deleteBySource(source: string, sourceId: string): Promise<number> {
    const tableName = this.config.postgres?.tableName ?? 'l2_chunks'
    const result = await this.postgres.query(
      `DELETE FROM ${tableName} WHERE source = $1 AND source_id = $2`,
      [source, sourceId],
    )

    return result.rowCount ?? 0
  }

  async clearWorkspace(tenantId: string, workspaceId?: string): Promise<void> {
    const tableName = this.config.postgres?.tableName ?? 'l2_chunks'

    if (workspaceId) {
      await this.postgres.query(
        `DELETE FROM ${tableName} WHERE tenant_id = $1 AND workspace_id = $2`,
        [tenantId, workspaceId],
      )
    }
    else {
      await this.postgres.query(
        `DELETE FROM ${tableName} WHERE tenant_id = $1`,
        [tenantId],
      )
    }
  }

  private async searchKeyword(query: string, options?: SearchOptions): Promise<L2SearchResult[]> {
    const tableName = this.config.postgres?.tableName ?? 'l2_chunks'
    const limit = options?.limit ?? 10
    const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2)

    if (keywords.length === 0) {
      return []
    }

    let sqlQuery = `
      SELECT *,
             (
               SELECT COUNT(*)
               FROM unnest(string_to_array(keywords, ',')) AS keyword
               WHERE keyword = ANY($1::text[])
             ) +
             (
               SELECT COUNT(*)
               FROM unnest($1::text[]) AS search_term
               WHERE LOWER(content) LIKE '%' || search_term || '%'
             ) as keyword_score
      FROM ${tableName}
      WHERE keywords IS NOT NULL OR content IS NOT NULL
    `

    const params: unknown[] = [keywords]
    let paramIndex = 2

    // Apply filters
    if (options?.filters) {
      if (options.filters.tenantId) {
        sqlQuery += ` AND tenant_id = $${paramIndex}`
        params.push(options.filters.tenantId)
        paramIndex += 1
      }

      if (options.filters.workspaceId) {
        sqlQuery += ` AND workspace_id = $${paramIndex}`
        params.push(options.filters.workspaceId)
        paramIndex += 1
      }

      if (options.filters.source) {
        sqlQuery += ` AND source = $${paramIndex}`
        params.push(options.filters.source)
        paramIndex += 1
      }
    }

    sqlQuery += ` ORDER BY keyword_score DESC LIMIT $${paramIndex}`
    params.push(limit)

    const result = await this.postgres.query(sqlQuery, params)

    return result.rows.map(row => ({
      chunk: this.parseDbRow(row),
      similarity: 0,
      keywordScore: Number.parseFloat(row.keyword_score) / keywords.length,
    }))
  }

  private createPostgresPool(): Pool {
    const options = this.config.postgres ?? this.config.paradedb
    if (!options) {
      throw new Error('Postgres configuration not provided')
    }

    const config: PoolConfig = options.connectionString
      ? { connectionString: options.connectionString }
      : {
          host: options.host ?? 'localhost',
          port: options.port ?? 5432,
          database: options.database ?? 'airi',
          user: options.user,
          password: options.password,
          ssl: options.ssl,
        }

    return new PgPool(config)
  }

  private createEmbeddingClient(): OpenAI {
    if (!this.config.embedding) {
      throw new Error('Embedding configuration not provided')
    }

    const config: { apiKey: string, baseURL?: string } = {
      apiKey: this.config.embedding.apiKey,
    }

    if (this.config.embedding.baseUrl) {
      config.baseURL = this.config.embedding.baseUrl
    }

    return new OpenAI(config)
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    if (!this.openai) {
      throw new Error('OpenAI client not initialized')
    }

    const response = await this.openai.embeddings.create({
      model: this.embeddingModel,
      input: text,
    })

    const embedding = response.data[0].embedding

    // Validate dimensions
    if (embedding.length !== this.embeddingDimensions) {
      console.warn(`[L2Provider] Embedding dimension mismatch. Expected ${this.embeddingDimensions}, got ${embedding.length}. Adjusting...`)
      this.embeddingDimensions = embedding.length
    }

    return embedding
  }

  private getDefaultDimensions(model: string): number {
    // Map common models to their dimensions
    const dimensionMap: Record<string, number> = {
      'nomic-embed-text': 768,
      'text-embedding-3-small': 1536,
      'text-embedding-3-large': 3072,
      'text-embedding-ada-002': 1536,
      'text-embedding-ada-001': 1024,
    }

    return dimensionMap[model] ?? 1536 // default to 1536 if unknown
  }

  private async createTablesIfNotExists(): Promise<void> {
    const tableName = this.config.postgres?.tableName ?? 'l2_chunks'

    const query = `
      CREATE TABLE IF NOT EXISTS ${tableName} (
        id SERIAL PRIMARY KEY,
        chunk_id VARCHAR(255) UNIQUE NOT NULL,
        content TEXT NOT NULL,
        embedding vector(${this.embeddingDimensions}),
        source VARCHAR(100) NOT NULL,
        source_id VARCHAR(255) NOT NULL,
        tenant_id VARCHAR(255) NOT NULL,
        workspace_id VARCHAR(255),
        timestamp TIMESTAMP NOT NULL,
        metadata JSONB,
        keywords TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `

    await this.postgres.query(query)
  }

  private async createIndexesIfNotExists(): Promise<void> {
    const tableName = this.config.postgres?.tableName ?? 'l2_chunks'
    const indexType = this.config.postgres?.indexType ?? 'hnsw'

    const queries = [
      `CREATE INDEX IF NOT EXISTS idx_${tableName}_tenant ON ${tableName}(tenant_id)`,
      `CREATE INDEX IF NOT EXISTS idx_${tableName}_workspace ON ${tableName}(workspace_id)`,
      `CREATE INDEX IF NOT EXISTS idx_${tableName}_source ON ${tableName}(source, source_id)`,
      `CREATE INDEX IF NOT EXISTS idx_${tableName}_timestamp ON ${tableName}(timestamp)`,
    ]

    // Create vector index
    if (indexType === 'hnsw') {
      queries.push(`CREATE INDEX IF NOT EXISTS idx_${tableName}_embedding ON ${tableName} USING hnsw (embedding vector_cosine_ops)`)
    }
    else {
      queries.push(`CREATE INDEX IF NOT EXISTS idx_${tableName}_embedding ON ${tableName} USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)`)
    }

    for (const query of queries) {
      try {
        await this.postgres.query(query)
      }
      catch (error) {
        console.warn(`[L2Provider] Failed to create index: ${error}`)
      }
    }
  }

  private parseDbRow(row: Record<string, unknown>): L2Chunk {
    return {
      chunkId: row.chunk_id as string,
      content: row.content as string,
      embedding: row.embedding as number[] | undefined,
      source: row.source as string,
      sourceId: row.source_id as string,
      tenantId: row.tenant_id as string,
      workspaceId: row.workspace_id as string | undefined,
      timestamp: new Date(row.timestamp as string),
      metadata: row.metadata as Record<string, unknown> | undefined,
      keywords: row.keywords ? (row.keywords as string).split(',') : undefined,
    }
  }
}
