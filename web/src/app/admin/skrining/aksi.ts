"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { buatKlien } from "../klien/aksi";
import {
  STATUS_SAH,
  phaseIdDariFaseSkrining,
  type StatusTindakLanjut,
} from "./status";

type Gagal = { ok: false; pesan: string };
type Dikonversi = { ok: true; clientId: string; padmaId: string };

type SkriningRingkas = {
  id: string;
  nama: string;
  no_hp: string;
  fase: string;
  client_id: string | null;
};

export async function ubahTindakLanjut(id: string, status: string) {
  await requireRole(["admin", "owner"]);
  if (!STATUS_SAH.includes(status as StatusTindakLanjut)) return;

  // RLS "screenings: staf" yang menjadi penjaga sesungguhnya — kita memakai
  // sesi pengguna (bukan service role) supaya haknya ikut diperiksa Postgres.
  // Hanya kolom status yang disentuh: hasil/flags/jawaban adalah rekaman
  // jawaban asli klien dan tidak boleh bisa diedit dari inbox.
  const supabase = await createServerSupabase();
  await supabase.from("screenings").update({ status_tindak_lanjut: status }).eq("id", id);
  revalidatePath("/admin/skrining");
}

/**
 * Mengubah satu baris skrining menjadi klien terdaftar.
 *
 * Inilah satu-satunya kode di seluruh aplikasi yang mengisi
 * `screenings.client_id`. Kolom itu ada sejak migration pertama tetapi tidak
 * pernah tersentuh: sampai sekarang inbox dan daftar klien adalah dua dunia
 * yang hanya disambung oleh ingatan admin.
 *
 * Empat aturan yang mengikat fungsi ini:
 *
 *  1. `requireRole` DI DALAM action. Server action adalah endpoint POST
 *     tersendiri — penjaga di `src/app/admin/layout.tsx` tidak pernah dilewati
 *     saat action dipanggil langsung.
 *
 *  2. FASE DIBACA DARI BARIS SKRINING, tidak pernah dari formulir, lalu
 *     dilewatkan daftar putih `FASE_SKRINING_KE_PHASE`. Foreign key `phases`
 *     tidak menolong di sini: `newborn` adalah fase yang sah tetapi tidak
 *     pernah lahir dari skrining, dan klien yang salah fase menerima rencana
 *     serta materi orang lain tanpa satu pun error.
 *
 *  3. PEMBUATAN KLIEN DIPINJAM DARI MODUL KLIEN (`buatKlien`). PADMA ID
 *     berkalender Jakarta, normalisasi email, penanganan bentrok 23505, dan
 *     larangan menyentuh kolom penautan akun sudah dijaga di sana — menyalinnya
 *     ulang di sini berarti dua tempat yang harus ikut berubah setiap kali satu
 *     aturan bergeser, dan hanya satu yang akan diingat.
 *
 *  4. PENAUTAN DITULIS BERSYARAT (`is("client_id", null)`). Itu yang
 *     menyerialkan dua klik "Jadikan klien" pada baris yang sama: klik kedua
 *     menilai ulang syaratnya terhadap baris yang sudah berubah dan tidak
 *     mengenai apa pun, alih-alih menggeser tautan yang sudah benar.
 *
 * Baris skrining itu sendiri TIDAK pernah ditulis ulang isinya. Nama dan nomor
 * yang dikoreksi admin masuk ke baris klien; jawaban, hasil, dan flags tetap
 * apa adanya sebagai rekaman jawaban asli.
 */
export async function jadikanKlien(
  skriningId: string,
  formData: FormData,
): Promise<Dikonversi | Gagal> {
  await requireRole(["admin", "owner"]);

  // Sesi pengguna, bukan service role: policy `screenings: staf` yang
  // mengizinkan baris ini terbaca, dan itulah penjaga yang ingin ikut berjalan.
  const supabase = await createServerSupabase();

  const { data: skrining } = await supabase
    .from("screenings")
    .select("id, nama, no_hp, fase, client_id")
    .eq("id", skriningId)
    .maybeSingle<SkriningRingkas>();

  if (!skrining) return { ok: false, pesan: "Skrining tidak ditemukan." };
  if (skrining.client_id !== null) {
    return {
      ok: false,
      pesan: "Skrining ini sudah pernah dijadikan klien. Buka halaman kliennya.",
    };
  }

  const phaseId = phaseIdDariFaseSkrining(skrining.fase);
  if (!phaseId) {
    return {
      ok: false,
      pesan: "Fase pada skrining ini tidak dikenal. Daftarkan lewat menu Klien.",
    };
  }

  // Hanya nama & nomor yang boleh dikoreksi admin — sisanya tidak berasal dari
  // formulir sama sekali. Yang kosong jatuh kembali ke isi baris skrining.
  const isian = new FormData();
  isian.set("nama", String(formData.get("nama") ?? "").trim() || skrining.nama);
  isian.set("no_hp", String(formData.get("no_hp") ?? "").trim() || skrining.no_hp);
  isian.set("email", String(formData.get("email") ?? ""));
  isian.set("fase", phaseId);

  const klien = await buatKlien(isian);
  if (!klien.ok) return klien;

  const { data: tertaut, error } = await supabase
    .from("screenings")
    .update({ client_id: klien.id, status_tindak_lanjut: "jadi_klien" })
    .eq("id", skriningId)
    .is("client_id", null)
    .select("id");

  // UPDATE yang tidak mengenai baris mana pun dijawab PostgREST 200 + []. Di
  // sini artinya seseorang mendahului pada detik yang sama: klien SUDAH lahir,
  // jadi kalimatnya harus mengatakan itu — bukan "gagal" yang membuat admin
  // menekan tombolnya lagi dan melahirkan orang kedua.
  if (error || (tertaut ?? []).length === 0) {
    return {
      ok: false,
      pesan: `Klien ${klien.padmaId} tersimpan, tetapi skriningnya sudah tertaut lebih dulu. Periksa di menu Klien.`,
    };
  }

  revalidatePath("/admin/skrining");
  revalidatePath("/admin/klien");
  revalidatePath("/admin");
  return { ok: true, clientId: klien.id, padmaId: klien.padmaId };
}
