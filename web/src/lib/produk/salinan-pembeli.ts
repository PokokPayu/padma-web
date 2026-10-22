import "server-only";
import type { createAdminSupabase } from "@/lib/supabase/admin";
import { prefiksPdfPembeli } from "@/lib/produk/cap-pdf";

const BUCKET_BERKAS = "produk-berkas";

/** Sebanyak yang dipulangkan satu halaman `.list()` — lihat komentar di bawah. */
const BATAS_LIST = 1000;

/**
 * Mengosongkan SELURUH salinan PDF tercap milik para pembeli satu materi.
 *
 * Satu-satunya implementasi: dulu ada dua salinan (`unggah.ts` dan
 * `aksi-isi.ts`) yang sudah mulai berbeda — salah satunya tanpa komentar
 * paginasi — padahal kegagalan di sini diam dan permanen. Hidup di modul
 * server biasa, bukan di berkas "use server", karena berkas itu hanya boleh
 * mengekspor action async.
 *
 * Salinan tercap (`<produk>/<materi>/pembeli/<klien>.pdf`) adalah TURUNAN dari
 * PDF sumber, dan rute unduh memakainya ulang begitu ia ada — tanpa pernah
 * membandingkannya dengan sumbernya. Karena itu siapa pun yang MENGGANTI atau
 * MELEPAS sumbernya wajib menghapus folder ini; kalau tidak, admin yang
 * mengunggah PDF perbaikan tidak akan PERNAH bisa mengirimkannya kepada orang
 * yang sudah pernah mengunduh — permanen, tanpa satu pun galat di layar — dan
 * "Lepas isi" meninggalkan objek yatim, kelas kebocoran yang sama yang sudah
 * ditutup untuk objek halaman.
 *
 * `.list()` DIPAGINASI, tidak dipanggil sekali: tanpa opsi, Supabase memulangkan
 * 100 objek pertama saja — pemotongan diam yang dulu membuat unggah ulang
 * e-book >100 halaman gagal permanen di modul materi. Materi laris punya lebih
 * dari 100 pembeli, dan sisa yang tidak terhapus adalah sisa yang tetap
 * disajikan rute unduh.
 *
 * Memulangkan `true` bila ADA yang tidak terhapus — mode gagal LUNAK yang
 * dilaporkan ke pemanggil, bukan ditelan diam.
 */
export async function hapusSalinanPembeli(
  admin: ReturnType<typeof createAdminSupabase>,
  productId: string,
  materiId: string,
): Promise<boolean> {
  const prefiks = prefiksPdfPembeli(productId, materiId);
  for (;;) {
    const { data, error } = await admin.storage
      .from(BUCKET_BERKAS)
      .list(prefiks, { limit: BATAS_LIST });
    if (error) return true;
    if (!data || data.length === 0) return false;

    const { error: hapus } = await admin.storage
      .from(BUCKET_BERKAS)
      .remove(data.map((o) => `${prefiks}/${o.name}`));
    if (hapus) return true;
    // Halaman terakhir: berhenti di sini, bukan memanggil `.list()` sekali lagi
    // hanya untuk mendapat jawaban kosong.
    if (data.length < BATAS_LIST) return false;
  }
}
