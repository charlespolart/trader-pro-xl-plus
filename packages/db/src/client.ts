import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export type Db = PostgresJsDatabase<typeof schema>

export function createDb(url?: string): Db {
  const dbUrl = url ?? process.env.DATABASE_URL ?? 'postgres://tpx:tpx@localhost:5432/tpx'
  const client = postgres(dbUrl, {
    max: 10,
    onnotice: () => {},
  })
  return drizzle(client, { schema })
}

let singleton: Db | null = null

/** lazy process-wide instance (workers create their own via createDb) */
export function getDb(): Db {
  if (!singleton) singleton = createDb()
  return singleton
}
