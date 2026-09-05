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
import {
  MATERI_VIDEO_TERBUKA,
  MATERI_VIDEO_TERKUNCI,
  OBJEK_VIDEO_TERBUKA,
  OBJEK_VIDEO_TERKUNCI,
} from "./helpers/materi-video-fixture";

/**
 * Materi video demo (1101 Sankalpa "…701" TERBUKA, 1106 Lactation Hero
 * "…703" TERKUNCI — id & nilai `objek`-nya ada di
 * `tests/helpers/materi-video-fixture.ts`, diimpor juga oleh berkas test
 * yang perlu mencocokkan nilai yang disemai di sini).
 *
 * `supabase/seed.sql` SENGAJA tidak menaruh baris `material_videos` DAN
 * menyemai kedua materi ini `aktif = false` (spec §13b A-6 + fix F4, video-r2
 * fix wave): menyemai OBJEK SUNGGUHAN ke bucket R2 pada setiap `db reset`
 * berarti setiap mesin dev menulis ke bucket bersama, jadi demo dev dibiarkan
 * kosong — "Belum ada isi" DAN nonaktif di panel admin, tidak muncul sama
 * sekali di passport, sampai admin mengunggah video sungguhan dan menerbitkannya.
 *
 * Fungsi ini TIDAK melanggar keputusan itu: baris `material_videos` yang
 * ditaruhnya hanya METADATA (kolom `objek` berisi string placeholder) — TIDAK
 * ADA satu byte pun ditulis ke R2 — dan ia HANYA dipanggil dari globalSetup
 * vitest, bukan dari `seedUsers()` yang juga dipakai `npm run
 * seed:users`/`npm run dev`. Baris ini (dan pengaktifan `materials.aktif` di
 * baliknya, lihat akhir fungsi) karena itu tidak pernah muncul di demo yang
 * dilihat manusia.
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

  // `supabase/seed.sql` menyemai KEDUA materi ini `aktif = false` (spec §13b
  // A-6 + fix F4, video-r2 fix wave): tanpa baris `material_videos`, `aktif =
  // true` adalah keadaan yang `aktifkanMateri` (`src/app/admin/materi/aksi.ts`)
  // sendiri menolak menerbitkan lewat panel admin. Baris di atas baru saja
  // memberi keduanya isi SUNGGUHAN (dari sudut pandang basis data — bukan
  // byte R2 apa pun, lihat dokblok fungsi ini), jadi urutan yang sama yang
  // dituntut dari admin sungguhan berlaku di sini juga: isi DULU, baru aktif.
  // Membalik urutan ini akan membuat jendela sempit di mana baris `materials`
  // aktif tanpa isi — persis pelanggaran yang `tests/admin-materi.test.ts`
  // ("invarian: tidak ada satu pun materi AKTIF tanpa isi") ada untuk cegah.
  const { error: errAktif } = await admin
    .from("materials")
    .update({ aktif: true })
    .in("id", [MATERI_VIDEO_TERBUKA, MATERI_VIDEO_TERKUNCI]);
  if (errAktif) throw errAktif;
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
