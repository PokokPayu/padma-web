/**
 * Pemindai kelas Tailwind yang menunjuk token panel.
 *
 * Kelas yang menunjuk token tak terdefinisi gagal SENYAP di Tailwind v4:
 * tidak ada galat build, tidak ada peringatan, hanya teks yang tidak terbaca
 * di layar. Sudah terjadi sekali (`text-panel-accent`, rencana 1).
 *
 * Dipisah menjadi dua fungsi MURNI supaya pemindainya sendiri bisa dibuktikan
 * bergigi tanpa memalsukan berkas di disk — lihat tests/pagar-cetakan.test.ts.
 */

/**
 * Semua awalan utilitas Tailwind yang bisa menunjuk warna.
 *
 * Pagar rencana 1 hanya mengenal `text|bg|border`, sehingga `ring-panel-*`
 * pada keadaan fokus akan lolos. Daftar ini melebar ke setiap awalan warna
 * yang benar-benar dipakai proyek ini atau wajar dipakai berikutnya.
 */
const AWALAN =
  "text|bg|border|ring|outline|shadow|divide|from|via|to|fill|stroke|placeholder|accent|caret|decoration";

const POLA_KELAS = new RegExp(`(?:${AWALAN})-panel-[a-z]+(?:-[a-z]+)*`, "g");

/**
 * Kelas `*-panel-*` yang muncul di `isi`, tanpa duplikat.
 *
 * Modifier opacity (`/70`) tidak ikut terpungut: `[a-z]` berhenti di garis
 * miring, dan `border-panel-border/70` tetap menunjuk token
 * `--color-panel-border` yang sama.
 */
export function kelasPanelDi(isi: string): string[] {
  return [...new Set(isi.match(POLA_KELAS) ?? [])];
}

/** Kelas yang token `--color-panel-*`-nya TIDAK ada di `css`. */
export function tokenHantu(kelas: string[], css: string): string[] {
  return kelas.filter((k) => !css.includes(`--color-panel-${k.split("panel-")[1]}`));
}
