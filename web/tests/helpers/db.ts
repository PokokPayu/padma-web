import { Client } from "pg";

/**
 * Koneksi SQL langsung ke Postgres lokal Supabase.
 *
 * Kenapa perlu, padahal test lain cukup memakai supabase-js?
 * Dua invarian yang diuji di suite ini bersifat STRUKTURAL, bukan perilaku:
 *   1. hak tabel (GRANT) peran `anon` — hidup di katalog sistem, tidak pernah
 *      terlihat lewat PostgREST;
 *   2. daftar kolom seluruh skema `public` (information_schema.columns) —
 *      PostgREST hanya mengekspos skema `public`, bukan information_schema.
 *
 * Menguji keduanya lewat API saja mustahil, dan menyimpulkannya dari perilaku
 * ("anon dapat 0 baris") justru itulah kelemahan yang sedang ditambal: 0 baris
 * bisa berarti "RLS menyaring" ATAU "hak tabel dicabut" — dua hal yang sangat
 * berbeda kekuatannya.
 */
const DEFAULT_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export function dbUrl(): string {
  return process.env.SUPABASE_DB_URL ?? DEFAULT_DB_URL;
}

/**
 * Menjalankan `fn` di dalam transaksi yang SELALU di-rollback.
 * Dipakai untuk memeriksa efek DDL (mis. hak apa yang didapat tabel BARU)
 * tanpa meninggalkan jejak apa pun di database test.
 */
export async function dalamTransaksiRollback<T>(
  fn: (jalankan: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: dbUrl() });
  await client.connect();
  try {
    await client.query("begin");
    return await fn(async (sql, params = []) => {
      const hasil = await client.query(sql, params);
      return hasil.rows as Record<string, unknown>[];
    });
  } finally {
    await client.query("rollback").catch(() => {});
    await client.end();
  }
}

export async function querySql<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const client = new Client({ connectionString: dbUrl() });
  await client.connect();
  try {
    const hasil = await client.query(sql, params);
    return hasil.rows as T[];
  } finally {
    await client.end();
  }
}
