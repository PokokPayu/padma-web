/**
 * Daftar bagian kedua dokumen hukum — SATU sumber untuk daftar isi, judul
 * bernomor, jangkar, dan uji (`tests/dokumen-hukum.test.tsx`). Mengubah `id`
 * di sini memutus tautan dari layar `/persetujuan`; ujinya akan merah.
 */
export const BAGIAN_SK = [
  { id: "penerimaan", judul: "Penerimaan Ketentuan" },
  { id: "tentang-layanan", judul: "Tentang Layanan PADMA" },
  { id: "akun", judul: "Akun dan Digital Passport" },
  { id: "skrining", judul: "Skrining Kesehatan" },
  { id: "pemesanan", judul: "Pemesanan dan Kunjungan" },
  { id: "pembayaran", judul: "Pembayaran" },
  { id: "pembatalan", judul: "Pembatalan dan Jadwal Ulang" },
  { id: "produk-digital", judul: "Produk Digital" },
  { id: "testimoni", judul: "Testimoni" },
  { id: "batasan-tanggung-jawab", judul: "Batasan Tanggung Jawab" },
  { id: "perubahan", judul: "Perubahan Ketentuan" },
  { id: "hukum-kontak", judul: "Hukum yang Berlaku dan Kontak" },
] as const;

export const BAGIAN_PRIVASI = [
  { id: "pengendali", judul: "Siapa Kami" },
  { id: "data-dikumpulkan", judul: "Data yang Kami Kumpulkan" },
  { id: "tujuan", judul: "Untuk Apa Data Dipakai" },
  { id: "akses", judul: "Siapa yang Dapat Melihat Data Anda" },
  { id: "pihak-ketiga", judul: "Pemroses Pihak Ketiga dan Transfer ke Luar Negeri" },
  { id: "whatsapp", judul: "WhatsApp" },
  { id: "keamanan", judul: "Keamanan" },
  { id: "penyimpanan", judul: "Penyimpanan dan Penghapusan" },
  { id: "hak-anda", judul: "Hak Anda" },
  { id: "cookie", judul: "Cookie" },
  { id: "kebocoran", judul: "Kebocoran Data" },
  { id: "perubahan-kontak", judul: "Perubahan Kebijakan dan Kontak" },
] as const;

/** Tautan dari layar `/persetujuan` dan centang skrining ke bagian yang relevan. */
export const JANGKAR_PERSETUJUAN = {
  dataKesehatan: "/kebijakan-privasi#data-kesehatan",
  pihakKetiga: "/kebijakan-privasi#pihak-ketiga",
  hakAnda: "/kebijakan-privasi#hak-anda",
} as const;

export type DaftarBagian = readonly { readonly id: string; readonly judul: string }[];
