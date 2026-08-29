/**
 * Rupa undangan aktivasi SEBAGAIMANA DILIHAT MANUSIA: masa berlakunya, bentuk
 * tautannya, dan kalimat WhatsApp yang disalin admin.
 *
 * Berkas ini sengaja MURNI — tanpa satu pun impor. Kartu aktivasi di panel
 * admin adalah komponen `"use client"`, dan modul token (`link-client.ts`)
 * memuat `node:crypto` beserta klien service role. Satu impor dari sisi klien
 * sudah cukup untuk menyeret keduanya ke bundel browser; karena itu yang boleh
 * dipakai di sana hanyalah berkas ini.
 *
 * `INVITE_TTL_DAYS` tinggal di sini — bukan di `link-client.ts` — supaya angka
 * yang DITULIS di pesan WhatsApp dan angka yang benar-benar dipakai menghitung
 * `expires_at` tidak pernah bisa berselisih. `link-client.ts` mengekspornya
 * ulang untuk pemanggil lama.
 */

/** Masa berlaku default token undangan. */
export const INVITE_TTL_DAYS = 14;

/**
 * Tautan aktivasi siap-tempel ke pesan sambutan WhatsApp.
 *
 * Token di-encode: bentuk base64url memang aman apa adanya, tetapi menyusun URL
 * dengan penggabungan mentah adalah cara paling mudah menerbitkan tautan yang
 * tidak pernah bisa ditukarkan begitu bentuk tokennya berubah.
 */
export function tautanAktivasi(origin: string, token: string): string {
  return `${origin}/aktivasi?token=${encodeURIComponent(token)}`;
}

/**
 * Pesan sambutan yang disalin admin ke WhatsApp klien.
 *
 * Tiga hal yang wajib ada di dalamnya, dan ketiganya diuji:
 *   - nama klien (agar admin tidak mengirim pesan ke orang yang salah),
 *   - alamat email yang harus dipakai masuk (penautan menuntut token DAN email
 *     sepakat — klien yang mendaftar dengan email lain akan gagal tanpa tahu
 *     sebabnya),
 *   - masa berlaku & sifat sekali pakai, supaya klien tidak menyimpan tautan
 *     ini sebagai "pintu masuk" harian.
 */
export function teksUndanganWhatsApp({
  nama,
  email,
  tautan,
}: {
  nama: string;
  email: string;
  tautan: string;
}): string {
  return [
    `Halo ${nama}, selamat datang di PADMA 🌸`,
    "",
    "Digital Care Passport Anda sudah siap. Buka tautan berikut untuk mengaktifkan akun, lalu masuk dengan email " +
      `${email}:`,
    "",
    tautan,
    "",
    `Tautan ini berlaku ${INVITE_TTL_DAYS} hari dan hanya bisa dipakai sekali.`,
  ].join("\n");
}
