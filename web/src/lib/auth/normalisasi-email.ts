/**
 * Normalisasi email — aturan keamanan, bukan sekadar kerapian tampilan.
 *
 * Berkas ini sengaja MURNI — tanpa satu pun impor, pola yang sama dengan
 * `pesan-undangan.ts`. `link-client.ts` memuat `node:crypto` beserta klien
 * service role (`@/lib/supabase/admin`); satu impor dari sisi klien sudah
 * cukup menyeret keduanya ke bundel browser. `daftar.ts` dipakai
 * `form-daftar.tsx` yang bertanda `"use client"`, jadi ia wajib mengambil
 * `normalizeEmail` dari sini, bukan dari `link-client.ts`.
 *
 * Fungsinya sendiri tinggal di sini — bukan disalin ke `daftar.ts` — karena
 * ini aturan KEAMANAN: `linkClientByInvite` dan `tautkanKlienLewatEmailTerverifikasi`
 * mencocokkan baris klien lewat `email = normalizeEmail(input)`. Dua salinan
 * aturan itu adalah dua salinan yang bisa berselisih diam-diam, dan
 * perselisihan pada aturan pencocokan identitas persis jenis celah yang sudah
 * dicatat di `link-client.ts`. `link-client.ts` mengekspor ulang dari sini
 * untuk pemanggil yang sudah ada — pola yang sama dengan `INVITE_TTL_DAYS`.
 */

/**
 * Email dinormalkan (trim + huruf kecil) sebelum dipakai membandingkan.
 * DB menyimpan clients.email dalam bentuk yang sama (trigger
 * `clients_normalize_email` + constraint `clients_email_lowercase`, migration
 * 20260828114500), jadi `email = normalizeEmail(input)` setara dengan
 * `lower(email) = lower(input)` — tetap buta kapitalisasi, tapi PERSIS.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
