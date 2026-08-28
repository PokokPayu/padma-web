/**
 * globalSetup vitest — dijalankan SEKALI sebelum semua file test.
 *
 * Alasan: sesudah `npx supabase db reset` tabel auth.users kosong, sehingga
 * setiap test yang login (tests/helpers/as-user.ts) gagal dengan
 * "Invalid login credentials". Sebelumnya urutan `npm run seed:users` hanya
 * ditulis sebagai prosa di README — rapuh untuk CI. Sekarang seed dijalankan
 * otomatis di sini.
 *
 * Seed idempoten (user dibuat hanya bila belum ada, sisanya upsert), jadi
 * menjalankan `npm test` berkali-kali tetap murah — satu kali per run,
 * bukan per file test.
 */
import { config } from "dotenv";
import { seedUsers } from "../scripts/seed-users";

export default async function setup() {
  // vitest.config.ts memuat .env.local lewat setupFiles, tapi setupFiles hanya
  // berlaku di dalam worker test — globalSetup butuh env-nya sendiri.
  config({ path: [".env.local", ".env"] });

  const mulai = Date.now();
  await seedUsers();
  console.log(`[globalSetup] seed pengguna & data demo siap (${Date.now() - mulai}ms)`);
}
