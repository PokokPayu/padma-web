/**
 * E2E PEMBAYARAN SEBAGAI SYARAT KONFIRMASI (spec C2).
 *
 * Ini satu-satunya uji yang menjalankan SELURUH corong C2 lewat browser
 * sungguhan, dari klien mengajukan sampai jadwalnya terkunci:
 *
 *   klien mengajukan → admin cari & tetapkan bidan → admin terbitkan tagihan
 *   → klien melihat nominal & tenggat → klien unggah bukti
 *   → admin melihat bukti → admin tandai lunas → admin konfirmasi jadwal
 *
 * Yang dijaga, dan hanya bisa dijaga dari sini:
 *
 *  1. **Tombol "Konfirmasi jadwal" TIDAK ADA sebelum pembayaran lunas.** Uji
 *     basis data sudah membuktikan `konfirmasi_permintaan()` menolak baris
 *     yang belum lunas; yang belum pernah dibuktikan adalah bahwa ADMIN tidak
 *     ditawari tombolnya. Tombol yang pasti ditolak basis data adalah cara
 *     tercepat membuat admin berhenti memercayai layarnya.
 *  2. **Total yang dilihat klien = harga layanan + tarif transport**, dan itu
 *     diturunkan pada saat render — tidak ada kolom `total_tagihan` di mana
 *     pun (money firewall). Di sini angkanya dibaca dari LAYAR lalu
 *     dibandingkan dengan tarif di basis data.
 *  3. **Unggahan bukti benar-benar melewati peramban** — termasuk pengecilan
 *     gambar di kanvas, yang tidak pernah berjalan di vitest karena tidak ada
 *     `createImageBitmap` di sana. Yang gagal senyap di jalur itu akan tampak
 *     sebagai bukti yang tidak pernah sampai.
 *  4. **Bukti hanya terbuka lewat rute bertanda.** Bucketnya tanpa policy;
 *     yang dibuktikan di sini adalah sisi lainnya: staf yang berhak MEMANG
 *     bisa membukanya, bukan hanya semua orang tertolak.
 *
 * Prasyarat: `npx supabase start`, `npm run seed:users`, `npm run dev`.
 * Jalankan: `npm run test:e2e:bayar`.
 * Sengaja BUKAN file *.test.ts agar `npm test` (vitest) tetap bisa jalan tanpa
 * server dev & browser.
 *
 * Skrip ini IDEMPOTEN: seluruh yang disentuhnya — pengajuan, sesi, skrining,
 * objek bukti, koordinat mitra & klien — dikembalikan di awal DAN di akhir.
 */
import { config } from "dotenv";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { tungguIsi } from "./_tunggu";

config({ path: [".env.local", ".env"] });

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const PASSWORD = "padma-dev-123";

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
      .locator("[data-pengajuan-terkirim]")
      .first()
      .waitFor({ state: "visible", timeout: 20_000 })
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
    const kartu = staf.locator(`[data-permintaan="${idPermintaan}"]`);

    await staf.goto(`${BASE}/admin/sesi`, { waitUntil: "networkidle" });
    await kartu.getByRole("button", { name: "Cari bidan" }).click();
    await kartu
      .locator("select")
      .waitFor({ state: "visible", timeout: 20_000 });
    await kartu.locator("select").selectOption(MITRA);
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

    // ---- 4. Klien melihat nominal & tenggat ----
    //
    // DUA layar sejak halaman bayar dipecah: `/passport/bayar` adalah DAFTAR
    // yang menaut, dan nominal + tenggat + unggahan hidup di halaman satu
    // tagihan. Ketukan di bawah karena itu bagian dari yang diuji — bukan
    // sekadar navigasi: kartu yang tidak menaut membuat tagihannya tidak bisa
    // dibayar sama sekali.
    await klien.goto(`${BASE}/passport/bayar`, { waitUntil: "networkidle" });
    const kartuDaftar = klien.locator(`[data-tagihan="${idPermintaan}"]`);
    await kartuDaftar.waitFor({ state: "visible", timeout: 20_000 });
    await kartuDaftar.click();
    await klien.waitForURL(`**/passport/bayar/${idPermintaan}`, { timeout: 20_000 });

    // Sesudah berpindah, kartu ringkas di halaman tagihan membawa penanda yang
    // sama — nominal dan tenggatnya ada di dalamnya.
    const kartuTagihan = klien.locator(`[data-tagihan="${idPermintaan}"]`);
    await kartuTagihan.locator("[data-total]").waitFor({ state: "visible", timeout: 20_000 });

    // Total yang benar dihitung dari tarif di basis data, bukan diketik di sini:
    // angka yang di-hardcode akan merah setiap kali seed-nya disetel, dan yang
    // sedang diuji adalah PENJUMLAHANNYA, bukan besaran tarifnya.
    const { data: tarif } = await admin
      .from("variant_rates")
      .select("harga_klien, berlaku_sejak")
      .eq("variant_id", p2!.variant_id as string)
      .lte("berlaku_sejak", TANGGAL)
      .order("berlaku_sejak", { ascending: false })
      .limit(1);
    const { data: tarifTransport } = await admin
      .from("transport_rates")
      .select("tarif_klien")
      .eq("jenjang", JENJANG_HARAPAN)
      .lte("berlaku_sejak", TANGGAL)
      .order("berlaku_sejak", { ascending: false })
      .limit(1);
    const harapanTotal =
      Number(tarif?.[0]?.harga_klien ?? NaN) + Number(tarifTransport?.[0]?.tarif_klien ?? NaN);

    const totalTampil = rupiahKeAngka(await kartuTagihan.locator("[data-total]").innerText());
    catat(
      "4a. total di layar klien = harga layanan + tarif transport (diturunkan, tidak disimpan)",
      totalTampil === harapanTotal,
      `layar=${totalTampil} harapan=${harapanTotal} (layanan ${tarif?.[0]?.harga_klien} + transport ${tarifTransport?.[0]?.tarif_klien})`,
    );

    const teksKartu = (await kartuTagihan.innerText()).replace(/\s+/g, " ");
    catat(
      "4b. tenggat & akibatnya tertulis di kartu, bukan hanya di basis data",
      /Bayar dalam .* jam lagi/.test(teksKartu) && teksKartu.includes("slotnya dilepas"),
      `isi kartu: ${teksKartu.slice(0, 160)}`,
    );
    catat(
      "4c. honor mitra tidak pernah muncul di layar klien",
      !/honor/i.test(await teksTerlihat(klien)),
      "kata 'honor' tidak ada di halaman",
    );

    // ---- 5. Klien mengunggah bukti ----
    // Medan berkas hidup di seksi "Kirim bukti", di luar kartu ringkas — jadi
    // dicari pada halaman, bukan di dalam kartu. Ia `sr-only` (tetap fokusabel,
    // hanya tidak terlihat), dan `setInputFiles` memang tidak menuntut
    // visibilitas.
    await klien.locator('input[type="file"]').setInputFiles({
      name: "bukti.png",
      mimeType: "image/png",
      buffer: PNG_1X1,
    });
    // Kartu berganti kalimat begitu `router.refresh()` selesai — itu penanda
    // unggahannya benar-benar diterima server, bukan sekadar berkasnya dipilih.
    await klien
      .getByText("Bukti diterima")
      .first()
      .waitFor({ state: "visible", timeout: 20_000 });

    const p3 = await bacaPengajuan();
    catat(
      "5a. status bayar menjadi `menunggu_verifikasi` — BUKAN langsung lunas",
      p3?.status_bayar === "menunggu_verifikasi",
      `status_bayar=${p3?.status_bayar}`,
    );
    catat(
      "5b. objek bukti tercatat pada barisnya, berkunci turunan id pengajuan",
      p3?.bukti_objek === `${idPermintaan}/bukti.jpg`,
      `bukti_objek=${p3?.bukti_objek}`,
    );
    // Gambar dikecilkan & di-JPEG-kan di peramban sebelum dikirim. Yang
    // dibuktikan di sini: byte yang sampai ke bucket memang JPEG, jadi jalur
    // kanvas sungguhan berjalan dan tidak diam-diam jatuh ke berkas aslinya
    // (PNG) lewat blok `catch`.
    const { data: objek } = await admin.storage
      .from("bukti-bayar")
      .download(p3!.bukti_objek as string);
    const kepala = objek ? new Uint8Array(await objek.arrayBuffer()).slice(0, 3) : new Uint8Array();
    catat(
      "5c. berkas di bucket sudah JPEG — pengecilan di peramban sungguh berjalan",
      kepala[0] === 0xff && kepala[1] === 0xd8 && kepala[2] === 0xff,
      `3 byte pertama: ${[...kepala].map((b) => b.toString(16)).join(" ")}`,
    );

    // GERBANG KETIGA: bukti sudah ada, tetapi belum diverifikasi manusia.
    await staf.goto(`${BASE}/admin/sesi`, { waitUntil: "networkidle" });
    catat(
      "5d. bukti terkirim TAPI belum diverifikasi: masih TIDAK ada tombol Konfirmasi jadwal",
      (await staf.getByRole("button", { name: "Konfirmasi jadwal" }).count()) === 0,
      "tombol konfirmasi tidak dirender",
    );

    // ---- 6. Admin melihat bukti & menandai lunas ----
    await staf.goto(`${BASE}/admin/bayar`, { waitUntil: "networkidle" });
    const baris = staf.locator(`[data-tagihan-pengajuan="${idPermintaan}"]`);
    await baris.waitFor({ state: "visible", timeout: 20_000 });
    catat(
      "6a. barisnya bertanda `menahan jadwal` — dibedakan dari tagihan sesi biasa",
      (await baris.innerText()).includes("menahan jadwal"),
      "penanda tampil",
    );

    // Rute bertanda dipanggil dengan KUKI ADMIN. Sisi tertolaknya (anon &
    // klien) sudah dibuktikan uji unit; yang ini sisi sebaliknya — staf yang
    // berhak memang bisa membukanya.
    const resBukti = await ctxAdmin.request.get(`${BASE}/api/bukti/${idPermintaan}`);
    catat(
      "6b. staf bisa membuka bukti lewat rute bertanda, dengan tajuk private & no-store",
      resBukti.status() === 200 &&
        (resBukti.headers()["content-type"] ?? "").startsWith("image/") &&
        (resBukti.headers()["cache-control"] ?? "").includes("no-store"),
      `status=${resBukti.status()} type=${resBukti.headers()["content-type"]} cache=${resBukti.headers()["cache-control"]}`,
    );

    await baris.getByRole("button", { name: "Tandai lunas" }).click();
    await staf.waitForTimeout(1500);
    const p4 = await bacaPengajuan();
    catat(
      "6c. status bayar menjadi `lunas` sesudah admin memutuskan",
      p4?.status_bayar === "lunas",
      `status_bayar=${p4?.status_bayar}`,
    );
    catat(
      "6d. melunasi TIDAK ikut memindahkan status permintaan — konfirmasi tetap langkah tersendiri",
      p4?.status === "menunggu_bayar",
      `status=${p4?.status}`,
    );

    // ---- 7. Baru sekarang jadwal boleh dikunci ----
    await staf.goto(`${BASE}/admin/sesi`, { waitUntil: "networkidle" });
    const tombolKonfirmasi = kartu.getByRole("button", { name: "Konfirmasi jadwal" });
    await tombolKonfirmasi.waitFor({ state: "visible", timeout: 20_000 });
    catat("7a. lunas: tombol Konfirmasi jadwal MUNCUL", true, "tombol tampil");

    await tombolKonfirmasi.click();
    await staf.waitForTimeout(2000);

    const p5 = await bacaPengajuan();
    const { data: sesi } = await admin
      .from("sessions")
      .select("id, status, status_bayar, partner_id, tanggal")
      .eq("booking_request_id", idPermintaan);
    catat(
      "7b. permintaan menjadi `dikonfirmasi` dan sesinya lahir — satu transaksi",
      p5?.status === "dikonfirmasi" && (sesi ?? []).length === 1,
      `status=${p5?.status} jumlah sesi=${(sesi ?? []).length}`,
    );
    catat(
      "7c. sesi lahir sudah LUNAS — uangnya diterima sebelum jadwalnya ada",
      sesi?.[0]?.status_bayar === "lunas",
      `status_bayar sesi=${sesi?.[0]?.status_bayar}`,
    );
    catat(
      "7d. sesi memakai bidan & tanggal dari permintaannya",
      sesi?.[0]?.partner_id === MITRA && sesi?.[0]?.tanggal === TANGGAL,
      `partner=${sesi?.[0]?.partner_id} tanggal=${sesi?.[0]?.tanggal}`,
    );

    // ---- 8. Klien melihat hasilnya ----
    await klien.goto(`${BASE}/passport/bayar`, { waitUntil: "networkidle" });
    catat(
      "8a. tagihan pengajuan hilang dari halaman klien sesudah jadwalnya terkunci",
      (await klien.locator(`[data-tagihan="${idPermintaan}"]`).count()) === 0,
      "kartu tagihan tidak lagi dirender",
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
