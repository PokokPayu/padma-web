import { createAdminSupabase } from "@/lib/supabase/admin";

/**
 * Email dinormalkan (trim + huruf kecil) sebelum dipakai membandingkan.
 * DB menyimpan clients.email dalam bentuk yang sama (trigger
 * `clients_normalize_email` + constraint `clients_email_lowercase`, migration
 * 20260828114500), jadi `email = normalizeEmail(input)` setara dengan
 * `lower(email) = lower(input)` — tetap buta kapitalisasi, tapi PERSIS.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Menautkan auth user ke baris clients yang emailnya sama & belum tertaut.
// Dipanggil dari server (rute /setelah-masuk) — memakai service role
// karena user klien tidak punya hak update pada tabel clients.
//
// PENTING (celah yang pernah terjadi): pencocokan email WAJIB memakai `.eq()`.
// `.ilike()` diterjemahkan PostgREST ke SQL LIKE, sehingga `%` dan `_` pada
// email penyerang menjadi wildcard dan menautkan akunnya ke baris klien orang
// lain — membocorkan catatan sesi/rekomendasi (data kesehatan, UU PDP).
export async function linkClientByEmail(
  userId: string,
  email: string,
): Promise<boolean> {
  const emailNormal = normalizeEmail(email);
  if (!emailNormal) return false;

  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("clients")
    .update({ user_id: userId })
    .eq("email", emailNormal)
    .is("user_id", null)
    .select("id");
  if (error) throw error;
  if (data.length > 0) return true;
  // Tidak ada yang baru ditautkan. Ini tetap sukses bila baris klien dengan
  // email tersebut memang sudah tertaut ke user yang sama (mis. login kedua
  // kalinya). Pencocokan tetap diikat ke email — dan tetap `.eq()`, bukan pola —
  // agar user yang tertaut ke klien lain tidak dianggap sukses untuk email yang
  // tak punya data klien.
  const { data: existing } = await admin
    .from("clients")
    .select("id")
    .eq("email", emailNormal)
    .eq("user_id", userId)
    .limit(1);
  return (existing ?? []).length > 0;
}
