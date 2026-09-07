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

/**
 * Kelas yang token `--color-panel-*`-nya TIDAK ada di `css`.
 *
 * Batas deklarasi (`\s*:`), bukan `.includes()` telanjang: `.includes()`
 * lolos untuk suffix yang kebetulan menjadi AWALAN token sungguhan —
 * `"--color-panel-in"` adalah substring dari `"--color-panel-ink: ..."`, jadi
 * `bg-panel-rail-akt` (awalan `panel-rail-aktif`) dan `text-panel-b` (awalan
 * `panel-bg`) keduanya lolos sebagai "terdefinisi" walau keduanya bukan token
 * yang sungguh ada — celah yang ditemukan reviewer sapuan panel lewat
 * eksekusi nyata. Diikat ke titik dua deklarasi (dengan spasi opsional)
 * supaya hanya kecocokan UTUH nama token yang dianggap terdefinisi.
 */
export function tokenHantu(kelas: string[], css: string): string[] {
  return kelas.filter((k) => {
    const suffix = k.split("panel-")[1];
    return !new RegExp(`--color-panel-${suffix}\\s*:`).test(css);
  });
}
