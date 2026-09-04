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
import { createClient } from "@supabase/supabase-js";
import { seedUsers } from "../scripts/seed-users";

// Materi video demo (1101 Sankalpa "…701" TERBUKA, 1106 Lactation Hero "…703"
// TERKUNCI — id yang sama dipakai tests/rls-materi.test.ts, passport-data,
// passport-materi) — lihat komentar lengkap di `semaikanVideoDemoUntukTest`.
//
// `OBJEK_VIDEO_*` diekspor (bukan ditulis ulang di tiap berkas test) supaya
// nilai yang DISEMAI di sini dan nilai yang DIHARAPKAN oleh test lain tidak
// pernah mengembang berbeda — impor murni string konstan, aman lintas
// globalSetup/worker vitest (tidak ada state runtime yang dibagi).
export const MATERI_VIDEO_TERBUKA = "77777777-7777-7777-7777-777777777701";
export const MATERI_VIDEO_TERKUNCI = "77777777-7777-7777-7777-777777777703";
export const OBJEK_VIDEO_TERBUKA = `${MATERI_VIDEO_TERBUKA}/fixture-demo.mp4`;
export const OBJEK_VIDEO_TERKUNCI = `${MATERI_VIDEO_TERKUNCI}/fixture-rahasia.mp4`;

/**
 * `supabase/seed.sql` SENGAJA tidak menaruh baris `material_videos` (spec
 * §13b A-6): menyemai OBJEK SUNGGUHAN ke bucket R2 pada setiap `db reset`
 * berarti setiap mesin dev menulis ke bucket bersama, jadi demo dev dibiarkan
 * kosong — "Belum ada isi" di panel admin, terkunci di passport, sampai admin
 * mengunggah video sungguhan.
 *
 * Fungsi ini TIDAK melanggar keputusan itu: ia hanya menaruh METADATA (baris
 * Postgres, kolom `objek` berisi string placeholder) — TIDAK ADA satu byte
 * pun ditulis ke R2 — dan HANYA dipanggil dari globalSetup vitest, bukan dari
 * `seedUsers()` yang juga dipakai `npm run seed:users`/`npm run dev`. Baris
 * ini karena itu tidak pernah muncul di demo yang dilihat manusia.
 *
 * Kenapa perlu: sejumlah test regresi yang lebih tua dari migrasi objek-R2
 * (tests/rls-materi.test.ts — kebocoran RLS; tests/passport-*.test.ts —
 * gating & markup; tests/admin-materi.test.ts "invarian: tidak ada satu pun
 * materi AKTIF tanpa isi") menuntut baris `material_videos` SUNGGUHAN untuk
 * kedua materi video demo ini benar-benar ada. Tanpanya invarian-invarian
 * itu jadi lolos kebetulan (tidak ada apa pun untuk dibocorkan) atau merah
 * (materi aktif dianggap tak lengkap) — bukan karena regresi produk.
 *
 * Disemai di globalSetup (SEKALI, sebelum berkas test mana pun jalan) alih-
 * alih di `beforeAll` per berkas test: banyak berkas independen memakai id
 * yang SAMA, dan `fileParallelism: false` membuat baris yang disemai lalu
 * dibongkar lagi di satu berkas TIDAK ADA lagi ketika berkas lain berjalan.
 */
async function semaikanVideoDemoUntukTest() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  // Nilai `objek` SENGAJA berbentuk kunci objek (`{material_id}/{acak}.mp4`),
  // BUKAN URL berawalan "http" — `tests/materi-video-skema.test.ts` menuntut
  // TIDAK ADA baris `objek like 'http%'` yang tersisa sesudah migrasi, dan
  // baris fixture ini pun harus patuh pada aturan yang sama.
  const { error } = await admin.from("material_videos").upsert([
    { material_id: MATERI_VIDEO_TERBUKA, objek: OBJEK_VIDEO_TERBUKA, mime: "video/mp4" },
    { material_id: MATERI_VIDEO_TERKUNCI, objek: OBJEK_VIDEO_TERKUNCI, mime: "video/mp4" },
  ]);
  if (error) throw error;
}

export default async function setup() {
  // vitest.config.ts memuat .env.local lewat setupFiles, tapi setupFiles hanya
  // berlaku di dalam worker test — globalSetup butuh env-nya sendiri.
  config({ path: [".env.local", ".env"] });

  const mulai = Date.now();
  await seedUsers();
  await semaikanVideoDemoUntukTest();
  console.log(`[globalSetup] seed pengguna & data demo siap (${Date.now() - mulai}ms)`);
}
