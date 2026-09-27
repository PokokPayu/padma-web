"use server";

import { periksaPesananMenggantung } from "@/lib/pesanan/periksa-menggantung";

/**
 * Lapis 1b untuk `/produk/[slug]`, dipicu dari PERAMBAN.
 *
 * ===== KENAPA SERVER ACTION, BUKAN PANGGILAN DI SERVER COMPONENT =====
 * `/produk/[slug]` punya `export const revalidate = 300` dan dibaca anon.
 * Memanggil pemeriksaan ini di dalam render berarti membaca cookie di server
 * component, dan itu membuat SELURUH etalase dynamic demi satu tombol —
 * pengunjung anon membayar ongkosnya tanpa pernah punya pesanan. Alasan yang
 * sama sudah dipakai `punyaProdukDiPeramban` di `tombol-ambil.tsx`.
 *
 * ===== KENAPA TANPA requireRole, DAN KENAPA RLS SAJA TIDAK CUKUP =====
 * Yang dituntut hanyalah "pemanggilnya seorang klien", dan itu diputuskan di
 * dalam `periksaPesananMenggantung()`: ia membaca baris `clients` pemanggil
 * dengan sesi pemanggil, dan tanpa baris itu ia memulangkan `{diperiksa: 0}`
 * tanpa menyentuh apa pun.
 *
 * Kalimat "RLS yang menjaga radiusnya" BENAR untuk anon dan SALAH untuk staf:
 * `orders` punya DUA policy SELECT, dan `"pesanan: staf baca"` memulangkan
 * pesanan SELURUH klien. Halaman ini publik dan bisa dibuka admin mana pun,
 * jadi tanpa gerbang itu satu admin yang memeriksa tampilan etalase
 * menembakkan permintaan Status API atas pesanan orang lain — dan mencap
 * `diperiksa_pada` mereka, memperdaya penyapu Lapis 3.
 *
 * Yang tetap berlaku: pemeriksaan yang hanya hidup di server action bisa
 * dilewati dengan satu panggilan langsung ke PostgREST, jadi gerbangnya tidak
 * ditaruh DI SINI melainkan di fungsi yang dipanggil — satu tempat untuk dua
 * pemanggil (halaman ini dan `/passport/produk`).
 */
export async function periksaPesananSaya(): Promise<{ diperiksa: number }> {
  return periksaPesananMenggantung();
}
