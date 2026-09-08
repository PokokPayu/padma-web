import { createServerSupabase } from "@/lib/supabase/server";

/**
 * HAK SESI (kredit jenjang 2) MILIK SATU KLIEN, yang masih bisa ditukar.
 *
 * Kenapa lapisan ini ada: sampai sekarang `hak_sesi` tidak dibaca satu halaman
 * pun, dan `tukar_hak_sesi()` tidak punya pemanggil di luar uji. Artinya klien
 * yang membatalkan di jendela 2–24 jam menerima kredit yang TIDAK ADA
 * TOMBOLNYA — spec menjanjikan C3-a "bisa dipakai sendiri", dan menerbitkan
 * kredit yang tak bisa dibelanjakan bukan menjalankan kebijakan.
 *
 * Dibaca lewat SESI PENGGUNA (`createServerSupabase`), bukan service role:
 * policy "hak_sesi: staf" yang mengizinkannya, dan di bawah service role
 * `user_role()` justru mengembalikan 'klien' sehingga tidak satu pun pagar ikut
 * diperiksa. `src/app/admin/**` juga memang dilarang memuat service role
 * (`tests/admin-shell.test.ts`).
 *
 * NOL RUPIAH di seluruh berkas ini, dan itu struktural: `hak_sesi` memang tidak
 * punya kolom nominal sama sekali (money firewall). Kredit di PADMA berbentuk
 * HAK SATU SESI untuk layanan yang sama, bukan saldo.
 */
export type HakKlien = {
  id: string;
  namaLayanan: string;
  /** `YYYY-MM-DD`. Diformat di komponen, bukan di sini. */
  kedaluwarsa: string;
  /** Tanggal sesi yang batal dan melahirkan hak ini; null bila haknya yatim. */
  tanggalAsal: string | null;
};

type Baris = {
  id: string;
  kedaluwarsa: string;
  services: { nama: string } | null;
  sesi_asal_id: string | null;
};

/**
 * Hak yang MASIH BISA DIPAKAI: belum ditukar, dan belum kedaluwarsa.
 *
 * `hariIni` datang sebagai ARGUMEN, tidak dibaca dari jam server: Vercel
 * berjalan UTC sementara klinik hidup di WIB, sehingga membaca jam sistem di
 * sini akan menyembunyikan hak yang sebenarnya masih berlaku selama tujuh jam
 * setiap hari — dan hak yang tidak muncul di layar adalah hak yang hangus
 * tanpa satu pun galat.
 *
 * Ambangnya `>=`, sama persis dengan `tukar_hak_sesi()` yang menolak dengan
 * `kedaluwarsa < hari ini`: daftar yang lebih longgar daripada RPC-nya akan
 * menawarkan tombol yang pasti gagal, dan daftar yang lebih ketat akan
 * menyembunyikan hak yang sebenarnya masih diterima basis data.
 */
export async function hakBerlakuKlien(clientId: string, hariIni: string): Promise<HakKlien[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("hak_sesi")
    .select("id, kedaluwarsa, sesi_asal_id, services ( nama )")
    .eq("client_id", clientId)
    .is("dipakai_sesi_id", null)
    .gte("kedaluwarsa", hariIni)
    // Yang paling dekat kedaluwarsanya paling mendesak dipakai.
    .order("kedaluwarsa", { ascending: true })
    .returns<Baris[]>();

  const baris = data ?? [];
  if (baris.length === 0) return [];

  // Tanggal sesi ASAL ditarik terpisah: `sesi_asal_id` sengaja TANPA foreign
  // key ke `sessions` (sesi bisa dihapus, hak yang sudah terbit tetap milik
  // klien), jadi PostgREST tidak punya relasi untuk di-embed.
  const asalIds = baris.map((b) => b.sesi_asal_id).filter((v): v is string => v !== null);
  const tanggalAsal = new Map<string, string>();
  if (asalIds.length > 0) {
    const { data: sesi } = await supabase
      .from("sessions")
      .select("id, tanggal")
      .in("id", asalIds)
      .returns<{ id: string; tanggal: string }[]>();
    for (const s of sesi ?? []) tanggalAsal.set(s.id, s.tanggal);
  }

  return baris.map((b) => ({
    id: b.id,
    namaLayanan: b.services?.nama ?? "Layanan",
    kedaluwarsa: b.kedaluwarsa,
    tanggalAsal: b.sesi_asal_id ? (tanggalAsal.get(b.sesi_asal_id) ?? null) : null,
  }));
}
