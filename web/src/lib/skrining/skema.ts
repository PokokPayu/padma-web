import { z } from "zod";

// Skema payload skrining publik (POST /api/skrining).
//
// Perhatikan: TIDAK ada field `hasil`. Hasil & flags dihitung server dari bank
// soal server-side (keputusan A) — apa pun yang dikirim klien soal `hasil`
// diabaikan, karena klien tidak boleh bisa memaksa dirinya jadi "hijau".
//
// `fase` sengaja hanya 4 nilai: `newborn` (Shishu) TIDAK diskrining — yang
// diskrining adalah ibunya (fase nifas). Jangan menambah nilai kelima.
// Bank soal terbesar = 7 soal umum + 5 soal fase = 12 kunci. Batas 24 memberi
// margin dua kali lipat untuk perubahan bank soal, tapi menutup temuan red team:
// skema lama membatasi PANJANG kunci dan tidak membatasi JUMLAHnya, sehingga
// 200.001 kunci (2,76 MB) tersimpan mentah ke kolom jsonb data kesehatan.
export const MAKS_KUNCI_JAWABAN = 24;

export const SkemaSkriningPublik = z.object({
  // `<` dan `>` ditolak sebagai pertahanan-mendalam: render Inbox saat ini
  // ter-escape React, tapi nama yang sama kelak bisa diekspor ke CSV atau
  // dirender di konteks non-React. Nama manusia tidak membutuhkannya.
  nama: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .refine((v) => !/[<>]/.test(v), "nama tidak boleh memuat < atau >"),
  no_hp: z.string().trim().min(8).max(25).regex(/^[0-9+\-\s()]+$/),
  fase: z.enum(["prekonsepsi", "kehamilan", "nifas", "menopause"]),
  jawaban: z
    .record(z.string().max(40), z.boolean())
    .refine(
      (o) => Object.keys(o).length <= MAKS_KUNCI_JAWABAN,
      `jawaban maksimal ${MAKS_KUNCI_JAWABAN} kunci`,
    ),
});

export type PayloadSkrining = z.infer<typeof SkemaSkriningPublik>;
