"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Jalur tulis panel admin untuk antrean permintaan jadwal.
 *
 * Empat aturan yang mengikat berkas ini:
 *
 *  1. Server action adalah ENDPOINT POST TERSENDIRI. Penjaga di
 *     `src/app/admin/layout.tsx` tidak pernah dilewati saat action dipanggil
 *     langsung, jadi `requireRole(["admin","owner"])` ditulis DI DALAM setiap
 *     action. Tanpa itu, klien yang login bisa menyetujui permintaan jadwalnya
 *     sendiri — celah yang pernah nyata di proyek ini.
 *
 *  2. KEADAAN TUJUAN TIDAK PERNAH MENJADI PARAMETER. Karena itu ada dua action
 *     terpisah, `konfirmasiPermintaan` dan `tolakPermintaan`, masing-masing
 *     dengan status tertulis mati di dalamnya.
 *
 *  3. IDENTITAS KLIEN DIBACA DARI BARIS PERMINTAAN, bukan dari pemanggil. Bila
 *     `client_id`/`service_id` datang dari payload, satu POST yang dikarang
 *     bisa melahirkan sesi atas nama klien lain — dan sesi itu akan tampil di
 *     passport orang tersebut sebagai janji yang tidak pernah ia minta.
 *
 *  4. Sesi pengguna, bukan service role. Di bawah service role `user_role()`
 *     mengembalikan 'klien' dan `auth.uid()` NULL: policy `booking: staf` dan
 *     `sessions: staf` tidak pernah ikut diperiksa.
 *
 * Berkas `"use server"` hanya boleh mengekspor fungsi async — label dan daftar
 * putih tinggal di `status.ts`.
 */
type Gagal = { ok: false; pesan: string };
type Berhasil = { ok: true };

/**
 * Mengubah satu permintaan jadwal menjadi sesi terjadwal.
 *
 * Hanya DUA nilai yang boleh datang dari luar: permintaan mana, dan mitra siapa
 * yang ditugaskan. Tanggal, klien, dan layanan dibaca dari baris permintaannya.
 */
export async function konfirmasiPermintaan(
  permintaanId: string,
  partnerId: string,
): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();

  // Mitra diperiksa SEBELUM permintaan diklaim. Dua alasan: (a) foreign key
  // hanya menolak partner_id yang TIDAK ADA, bukan mitra yang sudah pensiun,
  // sedangkan daftar pilihan di UI menyaring `aktif` — dan action ini tidak
  // pernah melewati UI itu; (b) memeriksanya belakangan berarti permintaan
  // sudah terlanjur keluar dari antrean untuk sesuatu yang pasti gagal.
  const { data: mitra } = await supabase
    .from("partners")
    .select("id")
    .eq("id", partnerId)
    .eq("aktif", true)
    .maybeSingle();

  if (!mitra) {
    return { ok: false, pesan: "Mitra tidak tersedia. Pilih mitra yang aktif." };
  }

  // KLAIM DULU, baru buat sesi. Urutan ini penting: bila sesi dibuat lebih dulu
  // lalu klaim gagal, tertinggal sesi yatim sementara permintaannya tetap di
  // antrean menunggu dikonfirmasi untuk kedua kalinya.
  //
  // `eq("status","menunggu")` bukan sekadar validasi: ia yang menyerialkan dua
  // konfirmasi paralel. Transaksi kedua menunggu kunci baris, lalu menilai
  // ulang syaratnya terhadap baris yang sudah berubah — dan tidak mengenai apa
  // pun. Index unik `sessions_booking_request_unik` adalah jaring keduanya.
  const { data: klaim } = await supabase
    .from("booking_requests")
    .update({ status: "dikonfirmasi" })
    .eq("id", permintaanId)
    .eq("status", "menunggu")
    .select("id, client_id, service_id, tanggal");

  // UPDATE yang tidak mengenai baris mana pun dijawab PostgREST dengan 200 + []
  // — melaporkan "berhasil" tanpa memeriksa jumlah barisnya adalah kebohongan
  // senyap, dan di sini kebohongannya berbentuk sesi yang tidak pernah lahir.
  if ((klaim ?? []).length === 0) {
    return { ok: false, pesan: "Permintaan sudah ditangani atau tidak ditemukan." };
  }
  const p = klaim![0];

  const { error } = await supabase.from("sessions").insert({
    client_id: p.client_id,
    service_id: p.service_id,
    partner_id: partnerId,
    tanggal: p.tanggal,
    status: "terjadwal",
    booking_request_id: p.id,
  });

  if (error) {
    // Kembalikan ke antrean supaya permintaan tidak hilang diam-diam. Syarat
    // `eq("status","dikonfirmasi")` menjaga agar pengembalian ini tidak pernah
    // menimpa keputusan orang lain yang sempat masuk di sela-selanya.
    await supabase
      .from("booking_requests")
      .update({ status: "menunggu" })
      .eq("id", p.id)
      .eq("status", "dikonfirmasi");
    return { ok: false, pesan: "Gagal membuat sesi. Coba lagi." };
  }

  revalidatePath("/admin/sesi");
  revalidatePath("/admin");
  // Sesi baru langsung tampil di passport klien sebagai jadwal berikutnya.
  revalidatePath("/passport");
  return { ok: true };
}

/**
 * Menolak permintaan jadwal — hanya dari antrean.
 *
 * Permintaan yang sudah dikonfirmasi TIDAK bisa dibatalkan lewat sini: sesinya
 * sudah lahir, dan memutar status permintaan hanya akan membuat sesi itu
 * kehilangan asal-usulnya tanpa membatalkan apa pun. Pembatalan sesi adalah
 * status `batal` pada sesinya sendiri.
 */
export async function tolakPermintaan(permintaanId: string): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from("booking_requests")
    .update({ status: "ditolak" })
    .eq("id", permintaanId)
    .eq("status", "menunggu")
    .select("id");

  if (error || (data ?? []).length === 0) {
    return { ok: false, pesan: "Permintaan sudah ditangani atau tidak ditemukan." };
  }

  revalidatePath("/admin/sesi");
  revalidatePath("/admin");
  revalidatePath("/passport");
  return { ok: true };
}
