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
    env: { DOTENV_CONFIG_PATH: ".env.local" },
  },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
