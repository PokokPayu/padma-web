/**
 * E2E funnel calon klien (Plan 2 Task 8).
 *
 * Membuktikan lewat browser sungguhan:
 *   1. Landing publik menampilkan katalog DARI DATABASE (bukan kosong)
 *   2. Wizard skrining berjalan; demam saat KEHAMILAN memicu urgent + blok 119
 *   3. Kode skrining tampil, dan TIDAK muncul di URL (data kesehatan)
 *   4. Entri itu muncul di inbox admin dengan penanda URGENT
 *
 * Prasyarat: `npx supabase start`, `npm run seed:users`, `npm run dev`.
 * Jalankan: `npm run test:e2e:funnel`.
 * Sengaja BUKAN file *.test.ts agar `npm test` (vitest) tetap bisa jalan
 * tanpa server dev & browser.
 */
import { config } from "dotenv";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { tungguIsi } from "./_tunggu";

config({ path: [".env.local", ".env"] });

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const PASSWORD = "padma-dev-123";
const NAMA_UJI = "Uji E2E Funnel";

type Hasil = { nama: string; lolos: boolean; bukti: string };
const hasil: Hasil[] = [];

function catat(nama: string, lolos: boolean, bukti: string) {
  hasil.push({ nama, lolos, bukti });
  console.log(`${lolos ? "PASS" : "FAIL"}  ${nama}\n      ${bukti}`);
}

/**
 * Teks yang benar-benar TERLIHAT pengunjung.
 * `textContent("body")` ikut memungut isi <script> payload RSC Next.js —
 * di situ angka "119" dan kata apa pun bisa muncul kebetulan, sehingga
 * pemeriksaan pagar keselamatan lolos palsu. `innerText` tidak.
 */
async function teksTerlihat(page: Page): Promise<string> {
  return (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
}

/** true bila locator muncul sebelum tenggat; false (bukan lempar) bila tidak. */
async function munculDalam(
  page: Page,
  teks: string,
  tenggat = 30_000,
): Promise<boolean> {
  return page
    .getByText(teks)
    .first()
    .waitFor({ state: "visible", timeout: tenggat })
    .then(() => true, () => false);
}

async function login(browser: Browser, email: string): Promise<BrowserContext> {
  const context = await browser.newContext();
  const page = await context.newPage();
  // networkidle, bukan domcontentloaded: input form masuk adalah controlled
  // component — isian sebelum React hydrate akan terhapus.
  await page.goto(`${BASE}/masuk`, { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Kata sandi").fill(PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/masuk"), { timeout: 20_000 }),
    page.getByRole("button", { name: "Masuk", exact: true }).click(),
  ]);
  await tungguIsi(page);
  await page.close();
  return context;
}

const svc = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

async function main() {
  const browser = await chromium.launch();

  // ---- 1. Landing publik: katalog dari DB ----
  const tamu = await browser.newContext();
  const landing = await tamu.newPage();
  await landing.goto(BASE, { waitUntil: "networkidle" });
  const teksLanding = await teksTerlihat(landing);
  const fase = ["Sankalpa", "Garbha", "Purnama", "Sandhya", "Shishu"];
  const faseAda = fase.filter((f) => teksLanding.includes(f));
  catat(
    "1a. landing menampilkan 5 lini layanan dari DB",
    faseAda.length === 5,
    `ditemukan: ${faseAda.join(", ") || "(tidak ada)"}`,
  );
  catat(
    "1b. landing menampilkan nama layanan dummy dari DB",
    teksLanding.includes("Sankalpa Fertility Massage"),
    teksLanding.includes("Sankalpa Fertility Massage")
      ? "nama layanan ditemukan"
      : "TIDAK ditemukan — policy baca publik mungkin belum berlaku",
  );

  // ---- 2. Wizard skrining: demam saat kehamilan = urgent ----
  await landing.getByRole("link", { name: /Mulai Skrining/i }).first().click();
  await landing.waitForURL(/\/skrining$/, { timeout: 20_000 });
  await tungguIsi(landing);
  catat("2a. CTA landing membawa ke /skrining", true, landing.url());

  await landing.getByLabel("Nama panggilan").fill(NAMA_UJI);
  await landing.getByLabel("No. WhatsApp").fill("0812-0000-1234");
  await landing.getByRole("button", { name: "Kehamilan", exact: true }).click();
  await landing.getByRole("checkbox").check();
  const tombolMulai = landing.getByRole("button", { name: "Mulai Skrining" });
  catat("2b. tombol mulai aktif setelah syarat lengkap", await tombolMulai.isEnabled(), "enabled");
  await tombolMulai.click();

  // cardioresp -> Tidak, severe_pain -> Tidak, fever -> Ya (urgent pada kehamilan).
  // Nomor pertanyaan ditunggu tiap langkah: klik beruntun tanpa menunggu bisa
  // mendarat di render lama dan diam-diam menjawab soal yang sama dua kali.
  for (const nomor of [1, 2, 3]) {
    await landing.getByText(`Pertanyaan ${nomor} dari`).waitFor({ timeout: 10_000 });
    await landing
      .getByRole("button", { name: nomor === 3 ? "Ya" : "Tidak", exact: true })
      .click();
  }

  // Tunggu layar hasil benar-benar muncul (POST /api/skrining bisa memakan
  // beberapa detik saat route dikompilasi pertama kali di dev). Disclaimer
  // penutup dipakai sebagai penanda netral: ia tampil pada hijau maupun merah.
  const layarHasil = await munculDalam(landing, "Hasil ini adalah pra-skrining");
  catat(
    "2c. layar hasil tampil setelah jawaban terakhir",
    layarHasil,
    layarHasil ? "layar hasil terlihat" : "layar hasil TIDAK muncul dalam 30 detik",
  );

  const teksHasil = await teksTerlihat(landing);
  catat(
    "2d. demam saat KEHAMILAN -> merah",
    teksHasil.includes("Layanan belum dapat dijadwalkan"),
    teksHasil.includes("Layanan belum dapat dijadwalkan") ? "hasil merah" : "BUKAN merah",
  );
  catat(
    "2e. PAGAR KESELAMATAN: blok darurat 119 tampil",
    teksHasil.includes("hubungi 119 sekarang"),
    teksHasil.includes("hubungi 119 sekarang")
      ? "blok 119 terlihat"
      : "blok 119 TIDAK ADA — regresi keselamatan",
  );

  const kode = (teksHasil.match(/PDM-\d{6}-\d{4}-[A-Z0-9]{4}/) ?? [])[0] ?? "";
  catat("3a. kode skrining tampil di layar hasil", Boolean(kode), kode || "(tidak ada kode)");
  catat(
    "3b. kode TIDAK muncul di URL (data kesehatan)",
    !landing.url().includes("PDM-") && !landing.url().includes("hasil="),
    landing.url(),
  );

  // ---- 4. Inbox admin ----
  const ctxAdmin = await login(browser, "admin@padma.test");
  const inbox = await ctxAdmin.newPage();
  await inbox.goto(`${BASE}/admin/skrining`, { waitUntil: "networkidle" });
  const teksInbox = await teksTerlihat(inbox);
  catat(
    "4a. entri skrining muncul di inbox admin",
    Boolean(kode) && teksInbox.includes(kode),
    kode ? `mencari ${kode}` : "tidak ada kode untuk dicari",
  );
  // Penanda diperiksa pada BARIS kode ini, bukan sekadar ada di halaman:
  // entri lama yang urgent akan membuat pemeriksaan halaman lolos palsu.
  const barisKode = kode ? inbox.locator("tr", { hasText: kode }) : null;
  const teksBaris = barisKode
    ? (await barisKode.first().innerText()).replace(/\s+/g, " ").trim()
    : "";
  catat(
    "4b. baris skrining ini ditandai MERAH · URGENT",
    teksBaris.includes("MERAH · URGENT"),
    teksBaris || "(baris tidak ditemukan)",
  );

  // ---- 5. Spec §8: penyimpanan GAGAL tidak boleh mematikan funnel ----
  // Endpoint sengaja dijatuhkan (500) supaya kegagalan benar-benar terjadi di
  // browser, bukan sekadar disimpulkan dari membaca kode. Yang harus tetap
  // berdiri: layar hasil, tombol WhatsApp. Yang TIDAK boleh muncul: chip
  // "Tersimpan" — menampilkannya saat gagal adalah berbohong ke pengguna dan
  // menyesatkan admin yang mencari kodenya di inbox.
  const ctxGagal = await browser.newContext();
  const gagalPage = await ctxGagal.newPage();
  await gagalPage.route("**/api/skrining", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
  );
  await gagalPage.goto(`${BASE}/skrining`, { waitUntil: "networkidle" });
  await gagalPage.getByLabel("Nama panggilan").fill("Uji Gagal Simpan");
  await gagalPage.getByLabel("No. WhatsApp").fill("0812-0000-4321");
  await gagalPage.getByRole("button", { name: "Menopause", exact: true }).click();
  await gagalPage.getByRole("checkbox").check();
  await gagalPage.getByRole("button", { name: "Mulai Skrining" }).click();

  // Menopause: 7 soal umum + 4 soal fase, semuanya dijawab "Tidak" -> hijau.
  //
  // Nomor pertanyaan ditunggu tiap langkah, persis seperti skenario 2. Tombol
  // "Tidak" adalah simpul DOM yang SAMA di seluruh pertanyaan, jadi klik
  // beruntun tanpa menunggu bisa mendarat di render lama: dua klik memakai
  // `indeks` yang sama sehingga satu jawaban tertelan dan wizard berhenti
  // sebelum pertanyaan terakhir. Kegagalannya tidak deterministik — kadang
  // 5a merah sendirian, kadang 5a+5b sekaligus.
  for (let nomor = 1; nomor <= 11; nomor++) {
    await gagalPage.getByText(`Pertanyaan ${nomor} dari`).waitFor({ timeout: 10_000 });
    await gagalPage.getByRole("button", { name: "Tidak", exact: true }).click();
  }
  // Penanda netral yang sama dengan 2c: layar hasil, bukan sekadar jaringan
  // sepi. `networkidle` bisa terpenuhi sebelum React sempat merender hasil.
  const hasilTampil = await munculDalam(gagalPage, "Hasil ini adalah pra-skrining");
  const teksGagal = (await gagalPage.textContent("body")) ?? "";

  catat(
    "5a. endpoint mati -> layar hasil TETAP tampil (funnel hidup)",
    hasilTampil && teksGagal.includes("Layanan dapat dijadwalkan"),
    hasilTampil && teksGagal.includes("Layanan dapat dijadwalkan")
      ? "hasil tetap tampil"
      : "funnel MATI",
  );
  const adaTombolWa = await gagalPage
    .getByRole("link", { name: /WhatsApp/i })
    .count();
  catat(
    "5b. endpoint mati -> tombol WhatsApp tetap ada",
    adaTombolWa > 0,
    `${adaTombolWa} tautan WhatsApp`,
  );
  catat(
    "5c. endpoint mati -> chip 'Tersimpan' TIDAK berbohong",
    !teksGagal.includes("Tersimpan di sistem PADMA"),
    teksGagal.includes("Tersimpan di sistem PADMA")
      ? "chip MUNCUL padahal gagal simpan — berbohong ke pengguna"
      : "chip tidak muncul (benar)",
  );
  catat(
    "5d. endpoint mati -> tidak ada kode palsu yang ditampilkan",
    !/PDM-\d{6}-\d{4}-[A-Z0-9]{4}/.test(teksGagal),
    "tidak ada kode di layar (benar — tidak ada yang tersimpan)",
  );

  await browser.close();

  // Idempoten: bersihkan entri yang dibuat run ini (lewat service role —
  // `anon` memang tidak punya hak tabel pada `screenings`).
  const { error } = await svc().from("screenings").delete().eq("nama", NAMA_UJI);
  if (error) console.warn(`      [bersih-bersih] gagal menghapus entri uji: ${error.message}`);

  const gagal = hasil.filter((h) => !h.lolos);
  console.log(
    `\n${hasil.length - gagal.length}/${hasil.length} pemeriksaan lolos` +
      (gagal.length
        ? `\nGAGAL: ${gagal.map((g) => g.nama).join(", ")}`
        : "\nFunnel calon klien terbukti utuh"),
  );
  process.exit(gagal.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
