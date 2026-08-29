import { createServerSupabase } from "@/lib/supabase/server";

export type Antrean = {
  skriningBaru: number;
  permintaanMenunggu: number;
  klaimMenunggu: number;
  klienBelumAktif: number;
};

/**
 * Jumlah klaim pembayaran yang menunggu keputusan admin.
 *
 * Fungsi tersendiri, bukan hitungan inline di `hitungAntrean()`, karena
 * saringannya adalah PAGAR — dan pagar yang tidak bisa dipanggil sendiri tidak
 * bisa diuji sendiri.
 *
 * Saringan di sini WAJIB identik dengan `susunTagihan()` di
 * `@/lib/passport/turunan` + `ambilPaket()` di `@/lib/passport/data`, yang
 * menyusun daftar yang benar-benar dilihat manusia:
 *   - sesi berpaket dibuang (`sessions.status_bayar` hanya relevan untuk sesi
 *     LEPAS; sesi dalam paket mengikuti status paketnya),
 *   - sesi batal dibuang,
 *   - hanya paket berstatus 'aktif' yang dihitung.
 *
 * Bila saringan badge berbeda dari saringan daftar, badge menghitung sesuatu
 * yang tidak pernah muncul di daftar: angkanya naik, admin membuka modulnya,
 * dan tidak menemukan satu baris pun untuk diselesaikan. Badge seperti itu
 * TIDAK BISA DIBERSIHKAN — dan alarm yang tidak bisa dipadamkan berhenti
 * dipercaya, termasuk saat ia benar.
 *
 * Klaim pembayaran hidup di DUA tabel: sesi lepas dan paket klien. Menghitung
 * salah satunya saja membuat antrean pembayaran diam-diam separuh.
 */
export async function hitungKlaimMenunggu(): Promise<number> {
  const supabase = await createServerSupabase();
  const kepala = { count: "exact" as const, head: true };

  const [sesi, paket] = await Promise.all([
    supabase
      .from("sessions")
      .select("*", kepala)
      .eq("status_bayar", "menunggu_verifikasi")
      .is("client_package_id", null)
      .neq("status", "batal"),
    supabase
      .from("client_packages")
      .select("*", kepala)
      .eq("status_bayar", "menunggu_verifikasi")
      .eq("status", "aktif"),
  ]);

  return (sesi.count ?? 0) + (paket.count ?? 0);
}

/**
 * Empat angka yang menentukan apa yang dikerjakan klinik hari ini.
 *
 * Seluruh hitungan memakai SESI PENGGUNA (`createServerSupabase`), bukan
 * service role: RLS staf yang mengizinkan bacaan ini, dan di bawah service role
 * `user_role()` justru mengembalikan 'klien' sementara `auth.uid()` NULL —
 * angkanya tetap keluar, tetapi tidak satu pun pagar ikut diperiksa.
 *
 * `head: true` + `count: 'exact'`: yang dibutuhkan hanya jumlahnya, jadi tidak
 * ada satu baris data kesehatan pun yang perlu melintas ke server render.
 */
export async function hitungAntrean(): Promise<Antrean> {
  const supabase = await createServerSupabase();
  const kepala = { count: "exact" as const, head: true };

  // Klaim pembayaran dipanggil dari `hitungKlaimMenunggu()`, tidak dihitung
  // ulang di sini: dua salinan saringan akan berpisah diam-diam pada perubahan
  // berikutnya, dan yang berpisah adalah badge versus daftarnya sendiri.
  const [skrining, permintaan, klaimMenunggu, belumAktif] = await Promise.all([
    supabase
      .from("screenings")
      .select("*", kepala)
      .eq("status_tindak_lanjut", "baru"),
    supabase
      .from("booking_requests")
      .select("*", kepala)
      .eq("status", "menunggu"),
    hitungKlaimMenunggu(),
    supabase.from("clients").select("*", kepala).is("user_id", null),
  ]);

  return {
    skriningBaru: skrining.count ?? 0,
    permintaanMenunggu: permintaan.count ?? 0,
    klaimMenunggu,
    klienBelumAktif: belumAktif.count ?? 0,
  };
}
