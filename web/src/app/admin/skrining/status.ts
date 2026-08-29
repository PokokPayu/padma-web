// Daftar putih status tindak lanjut + labelnya.
//
// Berkas terpisah karena modul `"use server"` (aksi.ts) HANYA boleh
// mengekspor fungsi async — konstanta di sana akan menggagalkan `next build`.
// Memisahkannya juga membuat server action dan tabel memakai satu sumber yang
// sama: status yang bisa dipilih di UI persis status yang diterima server.
export const STATUS_SAH = ["baru", "dihubungi", "jadi_klien", "ditolak"] as const;

export type StatusTindakLanjut = (typeof STATUS_SAH)[number];

export const LABEL_STATUS: Record<StatusTindakLanjut, string> = {
  baru: "Baru",
  dihubungi: "Dihubungi",
  jadi_klien: "Jadi klien",
  ditolak: "Ditolak",
};

/**
 * Pemetaan fase skrining → `phases.id` untuk konversi menjadi klien.
 *
 * Nilainya memang sama persis dengan kuncinya hari ini, dan justru karena itu
 * daftar ini ditulis: pemetaan identitas (`phase_id = screenings.fase`) akan
 * TERLIHAT benar dan tetap lolos foreign key untuk nilai apa pun yang kebetulan
 * ada di tabel `phases`. Yang paling berbahaya adalah `newborn` (Shishu): ia id
 * fase yang SAH, tetapi tidak pernah lahir dari skrining — yang diskrining
 * adalah ibunya, bukan bayinya (lihat `@/lib/skrining/skema`, empat nilai).
 * Baris skrining ber-fase `newborn` hanya bisa datang dari data lama, jalur
 * service role, atau seseorang yang mengarangnya; ketiganya bukan alasan untuk
 * menerbitkan passport bayi berisi rencana promil.
 *
 * Daftar ini tinggal di sini dan bukan di `aksi.ts` karena berkas `"use server"`
 * hanya boleh mengekspor fungsi async.
 */
export const FASE_SKRINING_KE_PHASE: Record<string, string> = {
  prekonsepsi: "prekonsepsi",
  kehamilan: "kehamilan",
  nifas: "nifas",
  menopause: "menopause",
};

export function phaseIdDariFaseSkrining(fase: string): string | null {
  return FASE_SKRINING_KE_PHASE[fase] ?? null;
}
