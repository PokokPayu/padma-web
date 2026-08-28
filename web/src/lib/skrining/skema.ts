import { z } from "zod";

// Skema payload skrining publik (POST /api/skrining).
//
// Perhatikan: TIDAK ada field `hasil`. Hasil & flags dihitung server dari bank
// soal server-side (keputusan A) — apa pun yang dikirim klien soal `hasil`
// diabaikan, karena klien tidak boleh bisa memaksa dirinya jadi "hijau".
//
// `fase` sengaja hanya 4 nilai: `newborn` (Shishu) TIDAK diskrining — yang
// diskrining adalah ibunya (fase nifas). Jangan menambah nilai kelima.
export const SkemaSkriningPublik = z.object({
  nama: z.string().trim().min(2).max(80),
  no_hp: z.string().trim().min(8).max(25).regex(/^[0-9+\-\s()]+$/),
  fase: z.enum(["prekonsepsi", "kehamilan", "nifas", "menopause"]),
  jawaban: z.record(z.string().max(40), z.boolean()),
});

export type PayloadSkrining = z.infer<typeof SkemaSkriningPublik>;
