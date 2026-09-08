import { jamSampaiSesi } from "@/lib/jadwal/jam";

/**
 * JENJANG PEMBATALAN — DITURUNKAN, TIDAK PERNAH DISIMPAN (spec C3 P1).
 *
 * Kebijakan lengkapnya ada di `docs/superpowers/2026-09-08-kebijakan-pembatalan-klien.md`,
 * disalin utuh dari poster klien. JANGAN meringkasnya dari ingatan — isinya
 * sudah pernah disalahsebutkan dua kali sebelum berkas kebijakan itu ada.
 *
 * Seluruh berkas ini MURNI: tidak ada impor basis data, tidak ada `new Date()`
 * tersembunyi. `sekarang` selalu bisa disuntikkan, karena fungsi waktu yang
 * membaca jamnya sendiri tidak bisa diuji di ambangnya — dan ambang itulah
 * satu-satunya tempat fungsi ini bisa salah.
 */

export type Jenjang = 1 | 2 | 3 | 4;
export type Akibat = "refund" | "hak" | "hangus";

/** Berapa lama hak sesi berlaku, dalam hari. Angkanya dari poster klien. */
export const HARI_BERLAKU_HAK = 30;

const AMBANG_PENUH_JAM = 24;
const AMBANG_BERANGKAT_JAM = 2;

/**
 * Jenjang sebuah pembatalan menurut sisa waktu menuju sesi.
 *
 * TIDAK memulangkan 4: jenjang 4 bukan pertanyaan waktu melainkan pertanyaan
 * siapa (PADMA yang membatalkan). Memasukkannya ke sini akan memaksa fungsi
 * murni ini tahu tentang aktor, dan aktor datang dari sesi pengguna.
 *
 * Ambang `< 2 jam` sekaligus mewakili "mitra sudah berangkat" (spec C3 P2):
 * dalam praktik PADMA bidan berangkat sekitar dua jam sebelumnya, jadi kedua
 * pemicu itu berimpit dan penanda terpisahnya sengaja tidak dibuat.
 */
export function jenjangPembatalan(
  tanggal: string,
  jam: string,
  sekarang: Date = new Date(),
): 1 | 2 | 3 {
  const sisa = jamSampaiSesi(tanggal, jam, sekarang);
  if (sisa >= AMBANG_PENUH_JAM) return 1;
  if (sisa >= AMBANG_BERANGKAT_JAM) return 2;
  // Termasuk sisa NEGATIF (sesi sudah lewat). Ditulis sebagai jatuhan terakhir,
  // bukan sebagai perbandingan tersendiri, supaya tidak ada celah di antaranya.
  return 3;
}

/**
 * Apa yang klien terima. Diturunkan dari jenjang, tidak pernah dipilih
 * pemanggil — pilihan yang bisa dikirim peramban adalah pilihan yang bisa
 * dinaikkan sendiri oleh klien.
 */
export function akibatPembatalan(jenjang: Jenjang): Akibat {
  if (jenjang === 3) return "hangus";
  if (jenjang === 2) return "hak";
  return "refund"; // jenjang 1 dan 4
}

/**
 * Tanggal kedaluwarsa hak, dihitung dari TANGGAL SESI yang batal.
 *
 * Memakai UTC di dalam sengaja: yang dihitung adalah jarak KALENDER 30 hari,
 * bukan titik waktu. `Date.UTC` membuat penambahan hari tidak pernah tergeser
 * oleh jam atau zona mana pun, dan hasilnya dipulangkan sebagai `YYYY-MM-DD`
 * yang sama bentuknya dengan kolom `date` di basis data.
 */
export function kedaluwarsaHak(tanggalSesi: string): string {
  const [th, bl, hr] = tanggalSesi.split("-").map(Number);
  const t = new Date(Date.UTC(th, bl - 1, hr + HARI_BERLAKU_HAK));
  return t.toISOString().slice(0, 10);
}

/**
 * SIAPA yang membatalkan. Eksplisit di seluruh rantai, tidak pernah
 * disimpulkan dari isi kotak teks.
 *
 * Versi pertama `batalkan_sesi()` menyimpulkan jenjang 4 dari "staf DAN alasan
 * tidak kosong", sementara panel merender alasan sebagai catatan biasa yang
 * opsional. Akibatnya satu admin yang mengetik "klien minta batal" mengubah
 * kredit 30 hari menjadi refund penuh atas nama PADMA, dan satu admin yang
 * membiarkan alasan kosong saat bidannya sakit membuat klien kehilangan
 * seluruh uangnya. Keduanya bisa dicapai dari layar yang sama.
 */
export const AKTOR_PEMBATALAN = ["klien", "padma"] as const;
export type AktorPembatalan = (typeof AKTOR_PEMBATALAN)[number];

export const LABEL_AKTOR_PEMBATALAN: Record<AktorPembatalan, string> = {
  klien: "Klien yang meminta batal",
  padma: "PADMA yang membatalkan",
};

export const LABEL_JENJANG_PEMBATALAN: Record<Jenjang, string> = {
  1: "24 jam atau lebih sebelum sesi",
  2: "2–24 jam sebelum sesi",
  3: "Kurang dari 2 jam, atau sesi sudah lewat",
  4: "Dibatalkan PADMA",
};

export const KALIMAT_AKIBAT: Record<Akibat, string> = {
  refund: "Dana dikembalikan penuh.",
  hak: `Dana menjadi hak satu sesi untuk layanan yang sama, berlaku ${HARI_BERLAKU_HAK} hari sejak tanggal sesi.`,
  hangus: "Dana tidak dapat dikembalikan. Jadwal ulang dihitung sebagai pemesanan baru.",
};
