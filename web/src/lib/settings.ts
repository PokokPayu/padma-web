import { createAdminSupabase } from "@/lib/supabase/admin";
import { uraikanDaftarJam } from "@/lib/jadwal/jam";
import {
  ALAMAT_BAWAAN,
  JAM_BAWAAN,
  keFormatLokal,
  nomorWaTerpakai,
  teksTerpakai,
} from "@/lib/pengaturan/bentuk";

/**
 * Setelan klinik untuk halaman PUBLIK (landing, skrining, passport).
 *
 * `app_settings` sengaja tertutup untuk anon (migration cabut_grant_anon_berlebih),
 * jadi nilainya hanya bisa dibaca dari server dengan service role. Panel admin
 * TIDAK memakai fungsi ini — ia membaca lewat sesi penggunanya sendiri
 * (`@/lib/admin/pengaturan`), supaya RLS staf ikut diperiksa.
 *
 * Penjagaannya ada pada NILAI, bukan pada keberadaan baris. Bentuk lama —
 * nomor bawaan ditempel langsung dengan `??` — hanya menyala ketika BARISNYA
 * hilang, dan nomor literal itu hidup di dua tempat sekaligus; nilai `""`
 * lolos apa adanya menjadi `nomorWaLink === ""` dan seluruh kanal konversi
 * menerbitkan `https://wa.me/` — rusak untuk setiap pengunjung, tanpa error.
 * Aturannya kini tinggal di satu tempat, `@/lib/pengaturan/bentuk`, yang juga
 * dipakai server action penyimpannya.
 *
 * ===== KENAPA KETIGA KUNCI, BUKAN HANYA `nomor_wa` =====
 * Temuan red team (29 Agu 2026): `alamat_klinik` & `jam_operasional` terdaftar
 * di registri, punya kartunya sendiri di /admin/pengaturan, tersimpan ke basis
 * data — dan tidak dibaca SATU pun halaman. Diuji dengan nilai bertanda pada
 * server dev yang hidup: kemunculan "PAD-UJI" di HTML `/`, `/skrining`, dan
 * `/masuk` semuanya NOL, sementara footer tetap menampilkan "Melayani area
 * Jabodetabek" yang ditulis keras di komponennya. Panel sementara itu menjawab
 * "Tersimpan. Halaman publik sudah memakai nilai baru." — kalimat yang tidak
 * benar untuk dua dari tiga kartu, yaitu bentuk yang sama dengan "tombol yang
 * berbohong sejak hari pertama" yang sudah dilarang untuk modul materi.
 *
 * Dua jalan keluar tersedia: MEMAKAI kuncinya, atau MEMBUANGnya dari registri.
 * Yang dipilih adalah memakainya — registri sudah menjanjikan tampilan publik
 * ("Alamat/area layanan yang ditampilkan di footer", "Jam operasional yang
 * ditampilkan ke pengunjung"), dan alamat memang sudah tampil di footer; yang
 * salah hanyalah SUMBERNYA. Satu query mengembalikan ketiganya: kunci yang
 * terpisah query akan terpisah pula umur cache-nya.
 */
const KUNCI_PUBLIK = ["nomor_wa", "alamat_klinik", "jam_operasional", "jam_layanan"] as const;

export async function bacaPengaturan() {
  const admin = createAdminSupabase();
  const { data } = await admin
    .from("app_settings")
    .select("key, value")
    .in("key", KUNCI_PUBLIK);

  const nilai = new Map(
    (data ?? []).map((b) => [b.key as string, b.value as string]),
  );

  const link = nomorWaTerpakai(nilai.get("nomor_wa"));
  return {
    nomorWaLink: link,
    nomorWaTampilan: keFormatLokal(link),
    alamatTampilan: teksTerpakai(nilai.get("alamat_klinik"), ALAMAT_BAWAAN),
    jamTampilan: teksTerpakai(nilai.get("jam_operasional"), JAM_BAWAAN),
    // `jam_operasional` adalah KALIMAT yang dipajang di footer ("Senin–Sabtu
    // 08.00–17.00"); `jam_layanan` adalah DAFTAR jam yang boleh DIPILIH klien
    // saat memesan. Dua hal berbeda yang namanya mirip — sengaja tidak
    // digabung: yang satu untuk dibaca manusia, yang satu untuk divalidasi
    // server sebelum sebuah janji dibuat.
    jamLayanan: uraikanDaftarJam(nilai.get("jam_layanan")),
  };
}
