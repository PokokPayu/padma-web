import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    // Test RLS berbagi satu stack Supabase lokal — jalankan berurutan agar deterministik.
    fileParallelism: false,
    // ===== KENAPA BUKAN 5000ms BAWAAN VITEST =====
    // Suite ini bukan unit test murni: hampir setiap `it` melakukan login GoTrue
    // sungguhan lalu beberapa perjalanan bolak-balik ke PostgREST, dan sebagian
    // menembakkan 50 operasi SERENTAK untuk menguji pembatas banjir antrean.
    // Dengan 5000ms, tiga test pembatas di tests/passport-pembatas-jadwal.test.ts
    // GAGAL di setiap run — dan gagalnya bergerak: run pertama merah di dedup
    // ("expected 1 but got 2"), run kedua di "expected false to be true". Itu
    // bukan bug produk melainkan PENCEMARAN BERUNTUN: test yang di-timeout tetap
    // meninggalkan 50 permintaannya terbang, dan baris yang mendarat sesudah
    // `beforeEach` membersihkan antrean membuat test BERIKUTNYA merah.
    //
    // Bahayanya bukan sekadar merah palsu: pembatas banjir antrean adalah
    // KONTROL KEAMANAN, dan berkas yang selalu merah membuat regresi sungguhan
    // tenggelam sebagai "yang merah itu memang biasa merah".
    //
    // Yang dilonggarkan HANYA batas waktunya. Tidak satu pun assertion diubah;
    // ketiga test itu tetap menuntut jumlah baris PERSIS sama dengan batasnya.
    testTimeout: 30_000,
    // Hook `beforeAll` beberapa berkas menyemai belasan baris fixture lewat
    // service role sebelum satu assertion pun berjalan; batas 10 detik bawaan
    // Vitest membuat berkas yang sehat gagal sebagai "hook timed out".
    hookTimeout: 60_000,
    setupFiles: ["dotenv/config"],
    // Seed user demo otomatis sebelum test — `npm test` harus hijau langsung
    // sesudah `npx supabase db reset`, tanpa `npm run seed:users` manual.
    globalSetup: ["tests/global-setup.ts"],
    env: {
      DOTENV_CONFIG_PATH: ".env.local",
      // Vercel berjalan UTC, mesin dev WIB. Tanpa ini, bug zona waktu
      // tidak akan pernah terlihat lokal.
      TZ: "UTC",
      // Test rate limit /api/skrining menirukan DEPLOY NYATA: satu proxy
      // tepercaya (Vercel) di depan aplikasi, yang menulis hop terluar
      // X-Forwarded-For. Kasus "tanpa proxy tepercaya" (nilai 0, seperti
      // `next dev` lokal) diuji tersendiri di tests/skrining-pembatas.test.ts.
      // Ditulis di sini agar tidak bergantung pada isi .env.local mesin siapa pun.
      PADMA_PROXY_TEPERCAYA: "1",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // Lihat komentar di tests/stubs/server-only.ts: paket asli melempar
      // Error tanpa syarat di luar bundler Next.js, dan Vitest bukan itu.
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
});
