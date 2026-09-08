/**
 * E2E Digital Care Passport (Plan 4 Task 10).
 *
 * Membuktikan lewat browser sungguhan — bukan unit test dengan mock — bahwa:
 *   1. Beranda menampilkan sampul dan bagian pencapaian; grid stempel &
 *      progres paket (6 dari 8, 75%) HANYA selama `PAKET_TAMPIL` menyala
 *      (saklar K11) — mati, beranda jatuh ke kartu fallback "Perjalanan
 *      Anda" dan grid stempel wajib kosong. Lihat langkah 1b/1c.
 *   2. Riwayat sesi menyebut NAMA BIDAN (bukti `partner_publik` bekerja) dan
 *      catatan bidan baru terlihat sesudah kartunya diketuk.
 *   3. Materi tergating: isi bab & URL video tidak pernah ikut ke halaman
 *      daftar, materi terkunci ditolak MESKI URL-nya diakses langsung, reader
 *      e-book yang berhak menampilkan gambar halaman (Task 10 — watermark-nya
 *      sudah dibakar SERVER ke dalam gambar, bukan lagi lapisan CSS di DOM),
 *      dan tidak ada aksi unduh.
 *   4. Klaim bayar hanya membawa status ke `menunggu_verifikasi`, tidak pernah
 *      ke `lunas`.
 *   5. Permintaan jadwal dari klien selalu berstatus `diminta` (nama baru
 *      sejak C1; dulu `menunggu`) — klien tidak pernah bisa menyisipkan status
 *      yang lebih jauh di rantai.
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
import { PAKET_TAMPIL } from "@/lib/paket-tampil";

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

/** Klien seed yang dipakai skrip ini (Ananda). */
const KLIEN_UJI = "44444444-4444-4444-4444-444444444401";

/**
 * Menerbitkan satu skrining HIJAU untuk klien uji, dan memulangkan id-nya.
 *
 * WAJIB sejak C1-b (spec J3): setiap pengajuan jadwal berdiri di atas satu
 * skrining hijau milik pemesannya, dan `/passport/ajukan` menampilkan AJAKAN
 * skrining — bukan formulir — bila tidak ada. Tanpa langkah ini skenario 5 di
 * bawah menunggu medan tanggal yang memang tidak dirender.
 *
 * Ditulis dengan service role: klien sengaja tidak punya hak INSERT atas
 * `screenings` (hasil & flags selalu ditentukan server).
 */
async function terbitkanSkriningHijau(): Promise<void> {
  const { error } = await admin.from("screenings").insert({
    kode: `E2E-PSP-${Date.now().toString(36)}`.toUpperCase(),
    nama: "Uji E2E Passport",
    no_hp: "0800-0000-0000",
    fase: "prekonsepsi",
    jawaban: {},
    hasil: "hijau",
    flags: [],
    client_id: KLIEN_UJI,
  });
  if (error) throw new Error(`fixture skrining gagal: ${error.message}`);
}

/**
 * Membuang seluruh jejak skrip ini. Dipanggil di awal (sebelum menyiapkan) dan
 * di akhir (tanpa menyiapkan apa pun).
 */
async function bersihkanFixture() {
  // Pengajuan DULU: `booking_requests.screening_id` menahan penghapusan
  // skrining yang menopangnya.
  await admin.from("booking_requests").delete().eq("client_id", KLIEN_UJI);
  await admin.from("screenings").delete().like("kode", "E2E-PSP-%");
}

/** Keadaan seed untuk data yang disentuh skrip ini. */
async function keadaanAwal() {
  await admin.from("sessions").update({ status_bayar: "belum" }).eq("id", SESI_LEPAS);
  await bersihkanFixture();
  // SELURUH pengajuan klien uji dibuang, bukan hanya yang bertanggal uji.
  //
  // Menyaring per tanggal sudah cukup sebelum C1-b, tetapi tidak lagi: sejak
  // spec J3 sebuah skrining HANGUS begitu dipakai pengajuan mana pun, dan
  // pengajuan sisa dari run lain — atau dari suite vitest — akan memegang
  // skrining hijau klien ini sehingga formulirnya tertutup. Gejalanya:
  // skenario 5 gagal BERSELANG-SELING, yang persis terjadi sebelum baris ini
  // ditulis.
  await admin.from("booking_requests").delete().eq("client_id", KLIEN_UJI);
  // Baru sesudah itu skriningnya bebas dihapus (FK tanpa on delete).
  await admin.from("screenings").delete().eq("client_id", KLIEN_UJI);
  await terbitkanSkriningHijau();
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
    if (PAKET_TAMPIL) {
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
    } else {
      // Saklar K11: `ambilPaket()` memulangkan [] selama PAKET_TAMPIL mati
      // (src/lib/passport/data.ts), jadi `paketAktif` di page.tsx selalu null
      // walau klien seed (Ananda) memang punya paket aktif di database.
      // Beranda jatuh ke kartu fallback "Perjalanan Anda" — lihat
      // tests/passport-beranda.test.ts, describe "paket & stempel", yang
      // membuktikan bentuk statis lewat markup. Di sini, lewat browser
      // sungguhan, dibuktikan yang sama: fallback benar-benar tampil DAN grid
      // stempel benar-benar kosong — bukan diam-diam separuh jadi (mis. kartu
      // fallback muncul BERSAMA sisa grid stempel lama).
      catat(
        "1b. tanpa paket aktif, beranda jatuh ke kartu fallback 'Perjalanan Anda' (saklar K11)",
        teksBeranda.includes("Perjalanan Anda") &&
          teksBeranda.includes("Anda mengambil layanan per sesi"),
        teksBeranda.includes("Perjalanan Anda")
          ? "kartu fallback tampil"
          : "kartu fallback TIDAK tampil",
      );
      const totalStempel = await page.locator("[data-stempel]").count();
      catat(
        "1c. grid stempel tidak dirender sama sekali selama paket tersembunyi",
        totalStempel === 0,
        `elemen [data-stempel] ditemukan: ${totalStempel}`,
      );
    }
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
    // React menulis atribut `src` pada tag <img> APA PUN nasib permintaannya —
    // tag itu tetap ada di DOM walau rute di baliknya membalas 403/404 dan
    // pasien hanya melihat ikon gambar rusak. Menghitung KEHADIRAN tag saja
    // (`count() === 1`) karena itu lolos vakum: ia membuktikan markup-nya
    // ditulis, bukan bahwa reader-nya benar-benar bekerja. Yang membedakan
    // "termuat" dari "gagal senyap" adalah PIKSEL SUNGGUHAN — `naturalWidth`
    // & `naturalHeight` tetap 0 pada gambar yang gagal dimuat, tidak peduli
    // apa isi atribut `src`-nya. Ditunggu lewat `waitForFunction` (menunggu
    // `img.complete`), bukan dibaca sekali segera sesudah goto — supaya tidak
    // balapan dengan permintaan gambar yang belum tuntas.
    const selektorHalaman1 = `img[src="/api/materi/${MATERI_TERBUKA}/halaman/1"]`;
    const gambarHalaman = await page.locator(selektorHalaman1).count();
    let dimensiGambar = { naturalWidth: 0, naturalHeight: 0 };
    let gagalMenunggu = "";
    try {
      await page.waitForFunction(
        (sel) => {
          const el = document.querySelector(sel) as HTMLImageElement | null;
          return !!el && el.complete;
        },
        selektorHalaman1,
        { timeout: 15_000 },
      );
      dimensiGambar = await page.locator(selektorHalaman1).evaluate((el) => ({
        naturalWidth: (el as HTMLImageElement).naturalWidth,
        naturalHeight: (el as HTMLImageElement).naturalHeight,
      }));
    } catch (e) {
      gagalMenunggu = e instanceof Error ? e.message : String(e);
    }
    catat(
      "3e. reader e-book menampilkan gambar halaman BERISI PIKSEL SUNGGUHAN lewat rute bergerbang (bukan cuma tag <img> yang ditulis)",
      gambarHalaman === 1 && dimensiGambar.naturalWidth > 0 && dimensiGambar.naturalHeight > 0,
      `${gambarHalaman} elemen <img> halaman 1 ditemukan; naturalWidth=${dimensiGambar.naturalWidth} naturalHeight=${dimensiGambar.naturalHeight}${
        gagalMenunggu ? `; gagal menunggu load: ${gagalMenunggu}` : ""
      }`,
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
    // Skrining hijau sudah diterbitkan `keadaanAwal()` (spec J3) — tanpa itu
    // halaman ini menampilkan ajakan skrining dan medan tanggal tidak ada.
    await page.goto(`${BASE}/passport/ajukan`, { waitUntil: "networkidle" });
    await page.locator('input[name="tanggal"]').fill(TANGGAL_UJI);
    // Alamat WAJIB sejak modul transport: mitra harus datang ke suatu tempat,
    // dan jaraknya menentukan jenjang tarif. Medannya terisi otomatis HANYA
    // bila profil klien sudah punya alamat — dan `scripts/seed-users.ts` tidak
    // pernah memberi klien seed satu pun. Jadi pada basis data yang BARU
    // direset, medan ini kosong dan formulirnya tertahan `required` tanpa
    // pesan apa pun yang menyebut alamat. Langkah ini juga yang membuat uji
    // ini benar-benar melewati jalur "klien mengetik alamat kunjungan",
    // bukan hanya jalur "alamat sudah ada di profil".
    await page.locator('textarea[name="alamat"]').fill("Jl. Uji E2E No. 1, Denpasar");
    await page.getByRole("button", { name: "sore", exact: true }).click();
    await page.getByRole("button", { name: /Kirim Permintaan Jadwal/i }).click();
    // Sesudah pengajuan berhasil, klien DIPINDAHKAN ke beranda dengan
    // konfirmasi — bukan ditinggal di formulir. Sebabnya ada di komentar
    // `router.replace` pada `form.tsx`: skrining yang menopang pengajuan itu
    // HANGUS begitu ia tersimpan, sehingga halaman formulir sah berubah
    // menjadi "Isi skrining keselamatan dulu" dan menimpa panel suksesnya.
    const terkirim = await page
      .locator("[data-pengajuan-terkirim]")
      .first()
      .waitFor({ state: "visible", timeout: 20_000 })
      .then(() => true, () => false);
    catat(
      "5a. permintaan terkirim (mendarat di beranda dengan konfirmasi)",
      terkirim,
      terkirim ? "konfirmasi tampil di beranda" : `isi: ${(await teksTerlihat(page)).slice(0, 160)}`,
    );
    const { data: br } = await admin
      .from("booking_requests")
      .select("status")
      .eq("tanggal", TANGGAL_UJI)
      .order("created_at", { ascending: false })
      .limit(1);
    catat(
      "5b. status permintaan = diminta (bukan dikonfirmasi)",
      br?.[0]?.status === "diminta",
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
    // MEMBERSIHKAN, bukan menyiapkan ulang.
    //
    // Dulu blok ini memanggil `keadaanAwal()` supaya skrip boleh diulang kapan
    // saja. Sejak C1-c `keadaanAwal()` juga MENERBITKAN skrining hijau, jadi
    // memanggilnya di sini meninggalkan satu baris `screenings` setiap kali
    // skrip selesai — dan baris itu ikut terhitung oleh uji vitest yang
    // mengasersikan JUMLAH baris inbox skrining admin (`admin-inbox`,
    // `admin-konversi-skrining`, `admin-agenda`). Gejalanya: suite merah tanpa
    // satu baris kode pun berubah, dengan penyebab di berkas yang sama sekali
    // lain.
    //
    // Skrip tetap boleh diulang: `keadaanAwal()` di ATAS yang menyiapkannya.
    await bersihkanFixture();
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
