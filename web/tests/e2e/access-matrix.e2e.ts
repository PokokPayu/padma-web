/**
 * E2E matriks akses peran (Plan 1 Task 8 Step 3).
 *
 * Membuktikan lewat browser sungguhan (bukan unit test dengan mock) bahwa:
 *   1. Tanpa login: /passport, /admin, /owner  -> redirect ke /masuk
 *   2. klien (ananda):  /passport tampil; /admin & /owner DITOLAK
 *   3. admin:           /admin tampil;    /owner DITOLAK
 *   4. owner:           /owner tampil DAN /admin tampil (owner superset admin)
 *   5. aktivasi klien:  login dengan email klien TANPA tautan aktivasi berakhir
 *      di /akun-belum-terhubung dan tidak melihat data klien; dengan tautan
 *      aktivasi bertoken berakhir di /passport berisi data kliennya.
 *
 * Prasyarat: `npx supabase start`, `npm run seed:users`, lalu `npm run dev`
 * (server hidup di http://localhost:3000). Jalankan: `npm run test:e2e`.
 * Sengaja BUKAN file *.test.ts agar `npm test` (vitest) tetap bisa jalan
 * tanpa server dev & browser.
 */
import { config } from "dotenv";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { createClientInvite, inviteLink } from "../../src/lib/auth/link-client";
import { RINA_CLIENT_ID, TOKEN_UNDANGAN_RINA } from "../../scripts/seed-users";

config({ path: [".env.local", ".env"] });

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

async function login(
  browser: Browser,
  email: string,
  tautanAktivasi?: string,
): Promise<BrowserContext> {
  const context = await browser.newContext();
  const page = await context.newPage();
  if (tautanAktivasi) {
    // Klien membuka tautan aktivasi dari pesan WhatsApp lebih dulu; token
    // berpindah ke cookie httpOnly, lalu ia diarahkan ke halaman masuk.
    await page.goto(tautanAktivasi, { waitUntil: "networkidle" });
    console.log(`      [aktivasi] mendarat di ${page.url()}`);
  }
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
  urlPendaratan = new URL(page.url()).pathname;
  console.log(`      [login ${email}] mendarat di ${page.url()}`);
  await page.close();
  return context;
}

/** Path tempat login terakhir mendarat (dipakai skenario aktivasi). */
let urlPendaratan = "";

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

const svc = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

const EMAIL_RINA = "rina@padma.test";

async function hapusUser(email: string) {
  const admin = svc();
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const u of data.users) {
    if (u.email?.toLowerCase() === email) await admin.auth.admin.deleteUser(u.id);
  }
}

async function buatUser(email: string) {
  const { error } = await svc().auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
}

async function keadaanAwalRina() {
  await svc()
    .from("clients")
    .update({ user_id: null, linked_at: null })
    .eq("id", RINA_CLIENT_ID);
  await createClientInvite(RINA_CLIENT_ID, { token: TOKEN_UNDANGAN_RINA });
  await hapusUser(EMAIL_RINA);
}

/**
 * Skenario 5 — inti perbaikan keamanan 28 Agu 2026, diuji lewat aplikasi
 * sungguhan (rute /aktivasi + /setelah-masuk), bukan hanya lewat fungsi
 * penautan.
 */
async function ujiAktivasiKlien(browser: Browser) {
  // (a) Penyerang menduduki alamat email klien — posisi terkuat yang mungkin:
  //     akun sudah terkonfirmasi. Ia login TANPA tautan aktivasi.
  await keadaanAwalRina();
  await buatUser(EMAIL_RINA);
  const penyerang = await login(browser, EMAIL_RINA);
  catat(
    "5a. login tanpa tautan aktivasi -> /akun-belum-terhubung",
    urlPendaratan === "/akun-belum-terhubung",
    `mendarat di ${urlPendaratan}`,
  );
  const passportPenyerang = await buka(penyerang, "/passport");
  catat(
    "5b. tanpa token: data klien TIDAK terlihat di /passport",
    !passportPenyerang.teks.includes("Rina Hapsari") &&
      !passportPenyerang.teks.includes("PAD-2608-0019"),
    `isi: ${passportPenyerang.teks.slice(0, 120)}`,
  );
  const { data: sesudahPenyerang } = await svc()
    .from("clients")
    .select("user_id")
    .eq("id", RINA_CLIENT_ID)
    .single();
  catat(
    "5c. baris klien tetap belum tertaut sesudah percobaan penyerang",
    sesudahPenyerang!.user_id === null,
    `clients.user_id = ${sesudahPenyerang!.user_id}`,
  );
  await penyerang.close();

  // (b) Klien asli membuka tautan aktivasi bertoken dari pesan WhatsApp.
  await keadaanAwalRina();
  await buatUser(EMAIL_RINA);
  const klien = await login(
    browser,
    EMAIL_RINA,
    inviteLink(BASE, TOKEN_UNDANGAN_RINA),
  );
  catat(
    "5d. login lewat tautan aktivasi bertoken -> /passport",
    urlPendaratan === "/passport",
    `mendarat di ${urlPendaratan}`,
  );
  await cekTampil(klien, "5e. klien teraktivasi", "/passport", [
    "Rina Hapsari",
    "PAD-2608-0019",
  ]);
  await klien.close();

  // (c) Token sekali pakai: akun lain dengan tautan yang sama tidak kebagian.
  const passportUlang = await buka(
    await login(browser, "ananda@padma.test", inviteLink(BASE, TOKEN_UNDANGAN_RINA)),
    "/passport",
  );
  catat(
    "5f. token yang sudah dipakai tidak memberi akses rekam Rina",
    !passportUlang.teks.includes("Rina Hapsari"),
    `isi: ${passportUlang.teks.slice(0, 120)}`,
  );

  // Kembalikan keadaan seed supaya e2e idempoten.
  await keadaanAwalRina();
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

    // --- Skenario 5: aktivasi klien wajib token undangan ---
    await ujiAktivasiKlien(browser);
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
