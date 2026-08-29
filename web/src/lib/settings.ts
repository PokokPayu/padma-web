import { createAdminSupabase } from "@/lib/supabase/admin";
import { keFormatLokal, nomorWaTerpakai } from "@/lib/pengaturan/bentuk";

/**
 * Nomor WhatsApp resmi klinik untuk halaman PUBLIK (landing, skrining, passport).
 *
 * `app_settings` sengaja tertutup untuk anon (migration cabut_grant_anon_berlebih),
 * jadi nilainya hanya bisa dibaca dari server dengan service role. Panel admin
 * TIDAK memakai fungsi ini — ia membaca lewat sesi penggunanya sendiri
 * (`@/lib/admin/pengaturan`), supaya RLS staf ikut diperiksa.
 *
 * Penjagaannya ada pada NILAI, bukan pada keberadaan baris. Bentuk lama —
 * nomor bawaan ditempel langsung dengan `??` — hanya menyala ketika BARISNYA
 * hilang, dan nomor literal itu hidup di dua tempat sekaligus; nilai `""`
 * lolos apa adanya menjadi `nomorWaLink === ""` dan seluruh kanal konversi
 * menerbitkan `https://wa.me/` — rusak untuk setiap pengunjung, tanpa error.
 * Aturannya kini tinggal di satu tempat, `@/lib/pengaturan/bentuk`, yang juga
 * dipakai server action penyimpannya.
 */
export async function bacaPengaturan() {
  const admin = createAdminSupabase();
  const { data } = await admin
    .from("app_settings")
    .select("key, value")
    .eq("key", "nomor_wa")
    .maybeSingle();

  const link = nomorWaTerpakai(data?.value as string | undefined);
  return { nomorWaLink: link, nomorWaTampilan: keFormatLokal(link) };
}
