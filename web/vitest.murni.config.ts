import { defineConfig } from "vitest/config";
import dasar from "./vitest.config";

/**
 * UJI MURNI — sama persis dengan vitest.config.ts, minus `globalSetup`.
 *
 * `globalSetup` menyemai pengguna demo ke Supabase lokal, dan ia MENGGANTUNG
 * bila Docker mati (catatan P2, 2 Okt 2026). Konfigurasi ini hanya untuk
 * berkas yang tidak menyentuh basis data:
 *
 *   npm run test:murni -- tests/<berkas>.test.ts
 *
 * Berkas ber-DB yang dijalankan lewat sini akan gagal atau menggantung — dan
 * kegagalan itu bukan bukti apa pun tentang kodenya.
 */
export default defineConfig({
  ...dasar,
  test: { ...dasar.test, globalSetup: [] },
});
