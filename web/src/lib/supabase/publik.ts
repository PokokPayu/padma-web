import { createClient } from "@supabase/supabase-js";

/**
 * Klien anon tanpa cookie untuk halaman publik (pola `klienPublik` di
 * `@/lib/katalog`): tidak membuat halaman dynamic, jalan di luar request
 * scope, dan hanya melihat baris yang dibuka policy `to anon`.
 */
export function createPublikSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
