/**
 * Pengurai markdown untuk isi artikel situs publik.
 *
 * Owner menulis artikel di /admin/artikel sebagai markdown; halaman publik dan
 * pratinjau di panel memakai pengurai yang SAMA, jadi yang terlihat saat
 * menulis adalah yang tayang. Modul ini murni (tanpa `fs`, tanpa Supabase)
 * supaya bisa diimpor komponen klien.
 *
 * Bentuk yang dikenal sengaja sempit — cukup untuk artikel edukasi:
 *
 *   Paragraf (baris kosong memisahkan paragraf)
 *   ## Subjudul   /   ### Sub-subjudul
 *   - butir   atau   1. butir
 *   **tebal**, *miring*, tautan polos https://…, rujukan [1] atau [2,3]
 *   ### Referensi  → daftar bernomor sesudahnya menjadi daftar pustaka
 *
 * Tidak ada HTML mentah: keluarannya struktur data yang dirender React, jadi
 * teks apa pun yang diketik admin tidak bisa menyuntikkan markup ke situs.
 * Judul dan kategori adalah kolom terpisah, bukan bagian dari markdown.
 */

export type Inline =
  | { jenis: "teks"; isi: string }
  | { jenis: "tebal"; isi: string }
  | { jenis: "miring"; isi: string }
  | { jenis: "tautan"; href: string }
  | { jenis: "rujukan"; nomor: number[] };

export type Blok =
  | { jenis: "h2"; isi: Inline[] }
  | { jenis: "h3"; isi: Inline[] }
  | { jenis: "paragraf"; isi: Inline[] }
  | { jenis: "daftar"; berurut: boolean; butir: Inline[][] };

export type IsiArtikel = {
  blok: Blok[];
  referensi: Inline[][];
  /** Paragraf pertama sebagai teks polos — kartu daftar & meta description. */
  ringkasan: string;
  menitBaca: number;
};

const POLA_INLINE = /\*\*(.+?)\*\*|\*(.+?)\*|(https?:\/\/[^\s<>]+)|\[(\d+(?:\s*,\s*\d+)*)\]/g;

export function uraiInline(teks: string): Inline[] {
  const hasil: Inline[] = [];
  let posisi = 0;
  for (const m of teks.matchAll(POLA_INLINE)) {
    const mulai = m.index;
    let akhir = mulai + m[0].length;
    let potongan: Inline;
    if (m[1] !== undefined) potongan = { jenis: "tebal", isi: m[1] };
    else if (m[2] !== undefined) potongan = { jenis: "miring", isi: m[2] };
    else if (m[3] !== undefined) {
      // Tanda baca penutup kalimat bukan bagian dari tautan.
      const href = m[3].replace(/[.,;:)]+$/, "");
      akhir = mulai + href.length;
      potongan = { jenis: "tautan", href };
    } else potongan = { jenis: "rujukan", nomor: m[4].split(",").map((n) => Number(n.trim())) };
    if (mulai > posisi) hasil.push({ jenis: "teks", isi: teks.slice(posisi, mulai) });
    hasil.push(potongan);
    posisi = akhir;
  }
  if (posisi < teks.length) hasil.push({ jenis: "teks", isi: teks.slice(posisi) });
  return hasil;
}

/** Teks polos tanpa tanda markdown dan tanpa nomor rujukan. */
export function teksPolos(isi: Inline[]): string {
  return isi
    .map((i) => (i.jenis === "tautan" ? i.href : i.jenis === "rujukan" ? "" : i.isi))
    .join("")
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function uraiIsi(markdown: string): IsiArtikel {
  const blok: Blok[] = [];
  let paragraf: string[] = [];
  let daftar: { berurut: boolean; butir: string[] } | null = null;

  const tutup = () => {
    if (paragraf.length) blok.push({ jenis: "paragraf", isi: uraiInline(paragraf.join(" ")) });
    if (daftar) blok.push({ jenis: "daftar", berurut: daftar.berurut, butir: daftar.butir.map(uraiInline) });
    paragraf = [];
    daftar = null;
  };

  for (const mentah of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const b = mentah.trim();
    if (!b) {
      tutup();
      continue;
    }
    // `#` tunggal diperlakukan sebagai subjudul: h1 halaman adalah kolom judul.
    const h = /^(#{1,6})\s+(.*)$/.exec(b);
    if (h) {
      tutup();
      blok.push({ jenis: h[1].length <= 2 ? "h2" : "h3", isi: uraiInline(h[2]) });
      continue;
    }
    const butir = /^(?:[-*]|(\d+)\.)\s+(.*)$/.exec(b);
    if (butir) {
      const berurut = butir[1] !== undefined;
      if (paragraf.length || (daftar && daftar.berurut !== berurut)) tutup();
      daftar ??= { berurut, butir: [] };
      daftar.butir.push(butir[2]);
      continue;
    }
    if (daftar) tutup();
    paragraf.push(b);
  }
  tutup();

  // "Referensi" dipisah dari badan supaya bisa diberi jangkar #referensi-N.
  let referensi: Inline[][] = [];
  const iRef = blok.findIndex((x) => (x.jenis === "h2" || x.jenis === "h3") && /^referensi$/i.test(teksPolos(x.isi)));
  if (iRef >= 0) {
    const sesudah = blok[iRef + 1];
    const adaDaftar = sesudah?.jenis === "daftar";
    if (adaDaftar) referensi = sesudah.butir;
    blok.splice(iRef, adaDaftar ? 2 : 1);
  }

  const pembuka = blok.find((x) => x.jenis === "paragraf");
  const jumlahKata = markdown.split(/\s+/).filter(Boolean).length;
  return {
    blok,
    referensi,
    ringkasan: pembuka ? teksPolos(pembuka.isi) : "",
    menitBaca: Math.max(1, Math.round(jumlahKata / 200)),
  };
}

/** Slug URL dari judul: huruf kecil, angka, tanda hubung. */
export function slugDariJudul(judul: string): string {
  return judul
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
}

export const POLA_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
