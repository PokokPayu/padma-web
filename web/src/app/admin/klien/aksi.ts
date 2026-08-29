"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { buatPadmaId } from "@/lib/admin/padma-id";
import { normalizeEmail } from "@/lib/auth/link-client";

/**
 * Jalur tulis panel admin untuk data klien.
 *
 * Tiga aturan yang mengikat berkas ini:
 *
 *  1. Server action adalah ENDPOINT POST TERSENDIRI. Penjaga di
 *     `src/app/admin/layout.tsx` tidak pernah dilewati saat action dipanggil
 *     langsung, jadi `requireRole(["admin","owner"])` ditulis DI DALAM setiap
 *     action — bukan sekali di puncak modul.
 *
 *  2. Sesi pengguna, bukan service role. Di bawah service role `user_role()`
 *     mengembalikan 'klien' dan `auth.uid()` NULL: policy `clients: staf`
 *     tidak pernah ikut diperiksa dan trigger penjaga tidak menyala. Yang
 *     mengizinkan tulis di sini adalah RLS staf, dan itu memang yang diuji.
 *
 *  3. Kolom penautan akun tidak pernah disentuh dari sini. Baris klien selalu
 *     lahir belum tertaut; yang berhak menautkannya hanyalah server lewat
 *     token undangan sekali pakai (lihat `@/lib/auth/link-client`). Trigger
 *     `guard_client_link` menolak peran API — admin & owner sekalipun.
 *
 * Berkas `"use server"` hanya boleh mengekspor fungsi async. Konstanta apa pun
 * yang perlu dibagi ke UI wajib tinggal di modul lain.
 */
type Gagal = { ok: false; pesan: string };
type Dibuat = { ok: true; id: string; padmaId: string };
type Diperbarui = { ok: true };

// Rupa email diperiksa apa adanya — kepemilikan alamatnya dibuktikan kemudian
// oleh token undangan, bukan oleh regex ini.
const POLA_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Berapa kali nomor PADMA ID berikutnya dicoba saat dua admin menekan "simpan"
// pada detik yang sama. Bentroknya ditolak indeks unik `clients_padma_id_key`
// (23505) — bukan diam-diam menimpa klien lain.
const PERCOBAAN_ID = 5;

export async function buatKlien(formData: FormData): Promise<Dibuat | Gagal> {
  await requireRole(["admin", "owner"]);

  const nama = String(formData.get("nama") ?? "").trim();
  const alamatSurel = normalizeEmail(String(formData.get("email") ?? ""));
  const noHp = String(formData.get("no_hp") ?? "").trim();
  const faseId = String(formData.get("fase") ?? "").trim();

  if (nama.length < 2) return { ok: false, pesan: "Nama terlalu pendek." };
  if (!POLA_EMAIL.test(alamatSurel)) {
    return { ok: false, pesan: "Alamat email tidak sah." };
  }
  if (!faseId) return { ok: false, pesan: "Fase wajib dipilih." };

  const supabase = await createServerSupabase();

  for (let percobaan = 0; percobaan < PERCOBAAN_ID; percobaan++) {
    const padmaId = await buatPadmaId(supabase);

    const { data, error } = await supabase
      .from("clients")
      .insert({
        padma_id: padmaId,
        nama,
        email: alamatSurel,
        no_hp: noHp,
        phase_id: faseId,
      })
      .select("id")
      .single();

    if (!error && data) {
      revalidatePath("/admin/klien");
      return { ok: true, id: data.id as string, padmaId };
    }

    if (error?.code === "23505") {
      // Dua sumber bentrok yang sangat berbeda artinya: alamat surel yang
      // sudah terpakai (kesalahan manusia — beri kalimat) versus nomor PADMA
      // yang direbut admin lain pada detik yang sama (coba nomor berikutnya).
      if (error.message.includes("email")) {
        return { ok: false, pesan: "Alamat itu sudah dipakai klien lain." };
      }
      continue;
    }

    // 23503 (fase tidak dikenal), 42501 (peran ditolak RLS), dan sisanya:
    // pesan generik — detail Postgres tidak pernah dilemparkan ke layar.
    return { ok: false, pesan: "Gagal menyimpan klien." };
  }

  return { ok: false, pesan: "Nomor PADMA ID sedang berebut. Coba simpan lagi." };
}

export async function perbaruiKlien(
  id: string,
  formData: FormData,
): Promise<Diperbarui | Gagal> {
  await requireRole(["admin", "owner"]);

  const nama = String(formData.get("nama") ?? "").trim();
  const noHp = String(formData.get("no_hp") ?? "").trim();
  const faseId = String(formData.get("fase") ?? "").trim();

  if (nama.length < 2) return { ok: false, pesan: "Nama terlalu pendek." };
  if (!faseId) return { ok: false, pesan: "Fase wajib dipilih." };

  const supabase = await createServerSupabase();

  // Hanya tiga kolom operasional yang pernah menyentuh basis data. Medan lain
  // yang ikut dikirim browser diabaikan tanpa pernah masuk payload — termasuk
  // alamat surel (kunci pencocokan saat aktivasi) dan kolom penautan akun.
  const { data, error } = await supabase
    .from("clients")
    .update({ nama, no_hp: noHp, phase_id: faseId })
    .eq("id", id)
    .select("id");

  // UPDATE yang tertahan RLS dijawab PostgREST dengan 200 + [] — melaporkan
  // "berhasil" tanpa memeriksa jumlah barisnya adalah kebohongan senyap.
  if (error || (data ?? []).length === 0) {
    return { ok: false, pesan: "Gagal memperbarui klien." };
  }

  revalidatePath("/admin/klien");
  revalidatePath(`/admin/klien/${id}`);
  return { ok: true };
}
