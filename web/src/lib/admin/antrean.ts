import { cache } from "react";
import { createServerSupabase } from "@/lib/supabase/server";
import { ambilSesiMenungguTarif } from "@/lib/owner/data";
import { PAKET_TAMPIL } from "@/lib/paket-tampil";

export type Antrean = {
  skriningBaru: number;
  permintaanMenunggu: number;
  klaimMenunggu: number;
  klienBelumAktif: number;
  /** Sesi >20 km yang menunggu owner menetapkan tarif khusus. */
  menungguTarifTransport: number;
  /**
   * Sesi SELESAI yang jenjang transportnya masih null — jaraknya tidak
   * pernah diketahui, entah karena sesi lahir sebelum kolom ini ada atau
   * karena geocoding sesi baru gagal (Ruling 24). Lihat
   * `hitungMenungguJenjangTransport()` di bawah.
   */
  menungguJenjangTransport: number;
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

  // GERBANG SAKLAR (K11): badge angka harus cocok dengan jumlah baris yang
  // benar-benar tampil di tabel. Menghitung klaim paket yang barisnya
  // disembunyikan akan memunculkan angka yang tidak bisa ditemukan admin di
  // layar mana pun — bentuk kesalahan yang paling melelahkan untuk dilacak.
  const jumlahPaket = PAKET_TAMPIL ? (paket.count ?? 0) : 0;
  return (sesi.count ?? 0) + jumlahPaket;
}

/**
 * Sesi >20 km yang menunggu OWNER menetapkan tarif khususnya.
 *
 * Saringannya WAJIB identik dengan `ambilSesiMenungguTarif()` di
 * `lib/owner/data.ts` — karena itu fungsi ini MEMANGGIL fungsi itu langsung,
 * bukan menulis ulang predikatnya kedua kalinya di berkas ini. Dua salinan
 * predikat yang sama akan berpisah diam-diam pada perubahan berikutnya, dan
 * perpisahan itu berbentuk badge yang menghitung sesuatu yang tidak pernah
 * muncul di daftarnya — badge seperti itu TIDAK BISA DIBERSIHKAN, dan alarm
 * yang tidak bisa dipadamkan berhenti dipercaya, termasuk saat ia benar.
 *
 * >>> Ruling 12 (coordinator, Task 8 fix round 1) <<<
 * Draf pertama berkas ini menggerbangi angka ini dengan pemeriksaan peran
 * (`profilSaatIni().role !== "owner"` → 0), karena RLS "transport_khusus:
 * hanya owner" membuat `ambilSesiMenungguTarif()` versi lama (dua bacaan
 * terpisah) SALAH menghitung sebagai admin — setiap sesi `di_atas_20` tampak
 * "menunggu", termasuk yang sudah ditetapkan tarifnya. Gerbang itu
 * MEMINDAHKAN masalah, bukan menutupnya: bagi admin angkanya jadi KONSTANTA
 * nol, bukan saringan, padahal admin-lah yang sehari-hari mengerjakan
 * antrean klinik.
 *
 * Perbaikannya bukan gerbang peran di TypeScript, melainkan `security_
 * invoker = off` di SQL: `ambilSesiMenungguTarif()` kini membaca VIEW
 * `sesi_menunggu_tarif_transport` (migrasi `20260907140000`) yang melakukan
 * anti-join-nya sendiri dengan hak PEMILIK view, sehingga admin memperoleh
 * ANGKA YANG BENAR tanpa pernah butuh hak baca `transport_khusus` — batas
 * kolomnya ada di proyeksi view (nol nominal), bukan di gerbang peran
 * TypeScript. Tidak ada lagi pemeriksaan peran di fungsi ini.
 */
export async function hitungMenungguTarifTransport(): Promise<number> {
  // (Ruling 26, gelombang perbaikan akhir) TIDAK membiarkan galat dari
  // `ambilSesiMenungguTarif()` menembus ke pemanggil — sengaja BEDA dari
  // fungsi itu sendiri, yang justru THROW pada galat baca.
  //
  // `ambilSesiMenungguTarif()` melempar karena pemanggilnya di
  // `/owner/transport` adalah OWNER yang membaca DAFTAR untuk mengambil
  // keputusan uang — daftar yang diam-diam terpotong tanpa satu pun tanda
  // adalah persis lubang yang ditutup Ruling 12 (pagination senyap). Owner
  // WAJIB tahu bila daftarnya tidak lengkap; membungkam galat di sana berarti
  // owner menetapkan tarif dari daftar yang sudah salah tanpa sadar.
  //
  // Fungsi INI dipanggil dari `hitungAntrean()`, yang dipanggil sekali per
  // render dari `app/admin/layout.tsx` — shell yang membungkus /admin/bayar,
  // /admin/sesi, DAN /admin/skrining sekaligus. Fungsi itu memakai
  // `Promise.all`: satu promise yang REJECT menjatuhkan seluruh Promise.all,
  // dan satu galat baca (timeout, atau PGRST205 saat schema cache PostgREST
  // belum reload sesudah deploy) akan menampilkan 500 untuk TIGA modul admin
  // sekaligus — hanya karena SATU badge gagal dihitung. Empat penghitung lain
  // di `hitungAntrean()` sudah degradasi ke 0 pada galat (`.count ?? 0`);
  // fungsi ini menjaga disiplin yang sama: badge yang sempat salah (0,
  // padahal ada sesi menunggu) jauh lebih murah daripada panel admin yang
  // mati total.
  try {
    const menunggu = await ambilSesiMenungguTarif();
    return menunggu.length;
  } catch {
    return 0;
  }
}

/**
 * Sesi SELESAI yang jenjang transportnya masih `null` — jaraknya tidak
 * pernah diketahui.
 *
 * Dua sumber `jenjang = null` (Ruling 24): sesi pra-migrasi (sebelum kolom
 * ini ada, tidak akan pernah terisi retroaktif — lihat `lib/owner/rekap.ts`)
 * dan sesi baru yang geocoding-nya gagal (alamat tak dikenal OSM). Predikat
 * `status = 'selesai'` di view sengaja menyaring keduanya menjadi satu: sesi
 * TERJADWAL yang belum bermitra memang wajar null (belum ada yang perlu
 * dihitung), dan hanya sesi SELESAI yang berarti "honornya sedang dihitung
 * salah hari ini" (lihat komentar `hitungRekap()`).
 *
 * Dibaca lewat VIEW `sesi_menunggu_jenjang_transport` (migrasi
 * `20260907150000`), pola persis `sesi_menunggu_tarif_transport` di atas:
 * nol nominal, `security_invoker = off`. `count: 'exact', head: true` tidak
 * pernah throw pada galat (beda dari `ambilSesiMenungguTarif`) — `?? 0` sudah
 * cukup, sejalan dengan keempat penghitung lain di `hitungAntrean()`.
 *
 * Kemampuan memperbaikinya SUDAH ADA — `tetapkanJenjang`
 * (`app/admin/sesi/aksi.ts`, dipanggil dari laci "ubah jenjang" di
 * `form-selesai.tsx`) tidak memeriksa status maupun peran selain admin/owner.
 * Yang hilang sebelumnya hanya antrean yang menunjuk sesi mana.
 */
export async function hitungMenungguJenjangTransport(): Promise<number> {
  const supabase = await createServerSupabase();
  const { count } = await supabase
    .from("sesi_menunggu_jenjang_transport")
    .select("*", { count: "exact", head: true });
  return count ?? 0;
}

/**
 * Enam angka yang menentukan apa yang dikerjakan klinik hari ini.
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
 * sidebar dan `page.tsx` memanggilnya lagi untuk keenam StatTile, dua
 * pemanggil di SATU render yang sama pada satu request. Tanpa `cache()`, itu
 * seluruh query di bawah (ditambah query `hitungKlaimMenunggu()`,
 * `hitungMenungguTarifTransport()`, dan `hitungMenungguJenjangTransport()`
 * sendiri) DUA KALI untuk satu tampilan halaman — `cache()` membuat
 * pemanggilan kedua memakai hasil yang sama dengan yang pertama alih-alih
 * membaca ulang basis data.
 *
 * TIDAK ADA satu pun dari keenam query di bawah yang boleh THROW: fungsi ini
 * dipanggil dari `app/admin/layout.tsx`, yang membungkus /admin/bayar,
 * /admin/sesi, DAN /admin/skrining sekaligus — satu galat baca yang menembus
 * `Promise.all` menjatuhkan SEMUANYA dengan 500 (Ruling 26). Karena itu
 * `hitungMenungguTarifTransport()` dan `hitungMenungguJenjangTransport()`
 * di atas masing-masing sudah menjamin dirinya sendiri tidak pernah throw —
 * lihat komentarnya masing-masing untuk alasan kenapa pemanggil VIEW yang
 * sama (`ambilSesiMenungguTarif()` di `/owner/transport`) sengaja punya
 * disiplin galat yang berbeda di sana.
 */
export const hitungAntrean = cache(async function hitungAntrean(): Promise<Antrean> {
  const supabase = await createServerSupabase();
  const kepala = { count: "exact" as const, head: true };

  // Klaim pembayaran dan kedua antrean transport dipanggil dari fungsi
  // tersendiri masing-masing (`hitungKlaimMenunggu()`,
  // `hitungMenungguTarifTransport()`, `hitungMenungguJenjangTransport()`),
  // tidak dihitung ulang di sini: dua salinan saringan akan berpisah diam-diam
  // pada perubahan berikutnya, dan yang berpisah adalah badge versus
  // daftarnya sendiri.
  const [
    skrining,
    permintaan,
    klaimMenunggu,
    belumAktif,
    menungguTarifTransport,
    menungguJenjangTransport,
  ] = await Promise.all([
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
    hitungMenungguJenjangTransport(),
  ]);

  return {
    skriningBaru: skrining.count ?? 0,
    permintaanMenunggu: permintaan.count ?? 0,
    klaimMenunggu,
    klienBelumAktif: belumAktif.count ?? 0,
    menungguTarifTransport,
    menungguJenjangTransport,
  };
});
