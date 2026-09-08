/**
 * E2E PENDAFTARAN MANDIRI — jalur kedua penautan akun klien.
 *
 * Spec 8 September 2026 (K1–K3, K14) menuntut skrip ini di bagian Pengujian:
 * "E2E — skrip baru untuk pendaftaran mandiri, dirangkai ke test:e2e:semua".
 *
 * YANG DIBUKTIKAN, dan kenapa lewat browser dan bukan unit test:
 *
 *   1. Orang baru mendaftar di /daftar, membuka tautan konfirmasi dari KOTAK
 *      SURAT SUNGGUHAN, lalu masuk dan Passport-nya terbuka dengan baris klien
 *      yang lahir bertuan (fase kosong — fase datang dari skrining).
 *   2. SEBELUM tautan itu dibuka, tidak ada apa pun yang bisa diraihnya: login
 *      ditolak dan TIDAK ADA baris klien yang lahir. Ini paruh yang menjaga
 *      seluruh keputusan K1 — kalau ia hijau karena barisnya memang tidak
 *      pernah dibuat siapa pun, perkara 1 di atas yang membuktikan sebaliknya.
 *   3. Klien yang datanya SUDAH dibuat admin lebih dulu, lalu mendaftar sendiri
 *      dengan email yang sama tanpa pernah membuka tautan undangan WhatsApp,
 *      tertaut ke barisnya YANG SUDAH ADA — bukan mendapat baris kedua (K14).
 *   4. /masuk menawarkan jalan kembali ke /periksa-email. Tanpa itu, orang yang
 *      mendaftar lalu menutup tabnya hanya membaca "Email atau kata sandi
 *      salah" dan tidak punya jalan selain menelepon klinik.
 *
 * KAKI KOTAK SURAT. Spec menulis batas jujurnya: "kaki 'email konfirmasi
 * benar-benar terkirim dan tautannya bekerja' TIDAK diuji otomatis — ia
 * menuntut membaca kotak surat lokal." Skrip ini MEMBACANYA: stack Supabase
 * lokal menjalankan Mailpit di http://localhost:54324 dengan API HTTP, jadi
 * tautan konfirmasinya diambil dari pesan yang benar-benar terkirim lalu
 * dibuka di browser yang sama. Yang tersisa sebagai pemeriksaan manual
 * hanyalah SMTP produksi (lihat "Prasyarat produksi" di spec).
 *
 * Prasyarat: `npx supabase start`, `npm run seed:users`, lalu `npm run dev`
 * (server hidup di http://localhost:3000). Jalankan: `npm run test:e2e:daftar`.
 * Sengaja BUKAN file *.test.ts agar `npm test` (vitest) tetap bisa jalan tanpa
 * server dev & browser.
 */
import { config } from "dotenv";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { buatPadmaId } from "../../src/lib/admin/padma-id";
import { tungguIsi } from "./_tunggu";

config({ path: [".env.local", ".env"] });

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
/** Antarmuka web + API Mailpit yang dijalankan `supabase start` (config.toml). */
const KOTAK_SURAT = process.env.E2E_MAILPIT_URL ?? "http://localhost:54324";
const SANDI = "padma-dev-12345";

type Hasil = { nama: string; lolos: boolean; bukti: string };
const hasil: Hasil[] = [];

function catat(nama: string, lolos: boolean, bukti: string) {
  hasil.push({ nama, lolos, bukti });
  console.log(`${lolos ? "PASS" : "FAIL"}  ${nama}\n      ${bukti}`);
}

const svc = (): SupabaseClient =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

/**
 * Alamat unik per jalannya skrip.
 *
 * Bukan alamat tetap: pendaftaran mandiri MENERBITKAN akun auth dan baris
 * klien, dan run yang mati di tengah akan meninggalkan keduanya. Alamat tetap
 * membuat run berikutnya menabrak "email sudah terdaftar" lalu gagal karena
 * sampah, bukan karena regresi. Sampahnya tetap dibereskan di akhir.
 */
const jejak = Date.now();
const EMAIL_BARU = `e2e.mandiri.${jejak}@padma.test`;
const EMAIL_DIBUAT_ADMIN = `e2e.dibuatadmin.${jejak}@padma.test`;
const NAMA_BARU = "Sekar Ayu Pertiwi";
const NO_HP_BARU = "0812-9000-1234";

/* ========================================================================
 * Kotak surat
 * ==================================================================== */

type PesanMailpit = { ID: string; To: { Address: string }[] };

/**
 * Menunggu satu pesan untuk `email` muncul, lalu memulangkan tautan verifikasi
 * di dalamnya.
 *
 * Menunggu, bukan mengambil sekali: pengiriman terjadi di luar permintaan HTTP
 * yang memicunya, jadi membaca kotak surat tepat sesudah tombol "Daftar"
 * ditekan adalah balapan. Batas 20 detik; sesudahnya ia MENYERAH dengan galat,
 * bukan memulangkan string kosong yang akan berubah menjadi kegagalan
 * membingungkan beberapa baris kemudian.
 */
async function tungguTautanKonfirmasi(email: string): Promise<string> {
  const batas = Date.now() + 20_000;
  while (Date.now() < batas) {
    const res = await fetch(`${KOTAK_SURAT}/api/v1/messages?limit=100`);
    if (res.ok) {
      const { messages } = (await res.json()) as { messages: PesanMailpit[] };
      const pesan = messages.find((m) =>
        m.To.some((t) => t.Address.toLowerCase() === email.toLowerCase()),
      );
      if (pesan) {
        const isiRes = await fetch(`${KOTAK_SURAT}/api/v1/message/${pesan.ID}`);
        const isi = (await isiRes.json()) as { Text?: string; HTML?: string };
        const badan = `${isi.Text ?? ""}\n${isi.HTML ?? ""}`;
        const cocok = badan.match(/https?:\/\/[^\s"'<>()]*\/auth\/v1\/verify\?[^\s"'<>()]+/);
        if (cocok) return cocok[0].replace(/&amp;/g, "&");
        throw new Error(`pesan untuk ${email} tidak memuat tautan verifikasi`);
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `tidak ada pesan untuk ${email} di ${KOTAK_SURAT} dalam 20 detik — ` +
      `pastikan stack Supabase lokal (Mailpit) menyala`,
  );
}

/* ========================================================================
 * Browser
 * ==================================================================== */

async function isiFormulirDaftar(
  browser: Browser,
  { nama, email, noHp }: { nama: string; email: string; noHp: string },
): Promise<{ context: BrowserContext; path: string }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  // networkidle, bukan domcontentloaded: isian di formulir ini controlled
  // component, dan isian sebelum React hydrate akan terhapus saat hydration.
  await page.goto(`${BASE}/daftar`, { waitUntil: "networkidle" });
  await page.getByLabel("Nama lengkap").fill(nama);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("No. WhatsApp").fill(noHp);
  await page.getByLabel("Kata sandi").fill(SANDI);
  if ((await page.getByLabel("Email").inputValue()) !== email) {
    throw new Error("Isian email terhapus — halaman /daftar belum ter-hydrate.");
  }
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/daftar"), { timeout: 20_000 }),
    page.getByRole("button", { name: "Daftar", exact: true }).click(),
  ]);
  const path = new URL(page.url()).pathname;
  console.log(`      [daftar ${email}] mendarat di ${page.url()}`);
  await page.close();
  return { context, path };
}

/** Login yang BOLEH gagal — kegagalannya justru hasil yang diuji sebelum konfirmasi. */
async function cobaMasuk(
  browser: Browser,
  email: string,
): Promise<{ context: BrowserContext; path: string }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE}/masuk`, { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Kata sandi").fill(SANDI);
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await page
    .waitForURL((u) => !u.pathname.startsWith("/masuk"), { timeout: 10_000 })
    .then(() => tungguIsi(page))
    .catch(() => {});
  const path = new URL(page.url()).pathname;
  console.log(`      [masuk ${email}] berhenti di ${page.url()}`);
  await page.close();
  return { context, path };
}

async function buka(context: BrowserContext, path: string) {
  const page = await context.newPage();
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  const url = new URL(page.url());
  const teks = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
  await page.close();
  return { path: url.pathname, teks };
}

async function bukaTautan(context: BrowserContext, tautan: string) {
  const page = await context.newPage();
  await page.goto(tautan, { waitUntil: "networkidle" });
  const path = new URL(page.url()).pathname;
  console.log(`      [konfirmasi] mendarat di ${page.url()}`);
  await page.close();
  return path;
}

/* ========================================================================
 * Basis data
 * ==================================================================== */

async function barisKlien(email: string) {
  const { data, error } = await svc()
    .from("clients")
    .select("id, padma_id, nama, no_hp, email, phase_id, user_id, linked_at")
    .eq("email", email);
  if (error) throw error;
  return (data ?? []) as {
    id: string;
    padma_id: string;
    nama: string;
    no_hp: string;
    phase_id: string | null;
    user_id: string | null;
    linked_at: string | null;
  }[];
}

async function hapusJejak() {
  const admin = svc();
  for (const email of [EMAIL_BARU, EMAIL_DIBUAT_ADMIN]) {
    // Baris klien lebih dulu: `clients.user_id` menunjuk `auth.users(id)`
    // tanpa ON DELETE, jadi menghapus akunnya duluan ditolak foreign key.
    await admin.from("clients").delete().eq("email", email);
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    for (const u of data.users) {
      if (u.email?.toLowerCase() === email) await admin.auth.admin.deleteUser(u.id);
    }
  }
}

/* ========================================================================
 * Skenario
 * ==================================================================== */

/**
 * Skenario 1 — orang baru: /daftar → /periksa-email → kotak surat → /passport.
 *
 * Paruh "sebelum konfirmasi" dikerjakan DI TENGAH, bukan sebagai skenario
 * terpisah: ia harus dijalankan pada akun yang SAMA, di jendela waktu antara
 * pendaftaran dan pembukaan tautan. Memisahkannya berarti mengujinya pada akun
 * lain, dan pertanyaannya justru tentang akun ini.
 */
async function ujiOrangBaru(browser: Browser) {
  const daftar = await isiFormulirDaftar(browser, {
    nama: NAMA_BARU,
    email: EMAIL_BARU,
    noHp: NO_HP_BARU,
  });
  catat(
    "1a. formulir /daftar terkirim -> /periksa-email",
    daftar.path === "/periksa-email",
    `mendarat di ${daftar.path}`,
  );

  // --- Sebelum tautan konfirmasi dibuka: tidak ada apa pun yang diraih. ---
  const sebelum = await barisKlien(EMAIL_BARU);
  catat(
    "1b. SEBELUM konfirmasi: TIDAK ADA baris klien yang lahir",
    sebelum.length === 0,
    `baris beremail ${EMAIL_BARU}: ${sebelum.length}`,
  );

  const masukDini = await cobaMasuk(browser, EMAIL_BARU);
  catat(
    "1c. SEBELUM konfirmasi: masuk tidak membuka Passport (tertahan /masuk atau /periksa-email)",
    masukDini.path === "/masuk" || masukDini.path === "/periksa-email",
    `berhenti di ${masukDini.path}`,
  );
  const passportDini = await buka(masukDini.context, "/passport");
  catat(
    "1d. SEBELUM konfirmasi: /passport tidak terbuka",
    passportDini.path !== "/passport",
    `URL akhir ${passportDini.path}`,
  );
  await masukDini.context.close();

  // --- Kotak surat sungguhan. ---
  const tautan = await tungguTautanKonfirmasi(EMAIL_BARU);
  catat(
    "1e. email konfirmasi benar-benar terkirim & memuat tautan verifikasi",
    tautan.includes("/auth/v1/verify"),
    tautan.replace(/token=[^&]+/, "token=<disunting>"),
  );
  const pendaratanKonfirmasi = await bukaTautan(daftar.context, tautan);
  catat(
    "1f. tautan konfirmasi bekerja (tidak berakhir di halaman galat)",
    !pendaratanKonfirmasi.startsWith("/masuk") &&
      !pendaratanKonfirmasi.startsWith("/periksa-email"),
    `mendarat di ${pendaratanKonfirmasi}`,
  );
  await daftar.context.close();

  // --- Sesudah konfirmasi: masuk seperti biasa. ---
  const masuk = await cobaMasuk(browser, EMAIL_BARU);
  catat(
    "1g. SESUDAH konfirmasi: masuk -> /passport",
    masuk.path === "/passport",
    `mendarat di ${masuk.path}`,
  );
  const passport = await buka(masuk.context, "/passport");
  catat(
    "1h. Passport menampilkan identitas pendaftarnya",
    passport.path === "/passport" && passport.teks.includes(NAMA_BARU),
    `URL akhir ${passport.path} | isi: ${passport.teks.slice(0, 160)}`,
  );
  await masuk.context.close();

  const sesudah = await barisKlien(EMAIL_BARU);
  catat(
    "1i. TEPAT SATU baris klien, bertuan, berfase kosong, dengan data dari formulir",
    sesudah.length === 1 &&
      sesudah[0].user_id !== null &&
      sesudah[0].linked_at !== null &&
      sesudah[0].phase_id === null &&
      sesudah[0].nama === NAMA_BARU &&
      sesudah[0].no_hp === "081290001234",
    `baris: ${JSON.stringify(sesudah.map((b) => ({ padma_id: b.padma_id, nama: b.nama, no_hp: b.no_hp, phase_id: b.phase_id, tertaut: b.user_id !== null })))}`,
  );
}

/**
 * Skenario 2 — K14: admin membuat data klien, kliennya mendaftar sendiri.
 *
 * Inilah anjuran utama panel admin sejak K14: "minta klien mendaftar sendiri",
 * dengan tautan undangan sebagai cadangan. Yang dibuktikan di sini adalah
 * bahwa anjuran itu benar-benar bekerja TANPA tautan undangan apa pun — dan,
 * yang sama pentingnya, bahwa ia menautkan ke baris yang SUDAH ADA alih-alih
 * menerbitkan baris kedua yang membuat rekam medisnya tak terlihat olehnya.
 */
async function ujiKlienDibuatAdmin(browser: Browser) {
  const admin = svc();
  const padmaId = await buatPadmaId(admin);
  const { data: dibuat, error } = await admin
    .from("clients")
    .insert({
      padma_id: padmaId,
      nama: "Larasati Dewi",
      email: EMAIL_DIBUAT_ADMIN,
      no_hp: "0857-7000-4321",
      phase_id: "kehamilan",
      // Belum tertaut — persis keadaan sesudah admin membuat datanya.
      user_id: null,
      linked_at: null,
    })
    .select("id, padma_id")
    .single();
  if (error) throw error;

  const daftar = await isiFormulirDaftar(browser, {
    // Nama SENGAJA berbeda dari yang diketik admin: yang menautkan adalah
    // emailnya, dan data pada baris klien tidak boleh tertimpa diam-diam oleh
    // apa pun yang diketik pendaftar.
    nama: "Laras",
    email: EMAIL_DIBUAT_ADMIN,
    noHp: "0899-1111-2222",
  });
  catat(
    "2a. klien bikinan admin mendaftar sendiri -> /periksa-email",
    daftar.path === "/periksa-email",
    `mendarat di ${daftar.path}`,
  );

  const tautan = await tungguTautanKonfirmasi(EMAIL_DIBUAT_ADMIN);
  await bukaTautan(daftar.context, tautan);
  await daftar.context.close();

  const masuk = await cobaMasuk(browser, EMAIL_DIBUAT_ADMIN);
  catat(
    "2b. sesudah konfirmasi, TANPA tautan undangan sama sekali -> /passport",
    masuk.path === "/passport",
    `mendarat di ${masuk.path}`,
  );
  const passport = await buka(masuk.context, "/passport");
  catat(
    "2c. Passport menampilkan rekam klien YANG DIBUAT ADMIN (bukan rekam kosong)",
    passport.teks.includes("Larasati Dewi") && passport.teks.includes(dibuat!.padma_id),
    `isi: ${passport.teks.slice(0, 200)}`,
  );
  await masuk.context.close();

  const baris = await barisKlien(EMAIL_DIBUAT_ADMIN);
  catat(
    "2d. TIDAK ada baris klien kedua — barisnya yang lama yang tertaut",
    baris.length === 1 &&
      baris[0].id === dibuat!.id &&
      baris[0].user_id !== null &&
      baris[0].nama === "Larasati Dewi",
    `baris: ${JSON.stringify(baris.map((b) => ({ padma_id: b.padma_id, nama: b.nama, tertaut: b.user_id !== null })))}`,
  );
}

/**
 * Skenario 3 — jalan kembali ke /periksa-email dari /masuk.
 *
 * Orang yang mendaftar kemarin lalu menutup tabnya tidak punya sesi dan tidak
 * bisa mengulang pengalihan sesudah pendaftaran. Tanpa tautan ini, yang
 * dibacanya cuma "Email atau kata sandi salah" — dan jalan keluarnya menelepon
 * klinik. Tautannya wajib TANPA SYARAT: memunculkannya hanya pada galat
 * `email_not_confirmed` akan membuat halaman ini bisa membedakan alamat yang
 * terdaftar dari yang tidak.
 */
async function ujiPintuPeriksaEmail(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE}/masuk`, { waitUntil: "networkidle" });
  const punyaTautan = (await page.locator('a[href="/periksa-email"]').count()) > 0;
  const teks = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
  catat(
    "3a. /masuk menautkan /periksa-email TANPA SYARAT (sebelum ada galat apa pun)",
    punyaTautan && !teks.includes("Email atau kata sandi salah"),
    `tautan ada: ${punyaTautan} | isi: ${teks.slice(0, 200)}`,
  );
  await page.close();
  await context.close();
}

async function main() {
  await hapusJejak();
  const browser = await chromium.launch();
  try {
    await ujiPintuPeriksaEmail(browser);
    await ujiOrangBaru(browser);
    await ujiKlienDibuatAdmin(browser);
  } finally {
    await browser.close();
    // Dibersihkan APA PUN hasilnya: run yang mati di tengah tetap tidak boleh
    // meninggalkan akun & baris klien di stack lokal yang dipakai bersama.
    await hapusJejak();
  }

  const gagal = hasil.filter((h) => !h.lolos);
  console.log(`\n${hasil.length - gagal.length}/${hasil.length} pemeriksaan lolos.`);
  if (gagal.length > 0) {
    console.error("GAGAL:\n" + gagal.map((g) => `  - ${g.nama}`).join("\n"));
    process.exit(1);
  }
  console.log("Pendaftaran mandiri terbukti utuh dari formulir sampai Passport.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
