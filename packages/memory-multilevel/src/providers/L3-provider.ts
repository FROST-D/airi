import type { Pool, PoolConfig } from 'pg'

import type { IL3Provider } from '../interfaces/multilevel-memory.interface'
import type { L3Config } from '../types/multilevel-config'
import type { L3Chunk, L3Document, L3SearchResult, SearchOptions } from '../types/multilevel-types'

import OpenAI from 'openai'

import { Pool as PgPool } from 'pg'

const DEFAULT_CHUNK_SIZE = 2000
const DEFAULT_CHUNK_OVERLAP = 400

export interface L3ProviderOptions extends L3Config {
  postgresPool?: Pool
}

export class L3Provider implements IL3Provider {
  private readonly config: L3Config
  private readonly postgres: Pool
  private readonly openai?: OpenAI
  private readonly embeddingModel: string
  private embeddingDimensions: number

  constructor(options: L3ProviderOptions) {
    this.config = {
      enabled: true,
      chunkSize: options.chunkSize ?? DEFAULT_CHUNK_SIZE,
      chunkOverlap: options.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP,
      hybridSearch: options.hybridSearch ?? true,
      versioningEnabled: options.versioningEnabled ?? true,
      storage: options.storage,
      embedding: options.embedding,
      postgres: options.postgres,
      paradedb: options.paradedb,
      scopeFilters: options.scopeFilters,
    }

    this.postgres = options.postgresPool ?? this.createPostgresPool()
    this.embeddingModel = this.config.embedding?.model ?? 'text-embedding-3-small'
    this.embeddingDimensions = this.config.embedding?.dimensions ?? this.getDefaultDimensions(this.embeddingModel)

    if (this.config.embedding) {
      this.openai = this.createEmbeddingClient()
    }
  }

  async initialize(): Promise<void> {
    console.info('[L3Provider] Initializing...')

    try {
      await this.createTablesIfNotExists()
      await this.createIndexesIfNotExists()
      console.info('[L3Provider] Postgres connection established and tables ready')
    }
    catch (error) {
      console.error('[L3Provider] Postgres initialization failed:', error)
      throw error
    }
  }

  async addDocument(document: L3Document): Promise<void> {
    const docsTable = this.config.postgres?.tableName ?? 'l3_documents'
    const chunksTable = `${docsTable}_chunks`

    // Insert or update document
    const docQuery = `
      INSERT INTO ${docsTable}
      (document_id, file_path, file_name, file_type, language, repository, branch, version, content, metadata, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (document_id) DO UPDATE SET
        file_path = EXCLUDED.file_path,
        file_name = EXCLUDED.file_name,
        content = EXCLUDED.content,
        metadata = EXCLUDED.metadata,
        version = EXCLUDED.version,
        updated_at = EXCLUDED.updated_at
    `

    const docValues = [
      document.documentId,
      document.filePath,
      document.fileName,
      document.fileType,
      document.language ?? null,
      document.repository ?? null,
      document.branch ?? null,
      document.version ?? null,
      document.content,
      JSON.stringify(document.metadata ?? {}),
      document.createdAt,
      document.updatedAt,
    ]

    await this.postgres.query(docQuery, docValues)

    // Delete existing chunks
    await this.postgres.query(`DELETE FROM ${chunksTable} WHERE document_id = $1`, [document.documentId])

    // Insert new chunks
    for (const chunk of document.chunks) {
      await this.addChunk(chunk, chunksTable)
    }
  }

  async updateDocument(documentId: string, document: Partial<L3Document>): Promise<void> {
    const docsTable = this.config.postgres?.tableName ?? 'l3_documents'
    const updates: string[] = []
    const values: unknown[] = []
    let paramIndex = 1

    if (document.filePath !== undefined) {
      updates.push(`file_path = $${paramIndex}`)
      values.push(document.filePath)
      paramIndex += 1
    }

    if (document.fileName !== undefined) {
      updates.push(`file_name = $${paramIndex}`)
      values.push(document.fileName)
      paramIndex += 1
    }

    if (document.content !== undefined) {
      updates.push(`content = $${paramIndex}`)
      values.push(document.content)
      paramIndex += 1
    }

    if (document.metadata !== undefined) {
      updates.push(`metadata = $${paramIndex}`)
      values.push(JSON.stringify(document.metadata))
      paramIndex += 1
    }

    if (document.version !== undefined) {
      updates.push(`version = $${paramIndex}`)
      values.push(document.version)
      paramIndex += 1
    }

    if (updates.length === 0) {
      return
    }

    updates.push(`updated_at = $${paramIndex}`)
    values.push(new Date())
    paramIndex += 1

    values.push(documentId)

    const query = `UPDATE ${docsTable} SET ${updates.join(', ')} WHERE document_id = $${paramIndex}`
    await this.postgres.query(query, values)
  }

  async getDocument(documentId: string): Promise<L3Document | null> {
    const docsTable = this.config.postgres?.tableName ?? 'l3_documents'
    const chunksTable = `${docsTable}_chunks`

    const docResult = await this.postgres.query(
      `SELECT * FROM ${docsTable} WHERE document_id = $1`,
      [documentId],
    )

    if (docResult.rows.length === 0) {
      return null
    }

    const chunksResult = await this.postgres.query(
      `SELECT * FROM ${chunksTable} WHERE document_id = $1 ORDER BY chunk_index`,
      [documentId],
    )

    return this.parseDocumentWithChunks(docResult.rows[0], chunksResult.rows)
  }

  async getDocumentByPath(filePath: string, repository?: string, branch?: string): Promise<L3Document | null> {
    const docsTable = this.config.postgres?.tableName ?? 'l3_documents'
    const chunksTable = `${docsTable}_chunks`

    let query = `SELECT * FROM ${docsTable} WHERE file_path = $1`
    const params: unknown[] = [filePath]
    let paramIndex = 2

    if (repository) {
      query += ` AND repository = $${paramIndex}`
      params.push(repository)
      paramIndex += 1
    }

    if (branch) {
      query += ` AND branch = $${paramIndex}`
      params.push(branch)
      paramIndex += 1
    }

    const docResult = await this.postgres.query(query, params)

    if (docResult.rows.length === 0) {
      return null
    }

    const chunksResult = await this.postgres.query(
      `SELECT * FROM ${chunksTable} WHERE document_id = $1 ORDER BY chunk_index`,
      [docResult.rows[0].document_id],
    )

    return this.parseDocumentWithChunks(docResult.rows[0], chunksResult.rows)
  }

  async searchSimilar(query: string, options?: SearchOptions): Promise<L3SearchResult[]> {
    if (!this.openai) {
      throw new Error('Embedding provider not configured')
    }

    const queryEmbedding = await this.generateEmbedding(query)
    const docsTable = this.config.postgres?.tableName ?? 'l3_documents'
    const chunksTable = `${docsTable}_chunks`
    const limit = options?.limit ?? 10
    const minSimilarity = options?.minSimilarity ?? 0.5

    let sqlQuery = `
      SELECT c.*, d.file_path, d.file_name, d.file_type, d.language, d.repository, d.branch, d.version,
             1 - (c.embedding <=> $1::vector) as similarity
      FROM ${chunksTable} c
      JOIN ${docsTable} d ON c.document_id = d.document_id
      WHERE 1 - (c.embedding <=> $1::vector) >= $2
    `

    const params: unknown[] = [`[${queryEmbedding.join(',')}]`, minSimilarity]
    let paramIndex = 3

    // Apply filters
    sqlQuery = this.applyFilters(sqlQuery, options?.filters, params, paramIndex)
    paramIndex = params.length + 1

    sqlQuery += ` ORDER BY similarity DESC LIMIT $${paramIndex}`
    params.push(limit)

    const result = await this.postgres.query(sqlQuery, params)

    return result.rows.map(row => ({
      chunk: this.parseChunkRow(row),
      document: {
        documentId: row.document_id,
        filePath: row.file_path,
        fileName: row.file_name,
        fileType: row.file_type,
        language: row.language,
        repository: row.repository,
        branch: row.branch,
        version: row.version,
      },
      similarity: Number.parseFloat(row.similarity),
    }))
  }

  async searchHybrid(query: string, options?: SearchOptions): Promise<L3SearchResult[]> {
    if (!this.config.hybridSearch) {
      return this.searchSimilar(query, options)
    }

    const [vectorResults, keywordResults] = await Promise.all([
      this.searchSimilar(query, options),
      this.searchKeyword(query, options),
    ])

    // Combine and re-rank results
    const combinedMap = new Map<string, L3SearchResult>()

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

  async listDocuments(filters?: SearchOptions['filters'], limit?: number, offset?: number): Promise<L3Document[]> {
    const docsTable = this.config.postgres?.tableName ?? 'l3_documents'
    let query = `SELECT * FROM ${docsTable} WHERE 1=1`
    const params: unknown[] = []
    let paramIndex = 1

    if (filters) {
      if (filters.repository) {
        query += ` AND repository = $${paramIndex}`
        params.push(filters.repository)
        paramIndex += 1
      }

      if (filters.branch) {
        query += ` AND branch = $${paramIndex}`
        params.push(filters.branch)
        paramIndex += 1
      }

      if (filters.language) {
        query += ` AND language = $${paramIndex}`
        params.push(filters.language)
        paramIndex += 1
      }

      if (filters.fileType) {
        query += ` AND file_type = $${paramIndex}`
        params.push(filters.fileType)
        paramIndex += 1
      }

      if (filters.path) {
        query += ` AND file_path LIKE $${paramIndex}`
        params.push(`%${filters.path}%`)
        paramIndex += 1
      }
    }

    query += ` ORDER BY updated_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`
    params.push(limit ?? 100, offset ?? 0)

    const result = await this.postgres.query(query, params)
    return result.rows.map(row => this.parseDocumentRow(row))
  }

  async deleteDocument(documentId: string): Promise<void> {
    const docsTable = this.config.postgres?.tableName ?? 'l3_documents'
    const chunksTable = `${docsTable}_chunks`

    await this.postgres.query(`DELETE FROM ${chunksTable} WHERE document_id = $1`, [documentId])
    await this.postgres.query(`DELETE FROM ${docsTable} WHERE document_id = $1`, [documentId])
  }

  async deleteByRepository(repository: string, branch?: string): Promise<number> {
    const docsTable = this.config.postgres?.tableName ?? 'l3_documents'
    const chunksTable = `${docsTable}_chunks`

    let query = `SELECT document_id FROM ${docsTable} WHERE repository = $1`
    const params: unknown[] = [repository]

    if (branch) {
      query += ` AND branch = $2`
      params.push(branch)
    }

    const result = await this.postgres.query(query, params)
    const documentIds = result.rows.map(row => row.document_id)

    if (documentIds.length > 0) {
      await this.postgres.query(
        `DELETE FROM ${chunksTable} WHERE document_id = ANY($1::text[])`,
        [documentIds],
      )
      await this.postgres.query(
        `DELETE FROM ${docsTable} WHERE document_id = ANY($1::text[])`,
        [documentIds],
      )
    }

    return documentIds.length
  }

  async clearAll(): Promise<void> {
    const docsTable = this.config.postgres?.tableName ?? 'l3_documents'
    const chunksTable = `${docsTable}_chunks`

    await this.postgres.query(`TRUNCATE TABLE ${chunksTable}`)
    await this.postgres.query(`TRUNCATE TABLE ${docsTable}`)
  }

  private async addChunk(chunk: L3Chunk, chunksTable: string): Promise<void> {
    // Generate embedding if not provided
    let embedding = chunk.embedding
    if (!embedding && this.openai && chunk.content) {
      embedding = await this.generateEmbedding(chunk.content)
    }

    const query = `
      INSERT INTO ${chunksTable}
      (chunk_id, document_id, content, embedding, chunk_index, char_start, char_end, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `

    const values = [
      chunk.chunkId,
      chunk.documentId,
      chunk.content,
      embedding ? `[${embedding.join(',')}]` : null,
      chunk.chunkIndex,
      chunk.charStart,
      chunk.charEnd,
      JSON.stringify(chunk.metadata ?? {}),
    ]

    await this.postgres.query(query, values)
  }

  private async searchKeyword(query: string, options?: SearchOptions): Promise<L3SearchResult[]> {
    const docsTable = this.config.postgres?.tableName ?? 'l3_documents'
    const chunksTable = `${docsTable}_chunks`
    const limit = options?.limit ?? 10
    const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2)

    if (keywords.length === 0) {
      return []
    }

    let sqlQuery = `
      SELECT c.*, d.file_path, d.file_name, d.file_type, d.language, d.repository, d.branch, d.version,
             (
               SELECT COUNT(*)
               FROM unnest($1::text[]) AS search_term
               WHERE LOWER(c.content) LIKE '%' || search_term || '%'
             ) as keyword_score
      FROM ${chunksTable} c
      JOIN ${docsTable} d ON c.document_id = d.document_id
      WHERE c.content IS NOT NULL
    `

    const params: unknown[] = [keywords]
    let paramIndex = 2

    sqlQuery = this.applyFilters(sqlQuery, options?.filters, params, paramIndex)
    paramIndex = params.length + 1

    sqlQuery += ` ORDER BY keyword_score DESC LIMIT $${paramIndex}`
    params.push(limit)

    const result = await this.postgres.query(sqlQuery, params)

    return result.rows.map(row => ({
      chunk: this.parseChunkRow(row),
      document: {
        documentId: row.document_id,
        filePath: row.file_path,
        fileName: row.file_name,
        fileType: row.file_type,
        language: row.language,
        repository: row.repository,
        branch: row.branch,
        version: row.version,
      },
      similarity: 0,
      keywordScore: Number.parseFloat(row.keyword_score) / keywords.length,
    }))
  }

  private applyFilters(query: string, filters: SearchOptions['filters'] | undefined, params: unknown[], startIndex: number): string {
    let paramIndex = startIndex

    if (filters) {
      if (filters.repository) {
        query += ` AND d.repository = $${paramIndex}`
        params.push(filters.repository)
        paramIndex += 1
      }

      if (filters.branch) {
        query += ` AND d.branch = $${paramIndex}`
        params.push(filters.branch)
        paramIndex += 1
      }

      if (filters.language) {
        query += ` AND d.language = $${paramIndex}`
        params.push(filters.language)
        paramIndex += 1
      }

      if (filters.fileType) {
        query += ` AND d.file_type = $${paramIndex}`
        params.push(filters.fileType)
        paramIndex += 1
      }

      if (filters.path) {
        query += ` AND d.file_path LIKE $${paramIndex}`
        params.push(`%${filters.path}%`)
        paramIndex += 1
      }
    }

    return query
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
      console.warn(`[L3Provider] Embedding dimension mismatch. Expected ${this.embeddingDimensions}, got ${embedding.length}. Adjusting...`)
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
    const docsTable = this.config.postgres?.tableName ?? 'l3_documents'
    const chunksTable = `${docsTable}_chunks`

    const docsTableQuery = `
      CREATE TABLE IF NOT EXISTS ${docsTable} (
        id SERIAL PRIMARY KEY,
        document_id VARCHAR(255) UNIQUE NOT NULL,
        file_path TEXT NOT NULL,
        file_name VARCHAR(500) NOT NULL,
        file_type VARCHAR(50) NOT NULL,
        language VARCHAR(50),
        repository VARCHAR(500),
        branch VARCHAR(255),
        version VARCHAR(100),
        content TEXT NOT NULL,
        metadata JSONB,
        created_at TIMESTAMP NOT NULL,
        updated_at TIMESTAMP NOT NULL
      )
    `

    const chunksTableQuery = `
      CREATE TABLE IF NOT EXISTS ${chunksTable} (
        id SERIAL PRIMARY KEY,
        chunk_id VARCHAR(255) UNIQUE NOT NULL,
        document_id VARCHAR(255) NOT NULL REFERENCES ${docsTable}(document_id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        embedding vector(${this.embeddingDimensions}),
        chunk_index INTEGER NOT NULL,
        char_start INTEGER NOT NULL,
        char_end INTEGER NOT NULL,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `

    await this.postgres.query(docsTableQuery)
    await this.postgres.query(chunksTableQuery)
  }

  private async createIndexesIfNotExists(): Promise<void> {
    const docsTable = this.config.postgres?.tableName ?? 'l3_documents'
    const chunksTable = `${docsTable}_chunks`
    const indexType = this.config.postgres?.indexType ?? 'hnsw'

    const queries = [
      `CREATE INDEX IF NOT EXISTS idx_${docsTable}_repository ON ${docsTable}(repository)`,
      `CREATE INDEX IF NOT EXISTS idx_${docsTable}_branch ON ${docsTable}(branch)`,
      `CREATE INDEX IF NOT EXISTS idx_${docsTable}_language ON ${docsTable}(language)`,
      `CREATE INDEX IF NOT EXISTS idx_${docsTable}_file_type ON ${docsTable}(file_type)`,
      `CREATE INDEX IF NOT EXISTS idx_${docsTable}_file_path ON ${docsTable}(file_path)`,
      `CREATE INDEX IF NOT EXISTS idx_${chunksTable}_document ON ${chunksTable}(document_id)`,
    ]

    // Create vector index
    if (indexType === 'hnsw') {
      queries.push(`CREATE INDEX IF NOT EXISTS idx_${chunksTable}_embedding ON ${chunksTable} USING hnsw (embedding vector_cosine_ops)`)
    }
    else {
      queries.push(`CREATE INDEX IF NOT EXISTS idx_${chunksTable}_embedding ON ${chunksTable} USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)`)
    }

    for (const query of queries) {
      try {
        await this.postgres.query(query)
      }
      catch (error) {
        console.warn(`[L3Provider] Failed to create index: ${error}`)
      }
    }
  }

  private parseDocumentRow(row: Record<string, unknown>): L3Document {
    return {
      documentId: row.document_id as string,
      filePath: row.file_path as string,
      fileName: row.file_name as string,
      fileType: row.file_type as string,
      language: row.language as string | undefined,
      repository: row.repository as string | undefined,
      branch: row.branch as string | undefined,
      version: row.version as string | undefined,
      content: row.content as string,
      chunks: [],
      metadata: row.metadata as Record<string, unknown> | undefined,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    }
  }

  private parseChunkRow(row: Record<string, unknown>): L3Chunk {
    return {
      chunkId: row.chunk_id as string,
      documentId: row.document_id as string,
      content: row.content as string,
      embedding: row.embedding as number[] | undefined,
      chunkIndex: row.chunk_index as number,
      charStart: row.char_start as number,
      charEnd: row.char_end as number,
      metadata: row.metadata as Record<string, unknown> | undefined,
    }
  }

  private parseDocumentWithChunks(docRow: Record<string, unknown>, chunkRows: Array<Record<string, unknown>>): L3Document {
    const document = this.parseDocumentRow(docRow)
    document.chunks = chunkRows.map(row => this.parseChunkRow(row))
    return document
  }
}
