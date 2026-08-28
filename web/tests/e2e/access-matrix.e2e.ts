/**
 * E2E matriks akses peran (Plan 1 Task 8 Step 3).
 *
 * Membuktikan lewat browser sungguhan (bukan unit test dengan mock) bahwa:
 *   1. Tanpa login: /passport, /admin, /owner  -> redirect ke /masuk
 *   2. klien (ananda):  /passport tampil; /admin & /owner DITOLAK
 *   3. admin:           /admin tampil;    /owner DITOLAK
 *   4. owner:           /owner tampil DAN /admin tampil (owner superset admin)
 *
 * Prasyarat: `npx supabase start`, `npm run seed:users`, lalu `npm run dev`
 * (server hidup di http://localhost:3000). Jalankan: `npm run test:e2e`.
 * Sengaja BUKAN file *.test.ts agar `npm test` (vitest) tetap bisa jalan
 * tanpa server dev & browser.
 */
import { chromium, type Browser, type BrowserContext } from "playwright";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const PASSWORD = "padma-dev-123";

type Hasil = { nama: string; lolos: boolean; bukti: string };
const hasil: Hasil[] = [];

function catat(nama: string, lolos: boolean, bukti: string) {
  hasil.push({ nama, lolos, bukti });
  console.log(`${lolos ? "PASS" : "FAIL"}  ${nama}\n      ${bukti}`);
}

/** Redirect mentah dari server, tanpa cookie sama sekali. */
async function cekAnonim(path: string) {
  const res = await fetch(`${BASE}${path}`, { redirect: "manual" });
  const lokasi = res.headers.get("location") ?? "";
  catat(
    `1. anonim GET ${path} -> /masuk`,
    res.status >= 300 && res.status < 400 && lokasi.startsWith("/masuk"),
    `status ${res.status}, location: ${lokasi || "(tidak ada)"}`,
  );
}

async function login(browser: Browser, email: string): Promise<BrowserContext> {
  const context = await browser.newContext();
  const page = await context.newPage();
  // networkidle, bukan domcontentloaded: input di form ini controlled component,
  // isian sebelum React hydrate akan terhapus saat hydration.
  await page.goto(`${BASE}/masuk`, { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Kata sandi").fill(PASSWORD);
  if ((await page.getByLabel("Email").inputValue()) !== email) {
    throw new Error("Isian email terhapus — halaman /masuk belum ter-hydrate.");
  }
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/masuk"), { timeout: 20_000 }),
    page.getByRole("button", { name: "Masuk", exact: true }).click(),
  ]);
  await page.waitForLoadState("networkidle");
  console.log(`      [login ${email}] mendarat di ${page.url()}`);
  await page.close();
  return context;
}

/** Buka path; kembalikan URL akhir (setelah semua redirect) + teks halaman. */
async function buka(context: BrowserContext, path: string) {
  const page = await context.newPage();
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  const url = new URL(page.url());
  const teks = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
  await page.close();
  return { path: url.pathname, teks };
}

async function cekTampil(
  context: BrowserContext,
  peran: string,
  path: string,
  wajibAda: string[],
) {
  const r = await buka(context, path);
  const lolos = r.path === path && wajibAda.every((s) => r.teks.includes(s));
  catat(
    `${peran}: ${path} TAMPIL (memuat ${wajibAda.map((s) => `"${s}"`).join(" + ")})`,
    lolos,
    `URL akhir ${r.path} | isi: ${r.teks.slice(0, 160)}`,
  );
}

async function cekDitolak(context: BrowserContext, peran: string, path: string) {
  const r = await buka(context, path);
  const lolos = r.path !== path;
  catat(
    `${peran}: ${path} DITOLAK`,
    lolos,
    `URL akhir ${r.path} | isi: ${r.teks.slice(0, 120)}`,
  );
}

async function main() {
  // --- Skenario 1: tanpa login ---
  for (const p of ["/passport", "/admin", "/owner"]) await cekAnonim(p);

  const browser = await chromium.launch();
  try {
    // --- Skenario 2: klien ---
    const klien = await login(browser, "ananda@padma.test");
    await cekTampil(klien, "2. klien", "/passport", ["Ananda Putri", "PAD-2607-0012"]);
    await cekDitolak(klien, "2. klien", "/admin");
    await cekDitolak(klien, "2. klien", "/owner");
    await klien.close();

    // --- Skenario 3: admin ---
    const admin = await login(browser, "admin@padma.test");
    await cekTampil(admin, "3. admin", "/admin", ["Panel Admin"]);
    await cekDitolak(admin, "3. admin", "/owner");
    await admin.close();

    // --- Skenario 4: owner (superset admin) ---
    const owner = await login(browser, "owner@padma.test");
    await cekTampil(owner, "4. owner", "/owner", ["Panel Owner"]);
    await cekTampil(owner, "4. owner", "/admin", ["Panel Admin"]);
    await owner.close();
  } finally {
    await browser.close();
  }

  const gagal = hasil.filter((h) => !h.lolos);
  console.log(
    `\n${hasil.length - gagal.length}/${hasil.length} pemeriksaan lolos.`,
  );
  if (gagal.length > 0) {
    console.error("GAGAL:\n" + gagal.map((g) => `  - ${g.nama}`).join("\n"));
    process.exit(1);
  }
  console.log("Matriks akses peran terbukti utuh.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
