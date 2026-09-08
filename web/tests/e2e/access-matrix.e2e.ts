/**
 * E2E matriks akses peran (Plan 1 Task 8 Step 3).
 *
 * Membuktikan lewat browser sungguhan (bukan unit test dengan mock) bahwa:
 *   1. Tanpa login: /passport, /admin, /owner  -> redirect ke /masuk
 *   2. klien (ananda):  /passport tampil; /admin & /owner DITOLAK
 *   3. admin:           /admin tampil;    /owner DITOLAK
 *   4. owner:           /owner tampil DAN /admin tampil (owner superset admin)
 *   5. penautan akun klien: penyamar DIHENTIKAN, pemilik sah DILEWATKAN.
 *
 * SKENARIO 5 DITULIS ULANG 8 Sep 2026, dan alasannya perlu dibaca sebelum
 * seseorang "mengembalikannya". Versi lamanya membuat akun lewat service role
 * dengan `email_confirm: true`, login tanpa tautan aktivasi, lalu menuntut
 * pendaratan di /akun-belum-terhubung. Sejak spec 8 September (K1), akun
 * berpenanda `email_confirmed_at` BUKAN LAGI model penyamar — itu justru model
 * PEMILIK SAH kotak surat itu, dan gerbang memang menautkannya. Skenario lama
 * karena itu tidak lagi menguji apa pun tentang eksploitnya; ia hanya merah.
 *
 * Penyamar di bawah aturan sekarang adalah orang yang MENDAFTAR SENDIRI lewat
 * anon key dengan menebak alamat email seorang klien — dan yang menghentikannya
 * adalah bahwa pendaftaran seperti itu tidak pernah terkonfirmasi. Karena itu
 * skenario ini berisi KEDUA paruhnya, dan keduanya harus ada: tanpa kontrol
 * positif, "tidak melihat data" bisa berarti tembok yang menolak semua orang;
 * tanpa penyamar, kontrol positif hanya membuktikan aplikasinya menyala.
 *
 * Pendaftaran mandiri LENGKAP (formulir /daftar → kotak surat → /passport)
 * diuji skrip tersendiri: `npm run test:e2e:daftar`
 * (tests/e2e/daftar-mandiri.e2e.ts). Yang di sini sengaja dibatasi pada apa
 * yang menjadi klaim berkas ini: siapa boleh melihat rekam klien Rina.
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
import { tungguIsi } from "./_tunggu";

config({ path: [".env.local", ".env"] });

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const PASSWORD = "padma-dev-123";

type Hasil = { nama: string; lolos: boolean; bukti: string };
const hasil: Hasil[] = [];

function catat(nama: string, lolos: boolean, bukti: string) {
  hasil.push({ nama, lolos, bukti });
  console.log(`${lolos ? "PASS" : "FAIL"}  ${nama}\n      ${bukti}`);
}

/**
 * Cookie sesi yang dikarang sendiri, mengaku ber-peran owner.
 *
 * Sejak proxy hanya melakukan pemeriksaan OPTIMISTIK (membaca cookie secara
 * lokal, tanpa memverifikasi tanda tangan JWT ke server Auth — lihat komentar
 * di src/proxy.ts), cookie semacam ini memang SENGAJA lolos dari proxy. Yang
 * menghentikannya adalah requireRole(), satu-satunya tempat verifikasi
 * sungguhan terjadi. Tes ini menjaga pembagian tugas itu: kalau seseorang kelak
 * memindahkan otorisasi kembali ke proxy dan mengendurkan requireRole, di
 * sinilah kebocorannya ketahuan.
 */
async function cekCookieKarangan(path: string) {
  const isi = Buffer.from(
    JSON.stringify({
      access_token: "a.b.c",
      refresh_token: "x",
      expires_at: 9999999999,
      user: { id: "00000000-0000-0000-0000-000000000000", role: "owner" },
    }),
  ).toString("base64");

  const res = await fetch(`${BASE}${path}`, {
    redirect: "manual",
    headers: { cookie: `sb-127-auth-token=base64-${isi}` },
  });
  const lokasi = res.headers.get("location") ?? "";
  const badan = res.status === 200 ? await res.text() : "";
  const bocor = /Panel Owner|Panel Admin|honor/.test(badan);

  catat(
    `1b. cookie sesi karangan ber-peran owner DITOLAK di ${path}`,
    lokasi.startsWith("/masuk") && !bocor,
    `status ${res.status}, location: ${lokasi || "(tidak ada)"}, isi bocor: ${bocor}`,
  );
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
  await tungguIsi(page);
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
 * Login yang BOLEH GAGAL — dipakai skenario penyamar.
 *
 * `login()` di atas melempar bila halaman tidak pernah meninggalkan /masuk,
 * dan itu benar untuk skenario 1–4 yang memang menuntut sesi. Di sini
 * kegagalannya justru hasil yang dicari: dengan `enable_confirmations = true`,
 * `signInWithPassword` atas akun yang belum dikonfirmasi memulangkan
 * `email_not_confirmed` tanpa sesi, sehingga URL-nya tidak pernah berpindah.
 */
async function cobaLogin(
  browser: Browser,
  email: string,
): Promise<{ context: BrowserContext; pindahDariMasuk: boolean; path: string }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE}/masuk`, { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Kata sandi").fill(PASSWORD);
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  const pindah = await page
    .waitForURL((u) => !u.pathname.startsWith("/masuk"), { timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  const path = new URL(page.url()).pathname;
  console.log(`      [coba login ${email}] berhenti di ${page.url()}`);
  await page.close();
  return { context, pindahDariMasuk: pindah, path };
}

/** Pendaftaran mandiri lewat anon key — persis yang bisa dilakukan siapa pun. */
async function daftarMandiri(email: string) {
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  return anon.auth.signUp({ email, password: PASSWORD });
}

async function userIdRina(): Promise<string | null> {
  const { data } = await svc()
    .from("clients")
    .select("user_id")
    .eq("id", RINA_CLIENT_ID)
    .single();
  return (data?.user_id as string | null) ?? null;
}

/**
 * Skenario 5 — siapa boleh melihat rekam klien Rina, diuji lewat aplikasi
 * sungguhan (rute /aktivasi + /setelah-masuk), bukan lewat fungsi penautan.
 *
 * Empat paruh, dan tidak satu pun boleh berdiri sendiri: penyamar dihentikan
 * (a), pemilik sah lewat email terkonfirmasi dilewatkan (b), jalur undangan
 * lama tetap hidup (c), dan token tetap sekali pakai (d).
 */
async function ujiAktivasiKlien(browser: Browser) {
  // ---- (a) PENYAMAR, dalam bentuk yang masih mungkin hari ini ----
  // Ia tidak punya service role. Yang bisa dilakukannya hanyalah MENEBAK
  // alamat email seorang klien lalu mendaftar sendiri dengan alamat itu.
  await keadaanAwalRina();
  const { data: daftar, error: errDaftar } = await daftarMandiri(EMAIL_RINA);
  catat(
    "5a. penyamar bisa mendaftar, tetapi TIDAK mendapat sesi & emailnya tidak terkonfirmasi",
    !errDaftar &&
      daftar.session === null &&
      !daftar.user?.email_confirmed_at,
    `error: ${errDaftar?.message ?? "-"} | sesi: ${daftar?.session ? "ADA" : "tidak ada"} | confirmed_at: ${daftar?.user?.email_confirmed_at ?? "kosong"}`,
  );

  const penyamar = await cobaLogin(browser, EMAIL_RINA);
  // Dua akhir yang sama-sama benar: login ditolak sehingga ia tertahan di
  // /masuk, ATAU (bila GoTrue kelak memberi sesi tak terkonfirmasi) gerbang
  // memulangkannya ke /periksa-email. Yang TIDAK boleh: /passport.
  catat(
    "5b. penyamar tertahan: tetap di /masuk, atau /periksa-email — tidak pernah /passport",
    penyamar.path === "/masuk" || penyamar.path === "/periksa-email",
    `berhenti di ${penyamar.path} (pindah dari /masuk: ${penyamar.pindahDariMasuk})`,
  );
  const passportPenyamar = await buka(penyamar.context, "/passport");
  catat(
    "5c. data klien TIDAK terlihat oleh penyamar di /passport",
    passportPenyamar.path !== "/passport" ||
      (!passportPenyamar.teks.includes("Rina Hapsari") &&
        !passportPenyamar.teks.includes("PAD-2608-0019")),
    `URL akhir ${passportPenyamar.path} | isi: ${passportPenyamar.teks.slice(0, 120)}`,
  );
  catat(
    "5d. baris klien tetap belum tertaut sesudah percobaan penyamar",
    (await userIdRina()) === null,
    `clients.user_id = ${await userIdRina()}`,
  );
  await penyamar.context.close();

  // ---- (b) KONTROL POSITIF K1: pemilik sah kotak surat itu ----
  // Bedanya dengan (a) HANYA satu: emailnya sudah terbukti miliknya. Di sini
  // buktinya dipasang lewat service role (`email_confirm: true`) — pola yang
  // sama dipakai seed dev, dan batas jujurnya tercatat di spec: kaki "tautan
  // konfirmasi benar-benar sampai dan bekerja" diuji skrip
  // `test:e2e:daftar`, yang membacanya dari kotak surat lokal.
  //
  // Perhatikan bahwa ia TIDAK membuka tautan aktivasi apa pun. Sampai 8 Sep
  // 2026 justru inilah yang dituntut GAGAL di berkas ini; pembalikannya
  // disengaja (K1) dan berdiri di atas satu fakta yang berubah —
  // enable_confirmations menyala sejak 28 Agu 2026.
  await keadaanAwalRina();
  await buatUser(EMAIL_RINA);
  const pemilik = await login(browser, EMAIL_RINA);
  catat(
    "5e. pemilik sah (email TERKONFIRMASI) tanpa tautan undangan -> /passport",
    urlPendaratan === "/passport",
    `mendarat di ${urlPendaratan}`,
  );
  await cekTampil(pemilik, "5f. pemilik sah", "/passport", [
    "Rina Hapsari",
    "PAD-2608-0019",
  ]);
  await pemilik.close();

  // ---- (c) Jalur undangan TIDAK dicabut oleh jalur kedua (K14) ----
  await keadaanAwalRina();
  await buatUser(EMAIL_RINA);
  const klien = await login(
    browser,
    EMAIL_RINA,
    inviteLink(BASE, TOKEN_UNDANGAN_RINA),
  );
  catat(
    "5g. login lewat tautan aktivasi bertoken -> /passport",
    urlPendaratan === "/passport",
    `mendarat di ${urlPendaratan}`,
  );
  await cekTampil(klien, "5h. klien teraktivasi lewat undangan", "/passport", [
    "Rina Hapsari",
    "PAD-2608-0019",
  ]);
  await klien.close();

  // ---- (d) Token sekali pakai: akun LAIN dengan tautan yang sama ----
  const passportUlang = await buka(
    await login(browser, "ananda@padma.test", inviteLink(BASE, TOKEN_UNDANGAN_RINA)),
    "/passport",
  );
  catat(
    "5i. token yang sudah dipakai tidak memberi akses rekam Rina",
    !passportUlang.teks.includes("Rina Hapsari"),
    `isi: ${passportUlang.teks.slice(0, 120)}`,
  );

  // Kembalikan keadaan seed supaya e2e idempoten.
  await keadaanAwalRina();
}

async function main() {
  // --- Skenario 1: tanpa login ---
  for (const p of ["/passport", "/admin", "/owner"]) await cekAnonim(p);
  for (const p of ["/passport", "/admin", "/owner"]) await cekCookieKarangan(p);

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

    // --- Skenario 5: penyamar dihentikan, pemilik sah dilewatkan ---
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
