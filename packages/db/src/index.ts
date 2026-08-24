import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { schema } from "./schema";

export function createDatabase(connectionString: string) {
  const pool = new Pool({ connectionString, max: 20 });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

export type Database = ReturnType<typeof createDatabase>["db"];

export * from "./schema";
