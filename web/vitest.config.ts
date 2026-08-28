import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    // Test RLS berbagi satu stack Supabase lokal — jalankan berurutan agar deterministik.
    fileParallelism: false,
    setupFiles: ["dotenv/config"],
    // Seed user demo otomatis sebelum test — `npm test` harus hijau langsung
    // sesudah `npx supabase db reset`, tanpa `npm run seed:users` manual.
    globalSetup: ["tests/global-setup.ts"],
    env: {
      DOTENV_CONFIG_PATH: ".env.local",
      // Test rate limit /api/skrining menirukan DEPLOY NYATA: satu proxy
      // tepercaya (Vercel) di depan aplikasi, yang menulis hop terluar
      // X-Forwarded-For. Kasus "tanpa proxy tepercaya" (nilai 0, seperti
      // `next dev` lokal) diuji tersendiri di tests/skrining-pembatas.test.ts.
      // Ditulis di sini agar tidak bergantung pada isi .env.local mesin siapa pun.
      PADMA_PROXY_TEPERCAYA: "1",
    },
  },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
