import { createAdminSupabase } from "@/lib/supabase/admin";

// Menautkan auth user ke baris clients yang emailnya sama & belum tertaut.
// Dipanggil dari server (rute /setelah-masuk) — memakai service role
// karena user klien tidak punya hak update pada tabel clients.
export async function linkClientByEmail(
  userId: string,
  email: string,
): Promise<boolean> {
  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("clients")
    .update({ user_id: userId })
    .ilike("email", email)
    .is("user_id", null)
    .select("id");
  if (error) throw error;
  if (data.length > 0) return true;
  // Tidak ada yang baru ditautkan. Ini tetap sukses bila baris klien dengan
  // email tersebut memang sudah tertaut ke user yang sama (mis. login kedua
  // kalinya). Pencocokan tetap diikat ke email agar user yang tertaut ke klien
  // lain tidak dianggap sukses untuk email yang tak punya data klien.
  const { data: existing } = await admin
    .from("clients")
    .select("id")
    .ilike("email", email)
    .eq("user_id", userId)
    .limit(1);
  return (existing ?? []).length > 0;
}
