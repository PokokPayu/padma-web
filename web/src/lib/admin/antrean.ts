import { createServerSupabase } from "@/lib/supabase/server";

export type Antrean = {
  skriningBaru: number;
  permintaanMenunggu: number;
  klaimMenunggu: number;
  klienBelumAktif: number;
};

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

  // Klaim pembayaran hidup di DUA tabel: sesi lepas dan paket klien. Menghitung
  // salah satunya saja membuat antrean pembayaran diam-diam separuh.
  const [skrining, permintaan, klaimSesi, klaimPaket, belumAktif] =
    await Promise.all([
      supabase
        .from("screenings")
        .select("*", kepala)
        .eq("status_tindak_lanjut", "baru"),
      supabase
        .from("booking_requests")
        .select("*", kepala)
        .eq("status", "menunggu"),
      supabase
        .from("sessions")
        .select("*", kepala)
        .eq("status_bayar", "menunggu_verifikasi"),
      supabase
        .from("client_packages")
        .select("*", kepala)
        .eq("status_bayar", "menunggu_verifikasi"),
      supabase.from("clients").select("*", kepala).is("user_id", null),
    ]);

  return {
    skriningBaru: skrining.count ?? 0,
    permintaanMenunggu: permintaan.count ?? 0,
    klaimMenunggu: (klaimSesi.count ?? 0) + (klaimPaket.count ?? 0),
    klienBelumAktif: belumAktif.count ?? 0,
  };
}
