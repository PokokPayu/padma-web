import { z } from "zod";
import { MINGGU_MAKS, trimesterDari } from "./usia-kehamilan";

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

const Bentuk = z.object({
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

  // ===== USIA KEHAMILAN (opsional) =====
  // Klien boleh mengetik minggunya, memilih trimester saja bila tidak hafal,
  // atau melewatkannya sama sekali. Keduanya null untuk fase selain kehamilan.
  //
  // MURNI INFORMASI untuk tim: tidak satu pun nilai di sini ikut menentukan
  // hijau/merah — lihat dokblok usia-kehamilan.ts.
  usia_kehamilan_minggu: z.number().int().min(0).max(MINGGU_MAKS).nullish(),
  trimester: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullish(),
});

export const SkemaSkriningPublik = Bentuk
  .superRefine((v, ctx) => {
    // FAIL-CLOSED. "Nifas, trimester 2" bukan sekadar data janggal di inbox —
    // ia catatan keselamatan yang membingungkan terapis di rumah klien. Layar
    // memang tidak bisa menghasilkannya, tapi rute publik menerima JSON apa pun.
    if (v.fase !== "kehamilan" && (v.usia_kehamilan_minggu != null || v.trimester != null)) {
      ctx.addIssue({
        code: "custom",
        path: ["usia_kehamilan_minggu"],
        message: "usia kehamilan hanya untuk fase kehamilan",
      });
    }
  })
  .transform((v) => ({
    ...v,
    usia_kehamilan_minggu: v.usia_kehamilan_minggu ?? null,
    // Bila minggu diketahui, trimester SELALU diturunkan ulang di server dan
    // angka kiriman klien diabaikan. Dengan begitu tidak mungkin tersimpan
    // "30 minggu, trimester 1" — satu fakta, satu nilai.
    trimester:
      v.usia_kehamilan_minggu != null
        ? trimesterDari(v.usia_kehamilan_minggu)
        : (v.trimester ?? null),
  }));

export type PayloadSkrining = z.infer<typeof SkemaSkriningPublik>;
