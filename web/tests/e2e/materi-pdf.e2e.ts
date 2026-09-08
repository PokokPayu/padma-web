/**
 * E2E RANTAI PENUH MATERI PDF (Task 12) — skrip TERAKHIR dari plan
 * materi-ebook-pdf, dan satu-satunya yang membuktikan seluruh rantai lewat
 * peramban & server sungguhan: Task 1-9 menulis rasterisasi PDF di peramban,
 * unggahan bertoken langsung ke Storage, gerbang `berhak_isi_materi`, dan
 * watermark yang DIBAKAR ke byte gambar; Task 11 menambah penugasan manual.
 * Tidak satu pun test sebelumnya menyalakan peramban sungguhan untuk
 * membuktikan potongan-potongan itu tersambung MENJADI SATU rantai.
 *
 * Yang dibuktikan, berurutan (lihat task-12-brief.md):
 *   1. Admin membuat materi ebook TANPA layanan, lalu mengunggah PDF 3
 *      halaman lewat `<PengunggahPdf/>` (rasterisasi + unggah di peramban).
 *   2. Klien uji BELUM berhak: rute halaman menjawab 404, dan `material_pages`
 *      lewat REST klien mengembalikan 0 baris — sementara service role
 *      membuktikan barisnya SUNGGUH ada (bukan salah materiId).
 *   3. M10: materi tanpa layanan & belum ditugaskan TIDAK muncul di daftar
 *      klien — dibandingkan dengan materi demo lain yang memang terbuka,
 *      supaya "tidak muncul" bukan gejala selektor yang rusak.
 *   4. Admin menugaskan klien itu → rute halaman menjawab 200 `image/webp`
 *      bergambar SAH (magic bytes RIFF/WEBP), dan `Cache-Control`-nya PRIVATE
 *      per pasien: `max-age=900` ada, `s-maxage`/`public` TIDAK ada.
 *   5. Materi muncul di daftar & reader menampilkan tiga `<img>` halaman.
 *   6. WATERMARK DIBAKAR: dua pasien berbeda (Ananda & Rina) menerima gambar
 *      200 yang masing-masing valid WebP tetapi ber-BYTE BERBEDA untuk
 *      HALAMAN YANG SAMA — bukti watermark ada di dalam byte, bukan lapisan
 *      CSS yang lenyap begitu gambarnya disimpan.
 *   7. Bucket benar-benar tertutup: objek `materi-halaman` tidak bisa diambil
 *      langsung lewat Storage API, baik dengan anon key MAUPUN JWT klien yang
 *      justru sedang berhak — satu-satunya jalan masuk adalah rute bergerbang.
 *   8. Mencabut penugasan mengembalikan 404 UNTUK KLIEN ITU SAJA — klien lain
 *      yang masih ditugaskan tetap 200, membuktikan cabutnya presisi.
 *   9. Seluruh data uji & objek storage bersih sesudah skrip selesai.
 *
 * Prasyarat: `npx supabase start`, `npm run seed:users`, `npm run dev`.
 * Jalankan: `npm run test:e2e:materi`.
 * Sengaja BUKAN file *.test.ts agar `npm test` (vitest) tetap bisa jalan tanpa
 * server dev & peramban.
 *
 * IDEMPOTEN: satu-satunya baris baru yang ditulis skrip ini adalah SATU
 * `materials` bertanda `E2E-MATERI-PDF` di judulnya (halaman, tautan layanan,
 * dan penugasannya ikut cascade saat baris itu dihapus — lihat migration
 * `materi_halaman_pdf`, `materi_banyak_layanan`, `materi_penugasan`). Objek di
 * bucket storage TIDAK ikut cascade (ia bukan baris Postgres) dan dibersihkan
 * manual di `bersihkan()`, dipanggil di AWAL (menyapu sisa run yang mati di
 * tengah) maupun di `finally`.
 *
 * Rina dipakai sebagai pasien kedua untuk pemeriksaan 6 & 7 — dan hanya dia
 * yang butuh penanganan khusus: skrip `access-matrix.e2e.ts` (berjalan LEBIH
 * DULU di `test:e2e:semua`) memakainya sebagai bahan skenario aktivasi dan
 * SENGAJA mengembalikannya ke keadaan "belum tertaut, tanpa akun auth" di
 * akhir setiap kali skenario itu berjalan. Skrip ini karena itu tidak pernah
 * MENGASUMSIKAN keadaan awal Rina — `keadaanRina()` merekamnya apa adanya
 * SEBELUM disentuh, dan `pulihkanRina()` mengembalikannya persis di `finally`,
 * termasuk menghapus akun auth yang skrip ini sendiri buat bila memang belum
 * ada sebelumnya. Ananda TIDAK butuh penanganan ini — dipakai HANYA sebagai
 * pembaca (login & REST), tidak ada satu pun baris miliknya yang diubah.
 */
import { writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { config } from "dotenv";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { tungguIsi } from "./_tunggu";
import { buatPdfUji } from "../bantu/pdf";

config({ path: [".env.local", ".env"] });

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const PASSWORD = "padma-dev-123";
const BUCKET = "materi-halaman";

const PENANDA_ISI = "E2E-MATERI-PDF";
const stempel = Date.now();
const JUDUL_MATERI = `${PENANDA_ISI} ${stempel}`;

const EMAIL_ANANDA = "ananda@padma.test";
const EMAIL_RINA = "rina@padma.test";
const NAMA_ANANDA = "Ananda Putri";
const NAMA_RINA = "Rina Hapsari";
// id `clients`, bukan `auth.users` — dari scripts/seed-users.ts.
const ANANDA_CLIENT_ID = "44444444-4444-4444-4444-444444444401";
const RINA_CLIENT_ID = "44444444-4444-4444-4444-444444444402";
// Materi demo ebook TERBUKA dari seed (lihat tests/e2e/passport.e2e.ts) —
// dipakai HANYA sebagai kontrol positif di pemeriksaan 3, supaya "materi uji
// tidak muncul" tidak bisa hijau palsu karena selektor/halamannya sendiri
// rusak.
const MATERI_DEMO_TERBUKA = "77777777-7777-7777-7777-777777777702";

const admin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type Hasil = { nama: string; lolos: boolean; bukti: string };
const hasil: Hasil[] = [];

function catat(nama: string, lolos: boolean, bukti: string) {
  hasil.push({ nama, lolos, bukti });
  console.log(`${lolos ? "PASS" : "FAIL"}  ${nama}\n      ${bukti}`);
}

async function login(browser: Browser, email: string): Promise<BrowserContext> {
  const context = await browser.newContext();
  const page = await context.newPage();
  // networkidle, bukan domcontentloaded: form masuk adalah controlled
  // component — isian sebelum React hydrate akan terhapus.
  await page.goto(`${BASE}/masuk`, { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Kata sandi").fill(PASSWORD);
  if ((await page.getByLabel("Email").inputValue()) !== email) {
    throw new Error("Isian email terhapus — halaman /masuk belum ter-hydrate.");
  }
  await Promise.all([
    page.waitForURL(
      (u) => !u.pathname.startsWith("/masuk") && !u.pathname.startsWith("/setelah-masuk"),
      { timeout: 20_000 },
    ),
    page.getByRole("button", { name: "Masuk", exact: true }).click(),
  ]);
  await tungguIsi(page);
  console.log(`      [login ${email}] mendarat di ${page.url()}`);
  await page.close();
  return context;
}

/** Klien supabase-js ber-SESI klien uji — dipakai menembak REST & mengambil JWT-nya. */
async function sesiRest(email: string): Promise<SupabaseClient> {
  const c = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`Gagal login REST ${email}: ${error.message}`);
  return c;
}

type HasilHalaman = { status: number; tipe: string; cache: string; byte: Buffer };

/** Mengambil satu halaman lewat rute bergerbang, memakai cookie sesi `ctx`. */
async function ambilHalaman(
  ctx: BrowserContext,
  materiId: string,
  n = 1,
): Promise<HasilHalaman> {
  const res = await ctx.request.get(`${BASE}/api/materi/${materiId}/halaman/${n}`, {
    failOnStatusCode: false,
  });
  return {
    status: res.status(),
    tipe: res.headers()["content-type"] ?? "",
    cache: res.headers()["cache-control"] ?? "",
    byte: Buffer.from(await res.body()),
  };
}

/**
 * Magic bytes WebP (`RIFF????WEBP`). Dipakai supaya pemeriksaan 4 & 6 tidak
 * bisa hijau palsu hanya karena respons 200 kebetulan berisi halaman error
 * HTML atau badan kosong — lihat peringatan di kepala task-12-brief.md.
 */
function webpSah(buf: Buffer): boolean {
  return (
    buf.length > 12 &&
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  );
}

/** Menghapus SATU materi bertanda beserta objek storage-nya (bukan cascade Postgres). */
async function bersihkan() {
  const { data: materiLama } = await admin
    .from("materials")
    .select("id")
    .like("judul", `${PENANDA_ISI}%`);
  for (const m of materiLama ?? []) {
    const id = m.id as string;
    const { data: objek } = await admin.storage.from(BUCKET).list(id);
    if (objek && objek.length > 0) {
      await admin.storage.from(BUCKET).remove(objek.map((o) => `${id}/${o.name}`));
    }
    // Cascade Postgres menyapu material_pages/material_services/material_assignments
    // miliknya (lihat migration materi_halaman_pdf, materi_banyak_layanan,
    // materi_penugasan) — objek storage di atas TIDAK ikut, itulah sebabnya
    // dihapus manual lebih dulu.
    await admin.from("materials").delete().eq("id", id);
  }
}

type KeadaanRina = { userId: string | null; linkedAt: string | null; authUserId: string | null };

async function keadaanRina(): Promise<KeadaanRina> {
  const { data: baris } = await admin
    .from("clients")
    .select("user_id, linked_at")
    .eq("id", RINA_CLIENT_ID)
    .single();
  const { data: daftar } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const user = (daftar?.users ?? []).find((u) => u.email?.toLowerCase() === EMAIL_RINA);
  return {
    userId: (baris?.user_id as string | null) ?? null,
    linkedAt: (baris?.linked_at as string | null) ?? null,
    authUserId: user?.id ?? null,
  };
}

/**
 * Menjamin Rina bisa login untuk skrip ini — TANPA mengasumsikan keadaan
 * awalnya (lihat komentar berkas). Akun auth dibuat hanya bila belum ada;
 * `clients.user_id`/`linked_at` ditaut LANGSUNG lewat service role, pola yang
 * sama dipakai `scripts/seed-users.ts` untuk Ananda dan `access-matrix.e2e.ts`
 * untuk Rina sendiri di skenario aktivasinya.
 */
async function pastikanRinaBisaLogin(): Promise<void> {
  const { data: daftar } = await admin.auth.admin.listUsers({ perPage: 1000 });
  let user = (daftar?.users ?? []).find((u) => u.email?.toLowerCase() === EMAIL_RINA);
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email: EMAIL_RINA,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    user = data.user;
  }
  const { error } = await admin
    .from("clients")
    .update({ user_id: user!.id, linked_at: new Date().toISOString() })
    .eq("id", RINA_CLIENT_ID);
  if (error) throw error;
}

async function pulihkanRina(semula: KeadaanRina): Promise<void> {
  await admin
    .from("clients")
    .update({ user_id: semula.userId, linked_at: semula.linkedAt })
    .eq("id", RINA_CLIENT_ID);
  // Akun auth hanya dihapus bila skrip ini SENDIRI yang membuatnya (semula
  // tidak ada satu pun). Bila sudah ada sebelumnya, kredensialnya dibiarkan —
  // kita tidak pernah mengubah passwordnya, jadi tidak ada yang perlu dipulihkan.
  if (!semula.authUserId) {
    const { data: daftar } = await admin.auth.admin.listUsers({ perPage: 1000 });
    for (const u of daftar?.users ?? []) {
      if (u.email?.toLowerCase() === EMAIL_RINA) await admin.auth.admin.deleteUser(u.id);
    }
  }
}

async function main() {
  await bersihkan();
  const semulaRina = await keadaanRina();

  const browser = await chromium.launch();
  let materiId = "";
  const berkasPdf = path.join(tmpdir(), `padma-e2e-materi-${stempel}.pdf`);
  let ctxRina: BrowserContext | null = null;

  try {
    writeFileSync(berkasPdf, buatPdfUji(3));

    // =============== 1. Admin membuat materi ebook TANPA layanan ============
    const ctxAdmin = await login(browser, "admin@padma.test");
    const kerja = await ctxAdmin.newPage();
    await kerja.goto(`${BASE}/admin/materi`, { waitUntil: "networkidle" });

    // "+ Materi baru" kini TAUTAN ke `?ubah=baru`, bukan tombol yang membuka
    // formulir inline: sejak sapuan rencana 2 keadaan panel hidup di URL.
    // Formulirnya langsung ada di dalam panel — gerbang keduanya (tombol
    // "+ Materi baru" di dalam panel) dibuang commit `747d330`, jadi jangan
    // menambahkan klik kedua di sini.
    await kerja.getByRole("link", { name: "+ Materi baru", exact: true }).click();
    await tungguIsi(kerja);
    await kerja.getByLabel("Judul materi").fill(JUDUL_MATERI);
    // Tipe sudah default "ebook", dan NOL checkbox layanan dicentang — materi
    // lahir sengaja tanpa satu pun layanan (bahan pemeriksaan 3, aturan M10).
    await kerja.getByRole("button", { name: "Simpan materi", exact: true }).click();
    // Sukses menutup panel lewat `router.push(hrefTutup)` — tidak ada teks
    // sukses untuk ditunggu. Yang membuktikan simpannya mendarat: panelnya
    // pergi, lalu judulnya muncul di tabel.
    await kerja.locator('[role="dialog"]').waitFor({ state: "detached", timeout: 20_000 });
    await kerja.getByText(JUDUL_MATERI).first().waitFor({ timeout: 20_000 });

    const { data: materiBaru, error: eMateriBaru } = await admin
      .from("materials")
      .select("id, aktif")
      .eq("judul", JUDUL_MATERI)
      .single();
    if (eMateriBaru || !materiBaru) throw new Error("Materi uji tidak tercatat di basis data.");
    materiId = materiBaru.id as string;
    catat(
      "1a. materi baru lahir NONAKTIF (gagal-tertutup sebelum isinya ada)",
      materiBaru.aktif === false,
      `materials.aktif: ${String(materiBaru.aktif)}`,
    );

    // Materi baru lahir NONAKTIF dan daftarnya berurut `aktif desc, judul asc`
    // (`ambilDaftarMateri`) — begitu klinik punya 25+ materi (`PER_HAL`), baris
    // ini jatuh ke halaman terakhir, bukan halaman 1. Cari lewat `stempel`
    // supaya baris ini pasti tampil di halaman yang sedang dilihat.
    await kerja.goto(`${BASE}/admin/materi?cari=${stempel}`, { waitUntil: "networkidle" });
    // Isi materi kini hidup di halaman DETAIL, dan Kartu "Isi" SELALU tampil —
    // tombol "Kelola isi" tidak ada lagi (lihat dokblok `AksiMateri`). Baris
    // daftar menaut ke sana lewat judulnya.
    await kerja.getByRole("link", { name: JUDUL_MATERI }).click();
    await tungguIsi(kerja);
    await kerja
      .locator('input[type="file"][accept="application/pdf"]')
      .setInputFiles(berkasPdf);
    // Rasterisasi + unggah berjalan DI PERAMBAN dan menembak banyak permintaan
    // paralel — "networkidle" datang dan pergi berkali-kali sebelum baris
    // `material_pages` tercatat. Tunggu TEKS HASILNYA, bukan jaringan.
    // `.first()` MENGIKAT: "3 halaman tersimpan." muncul DUA KALI di halaman
    // yang sama — pesan sukses `<PengunggahPdf/>` (`role="status"`) dan
    // ringkasan `<IsiEbook/>` yang membaca `jumlahHalaman` dari server.
    await kerja.getByText(/3 halaman tersimpan/).first().waitFor({ timeout: 60_000 });

    const { count: halamanTercatat } = await admin
      .from("material_pages")
      .select("halaman", { count: "exact", head: true })
      .eq("material_id", materiId);
    catat(
      "1b. 3 baris material_pages BENAR-BENAR tercatat (bukan cuma pesan panel)",
      halamanTercatat === 3,
      `material_pages di basis data: ${halamanTercatat} baris`,
    );

    // Diterbitkan SEKARANG, sebelum pemeriksaan hak: `berhak_isi_materi`
    // mensyaratkan `materials.aktif = true` di CABANG MANA PUN (otomatis
    // ataupun penugasan) — tanpa ini, pemeriksaan 2 & 4 di bawah tercampur
    // alasan "materi belum terbit", bukan murni menguji gerbang penugasan.
    // `exact: true` MENGIKAT: pencocokan nama `getByRole` bawaan Playwright
    // adalah SUBSTRING tanpa peduli huruf besar/kecil, sehingga
    // { name: "Aktifkan" } ikut mencocoki "NonAKTIFKAN". Tanpa `exact`,
    // `waitFor` selesai SEKETIKA pada tombol lama dan pemeriksaan berikutnya
    // membaca basis data sebelum server action-nya mendarat.
    await kerja.getByRole("button", { name: "Aktifkan", exact: true }).click();
    await kerja
      .getByRole("button", { name: "Nonaktifkan", exact: true })
      .waitFor({ state: "visible", timeout: 20_000 });

    // =============== 2. Klien uji BELUM berhak ================================
    const ctxAnanda = await login(browser, EMAIL_ANANDA);
    const restAnanda = await sesiRest(EMAIL_ANANDA);

    const sebelumAssign = await ambilHalaman(ctxAnanda, materiId);
    const { data: bacaKlien, error: eBacaKlien } = await restAnanda
      .from("material_pages")
      .select("halaman")
      .eq("material_id", materiId);
    // Kontrol: service role harus tetap melihat 3 baris SAAT INI JUGA — tanpa
    // ini, "0 baris" di atas bisa hijau palsu karena materiId salah ketik atau
    // baris memang belum sempat tercatat, bukan karena gerbang penugasan.
    const { count: totalSungguhan } = await admin
      .from("material_pages")
      .select("halaman", { count: "exact", head: true })
      .eq("material_id", materiId);
    catat(
      "2. klien belum ditugaskan -> rute 404 & REST 0 baris (baris sungguhan tetap 3 lewat service role)",
      sebelumAssign.status === 404 &&
        !eBacaKlien &&
        (bacaKlien ?? []).length === 0 &&
        totalSungguhan === 3,
      `rute: ${sebelumAssign.status}; REST klien: ${(bacaKlien ?? []).length} baris; REST service role: ${totalSungguhan} baris`,
    );

    // =============== 3. M10: materi tanpa layanan tidak muncul ===============
    const halamanDaftar = await ctxAnanda.newPage();
    await halamanDaftar.goto(`${BASE}/passport/materi`, { waitUntil: "networkidle" });
    await tungguIsi(halamanDaftar);
    const kartuTakMuncul = await halamanDaftar.locator(`[data-materi-id="${materiId}"]`).count();
    const demoTetapMuncul = await halamanDaftar
      .locator(`[data-materi-id="${MATERI_DEMO_TERBUKA}"][data-materi-terbuka="ya"]`)
      .count();
    catat(
      "3. materi tanpa layanan & belum ditugaskan TIDAK muncul (M10) — materi demo pembanding tetap muncul",
      kartuTakMuncul === 0 && demoTetapMuncul === 1,
      `kartu materi uji: ${kartuTakMuncul}; kartu demo terbuka (kontrol): ${demoTetapMuncul}`,
    );
    await halamanDaftar.close();

    // =============== 4. Admin menugaskan klien -> klien jadi berhak ==========
    // Kartu "Penugasan manual" SELALU tampil di halaman detail; tombol
    // "Kelola penugasan" tidak ada lagi (lihat dokblok `AksiMateri`).
    await kerja
      .getByLabel(`Tugaskan materi ${JUDUL_MATERI} ke klien`)
      .selectOption({ value: ANANDA_CLIENT_ID });
    await kerja.getByRole("button", { name: "Tugaskan", exact: true }).click();
    // `li` MENGIKAT: sebelum diklik, "Ananda Putri" sudah ada di DOM sebagai
    // <option> pilihan dropdown (tidak pernah visible, tapi tetap dalam DOM).
    // Menunggu `<li>` yang memuat namanya membedakan baris "ditugaskan"
    // sungguhan dari opsi dropdown yang kebetulan memuat teks yang sama.
    await kerja
      .locator("li")
      .filter({ hasText: NAMA_ANANDA })
      .first()
      .waitFor({ state: "visible", timeout: 20_000 });

    const sesudahAssign = await ambilHalaman(ctxAnanda, materiId);
    catat(
      "4a. sesudah ditugaskan: rute menjawab 200 image/webp bergambar SAH (magic bytes RIFF/WEBP)",
      sesudahAssign.status === 200 &&
        sesudahAssign.tipe.includes("image/webp") &&
        webpSah(sesudahAssign.byte),
      `status ${sesudahAssign.status}; content-type ${sesudahAssign.tipe}; panjang ${sesudahAssign.byte.length} byte`,
    );
    catat(
      "4b. cache PRIVATE per pasien: max-age=900 ADA, s-maxage & public TIDAK ADA",
      sesudahAssign.cache.includes("private") &&
        sesudahAssign.cache.includes("max-age=900") &&
        !sesudahAssign.cache.includes("s-maxage") &&
        !sesudahAssign.cache.includes("public"),
      `cache-control: ${sesudahAssign.cache}`,
    );

    // =============== 5. Materi muncul & reader menampilkan 3 halaman =========
    const halamanReader = await ctxAnanda.newPage();
    await halamanReader.goto(`${BASE}/passport/materi`, { waitUntil: "networkidle" });
    await tungguIsi(halamanReader);
    catat(
      "5a. materi kini muncul & bertanda terbuka di daftar klien",
      (await halamanReader
        .locator(`[data-materi-id="${materiId}"][data-materi-terbuka="ya"]`)
        .count()) === 1,
      "kartu materi tampil dengan data-materi-terbuka=ya",
    );

    await halamanReader.goto(`${BASE}/passport/materi/${materiId}`, { waitUntil: "networkidle" });
    await tungguIsi(halamanReader);
    // Sama seperti pemeriksaan 3e di passport.e2e.ts (dan untuk alasan yang
    // sama): menghitung KEHADIRAN tag <img> saja lolos vakum — React menulis
    // atribut `src` pada tag <img> APA PUN nasib permintaannya di baliknya,
    // tag itu tetap ada di DOM walau rutenya membalas 403/404. Sudah
    // materially tercakup checks 4a & 6 di skrip ini (keduanya membuktikan
    // byte WebP SAH lewat rute yang sama), tapi pemeriksaan INI SENDIRI perlu
    // dikencangkan supaya bentuknya konsisten: yang membedakan "termuat" dari
    // "gagal senyap" adalah PIKSEL SUNGGUHAN — `naturalWidth`/`naturalHeight`
    // tetap 0 pada gambar yang gagal dimuat, tidak peduli isi atribut `src`.
    // Ditunggu per halaman lewat `waitForFunction` (menunggu `img.complete`),
    // bukan dibaca sekali segera sesudah goto — supaya tidak balapan dengan
    // permintaan gambar yang belum tuntas.
    let jumlahImg = 0;
    let jumlahBerpiksel = 0;
    const detilHalaman: string[] = [];
    for (const n of [1, 2, 3]) {
      const selektor = `img[src="/api/materi/${materiId}/halaman/${n}"]`;
      const ada = await halamanReader.locator(selektor).count();
      jumlahImg += ada;
      if (ada !== 1) {
        detilHalaman.push(`halaman ${n}: ${ada} tag <img> (bukan 1)`);
        continue;
      }
      let dimensi = { naturalWidth: 0, naturalHeight: 0 };
      try {
        await halamanReader.waitForFunction(
          (sel) => {
            const el = document.querySelector(sel) as HTMLImageElement | null;
            return !!el && el.complete;
          },
          selektor,
          { timeout: 15_000 },
        );
        dimensi = await halamanReader.locator(selektor).evaluate((el) => ({
          naturalWidth: (el as HTMLImageElement).naturalWidth,
          naturalHeight: (el as HTMLImageElement).naturalHeight,
        }));
      } catch (e) {
        detilHalaman.push(
          `halaman ${n}: gagal menunggu load (${e instanceof Error ? e.message : String(e)})`,
        );
        continue;
      }
      if (dimensi.naturalWidth > 0 && dimensi.naturalHeight > 0) jumlahBerpiksel++;
      detilHalaman.push(
        `halaman ${n}: naturalWidth=${dimensi.naturalWidth} naturalHeight=${dimensi.naturalHeight}`,
      );
    }
    catat(
      "5b. reader menampilkan TEPAT 3 elemen <img> BERISI PIKSEL SUNGGUHAN lewat rute bergerbang (bukan cuma tag <img> yang ditulis)",
      jumlahImg === 3 && jumlahBerpiksel === 3,
      detilHalaman.join("; "),
    );
    await halamanReader.close();

    // =============== 6. WATERMARK DIBAKAR: dua pasien, byte BERBEDA ==========
    await pastikanRinaBisaLogin();
    // Masih di halaman detail yang sama sejak pemeriksaan 1 — tidak ada
    // `kartuMateri` (li) lagi untuk menyekop locator ini, sama seperti
    // penugasan Ananda di atas.
    await kerja
      .getByLabel(`Tugaskan materi ${JUDUL_MATERI} ke klien`)
      .selectOption({ value: RINA_CLIENT_ID });
    await kerja.getByRole("button", { name: "Tugaskan", exact: true }).click();
    await kerja
      .locator("li")
      .filter({ hasText: NAMA_RINA })
      .first()
      .waitFor({ state: "visible", timeout: 20_000 });

    ctxRina = await login(browser, EMAIL_RINA);
    const a = await ambilHalaman(ctxAnanda, materiId);
    const b = await ambilHalaman(ctxRina, materiId);
    // Status/tipe/magic-bytes diperiksa BERSAMA ketidaksamaan byte-nya —
    // tanpa itu dua respons 404 (atau dua halaman error yang identik) akan
    // "berbeda byte" secara vakum tanpa membuktikan watermark apa pun. Lihat
    // peringatan di kepala task-12-brief.md.
    catat(
      "6. dua pasien menerima gambar 200 valid (WebP sah) untuk halaman YANG SAMA — TAPI ber-byte BERBEDA (watermark dibakar, bukan lapisan CSS)",
      a.status === 200 &&
        b.status === 200 &&
        webpSah(a.byte) &&
        webpSah(b.byte) &&
        !a.byte.equals(b.byte),
      `panjang Ananda ${a.byte.length} vs Rina ${b.byte.length} byte; identik: ${a.byte.equals(b.byte)}`,
    );

    // =============== 7. Objek storage tertutup TOTAL ==========================
    const { data: barisHalaman1 } = await admin
      .from("material_pages")
      .select("objek")
      .eq("material_id", materiId)
      .eq("halaman", 1)
      .single();
    const objekUrl = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${barisHalaman1!.objek}`;
    const { data: sesiAnanda } = await restAnanda.auth.getSession();
    const tokenAnanda = sesiAnanda.session!.access_token;

    const [viaAnon, viaKlienBerhak] = await Promise.all([
      fetch(objekUrl, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } }),
      fetch(objekUrl, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${tokenAnanda}` } }),
    ]);
    catat(
      "7. objek storage tidak bisa diambil LANGSUNG — anon key MAUPUN JWT klien yang justru sedang berhak",
      viaAnon.status !== 200 && viaKlienBerhak.status !== 200,
      `anon: ${viaAnon.status}; JWT klien berhak: ${viaKlienBerhak.status} (objek yang sama SUKSES 200 lewat rute bergerbang di pemeriksaan 4)`,
    );

    // =============== 8. Cabut penugasan menutup lagi, PRESISI =================
    // `kerja`, bukan `kartuMateri`: sudah tidak ada `<li>` pembungkus kartu
    // sejak pemeriksaan 1 pindah ke halaman detail (lihat komentar di :484).
    const liAnanda = kerja.locator("li").filter({ hasText: NAMA_ANANDA });
    await liAnanda.getByRole("button", { name: "Cabut" }).click();
    await liAnanda.waitFor({ state: "detached", timeout: 20_000 });

    const [sesudahCabutAnanda, rinaTetapBerhak] = await Promise.all([
      ambilHalaman(ctxAnanda, materiId),
      ambilHalaman(ctxRina, materiId),
    ]);
    catat(
      "8. pencabutan mengembalikan Ananda ke 404 TANPA menyentuh hak Rina (masih 200)",
      sesudahCabutAnanda.status === 404 && rinaTetapBerhak.status === 200,
      `Ananda (dicabut): ${sesudahCabutAnanda.status}; Rina (masih ditugaskan): ${rinaTetapBerhak.status}`,
    );
  } finally {
    await browser.close();
    try {
      unlinkSync(berkasPdf);
    } catch {
      // berkas sementara — kegagalan hapus tidak boleh menutupi hasil di atas.
    }
    await pulihkanRina(semulaRina);
    await bersihkan();
  }

  // ================= 9. Pembersihan benar-benar bersih ========================
  const { data: sisaMateri } = await admin
    .from("materials")
    .select("id")
    .like("judul", `${PENANDA_ISI}%`);
  let sisaObjek = 0;
  if (materiId) {
    const { data: objekSisa } = await admin.storage.from(BUCKET).list(materiId);
    sisaObjek = objekSisa?.length ?? 0;
  }
  const sesudahRina = await keadaanRina();
  catat(
    "9. seluruh data uji, objek storage, dan keadaan Rina bersih kembali",
    (sisaMateri ?? []).length === 0 &&
      sisaObjek === 0 &&
      sesudahRina.userId === semulaRina.userId &&
      sesudahRina.authUserId === semulaRina.authUserId,
    `materi sisa: ${(sisaMateri ?? []).length}; objek storage sisa: ${sisaObjek}; Rina user_id semula=${String(
      semulaRina.userId,
    )} kini=${String(sesudahRina.userId)}; akun auth semula=${String(
      semulaRina.authUserId !== null,
    )} kini=${String(sesudahRina.authUserId !== null)}`,
  );

  const gagal = hasil.filter((h) => !h.lolos);
  console.log(`\n${hasil.length - gagal.length}/${hasil.length} pemeriksaan lolos.`);
  if (gagal.length > 0) {
    console.error("GAGAL:\n" + gagal.map((g) => `  - ${g.nama}`).join("\n"));
    process.exit(1);
  }
  console.log(
    "Rantai penuh materi PDF terbukti utuh: unggah di peramban -> gating berhak_isi_materi -> watermark dibakar per pasien -> bucket tertutup total.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
