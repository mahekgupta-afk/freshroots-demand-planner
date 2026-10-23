import { neon } from "@neondatabase/serverless";

export type Row = Record<string, unknown>;
export type Query = (text: string, params?: unknown[]) => Promise<Row[]>;

export const dbConfigured = () => Boolean(process.env.DATABASE_URL);

/**
 * Query function over Neon's HTTP driver. Server only: DATABASE_URL is a full-access credential.
 * Note: numeric columns come back as strings, so cast to float8 in SQL where numbers are needed.
 */
export function neonQuery(): Query {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = neon(url);
  return (text, params = []) => sql.query(text, params) as Promise<Row[]>;
}
