// Dari `normalisasi-email.ts` (berkas murni tanpa impor), BUKAN dari
// `link-client.ts` — `daftar.ts` dipakai `form-daftar.tsx` yang bertanda
// "use client", dan `link-client.ts` memuat `node:crypto` beserta klien
// service role. Satu impor dari sisi klien sudah cukup menyeret keduanya ke
// bundel browser (lihat komentar di kedua berkas itu untuk riwayat lengkap).
import { normalizeEmail } from "@/lib/auth/normalisasi-email";

/**
 * VALIDATOR PENDAFTARAN MANDIRI (spec 8 Sep 2026, keputusan K3/K4) — tanpa
 * I/O, sama seperti `src/app/admin/sesi/status.ts`, supaya bisa diuji
 * langsung tanpa memutar Supabase.
 *
 * Fase sengaja TIDAK ada di sini (K3): wizard skrining sudah menanyakannya,
 * dan setiap pemesanan wajib berskrining. Menanyakan fase dua kali berarti
 * menyimpan dua jawaban yang bisa berbeda.
 */

/**
 * Enam karakter (bawaan lama Supabase) terlalu pendek untuk akun yang
 * memegang catatan medis. Sejak pendaftaran mandiri hidup, kata sandi juga
 * bukan lagi barang yang hanya dipegang admin — siapa pun bisa memilihnya
 * sendiri, jadi batas bawahnya harus cukup kuat tanpa bantuan admin.
 */
export const PANJANG_SANDI_MIN = 8;

// `clients.nama` bukan tempat menitipkan teks bebas — metadata pendaftaran
// dikendalikan pengguna sepenuhnya, jadi batas panjang mencegahnya dipakai
// sebagai gudang teks di luar keperluan sebuah nama.
const PANJANG_NAMA_MAKS = 120;

// Cukup untuk menolak input yang jelas bukan alamat email ("bukan-email");
// bukti kepemilikan yang sesungguhnya tetap datang dari konfirmasi email
// GoTrue (K1/K7), bukan dari pola ini.
const POLA_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Merapikan nama: pangkas spasi di ujung, rapatkan spasi ganda di tengah,
 * lalu batasi panjangnya. Dipakai DUA jalur yang harus sepakat persis —
 * formulir `/daftar` (lewat `periksaPendaftaran`) dan pembacaan ulang
 * `user_metadata` saat baris klien mandiri diterbitkan (Tugas 3) — supaya
 * nama klien tidak berbentuk beda tergantung jalur mana yang menuliskannya.
 *
 * Fungsi ini MERAPIKAN, bukan MENOLAK: kelebihan panjang dipangkas diam-diam
 * di sini karena jalur Tugas 3 tidak punya formulir untuk menampilkan pesan
 * penolakan — baris klien sudah harus lahir. Penolakan eksplisit atas nama
 * kepanjangan tetap ada, tapi di `periksaPendaftaran`, sebelum dipangkas.
 */
export function rapikanNama(mentah: string): string {
  return mentah.trim().replace(/\s+/g, " ").slice(0, PANJANG_NAMA_MAKS);
}

/**
 * Merapikan nomor HP: buang semua karakter selain digit dan `+`, jadi
 * "0812-3456-7890" atau "0812 3456 7890" berakhir dalam bentuk yang sama.
 * Sama seperti `rapikanNama`, dipakai persis oleh formulir pendaftaran dan
 * oleh Tugas 3 saat membaca `user_metadata` — dua jalur, satu aturan.
 */
export function rapikanNoHp(mentah: string): string {
  return mentah.replace(/[^\d+]/g, "");
}

export type HasilPendaftaran =
  | { ok: true; nilai: { nama: string; email: string; noHp: string } }
  | { ok: false; pesan: string };

export function periksaPendaftaran(input: {
  nama: string;
  email: string;
  noHp: string;
  sandi: string;
}): HasilPendaftaran {
  const namaTrim = input.nama.trim();
  if (namaTrim.length === 0) {
    return { ok: false, pesan: "Nama wajib diisi." };
  }
  if (namaTrim.length > PANJANG_NAMA_MAKS) {
    return { ok: false, pesan: `Nama maksimal ${PANJANG_NAMA_MAKS} karakter.` };
  }

  const email = normalizeEmail(input.email);
  if (!POLA_EMAIL.test(email)) {
    return { ok: false, pesan: "Alamat email tidak valid." };
  }

  if (input.sandi.length < PANJANG_SANDI_MIN) {
    return {
      ok: false,
      pesan: `Kata sandi minimal ${PANJANG_SANDI_MIN} karakter.`,
    };
  }

  const noHp = rapikanNoHp(input.noHp);
  if (noHp.length === 0) {
    return { ok: false, pesan: "Nomor WhatsApp wajib diisi." };
  }

  return { ok: true, nilai: { nama: rapikanNama(input.nama), email, noHp } };
}
