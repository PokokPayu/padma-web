import { createServerSupabase } from "@/lib/supabase/server";
import { awalPekan, geserHari, rentangPekan } from "@/lib/owner/pekan";

export type TitikTren = {
  senin: string;   // YYYY-MM-DD
  rentang: string; // label manusia, mis. "1 – 7 Sep 2026"
  jumlah: number;
};

/**
 * Sesi SELESAI per pekan, `pekan` pekan terakhir, terlama di kiri.
 *
 * Emedernya DISIAPKAN LEBIH DULU untuk seluruh rentang, lalu diisi. Itu bukan
 * gaya: mengelompokkan baris yang ada saja — seperti `hitungRekap()` di panel
 * owner — menghasilkan ember hanya untuk pekan yang punya sesi, sehingga
 * delapan pekan tampil sebagai enam batang. Tidak ada satu angka pun yang
 * salah, tetapi trennya berbohong.
 *
 * Matematika tanggalnya dipakai ulang dari `@/lib/owner/pekan`. Impor itu
 * melintasi batas admin/owner, tetapi yang diimpor murni aritmatika kalender —
 * nol nominal, nol query — dan menyalinnya ke sini akan melahirkan definisi
 * "pekan" kedua yang bisa berpisah dari definisi yang dipakai menghitung honor.
 *
 * Memakai SESI PENGGUNA, bukan service role: RLS staf yang mengizinkan bacaan
 * ini, dan di bawah service role `user_role()` justru mengembalikan 'klien'.
 */
export async function trenSesiSelesai(
  hariIni: string,
  pekan = 8,
): Promise<TitikTren[]> {
  const seninKini = awalPekan(hariIni);
  const seninAwal = geserHari(seninKini, -7 * (pekan - 1));
  const mingguAkhir = geserHari(seninKini, 6);

  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("sessions")
    // Hanya kolom tanggal: yang dibutuhkan hanya pengelompokannya, jadi tidak
    // ada satu baris data kesehatan pun yang perlu melintas ke server render.
    .select("tanggal")
    .eq("status", "selesai")
    .gte("tanggal", seninAwal)
    .lte("tanggal", mingguAkhir)
    .returns<{ tanggal: string }[]>();

  const ember = new Map<string, number>();
  for (let i = 0; i < pekan; i++) {
    ember.set(geserHari(seninAwal, i * 7), 0);
  }
  for (const baris of data ?? []) {
    const senin = awalPekan(baris.tanggal);
    const kini = ember.get(senin);
    if (kini !== undefined) ember.set(senin, kini + 1);
  }

  return [...ember].map(([senin, jumlah]) => ({
    senin,
    rentang: rentangPekan(senin),
    jumlah,
  }));
}
