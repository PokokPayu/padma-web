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
