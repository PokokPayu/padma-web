import { cache } from "react";
import { createServerSupabase } from "@/lib/supabase/server";
import { profilSaatIni } from "@/lib/auth/sesi";
import { ambilSesiMenungguTarif } from "@/lib/owner/data";

export type Antrean = {
  skriningBaru: number;
  permintaanMenunggu: number;
  klaimMenunggu: number;
  klienBelumAktif: number;
  /** Sesi >20 km yang menunggu owner menetapkan tarif khusus. Lihat
   *  `hitungMenungguTarifTransport()` di bawah untuk kenapa angkanya 0 bagi
   *  admin biasa. */
  menungguTarifTransport: number;
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
 * Sesi >20 km yang menunggu OWNER menetapkan tarif khususnya.
 *
 * Saringannya WAJIB identik dengan `ambilSesiMenungguTarif()` di
 * `lib/owner/data.ts` — karena itu fungsi ini MEMANGGIL fungsi itu langsung,
 * bukan menulis ulang predikatnya ("jenjang di_atas_20, belum punya baris
 * transport_khusus, bukan sesi batal") kedua kalinya di berkas ini. Dua
 * salinan predikat yang sama akan berpisah diam-diam pada perubahan
 * berikutnya, dan perpisahan itu berbentuk badge yang menghitung sesuatu yang
 * tidak pernah muncul di daftarnya — badge seperti itu TIDAK BISA
 * DIBERSIHKAN, dan alarm yang tidak bisa dipadamkan berhenti dipercaya,
 * termasuk saat ia benar.
 *
 * PENJAGA PERAN, dan alasannya bukan soal wewenang menulis (itu sudah
 * dijaga `tetapkanTarifKhusus`), melainkan soal apa yang RLS izinkan
 * DIBACA: `transport_khusus` hanya boleh dibaca OWNER (policy "transport_
 * khusus: hanya owner"). Admin biasa yang memanggil `ambilSesiMenungguTarif()`
 * akan mendapat SELECT KOSONG dari `transport_khusus` untuk SETIAP baris —
 * bukan karena barisnya belum ada, melainkan karena RLS menyembunyikannya
 * dari perannya. Menghitung "belum punya baris" dari kekosongan itu akan
 * membuat badge MENGGEMBUNG: sesi yang tarifnya SUDAH ditetapkan owner tetap
 * terhitung "menunggu" di mata admin, dan admin tidak punya cara
 * membersihkannya — persis alarm tak-terpadamkan yang diperingatkan di atas.
 *
 * Karena itu angka ini hanya dihitung SUNGGUHAN saat pemanggilnya OWNER (yang
 * — sebagai superset admin — memang bisa membuka `/admin`); untuk admin biasa
 * ia sengaja 0. Itu bukan angka yang salah, melainkan angka yang JUJUR:
 * admin tidak berwenang menetapkan tarif khusus sama sekali
 * (`tetapkanTarifKhusus` menuntut `requireRole(["owner"])`), jadi antrean yang
 * tidak bisa ia tindaklanjuti bukan miliknya untuk dilihat.
 */
export async function hitungMenungguTarifTransport(): Promise<number> {
  const profil = await profilSaatIni();
  if (profil?.role !== "owner") return 0;

  const menunggu = await ambilSesiMenungguTarif();
  return menunggu.length;
}

/**
 * Lima angka yang menentukan apa yang dikerjakan klinik hari ini.
 *
 * Seluruh hitungan memakai SESI PENGGUNA (`createServerSupabase`), bukan
 * service role: RLS staf yang mengizinkan bacaan ini, dan di bawah service role
 * `user_role()` justru mengembalikan 'klien' sementara `auth.uid()` NULL —
 * angkanya tetap keluar, tetapi tidak satu pun pagar ikut diperiksa.
 *
 * `head: true` + `count: 'exact'`: yang dibutuhkan hanya jumlahnya, jadi tidak
 * ada satu baris data kesehatan pun yang perlu melintas ke server render.
 *
 * Dibungkus `cache()` dari React: `layout.tsx` memanggilnya untuk badge
 * sidebar dan `page.tsx` memanggilnya lagi untuk keempat StatTile, dua
 * pemanggil di SATU render yang sama pada satu request. Tanpa `cache()`, itu
 * seluruh query di bawah (ditambah query `hitungKlaimMenunggu()` dan
 * `hitungMenungguTarifTransport()` sendiri) DUA KALI untuk satu tampilan
 * halaman — `cache()` membuat pemanggilan kedua memakai hasil yang sama
 * dengan yang pertama alih-alih membaca ulang basis data.
 */
export const hitungAntrean = cache(async function hitungAntrean(): Promise<Antrean> {
  const supabase = await createServerSupabase();
  const kepala = { count: "exact" as const, head: true };

  // Klaim pembayaran dan tarif transport menunggu dipanggil dari fungsi
  // tersendiri masing-masing (`hitungKlaimMenunggu()`,
  // `hitungMenungguTarifTransport()`), tidak dihitung ulang di sini: dua
  // salinan saringan akan berpisah diam-diam pada perubahan berikutnya, dan
  // yang berpisah adalah badge versus daftarnya sendiri.
  const [skrining, permintaan, klaimMenunggu, belumAktif, menungguTarifTransport] =
    await Promise.all([
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
      hitungMenungguTarifTransport(),
    ]);

  return {
    skriningBaru: skrining.count ?? 0,
    permintaanMenunggu: permintaan.count ?? 0,
    klaimMenunggu,
    klienBelumAktif: belumAktif.count ?? 0,
    menungguTarifTransport,
  };
});
