/**
 * E2E Digital Care Passport (Plan 4 Task 10).
 *
 * Membuktikan lewat browser sungguhan — bukan unit test dengan mock — bahwa:
 *   1. Beranda menampilkan sampul, 6 stempel terisi dari 8, progres 75%,
 *      dan bagian pencapaian.
 *   2. Riwayat sesi menyebut NAMA BIDAN (bukti `partner_publik` bekerja) dan
 *      catatan bidan baru terlihat sesudah kartunya diketuk.
 *   3. Materi tergating: isi bab & URL video tidak pernah ikut ke halaman
 *      daftar, materi terkunci ditolak MESKI URL-nya diakses langsung, reader
 *      e-book yang berhak menampilkan gambar halaman (Task 10 — watermark-nya
 *      sudah dibakar SERVER ke dalam gambar, bukan lagi lapisan CSS di DOM),
 *      dan tidak ada aksi unduh.
 *   4. Klaim bayar hanya membawa status ke `menunggu_verifikasi`, tidak pernah
 *      ke `lunas`.
 *   5. Permintaan jadwal dari klien selalu berstatus `menunggu`.
 *   6. Bottom bar mobile muncul di 390px tanpa scroll horizontal.
 *
 * Prasyarat: `npx supabase start`, `npm run seed:users`, `npm run dev`.
 * Jalankan: `npm run test:e2e:passport`.
 * Sengaja BUKAN file *.test.ts agar `npm test` (vitest) tetap bisa jalan
 * tanpa server dev & browser.
 *
 * Skrip ini IDEMPOTEN: status bayar dan permintaan jadwal yang disentuhnya
 * dikembalikan ke keadaan seed — di awal (membersihkan sisa run yang gagal di
 * tengah) maupun di akhir.
 */
import { config } from "dotenv";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { tungguIsi } from "./_tunggu";

config({ path: [".env.local", ".env"] });

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const PASSWORD = "padma-dev-123";

const SESI_LEPAS = "66666666-6666-6666-6666-666666666608";
const MATERI_TERBUKA = "77777777-7777-7777-7777-777777777702";
const MATERI_TERKUNCI = "77777777-7777-7777-7777-777777777704";
const TANGGAL_UJI = "2026-12-20";
const PADMA_ID = "PAD-2607-0012";

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
 * Teks yang benar-benar TERLIHAT klien.
 * `textContent("body")` ikut memungut isi <script> payload RSC Next.js — dan
 * juga blok catatan bidan yang masih tertutup atribut `hidden`. Dengan
 * `textContent`, pemeriksaan "catatan baru muncul sesudah diketuk" lolos palsu.
 */
async function teksTerlihat(page: Page): Promise<string> {
  return (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
}

/** Berapa kali sebuah penggal muncul di dalam teks. */
function hitung(teks: string, penggal: string): number {
  return teks.split(penggal).length - 1;
}

/**
 * Pencocokan tanpa peduli besar-kecil huruf.
 * `innerText` mengembalikan teks SETELAH `text-transform`, jadi label yang
 * ber-kelas `uppercase` ("Catatan Bidan Sri Wahyuni") sampai ke sini sebagai
 * "CATATAN BIDAN SRI WAHYUNI". Membandingkan apa adanya membuat pemeriksaan
 * gagal palsu setiap kali desain menaikkan hurufnya.
 */
function memuat(teks: string, penggal: string): boolean {
  return teks.toLowerCase().includes(penggal.toLowerCase());
}

async function login(browser: Browser, email: string): Promise<BrowserContext> {
  const context = await browser.newContext();
  const page = await context.newPage();
  // networkidle, bukan domcontentloaded: input form masuk adalah controlled
  // component — isian sebelum React hydrate akan terhapus.
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
  console.log(`      [login ${email}] mendarat di ${page.url()}`);
  await page.close();
  return context;
}

/** Keadaan seed untuk data yang disentuh skrip ini. */
async function keadaanAwal() {
  await admin.from("sessions").update({ status_bayar: "belum" }).eq("id", SESI_LEPAS);
  await admin
    .from("booking_requests")
    .delete()
    .eq("tanggal", TANGGAL_UJI);
}

async function main() {
  await keadaanAwal();

  const browser = await chromium.launch();
  try {
    const ctx = await login(browser, "ananda@padma.test");
    const page = await ctx.newPage();

    // ---- 1. Beranda ----
    await page.goto(`${BASE}/passport`, { waitUntil: "networkidle" });
    const teksBeranda = await teksTerlihat(page);
    catat(
      "1a. sampul menampilkan nama & PADMA ID",
      teksBeranda.includes("Ananda Putri") && teksBeranda.includes(PADMA_ID),
      `isi: ${teksBeranda.slice(0, 120)}`,
    );
    catat(
      "1b. progres paket 6 dari 8 (75%)",
      teksBeranda.includes("6 dari 8 sesi selesai") && teksBeranda.includes("75%"),
      teksBeranda.includes("75%") ? "75% tampil" : "progres TIDAK sesuai seed",
    );
    // JENIS slot dibaca lewat data-stempel, bukan lewat jumlah <svg>: kelas dan
    // ikon berubah tiap desain disetel, sedangkan jenis slot adalah kontraknya.
    const terisi = await page.locator('[data-stempel="terisi"]').count();
    const berikutnya = await page.locator('[data-stempel="berikutnya"]').count();
    const kosong = await page.locator('[data-stempel="kosong"]').count();
    catat(
      "1c. grid stempel 6 terisi + 1 berikutnya + 1 kosong",
      terisi === 6 && berikutnya === 1 && kosong === 1,
      `terisi=${terisi} berikutnya=${berikutnya} kosong=${kosong}`,
    );
    const badge = await page.locator("[data-badge]").count();
    catat(
      "1d. bagian pencapaian memuat 3 badge",
      teksBeranda.includes("Pencapaian") && badge === 3,
      `${badge} badge`,
    );

    // ---- 2. Riwayat sesi & nama bidan ----
    await page.goto(`${BASE}/passport/sesi`, { waitUntil: "networkidle" });
    const teksSesi = await teksTerlihat(page);
    catat(
      "2a. nama bidan tampil (partner_publik bekerja)",
      teksSesi.includes("Bidan Sri Wahyuni") || teksSesi.includes("Bidan Dewi Lestari"),
      teksSesi.includes("Tim PADMA")
        ? "hanya 'Tim PADMA' — nama mitra GAGAL terbaca"
        : "nama bidan terbaca",
    );
    // Sebelum diketuk, catatan bidan tidak boleh terlihat: delapan rekam
    // perawatan tidak boleh terpampang sekaligus di layar ruang bersama.
    catat(
      "2b. catatan bidan tertutup sebelum kartunya diketuk",
      !memuat(teksSesi, "Rekomendasi untuk Anda"),
      memuat(teksSesi, "Rekomendasi untuk Anda")
        ? "catatan terpampang tanpa diketuk"
        : "catatan tertutup",
    );
    await page.getByText("Sankalpa Fertility Massage").first().click();
    await page.waitForTimeout(300);
    const teksBuka = await teksTerlihat(page);
    catat(
      "2c. catatan bidan bisa dibuka",
      memuat(teksBuka, "Catatan Bidan") && memuat(teksBuka, "Rekomendasi untuk Anda"),
      "catatan & rekomendasi tampil",
    );

    // ---- 3. Materi: gating & tidak bocor ----
    await page.goto(`${BASE}/passport/materi`, { waitUntil: "networkidle" });
    // Kebocoran diperiksa di HTML MENTAH (termasuk payload RSC), bukan di teks
    // terlihat: yang berbahaya justru data yang terkirim tanpa dirender.
    const htmlMateri = await page.content();
    catat(
      "3a. URL video TIDAK ada di HTML daftar",
      !htmlMateri.includes("vimeo.com"),
      htmlMateri.includes("vimeo.com") ? "BOCOR: vimeo.com ditemukan" : "tidak ada URL video",
    );
    catat(
      "3b. isi bab TIDAK ada di HTML daftar",
      !htmlMateri.includes("Lendir serviks"),
      "isi bab tidak terkirim ke halaman daftar",
    );
    const kartuTerkunci = await page.locator('[data-materi-terbuka="tidak"]').count();
    catat(
      "3c. materi terkunci tampil sebagai terkunci & bukan tautan",
      kartuTerkunci > 0 &&
        (await teksTerlihat(page)).includes("Terbuka setelah layanan terkait selesai") &&
        (await page.locator('a[data-materi-terbuka="tidak"]').count()) === 0,
      `${kartuTerkunci} kartu terkunci, tak satu pun berupa tautan`,
    );

    // akses langsung URL materi terkunci
    await page.goto(`${BASE}/passport/materi/${MATERI_TERKUNCI}`, {
      waitUntil: "networkidle",
    });
    const htmlTerkunci = await page.content();
    const teksTerkunci = await teksTerlihat(page);
    catat(
      "3d. URL langsung materi terkunci ditolak, isinya tidak ikut terkirim",
      teksTerkunci.includes("belum terbuka") && !htmlTerkunci.includes("Isi bab ini sengaja"),
      htmlTerkunci.includes("Isi bab ini sengaja")
        ? "BOCOR: isi bab terkirim ke halaman"
        : "ditolak dengan halaman ramah",
    );

    // reader materi yang berhak — gambar halaman (Task 10)
    await page.goto(`${BASE}/passport/materi/${MATERI_TERBUKA}`, {
      waitUntil: "networkidle",
    });
    // Watermark kini dibakar SERVER ke dalam byte gambar (lihat
    // src/lib/materi/watermark.ts) — tidak lagi teks yang bisa dibaca dari
    // DOM, jadi tidak bisa lagi dicek lewat teksTerlihat/hitung seperti
    // reader bab lama. Yang dibuktikan di sini adalah gambar halamannya
    // sungguhan dimuat lewat rute bergerbang RLS
    // `/api/materi/{id}/halaman/{n}`, bukan isi mentah dari storage.
    const gambarHalaman = await page
      .locator(`img[src="/api/materi/${MATERI_TERBUKA}/halaman/1"]`)
      .count();
    catat(
      "3e. reader e-book menampilkan gambar halaman lewat rute bergerbang",
      gambarHalaman === 1,
      `${gambarHalaman} elemen <img> halaman 1 ditemukan`,
    );
    // Aksi unduh dicari sebagai ELEMEN, bukan sebagai kata: halaman ini memang
    // menulis kalimat "tidak ada berkas yang bisa diunduh", dan pencarian kata
    // akan tersandung kalimatnya sendiri.
    const aksiUnduh =
      (await page.locator("a[download]").count()) +
      (await page.locator('a[href$=".pdf"], a[href^="blob:"], a[href^="data:"]').count()) +
      (await page.getByRole("button", { name: /unduh|download|simpan berkas/i }).count()) +
      (await page.getByRole("link", { name: /unduh|download/i }).count());
    catat("3f. tidak ada aksi unduh", aksiUnduh === 0, `${aksiUnduh} aksi unduh ditemukan`);

    // ---- 4. Klaim bayar ----
    await page.goto(`${BASE}/passport/bayar`, { waitUntil: "networkidle" });
    const teksBayar = await teksTerlihat(page);
    catat(
      "4a. nominal uang tidak pernah tampil di halaman klien",
      !/Rp\s?\d/.test(teksBayar),
      "hanya status, tanpa angka",
    );
    const tombol = page.getByRole("button", { name: /Saya sudah bayar/i });
    const jumlahTombol = await tombol.count();
    catat("4b. item belum dibayar punya tombol klaim", jumlahTombol > 0, `${jumlahTombol} tombol`);
    if (jumlahTombol > 0) {
      const [popup] = await Promise.all([
        page.waitForEvent("popup").catch(() => null),
        tombol.first().click(),
      ]);
      if (popup) await popup.close();
      await page.waitForTimeout(1200);
      const { data: sesiBayar } = await admin
        .from("sessions")
        .select("status_bayar")
        .eq("id", SESI_LEPAS)
        .single();
      catat(
        "4c. status menjadi menunggu_verifikasi, BUKAN lunas",
        sesiBayar!.status_bayar === "menunggu_verifikasi",
        `status di DB: ${sesiBayar!.status_bayar}`,
      );
    }

    // ---- 5. Ajukan jadwal ----
    await page.goto(`${BASE}/passport/ajukan`, { waitUntil: "networkidle" });
    await page.locator('input[name="tanggal"]').fill(TANGGAL_UJI);
    await page.getByRole("button", { name: "sore", exact: true }).click();
    await page.getByRole("button", { name: /Kirim Permintaan Jadwal/i }).click();
    const terkirim = await page
      .getByText("Permintaan terkirim")
      .first()
      .waitFor({ state: "visible", timeout: 20_000 })
      .then(() => true, () => false);
    catat(
      "5a. permintaan terkirim",
      terkirim,
      terkirim ? "panel sukses tampil" : `isi: ${(await teksTerlihat(page)).slice(0, 160)}`,
    );
    const { data: br } = await admin
      .from("booking_requests")
      .select("status")
      .eq("tanggal", TANGGAL_UJI)
      .order("created_at", { ascending: false })
      .limit(1);
    catat(
      "5b. status permintaan = menunggu (bukan dikonfirmasi)",
      br?.[0]?.status === "menunggu",
      `status di DB: ${br?.[0]?.status ?? "(tidak ada)"}`,
    );

    // ---- 6. Responsif ----
    const mobil = await ctx.newPage();
    await mobil.setViewportSize({ width: 390, height: 844 });
    await mobil.goto(`${BASE}/passport`, { waitUntil: "networkidle" });
    const bottomTampil = await mobil
      .locator('nav[aria-label="Navigasi passport"]')
      .isVisible();
    const tabTampil = await mobil.locator('nav[aria-label="Menu passport"]').isVisible();
    catat("6a. bottom bar tampil di 390px", bottomTampil, `bottom=${bottomTampil}`);
    catat("6b. tab desktop tersembunyi di 390px", !tabTampil, `tab=${tabTampil}`);
    const lebar = await mobil.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    catat("6c. tidak ada scroll horizontal di 390px", lebar <= 0, `selisih ${lebar}px`);
  } finally {
    await browser.close();
    // Kembalikan keadaan seed supaya skrip ini boleh diulang kapan saja.
    await keadaanAwal();
  }

  const gagal = hasil.filter((h) => !h.lolos);
  console.log(`\n${hasil.length - gagal.length}/${hasil.length} pemeriksaan lolos.`);
  if (gagal.length > 0) {
    console.error("GAGAL:\n" + gagal.map((g) => `  - ${g.nama}`).join("\n"));
    process.exit(1);
  }
  console.log("Passport terbukti utuh & aman.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
