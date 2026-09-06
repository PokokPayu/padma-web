import { createClient } from "@supabase/supabase-js";

// HANYA untuk server (route handler/server action) & script.
// Jangan pernah diimpor dari komponen client.
export function createAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
