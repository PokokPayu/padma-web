/**
 * E2E TAGIHAN SESI LEWAT DOKU (plan B, tugas B8).
 *
 * Menjalankan alur baru lewat browser sungguhan:
 *
 *   klien mengajukan → admin cari & tetapkan bidan → admin terbitkan tagihan
 *   → klien membuka /passport/bayar/<id> (rincian beku + tombol Bayar)
 *   → klien menekan Bayar → peramban dialihkan ke tautan DOKU
 *   → notifikasi SUCCESS bertanda tangan (disimulasikan) → sesi lahir
 *   → Passport "Lunas" + tautan jadwal; /admin/sesi "Baru — kabari bidan"
 *
 * DOKU TIDAK PERNAH dihubungi. Dua pagar:
 *  - Pesanan diberi `tautan_gateway` palsu (host `*.doku.test`) lewat service
 *    role sebelum klik, sehingga rute `/api/pesanan/sesi/<id>/bayar` memakai
 *    ULANG tautan itu (jalur pakai-ulang `terbitkanTautanBayar`) tanpa memanggil
 *    API DOKU. Peramban dicegat di `page.route` dan tidak keluar dari mesin.
 *  - Notifikasi ditandatangani dengan kunci PALSU yang sama dengan yang dipasang
 *    pada dev server lewat env proses. Kunci sandbox di `.env.local` tidak
 *    dipakai di sini.
 *
 * Prasyarat: `npx supabase start`, `npm run seed:users`, dan dev server yang
 * dijalankan dengan kunci palsu yang sama:
 *
 *   DOKU_CLIENT_ID=klien-uji-doku DOKU_SECRET_KEY=kunci-uji-doku \
 *   DOKU_PRODUKSI=false NEXT_PUBLIC_BASIS_URL=http://localhost:3000 \
 *   npm run dev -- -p 3000
 *
 * Jalankan: `npm run test:e2e:bayar`. Sengaja BUKAN *.test.ts agar vitest tetap
 * bisa jalan tanpa server dev & browser.
 *
 * Skrip ini IDEMPOTEN: pengajuan, pesanan, sesi, skrining, dan koordinat yang
 * disentuhnya dikembalikan di awal DAN di akhir.
 */
import { config } from "dotenv";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { tungguIsi } from "./_tunggu";
import { setujuiDokumenUntukUji } from "../helpers/persetujuan";
import {
  hitungDigest,
  hitungTandaTangan,
  rakitKomponenTandaTangan,
} from "../../src/lib/doku/tanda-tangan";
import { rakitInvoice } from "../../src/lib/pesanan/order-id";

config({ path: [".env.local", ".env"] });

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const PASSWORD = "padma-dev-123";

/** Kunci PALSU; harus identik dengan env dev server (lihat dokblok atas). */
const CLIENT_ID_UJI = "klien-uji-doku";
const SECRET_KEY_UJI = "kunci-uji-doku";
const TAUTAN_PALSU = "https://checkout-uji.doku.test/jalur-pakai-ulang";

const KLIEN = "44444444-4444-4444-4444-444444444401"; // Ananda Putri
const MITRA = "33333333-3333-3333-3333-333333333301"; // Bidan Sri Wahyuni
const TANGGAL = "2027-11-18";

/**
 * Titik mitra & klien dijatuhkan SENGAJA berjarak ±7 km — jenjang `5_10`,
 * yang tarifnya BUKAN nol di seed (Rp10.000).
 *
 * Jenjang terdekat (`0_5`) bertarif nol selama soft launch, dan total yang
 * kebetulan sama dengan harga layanan tidak bisa membedakan "transport nol
 * yang sah" dari "transport tidak ikut dihitung sama sekali". Uji unit sudah
 * membedakan keduanya lewat fungsi murni; corong ini butuh angka yang
 * BERGERAK supaya penjumlahannya benar-benar teruji ujung ke ujung.
 *
 * 1° bujur di lintang −7,97 ≈ 109,3 km, jadi 0,0640° ≈ 7,0 km.
 */
const LAT_MITRA = -7.9666;
const LON_MITRA = 112.6326;
const LAT_KLIEN = -7.9666;
const LON_KLIEN = 112.6966;
const JENJANG_HARAPAN = "5_10";

/** Alamat profil klien. Dibiarkan APA ADANYA di formulir supaya koordinat
 *  profil diwarisi pengajuan — jalur yang dilalui mayoritas klien sungguhan,
 *  dan satu-satunya yang tidak menuntut geocoding Nominatim di tengah uji. */
const ALAMAT = "Jl. Uji E2E Bayar No. 7, Malang";

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

/** Teks yang benar-benar TERLIHAT — `textContent` ikut memungut payload RSC. */
async function teksTerlihat(page: Page): Promise<string> {
  return (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
}

/** "Rp189.000" → 189000. Formatnya milik `formatRupiah`; yang dibandingkan
 *  angkanya, bukan tanda bacanya. */
function rupiahKeAngka(teks: string): number {
  return Number(teks.replace(/\D/g, ""));
}

async function login(browser: Browser, email: string): Promise<BrowserContext> {
  const context = await browser.newContext();
  const page = await context.newPage();
  // networkidle, bukan domcontentloaded: isian form masuk adalah controlled
  // component — apa pun yang diketik sebelum React hydrate akan terhapus.
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

/** PNG 1×1 yang sah. Harus gambar SUNGGUHAN: `kecilkan()` di kartu tagihan
 *  memanggil `createImageBitmap`, dan byte sembarang akan jatuh ke jalur
 *  cadangan sehingga pengecilan di peramban tidak pernah teruji. */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** Membuang seluruh jejak skrip ini dan memulangkan data seed ke keadaannya. */
async function bersihkan() {
  const { data: pengajuan } = await admin
    .from("booking_requests")
    .select("id, bukti_objek")
    .eq("client_id", KLIEN);

  for (const p of pengajuan ?? []) {
    if (p.bukti_objek) await admin.storage.from("bukti-bayar").remove([p.bukti_objek as string]);
  }

  // Sesi DULU: `sessions.booking_request_id` menahan penghapusan permintaan yang
  // melahirkannya.
  //
  // JEJAK AUDITNYA ikut disapu, dan itu wajib. Sesi C2 lahir langsung berstatus
  // `lunas`, jadi trigger pencatat menulis satu baris `jejak_status_bayar`
  // untuk setiap sesi yang lahir di sini. Tabel jejak SENGAJA tanpa foreign
  // key — cascade akan menghapus tepat bukti yang menjelaskan penghapusan —
  // sehingga menghapus sesinya saja meninggalkan baris yatim yang menumpuk
  // satu per jalannya skrip ini, dan `tests/jejak-yatim.test.ts` akan merah di
  // suite yang sama sekali tidak menyentuh pembayaran.
  const { data: sesiLama } = await admin.from("sessions").select("id").eq("tanggal", TANGGAL);
  const idSesi = (sesiLama ?? []).map((s) => s.id as string);
  if (idSesi.length > 0) {
    await admin.from("jejak_status_bayar").delete().in("sesi_id", idSesi);
  }
  await admin.from("sessions").delete().eq("tanggal", TANGGAL);
  // Pesanan sesi fixture (item ikut lewat cascade/eksplisit) sebelum pengajuan:
  // `orders.booking_request_id` menahan penghapusan pengajuannya.
  const idPengajuan = (pengajuan ?? []).map((p) => p.id as string);
  if (idPengajuan.length > 0) {
    const { data: pesananLama } = await admin
      .from("orders")
      .select("id")
      .in("booking_request_id", idPengajuan);
    const idPesanan = (pesananLama ?? []).map((o) => o.id as string);
    if (idPesanan.length > 0) {
      await admin.from("order_items").delete().in("pesanan_id", idPesanan);
      await admin.from("orders").delete().in("id", idPesanan);
    }
  }
  // Pengajuan sebelum skrining: `booking_requests.screening_id` menahan
  // penghapusan skrining yang menopangnya.
  await admin.from("booking_requests").delete().eq("client_id", KLIEN);
  await admin.from("screenings").delete().like("kode", "E2E-BYR-%");

  // Koordinat dipulangkan ke NULL — keadaan seed. Meninggalkannya berarti uji
  // lain yang mengasersikan "mitra tanpa koordinat" akan merah tanpa satu baris
  // kode pun berubah.
  await admin.from("partners").update({ lat: null, lon: null }).eq("id", MITRA);
  await admin.from("clients").update({ alamat: "", alamat_lat: null, alamat_lon: null }).eq("id", KLIEN);
}

async function keadaanAwal() {
  await bersihkan();
  await setujuiDokumenUntukUji(admin, KLIEN);
  // Skrining hijau: setiap pengajuan berdiri di atas satu skrining hijau milik
  // pemesannya (spec C1-b J3). Ditulis service role — klien sengaja tidak punya
  // hak INSERT atas `screenings`.
  const { error: eSkrining } = await admin.from("screenings").insert({
    kode: `E2E-BYR-${Date.now().toString(36)}`.toUpperCase(),
    nama: "Uji E2E Bayar",
    no_hp: "0800-0000-0000",
    fase: "prekonsepsi",
    jawaban: {},
    hasil: "hijau",
    flags: [],
    client_id: KLIEN,
  });
  if (eSkrining) throw new Error(`fixture skrining gagal: ${eSkrining.message}`);

  await admin.from("partners").update({ lat: LAT_MITRA, lon: LON_MITRA }).eq("id", MITRA);
  await admin
    .from("clients")
    .update({ alamat: ALAMAT, alamat_lat: LAT_KLIEN, alamat_lon: LON_KLIEN })
    .eq("id", KLIEN);
}

/** Baris pengajuan klien uji, apa adanya dari basis data. */
async function bacaPengajuan() {
  const { data } = await admin
    .from("booking_requests")
    .select("id, status, status_bayar, tenggat, bukti_objek, variant_id, screening_id")
    .eq("client_id", KLIEN)
    .order("created_at", { ascending: false })
    .limit(1);
  return data?.[0] ?? null;
}

async function main() {
  await keadaanAwal();

  const browser = await chromium.launch();
  try {
    const ctxKlien = await login(browser, "ananda@padma.test");
    const klien = await ctxKlien.newPage();

    // ---- 1. Klien mengajukan jadwal ----
    await klien.goto(`${BASE}/passport/ajukan`, { waitUntil: "networkidle" });
    // Formulir dua langkah: katalog dulu, lalu "Isi data". Varian bawaan
    // dipakai apa adanya; yang diuji di sini penagihannya, bukan katalognya.
    await klien.getByRole("button", { name: "Isi data", exact: true }).click();
    await klien.locator('input[name="tanggal"]').fill(TANGGAL);
    // Alamat TIDAK disentuh: medannya sudah terisi dari profil, dan justru
    // itulah jalur yang mewariskan koordinat profil ke pengajuan.
    const alamatTerisi = await klien.locator('textarea[name="alamat"]').inputValue();
    catat(
      "1a. alamat profil terisi otomatis di formulir",
      alamatTerisi === ALAMAT,
      `isi medan: ${JSON.stringify(alamatTerisi)}`,
    );
    await klien.getByRole("button", { name: "sore", exact: true }).click();
    await klien.getByRole("button", { name: /Kirim Permintaan Jadwal/i }).click();
    const terkirim = await klien
      .waitForURL("**/passport/ajukan/terkirim", { timeout: 20_000 })
      .then(() => true, () => false);

    const p1 = await bacaPengajuan();
    catat(
      "1b. pengajuan tersimpan berstatus `diminta`",
      terkirim && p1?.status === "diminta",
      `status di DB: ${p1?.status ?? "(tidak ada baris)"}`,
    );
    if (!p1) throw new Error("Pengajuan tidak tersimpan — sisa skrip tidak punya pijakan.");
    const idPermintaan = p1.id as string;

    // Koordinat pengajuan menentukan jenjang transport, dan jenjang menentukan
    // total. Bila warisan koordinat gagal, totalnya nanti `null` dan penyebabnya
    // akan tampak sebagai kegagalan di langkah 4 yang jauh dari sebabnya.
    const { data: koordinat } = await admin
      .from("booking_requests")
      .select("alamat_lat, alamat_lon")
      .eq("id", idPermintaan)
      .single<{ alamat_lat: number | null; alamat_lon: number | null }>();
    catat(
      "1c. koordinat profil DIWARISI pengajuan (tanpa geocoding ulang)",
      koordinat?.alamat_lat === LAT_KLIEN && koordinat?.alamat_lon === LON_KLIEN,
      `lat=${koordinat?.alamat_lat} lon=${koordinat?.alamat_lon}`,
    );

    // ---- 2. Admin: cari & tetapkan bidan ----
    const ctxAdmin = await login(browser, "admin@padma.test");
    const staf = await ctxAdmin.newPage();
    // Panel admin kini terbuka lewat `?lihat=<id>` (bukan kartu di daftar).
    const kartu = staf.locator("main");

    await staf.goto(`${BASE}/admin/sesi?lihat=${idPermintaan}`, { waitUntil: "networkidle" });
    await kartu.getByRole("button", { name: "Cari bidan" }).click();
    await kartu
      .locator(`#mitra-${idPermintaan}`)
      .waitFor({ state: "visible", timeout: 20_000 });
    await kartu.locator(`#mitra-${idPermintaan}`).selectOption(MITRA);
    await kartu.getByRole("button", { name: "Tetapkan bidan" }).click();
    await kartu
      .getByRole("button", { name: "Terbitkan tagihan" })
      .waitFor({ state: "visible", timeout: 20_000 });

    // GERBANG PERTAMA. Bidannya sudah siap, tetapi tagihannya belum terbit —
    // sebelum C2 inilah tepatnya titik admin boleh mengonfirmasi. Sekarang
    // tidak, dan tombolnya harus benar-benar TIDAK ADA.
    catat(
      "2a. `mitra_siap`: TIDAK ada tombol Konfirmasi jadwal — hanya Terbitkan tagihan",
      (await staf.getByRole("button", { name: "Konfirmasi jadwal" }).count()) === 0,
      "tombol konfirmasi tidak dirender",
    );

    // ---- 3. Admin menerbitkan tagihan ----
    await kartu.getByRole("button", { name: "Terbitkan tagihan" }).click();
    await kartu
      .getByRole("link", { name: "Kirim tagihan via WA" })
      .waitFor({ state: "visible", timeout: 20_000 });

    const p2 = await bacaPengajuan();
    const sisaJam = p2?.tenggat
      ? (new Date(p2.tenggat as string).getTime() - Date.now()) / 3_600_000
      : NaN;
    catat(
      "3a. status `menunggu_bayar` dengan tenggat ±24 jam dari SEKARANG",
      p2?.status === "menunggu_bayar" && sisaJam > 23.5 && sisaJam <= 24,
      `status=${p2?.status} sisa=${sisaJam.toFixed(2)} jam`,
    );
    catat(
      "3b. status bayar lahir `belum` — menerbitkan tagihan bukan menerima uang",
      p2?.status_bayar === "belum",
      `status_bayar=${p2?.status_bayar}`,
    );

    // GERBANG KEDUA, dan yang paling penting: tagihan sudah terbit, klien belum
    // membayar. Ini keadaan yang akan paling sering terlihat admin.
    catat(
      "3c. `menunggu_bayar` + belum lunas: TIDAK ada tombol Konfirmasi jadwal",
      (await staf.getByRole("button", { name: "Konfirmasi jadwal" }).count()) === 0,
      "tombol konfirmasi tidak dirender",
    );

    // TUJUAN TAUTANNYA, bukan sekadar keberadaannya. Cacat yang memunculkan
    // pemeriksaan ini tidak bisa dilihat uji murni atas `tautanWaTagihan`:
    // fungsinya benar, yang salah nomor yang disodorkan pemanggilnya —
    // `nomorWaLink`, yaitu setelan `nomor_wa` KLINIK. Tautannya terbit rapi
    // dan membuka percakapan PADMA dengan dirinya sendiri, berisi nama,
    // jadwal, dan nominal kliennya. Admin mengira sudah menagih; kliennya tidak
    // pernah ditagih, dan tenggat 24 jamnya tetap berjalan.
    const { data: barisKlien } = await admin
      .from("clients")
      .select("no_hp")
      .eq("id", KLIEN)
      .single();
    const { data: setelanKlinik } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", "nomor_wa")
      .maybeSingle();
    const waKlien = String(barisKlien?.no_hp ?? "").replace(/\D/g, "").replace(/^0/, "62");
    const waKlinik = String(setelanKlinik?.value ?? "").replace(/\D/g, "").replace(/^0/, "62");
    const href =
      (await kartu.getByRole("link", { name: "Kirim tagihan via WA" }).getAttribute("href")) ?? "";

    catat(
      "3d. tautan tagihan menuju nomor KLIEN",
      waKlien.length > 0 && href.startsWith(`https://wa.me/${waKlien}?text=`),
      `href=${href.slice(0, 40)}… nomor klien=${waKlien}`,
    );
    catat(
      "3e. tautan tagihan BUKAN ke nomor klinik sendiri",
      waKlinik.length > 0 && waKlien !== waKlinik && !href.startsWith(`https://wa.me/${waKlinik}?`),
      `nomor klinik=${waKlinik}`,
    );

    // ---- 4. Klien membuka halaman tagihan ----
    const { data: pesanan } = await admin
      .from("orders")
      .select("id, kode, percobaan, status, jenis")
      .eq("booking_request_id", idPermintaan)
      .single<{ id: string; kode: string; percobaan: number; status: string; jenis: string }>();
    const { data: butir } = await admin
      .from("order_items")
      .select("judul_beku, harga_beku")
      .eq("pesanan_id", pesanan!.id);
    const nominal = (butir ?? []).reduce((n, b) => n + (b.harga_beku as number), 0);
    catat(
      "4a. tagihan terbit sebagai pesanan jenis `sesi` berstatus `menunggu_bayar`",
      pesanan?.jenis === "sesi" && pesanan?.status === "menunggu_bayar" && nominal > 0,
      `jenis=${pesanan?.jenis} status=${pesanan?.status} nominal=${nominal}`,
    );

    await klien.goto(`${BASE}/passport/bayar/${idPermintaan}`, { waitUntil: "networkidle" });
    await tungguIsi(klien);
    const totalTampil = rupiahKeAngka(await klien.locator("[data-total]").innerText());
    catat(
      "4b. total di layar klien = jumlah harga beku pesanan",
      totalTampil === nominal,
      `layar=${totalTampil} pesanan=${nominal}`,
    );
    catat(
      "4c. honor mitra tidak pernah muncul di layar klien",
      !/honor/i.test(await teksTerlihat(klien)),
      "kata 'honor' tidak ada di halaman",
    );
    const tombolBayar = klien.getByRole("button", { name: /Bayar sekarang/i });
    catat(
      "4d. tombol Bayar ada",
      (await tombolBayar.count()) === 1,
      "tombol 'Bayar sekarang' dirender",
    );

    // ---- 5. Klien menekan Bayar ----
    // Tautan palsu dipasang lewat service role: rute memakai ulang tautan yang
    // masih berlaku, jadi API DOKU tidak dipanggil. Peramban dicegat sebelum
    // keluar dari mesin; yang diperiksa hanya URL tujuannya.
    await admin
      .from("orders")
      .update({ tautan_gateway: TAUTAN_PALSU, tautan_terbit_pada: new Date().toISOString() })
      .eq("id", pesanan!.id);

    const hostDipanggil: string[] = [];
    await klien.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname.endsWith("doku.test") || url.hostname.endsWith("doku.com")) {
        hostDipanggil.push(url.href);
        await route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>DOKU palsu</body></html>" });
        return;
      }
      await route.continue();
    });
    await Promise.all([
      klien.waitForURL((u) => u.hostname.endsWith("doku.test"), { timeout: 20_000 }),
      tombolBayar.click(),
    ]);
    catat(
      "5a. peramban dialihkan ke tautan pesanan (jalur pakai-ulang, tanpa memanggil DOKU)",
      klien.url() === TAUTAN_PALSU && hostDipanggil.every((h) => h.startsWith(TAUTAN_PALSU)),
      `url=${klien.url()}`,
    );
    const { data: sesudahKlik } = await admin
      .from("orders")
      .select("tautan_gateway, percobaan")
      .eq("id", pesanan!.id)
      .single();
    catat(
      "5b. rute tidak menerbitkan invoice baru (percobaan & tautan tetap)",
      sesudahKlik?.tautan_gateway === TAUTAN_PALSU && sesudahKlik?.percobaan === pesanan!.percobaan,
      `percobaan=${sesudahKlik?.percobaan}`,
    );

    // ---- 6. Notifikasi SUCCESS bertanda tangan ----
    const invoice = rakitInvoice(pesanan!.kode, pesanan!.percobaan);
    const badan = JSON.stringify({
      order: { invoice_number: invoice, amount: nominal },
      transaction: { status: "SUCCESS" },
    });
    function kirimNotifikasi(clientId: string, rahasia: string) {
      const requestId = `uji-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const requestTimestamp = new Date().toISOString().replace(/\.\d+Z$/, "Z");
      const komponen = rakitKomponenTandaTangan({
        clientId,
        requestId,
        requestTimestamp,
        requestTarget: "/api/pembayaran/doku",
        digest: hitungDigest(badan),
      });
      return fetch(`${BASE}/api/pembayaran/doku`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Client-Id": clientId,
          "Request-Id": requestId,
          "Request-Timestamp": requestTimestamp,
          Signature: hitungTandaTangan(komponen, rahasia),
        },
        body: badan,
      });
    }

    // Tanda tangan SALAH dulu: membuktikan dev server memang memverifikasi
    // dengan kunci uji, bukan menerima apa saja (dan bukan memakai kunci lain).
    const resSalah = await kirimNotifikasi(CLIENT_ID_UJI, "kunci-salah");
    catat(
      "6a. notifikasi bertanda tangan SALAH ditolak 401 (server memverifikasi)",
      resSalah.status === 401,
      `status=${resSalah.status}`,
    );
    const resOk = await kirimNotifikasi(CLIENT_ID_UJI, SECRET_KEY_UJI);
    const jawab = (await resOk.json().catch(() => ({}))) as { hasil?: string };
    catat(
      "6b. notifikasi SUCCESS bertanda tangan benar diterapkan (200)",
      resOk.status === 200 && jawab.hasil === "diterapkan",
      `status=${resOk.status} hasil=${jawab.hasil}`,
    );

    const { data: pesananLunas } = await admin
      .from("orders")
      .select("status")
      .eq("id", pesanan!.id)
      .single();
    const { data: sesi } = await admin
      .from("sessions")
      .select("id, status_bayar, partner_id, tanggal, kabari_bidan_sejak")
      .eq("booking_request_id", idPermintaan);
    const p5 = await bacaPengajuan();
    catat(
      "6c. pesanan `lunas`, permintaan `dikonfirmasi`, tepat satu sesi lahir",
      pesananLunas?.status === "lunas" && p5?.status === "dikonfirmasi" && (sesi ?? []).length === 1,
      `pesanan=${pesananLunas?.status} permintaan=${p5?.status} sesi=${(sesi ?? []).length}`,
    );
    catat(
      "6d. sesi lahir LUNAS, memakai bidan & tanggal permintaan, bertanda kabari bidan",
      sesi?.[0]?.status_bayar === "lunas" &&
        sesi?.[0]?.partner_id === MITRA &&
        sesi?.[0]?.tanggal === TANGGAL &&
        sesi?.[0]?.kabari_bidan_sejak != null,
      `status_bayar=${sesi?.[0]?.status_bayar} partner=${sesi?.[0]?.partner_id} kabari=${sesi?.[0]?.kabari_bidan_sejak}`,
    );

    // ---- 7. Klien & admin melihat hasilnya ----
    await klien.unroute("**/*");
    await klien.goto(`${BASE}/passport/bayar/${idPermintaan}`, { waitUntil: "networkidle" });
    await tungguIsi(klien);
    const teksLunas = await teksTerlihat(klien);
    const tautJadwal = klien.getByRole("link", { name: "Lihat jadwal Anda" });
    catat(
      "7a. halaman tagihan menampilkan Lunas, tanpa tombol Bayar, dengan tautan jadwal",
      /lunas/i.test(teksLunas) &&
        (await klien.getByRole("button", { name: /Bayar|Lanjutkan pembayaran/i }).count()) === 0 &&
        (await tautJadwal.count()) === 1 &&
        ((await tautJadwal.getAttribute("href")) ?? "") === `/passport/sesi/${sesi?.[0]?.id}`,
      `href=${await tautJadwal.getAttribute("href").catch(() => null)}`,
    );

    // Penanda hidup di panel sesi (`/admin/sesi/<id>`), bukan di daftar.
    await staf.goto(`${BASE}/admin/sesi/${sesi?.[0]?.id}`, { waitUntil: "networkidle" });
    await tungguIsi(staf);
    catat(
      "7b. panel sesi admin menampilkan \"Baru — kabari bidan\"",
      (await teksTerlihat(staf)).includes("Baru — kabari bidan"),
      "penanda tampil",
    );
  } finally {
    await browser.close();
    await bersihkan();
  }

  const gagal = hasil.filter((h) => !h.lolos);
  console.log(`\n${hasil.length - gagal.length}/${hasil.length} pemeriksaan lolos.`);
  if (gagal.length > 0) {
    console.error("GAGAL:\n" + gagal.map((g) => `  - ${g.nama}`).join("\n"));
    process.exit(1);
  }
  console.log("Corong pembayaran terbukti utuh: tanpa lunas, tidak ada jadwal.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
