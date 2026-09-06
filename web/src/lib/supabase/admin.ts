import { createClient } from "@supabase/supabase-js";

// Fetch asli, direkam SEKALI saat modul ini pertama dimuat — sebelum kode
// mana pun (termasuk uji) sempat mengganti `fetch` global. supabase-js
// menyelesaikan `fetch` secara DINAMIS pada setiap panggilan (bukan sekali
// saat klien dibuat), jadi tanpa penguncian ini, uji yang men-stub `fetch`
// global untuk memalsukan panggilan KELUAR (mis. Nominatim di
// lib/transport/geocode.ts) ikut membajak panggilan klien admin ke Supabase
// sendiri. Klien admin harus selalu bicara ke Supabase sungguhan.
const fetchAsli = globalThis.fetch;

// HANYA untuk server (route handler/server action) & script.
// Jangan pernah diimpor dari komponen client.
export function createAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: fetchAsli },
    },
  );
}
