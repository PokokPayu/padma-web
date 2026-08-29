/**
 * E2E rantai operasional admin (Plan 3A Task 11).
 *
 * Yang dibuktikan di sini bukan potongan-potongan fitur, melainkan SATU RANTAI
 * yang harus utuh supaya klinik bisa menjalankan harinya lewat aplikasi:
 *
 *   1. Admin masuk → `/admin` menampilkan kartu antrean.
 *   2. Admin membuat klien baru → muncul di daftar dengan status "Belum aktif",
 *      dan antrean "Klien belum aktif" ikut bertambah.
 *   3. Admin menerbitkan tautan aktivasi → pesan WhatsApp memuat
 *      `/aktivasi?token=…`, nama, dan email klien.
 *   4. Klien membuka tautan itu di BROWSER LAIN, masuk, dan mendarat di
 *      `/passport` — barisnya berubah menjadi "Aktif" di panel admin.
 *   5. Admin menjadwalkan sesi untuk klien itu, lalu menandainya selesai
 *      beserta catatan & rekomendasi bidan.
 *   6. Klien membuka `/passport/sesi` dan membaca catatan bidan tadi.
 *
 * Rantai ini sengaja dijalankan dalam satu alur: tiap potongannya sudah punya
 * test unit sendiri, tetapi yang paling mudah patah tanpa ada yang merah adalah
 * SAMBUNGAN antar-potongan — token yang tidak pernah sampai ke cookie, sesi yang
 * lahir tanpa tautan ke paket, catatan yang tersimpan tetapi tertahan RLS di
 * sisi klien.
 *
 * Prasyarat: `npx supabase start`, `npm run seed:users`, `npm run dev`.
 * Jalankan: `npm run test:e2e:admin`.
 * Sengaja BUKAN file *.test.ts agar `npm test` (vitest) tetap bisa jalan tanpa
 * server dev & browser.
 *
 * IDEMPOTEN: seluruh data uji dibuat dengan penanda `E2E-ADMIN` bertimestamp dan
 * dibersihkan lewat service role di awal (sisa run yang mati di tengah) maupun
 * di akhir. Data seed — Ananda, Rina, sesi & paketnya — tidak pernah disentuh:
 * `tests/rls-firewall.test.ts` dan `tests/passport-beranda.test.ts` meng-assert
 * jumlah barisnya PERSIS.
 */
import { config } from "dotenv";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { createClient } from "@supabase/supabase-js";

config({ path: [".env.local", ".env"] });

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const PASSWORD = "padma-dev-123";

/** Penanda data uji: satu-satunya pegangan pembersihan. */
const PENANDA = "e2e-admin-";
const stempel = Date.now();
const EMAIL_KLIEN = `${PENANDA}${stempel}@padma.test`;
const NAMA_KLIEN = `Uji E2E Admin ${stempel}`;
const NO_HP = "0899-0000-0001";

// Layanan & mitra dari seed. Tanggal sengaja jauh di depan supaya sesi uji tidak
// pernah bersaing dengan "sesi berikutnya" milik data demo.
const LAYANAN = "Sankalpa Fertility Massage";
const MITRA = "Bidan Sri Wahyuni";
const TANGGAL_SESI = "2026-12-29";

const CATATAN =
  "Sesi perkenalan berjalan lancar; klien merespons baik teknik napas dasar.";
const REKOMENDASI = "Ulangi latihan napas 15 menit, 3x sepekan, sampai sesi berikutnya.";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

type Hasil = { nama: string; lolos: boolean; bukti: string };
const hasil: Hasil[] = [];

function catat(nama: string, lolos: boolean, bukti: string) {
  hasil.push({ nama, lolos, bukti });
  console.log(`${lolos ? "PASS" : "FAIL"}  ${nama}\n      ${bukti}`);
}

/**
 * Teks yang benar-benar TERLIHAT.
 * `textContent("body")` ikut memungut payload RSC Next.js di dalam <script> dan
 * blok yang masih tertutup atribut `hidden` — dengan `textContent`, pemeriksaan
 * "catatan baru muncul sesudah diketuk" lolos palsu.
 */
async function teksTerlihat(page: Page): Promise<string> {
  return (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
}

function memuat(teks: string, penggal: string): boolean {
  return teks.toLowerCase().includes(penggal.toLowerCase());
}

async function login(browser: Browser, email: string): Promise<BrowserContext> {
  const context = await browser.newContext();
  const page = await context.newPage();
  // networkidle, bukan domcontentloaded: form masuk adalah controlled component —
  // isian sebelum React hydrate akan terhapus.
  await page.goto(`${BASE}/masuk`, { waitUntil: "networkidle" });
  await masukkanKredensial(page, email);
  await page.close();
  return context;
}

/** Mengisi form `/masuk` yang sudah terbuka dan menunggu perpindahan halaman. */
async function masukkanKredensial(page: Page, email: string) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Kata sandi").fill(PASSWORD);
  if ((await page.getByLabel("Email").inputValue()) !== email) {
    throw new Error("Isian email terhapus — halaman /masuk belum ter-hydrate.");
  }
  // `/setelah-masuk` ikut dikecualikan: ia rute pengarah yang menautkan undangan
  // lalu meneruskan. Berhenti menunggu di sana membuat pemeriksaan "mendarat di
  // /passport" membaca URL antara, dan merahnya datang & pergi sesuai kecepatan
  // mesin.
  await Promise.all([
    page.waitForURL(
      (u) =>
        !u.pathname.startsWith("/masuk") && !u.pathname.startsWith("/setelah-masuk"),
      { timeout: 20_000 },
    ),
    page.getByRole("button", { name: "Masuk", exact: true }).click(),
  ]);
  await page.waitForLoadState("networkidle");
  console.log(`      [login ${email}] mendarat di ${page.url()}`);
}

/**
 * Pembersihan lewat service role.
 *
 * Urutannya mengikat: `clients.user_id` menunjuk `auth.users(id)` TANPA
 * `on delete`, jadi menghapus user auth lebih dulu ditolak foreign key. Baris
 * klien dihapus dulu (sesi, paket, permintaan, dan undangannya ikut lewat
 * cascade), baru akun autentikasinya.
 */
async function bersihkan() {
  const { data: klien } = await admin
    .from("clients")
    .select("id")
    .like("email", `${PENANDA}%`);
  for (const k of klien ?? []) {
    await admin.from("sessions").delete().eq("client_id", k.id);
    await admin.from("clients").delete().eq("id", k.id);
  }

  const { data: daftar } = await admin.auth.admin.listUsers();
  for (const u of daftar?.users ?? []) {
    if ((u.email ?? "").startsWith(PENANDA)) {
      await admin.auth.admin.deleteUser(u.id);
    }
  }
}

async function main() {
  await bersihkan();

  const browser = await chromium.launch();
  try {
    // ================= 1. Admin masuk & melihat antreannya =================
    const ctxAdmin = await login(browser, "admin@padma.test");
    const kerja = await ctxAdmin.newPage();

    await kerja.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
    const teksBeranda = await teksTerlihat(kerja);
    catat(
      "1a. panel admin terbuka dengan kartu antrean",
      memuat(teksBeranda, "Panel Admin") &&
        memuat(teksBeranda, "Skrining baru") &&
        memuat(teksBeranda, "Permintaan jadwal") &&
        memuat(teksBeranda, "Klien belum aktif"),
      `isi: ${teksBeranda.slice(0, 140)}`,
    );
    // Nominal uang tidak pernah tampil di panel admin — `service_rates`
    // mengembalikan [] untuk admin dengan HTTP 200, dan tidak ada halaman admin
    // yang boleh menampilkan angka rupiah.
    catat(
      "1b. tidak ada nominal rupiah di beranda admin",
      !/Rp\s?\d/.test(teksBeranda),
      "hanya hitungan antrean, tanpa angka uang",
    );

    // ================= 2. Admin membuat klien baru =================
    await kerja.goto(`${BASE}/admin/klien`, { waitUntil: "networkidle" });
    await kerja.getByRole("button", { name: "+ Klien baru" }).click();
    await kerja.locator('input[name="nama"]').fill(NAMA_KLIEN);
    await kerja.locator('input[name="email"]').fill(EMAIL_KLIEN);
    await kerja.locator('input[name="no_hp"]').fill(NO_HP);
    await kerja.selectOption('select[name="fase"]', "prekonsepsi");
    await kerja.getByRole("button", { name: /Simpan klien/i }).click();

    // Formulir menutup sendiri saat server action berhasil.
    await kerja
      .getByRole("button", { name: "+ Klien baru" })
      .waitFor({ state: "visible", timeout: 20_000 });

    const { data: klienDb } = await admin
      .from("clients")
      .select("id, padma_id, nama, email, user_id, phase_id")
      .eq("email", EMAIL_KLIEN)
      .maybeSingle();

    catat(
      "2a. baris klien tersimpan dengan PADMA ID berformat PAD-YYMM-NNNN",
      !!klienDb && /^PAD-\d{4}-\d{4}$/.test(klienDb.padma_id),
      `padma_id: ${klienDb?.padma_id ?? "(tidak ada baris)"}`,
    );
    if (!klienDb) throw new Error("Klien uji gagal dibuat lewat panel admin.");
    const PADMA_ID = klienDb.padma_id as string;

    catat(
      "2b. klien baru BELUM tertaut ke akun mana pun",
      klienDb.user_id === null,
      `user_id: ${String(klienDb.user_id)}`,
    );

    await kerja.goto(`${BASE}/admin/klien`, { waitUntil: "networkidle" });
    const barisKlien = kerja.locator("tr", { hasText: PADMA_ID });
    catat(
      "2c. klien muncul di daftar dengan status Belum aktif",
      (await barisKlien.count()) === 1 &&
        memuat(await barisKlien.first().innerText(), "Belum aktif") &&
        memuat(await barisKlien.first().innerText(), EMAIL_KLIEN),
      (await barisKlien.first().innerText()).replace(/\s+/g, " "),
    );

    // ================= 3. Terbitkan tautan aktivasi =================
    await barisKlien.first().getByRole("link", { name: PADMA_ID }).click();
    await kerja.waitForURL(/\/admin\/klien\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    await kerja.waitForLoadState("networkidle");

    await kerja.getByRole("button", { name: "Terbitkan tautan aktivasi" }).click();
    const kotakPesan = kerja.locator("#pesan-aktivasi");
    await kotakPesan.waitFor({ state: "visible", timeout: 20_000 });
    const pesanWa = await kotakPesan.inputValue();

    const cocok = pesanWa.match(/https?:\/\/[^\s]*\/aktivasi\?token=([A-Za-z0-9._~%-]+)/);
    catat(
      "3a. pesan WhatsApp memuat tautan /aktivasi?token=…",
      cocok !== null,
      cocok ? `tautan: ${cocok[0].slice(0, 60)}…` : `pesan: ${pesanWa.slice(0, 120)}`,
    );
    catat(
      "3b. pesan menyebut nama & email klien",
      pesanWa.includes(NAMA_KLIEN) && pesanWa.includes(EMAIL_KLIEN),
      `nama & email ${pesanWa.includes(NAMA_KLIEN) && pesanWa.includes(EMAIL_KLIEN) ? "ada" : "TIDAK ada"}`,
    );
    if (!cocok) throw new Error("Tautan aktivasi tidak ditemukan di pesan WhatsApp.");
    const TAUTAN = cocok[0];

    // Yang tersimpan di DB hanya sidik SHA-256 token; token mentah tidak pernah
    // ada di sana, dan admin pun tidak punya hak baca ke tabelnya.
    const { data: undangan } = await admin
      .from("client_invites")
      .select("client_id, token_hash, used_at")
      .eq("client_id", klienDb.id)
      .maybeSingle();
    catat(
      "3c. DB hanya menyimpan sidik token, belum terpakai",
      !!undangan &&
        typeof undangan.token_hash === "string" &&
        !pesanWa.includes(undangan.token_hash as string) &&
        undangan.used_at === null,
      `used_at: ${String(undangan?.used_at)}`,
    );

    // ================= 4. Klien mengaktifkan akunnya =================
    // Akun autentikasinya dibuat lewat service role: aplikasi ini memang tidak
    // punya halaman pendaftaran mandiri — akun lahir saat klien mendaftar di
    // GoTrue (email+sandi/Google), dan yang diuji rantai ini adalah PENAUTANNYA.
    const { data: userBaru, error: userErr } = await admin.auth.admin.createUser({
      email: EMAIL_KLIEN,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: NAMA_KLIEN },
    });
    if (userErr) throw userErr;

    const ctxKlien = await browser.newContext();
    const halamanKlien = await ctxKlien.newPage();
    // Tautan aktivasi memindahkan token ke cookie httpOnly lalu mengarahkan ke
    // /masuk — token tidak pernah ikut ke URL halaman berikutnya.
    await halamanKlien.goto(TAUTAN, { waitUntil: "networkidle" });
    catat(
      "4a. tautan aktivasi mengarahkan ke halaman masuk tanpa membawa token di URL",
      new URL(halamanKlien.url()).pathname === "/masuk" &&
        !halamanKlien.url().includes("token="),
      `mendarat di ${halamanKlien.url()}`,
    );

    await masukkanKredensial(halamanKlien, EMAIL_KLIEN);
    catat(
      "4b. klien mendarat di /passport sesudah menukarkan undangan",
      new URL(halamanKlien.url()).pathname === "/passport",
      `url: ${halamanKlien.url()}`,
    );
    const teksPassport = await teksTerlihat(halamanKlien);
    catat(
      "4c. passport menampilkan nama & PADMA ID klien itu",
      memuat(teksPassport, NAMA_KLIEN) && teksPassport.includes(PADMA_ID),
      `isi: ${teksPassport.slice(0, 120)}`,
    );

    const { data: sesudahTaut } = await admin
      .from("clients")
      .select("user_id, linked_at")
      .eq("id", klienDb.id)
      .single();
    catat(
      "4d. penautan tercatat di DB pada akun yang benar",
      sesudahTaut!.user_id === userBaru.user!.id && sesudahTaut!.linked_at !== null,
      `user_id cocok: ${sesudahTaut!.user_id === userBaru.user!.id}`,
    );

    await kerja.goto(`${BASE}/admin/klien`, { waitUntil: "networkidle" });
    const barisSesudah = kerja.locator("tr", { hasText: PADMA_ID }).first();
    const isiBarisSesudah = await barisSesudah.innerText();
    catat(
      "4e. panel admin kini menampilkan klien itu sebagai Aktif",
      memuat(isiBarisSesudah, "Aktif") && !memuat(isiBarisSesudah, "Belum aktif"),
      isiBarisSesudah.replace(/\s+/g, " "),
    );

    // ================= 5. Admin menjadwalkan & menyelesaikan sesi =================
    await kerja.goto(`${BASE}/admin/sesi`, { waitUntil: "networkidle" });
    await kerja.getByRole("button", { name: "+ Jadwalkan sesi" }).click();
    await kerja.selectOption('select[name="client_id"]', {
      label: `${NAMA_KLIEN} (${PADMA_ID})`,
    });
    await kerja.selectOption('select[name="service_id"]', { label: LAYANAN });
    await kerja.selectOption('select[name="partner_id"]', { label: MITRA });
    await kerja.locator('input[name="tanggal"]').fill(TANGGAL_SESI);
    await kerja.getByRole("button", { name: /Simpan jadwal/i }).click();
    await kerja
      .getByText("Jadwal sesi tersimpan.")
      .waitFor({ state: "visible", timeout: 20_000 });

    const { data: sesiBaru } = await admin
      .from("sessions")
      .select("id, status, tanggal, catatan")
      .eq("client_id", klienDb.id);
    catat(
      "5a. satu sesi terjadwal lahir untuk klien itu",
      (sesiBaru ?? []).length === 1 &&
        sesiBaru![0].status === "terjadwal" &&
        sesiBaru![0].tanggal === TANGGAL_SESI,
      `${(sesiBaru ?? []).length} sesi, status ${sesiBaru?.[0]?.status}`,
    );

    await kerja.goto(`${BASE}/admin/sesi`, { waitUntil: "networkidle" });
    const barisSesi = kerja.locator("tr", { hasText: PADMA_ID }).first();
    await barisSesi.getByRole("button", { name: "Tandai selesai" }).click();
    await kerja.locator('textarea[name="catatan"]').fill(CATATAN);
    await kerja.locator('textarea[name="rekomendasi"]').fill(REKOMENDASI);
    await kerja.getByRole("button", { name: /Simpan · sesi selesai/i }).click();
    await kerja
      .locator('textarea[name="catatan"]')
      .waitFor({ state: "hidden", timeout: 20_000 });

    const { data: sesiSelesai } = await admin
      .from("sessions")
      .select("status, catatan, rekomendasi")
      .eq("client_id", klienDb.id)
      .single();
    catat(
      "5b. sesi berstatus selesai beserta catatan & rekomendasi",
      sesiSelesai!.status === "selesai" &&
        sesiSelesai!.catatan === CATATAN &&
        sesiSelesai!.rekomendasi === REKOMENDASI,
      `status ${sesiSelesai!.status}; catatan tersimpan: ${sesiSelesai!.catatan === CATATAN}`,
    );

    // ================= 6. Catatan itu sampai ke klien =================
    await halamanKlien.goto(`${BASE}/passport/sesi`, { waitUntil: "networkidle" });
    const teksSesiKlien = await teksTerlihat(halamanKlien);
    catat(
      "6a. riwayat sesi klien memuat layanan & nama bidannya",
      memuat(teksSesiKlien, LAYANAN) && memuat(teksSesiKlien, MITRA),
      `isi: ${teksSesiKlien.slice(0, 160)}`,
    );
    catat(
      "6b. catatan bidan masih tertutup sebelum kartunya diketuk",
      !memuat(teksSesiKlien, CATATAN),
      memuat(teksSesiKlien, CATATAN) ? "catatan terpampang tanpa diketuk" : "tertutup",
    );

    await halamanKlien.getByText(LAYANAN).first().click();
    await halamanKlien.waitForTimeout(300);
    const teksDibuka = await teksTerlihat(halamanKlien);
    catat(
      "6c. catatan & rekomendasi bidan terbaca klien sesudah diketuk",
      memuat(teksDibuka, CATATAN) && memuat(teksDibuka, REKOMENDASI),
      memuat(teksDibuka, CATATAN)
        ? "catatan admin sampai ke passport klien"
        : "catatan TIDAK terbaca klien",
    );

    // Beranda passport ikut bergerak: sesi selesai pertama klien ini.
    await halamanKlien.goto(`${BASE}/passport`, { waitUntil: "networkidle" });
    const stempelTerisi = await halamanKlien.locator('[data-stempel="terisi"]').count();
    const badge = await halamanKlien.locator("[data-badge]").count();
    catat(
      "6d. pencapaian klien terbit dari sesi yang baru diselesaikan admin",
      badge >= 1,
      `${badge} badge, ${stempelTerisi} stempel terisi (klien ini belum berpaket)`,
    );
  } finally {
    await browser.close();
    await bersihkan();
  }

  // Pembersihan wajib benar-benar bersih: run berikutnya bergantung padanya, dan
  // baris uji yang tertinggal akan menggeser hitungan antrean panel admin.
  const { data: sisaKlien } = await admin
    .from("clients")
    .select("id")
    .like("email", `${PENANDA}%`);
  const { data: daftarUser } = await admin.auth.admin.listUsers();
  const sisaUser = (daftarUser?.users ?? []).filter((u) =>
    (u.email ?? "").startsWith(PENANDA),
  );
  catat(
    "7a. seluruh data uji terhapus lewat service role",
    (sisaKlien ?? []).length === 0 && sisaUser.length === 0,
    `${(sisaKlien ?? []).length} baris klien & ${sisaUser.length} akun tersisa`,
  );

  const gagal = hasil.filter((h) => !h.lolos);
  console.log(`\n${hasil.length - gagal.length}/${hasil.length} pemeriksaan lolos.`);
  if (gagal.length > 0) {
    console.error("GAGAL:\n" + gagal.map((g) => `  - ${g.nama}`).join("\n"));
    process.exit(1);
  }
  console.log("Rantai operasional admin terbukti utuh: klien → aktivasi → sesi → passport.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
