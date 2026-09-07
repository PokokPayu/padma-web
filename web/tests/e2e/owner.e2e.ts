/**
 * E2E PANEL OWNER (Plan 5 Task 6) — skrip KEENAM.
 *
 * `/owner/**` adalah SATU-SATUNYA layar PADMA yang menampilkan nominal uang,
 * dan sampai berkas ini ditulis ia punya NOL liputan E2E: kelima skrip yang
 * sudah ada (access-matrix, funnel-skrining, passport, admin-operasional,
 * admin-pelengkap) tidak pernah membuka satu pun rute owner. Yang paling mahal
 * dari kekosongan itu bukan tombolnya, melainkan pagar yang tidak punya bukti
 * di lapisan render:
 *
 *   MONEY FIREWALL. Nominal rate card tidak boleh muncul di satu pun rute
 *   /admin/** maupun /passport/**. Test unit menjaganya di lapisan RLS
 *   (rls-firewall, rls-hardening) dan di lapisan skema
 *   (money-firewall-struktural), tetapi tidak satu pun memeriksa HTML yang
 *   benar-benar terkirim ke browser staf. Kebocoran yang paling wajar justru
 *   lahir di sana: satu komponen bersama yang ikut membawa harga ke payload
 *   RSC halaman admin akan lolos SELURUH suite hari ini.
 *
 * Rantai yang dibuktikan lewat browser sungguhan:
 *   1. Owner masuk → `/owner` menampilkan "Panel Owner" dan ringkasan pekan.
 *   2. `/owner/rekap` mengelompokkan honor per mitra per pekan dengan tarif
 *      yang berlaku PADA TANGGAL SESI.
 *   3. `/owner/tarif` menampilkan rate card bernominal; menetapkan tarif baru
 *      melahirkan BARIS BARU — baris lama tetap utuh (INSERT-only).
 *   4. Rekap pekan yang sudah lewat TIDAK bergeser sesudah tarif naik.
 *   5. "Tandai dibayar" melahirkan satu `honor_marks` ber-`week_start` Senin
 *      dan ber-`ditandai_oleh` uid OWNER (bukan dari payload), lalu barisnya
 *      berubah menjadi "✓ Dibayar" dan tombolnya lenyap — tidak ada jalur
 *      pembatalan, dan tandanya bertahan sesudah halaman dimuat ulang.
 *   6. Owner punya JALAN PULANG yang bisa DIKLIK dari `/owner` ke `/admin`.
 *   7. Admin ditolak di `/owner`, DAN tidak satu pun nominal rate card muncul
 *      di HTML sepuluh rute /admin/** maupun enam rute /passport/**.
 *   8. KONTROL POSITIF: nominal yang sama HARUS terbaca di `/owner/tarif`.
 *      Tanpa langkah ini, "nol nominal" di langkah 7 bisa hijau palsu hanya
 *      karena pemindainya rusak — kelas kegagalan yang paling berbahaya di
 *      seluruh berkas ini, karena ia hijau justru saat tidak menguji apa pun.
 *
 * Prasyarat: `npx supabase start`, `npm run seed:users`, `npm run dev`.
 * Jalankan: `npm run test:e2e:owner`.
 * Sengaja BUKAN file *.test.ts agar `npm test` (vitest) tetap bisa jalan tanpa
 * server dev & browser.
 *
 * IDEMPOTEN: seluruh data uji berpenanda `E2E-OWNR` / `e2e-owner-` dan
 * dibersihkan lewat service role di awal (sisa run yang mati di tengah) maupun
 * di akhir. Data seed TIDAK disentuh: layanan, mitra, klien, dan sesinya dibuat
 * sendiri, sehingga tarif yang ditetapkan di langkah 3 tidak pernah mendarat di
 * rate card klinik yang sebenarnya. `jejak_status_bayar` sengaja tanpa foreign
 * key sehingga tidak ikut cascade — barisnya dihapus manual.
 */
import { config } from "dotenv";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { awalPekan, geserHari } from "../../src/lib/owner/pekan";
import { hariIniJakarta } from "../../src/lib/passport/waktu";
import { tungguIsi } from "./_tunggu";

config({ path: [".env.local", ".env"] });

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const PASSWORD = "padma-dev-123";

const PENANDA = "e2e-owner-";
const PENANDA_ISI = "E2E-OWNR";
const stempel = Date.now();
const NAMA_LAYANAN = `${PENANDA_ISI} Layanan ${stempel}`;
const NAMA_MITRA = `${PENANDA_ISI} Bidan ${stempel}`;
const NAMA_KLIEN = `${PENANDA_ISI} Klien ${stempel}`;
const EMAIL_KLIEN = `${PENANDA}${stempel}@padma.test`;
const PADMA_ID = `PAD-8${String(stempel).slice(-3)}-${String(stempel).slice(-4)}`;

/**
 * Nominal uji sengaja TIDAK bulat-lazim dan tidak muncul di seed, supaya
 * pemindai money firewall tidak pernah salah menuduh angka lain — dan supaya
 * kontrol positifnya membuktikan pemindainya memang melihat nominal INI.
 */
const HARGA_LAMA = 777_000;
const HONOR_LAMA = 333_000;
const HARGA_BARU = 999_000;
const HONOR_BARU = 555_000;

/**
 * Sesi ditaruh di pekan LALU, bukan pekan berjalan.
 *
 * Alasannya mengikat: tarif baru di langkah 3 berlaku mulai HARI INI, dan
 * pembuktian "rekap pekan lama tidak bergeser" hanya berarti bila seluruh sesi
 * fixture memang lebih tua dari tanggal berlaku itu. Bila sesinya di pekan
 * berjalan, skrip ini akan hijau pada hari Selasa–Minggu dan MERAH setiap hari
 * Senin — kelas bug zona/pekan yang sudah dibayar sekali di repo ini.
 */
const HARI_INI = hariIniJakarta();
const SENIN_LALU = geserHari(awalPekan(HARI_INI), -7);
const TANGGAL_SESI_A = SENIN_LALU;
const TANGGAL_SESI_B = geserHari(SENIN_LALU, 2);

/** Honor yang harus muncul di rekap: dua sesi selesai × tarif LAMA. */
const HONOR_PEKAN = HONOR_LAMA * 2;

/**
 * Layanan seed permanen ("Sankalpa Fertility Massage") — SATU-SATUNYA id yang
 * dipakai untuk memeriksa rute DINAMIS `/admin/layanan/[id]` di bawah. Baris
 * ini hidup selamanya di `supabase/seed.sql` (bukan fixture `PAD-UJI` milik
 * berkas vitest mana pun, yang dibuat & dihapus dalam satu run test dan
 * karenanya bisa TIDAK ADA saat skrip e2e ini berjalan terpisah).
 */
const SVC_SEED_E2E = "11111111-1111-1111-1111-111111111101";

/**
 * Rute yang HTML-nya wajib bersih dari nominal rate card.
 *
 * Seluruh entri di sini SELALU statis — `buka()` di bawah hanya melakukan
 * `page.goto(BASE + path)` literal, dan sesudahnya memeriksa `tiba === path`
 * persis (redirect dianggap "rute tidak benar-benar diperiksa"). Sampai baris
 * `/admin/layanan/[id]` di bawah, tidak ada satu pun rute berparameter
 * (`/admin/klien/[id]`, `/passport/materi/[id]`, dst.) yang pernah masuk daftar
 * ini — jadi TIDAK ADA konvensi template/placeholder untuk rute dinamis untuk
 * diikuti. Diselesaikan dengan cara TERKECIL yang konsisten dengan pola yang
 * sudah ada: satu string literal dengan id sungguhan tertanam, dievaluasi
 * PERSIS seperti sembilan entri statis lain, bukan mesin templating baru.
 */
const RUTE_ADMIN = [
  "/admin",
  "/admin/bayar",
  "/admin/klien",
  "/admin/sesi",
  "/admin/layanan",
  `/admin/layanan/${SVC_SEED_E2E}`,
  "/admin/materi",
  "/admin/mitra",
  "/admin/pengaturan",
  "/admin/skrining",
];
const RUTE_KLIEN = [
  "/passport",
  "/passport/sesi",
  "/passport/materi",
  "/passport/bayar",
  "/passport/profil",
  "/passport/ajukan",
];

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
 * Bentuk-bentuk tulisan satu nominal yang mungkin muncul di HTML.
 *
 * `formatRupiah` mencetak "Rp 777.000" (pemisah id-ID), sedangkan payload RSC
 * membawa angkanya TELANJANG (777000) — dan payload itulah kebocoran yang
 * paling mungkin terjadi tanpa terlihat di layar. Bentuk berkoma ikut dicari
 * karena `toLocaleString` bawaan runtime lain memakainya.
 */
function bentukNominal(nilai: number): string[] {
  return [
    String(nilai),
    nilai.toLocaleString("id-ID"),
    nilai.toLocaleString("en-US"),
  ];
}

/**
 * Mencari sebuah nominal di dalam HTML.
 *
 * Angka telanjang dicari dengan penjaga heksadesimal di kedua sisi: id UUID,
 * hash, dan nonce yang bertaburan di HTML Next.js bisa saja memuat enam digit
 * yang sama secara kebetulan, dan tuduhan palsu pada pemindai keamanan jauh
 * lebih mahal daripada terlihat pintar — ia membuat orang berikutnya
 * melonggarkan pemindainya, bukan memperbaiki kebocorannya.
 */
function memuatNominal(html: string, nilai: number): string | null {
  for (const bentuk of bentukNominal(nilai)) {
    const pola = /^\d+$/.test(bentuk)
      ? new RegExp(`(?<![0-9a-fA-F])${bentuk}(?![0-9a-fA-F])`)
      : new RegExp(bentuk.replace(/[.,]/g, "\\$&"));
    if (pola.test(html)) return bentuk;
  }
  return null;
}

async function login(browser: Browser, email: string): Promise<BrowserContext> {
  const context = await browser.newContext();
  const page = await context.newPage();
  // networkidle, bukan domcontentloaded: form masuk adalah controlled component —
  // isian sebelum React hydrate akan terhapus.
  await page.goto(`${BASE}/masuk`, { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Kata sandi").fill(PASSWORD);
  if ((await page.getByLabel("Email").inputValue()) !== email) {
    throw new Error("Isian email terhapus — halaman /masuk belum ter-hydrate.");
  }
  await Promise.all([
    page.waitForURL(
      (u) => !u.pathname.startsWith("/masuk") && !u.pathname.startsWith("/setelah-masuk"),
      { timeout: 20_000 },
    ),
    page.getByRole("button", { name: "Masuk", exact: true }).click(),
  ]);
  await tungguIsi(page);
  console.log(`      [login ${email}] mendarat di ${page.url()}`);
  await page.close();
  return context;
}

/** Buka path; kembalikan halaman yang masih hidup (pemanggil menutupnya). */
async function buka(context: BrowserContext, path: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  return page;
}

/**
 * Teks yang benar-benar TERLIHAT. `textContent("body")` ikut memungut payload
 * RSC di dalam <script>, sehingga pemeriksaan "nilai muncul di layar" lolos
 * palsu untuk nilai yang hanya ada di payload.
 */
async function teksTerlihat(page: Page): Promise<string> {
  return (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
}

async function uidAkun(email: string): Promise<string> {
  const { data } = await admin.auth.admin.listUsers();
  const u = (data?.users ?? []).find((x) => x.email === email);
  if (!u) throw new Error(`Akun ${email} tidak ada — jalankan npm run seed:users.`);
  return u.id;
}

/**
 * Pembersihan lewat service role.
 *
 * Urutannya mengikat: `jejak_status_bayar` sengaja TANPA foreign key sehingga
 * tidak ikut tersapu cascade dan harus dihapus MENURUT id sesinya, selagi id
 * itu masih bisa dicari. `variant_rates` menahan `service_variants`, yang pada
 * gilirannya menahan `services`, lewat foreign key — dan `honor_marks` menahan
 * `partners` — keduanya harus lebih dulu. Verba DELETE atas ketiga tabel uang
 * (`variant_rates`, `service_variants`, `honor_marks`) memang sudah dicabut
 * dari peran API; jalur ini service role, satu-satunya jalan keluar yang
 * disediakan migration `cabut_hak_hapus_berlebih`.
 *
 * `service_variants` WAJIB disapu meski tidak pernah disisipkan manual di
 * berkas ini: trigger `trg_terbitkan_varian_baku` (Ruling 11) menerbitkan satu
 * varian baku OTOMATIS — id acak, tidak pernah dicatat di sini — begitu setiap
 * `services` fixture di bawah lahir. Tanpa langkah ini, FK-nya menahan
 * penghapusan `services` secara DIAM-DIAM (Supabase tidak melempar kecuali
 * errornya diperiksa), dan fixture E2E menumpuk tiap run karena `services.nama`
 * tidak unik — persis kebocoran yang ditemukan lewat audit fix round 2.
 * Errornya karena itu WAJIB diperiksa di setiap langkah penghapusan di sini.
 */
async function bersihkan() {
  const { data: klien } = await admin
    .from("clients")
    .select("id")
    .like("email", `${PENANDA}%`);
  for (const k of klien ?? []) {
    const { data: sesi } = await admin.from("sessions").select("id").eq("client_id", k.id);
    for (const s of sesi ?? []) {
      await admin.from("jejak_status_bayar").delete().eq("sesi_id", s.id);
    }
    await admin.from("sessions").delete().eq("client_id", k.id);
  }
  await admin.from("clients").delete().like("email", `${PENANDA}%`);

  const { data: mitra } = await admin
    .from("partners")
    .select("id")
    .like("nama", `${PENANDA_ISI}%`);
  for (const m of mitra ?? []) {
    await admin.from("honor_marks").delete().eq("partner_id", m.id);
  }
  await admin.from("partners").delete().like("nama", `${PENANDA_ISI}%`);

  const { data: layanan } = await admin
    .from("services")
    .select("id")
    .like("nama", `${PENANDA_ISI}%`);
  for (const l of layanan ?? []) {
    const { data: varian } = await admin
      .from("service_variants")
      .select("id")
      .eq("service_id", l.id);
    for (const v of varian ?? []) {
      const { error: eTarifVarian } = await admin
        .from("variant_rates")
        .delete()
        .eq("variant_id", v.id);
      if (eTarifVarian) {
        throw new Error(`bersihkan variant_rates gagal: ${eTarifVarian.message}`);
      }
    }
    const { error: eVarian } = await admin
      .from("service_variants")
      .delete()
      .eq("service_id", l.id);
    if (eVarian) throw new Error(`bersihkan service_variants gagal: ${eVarian.message}`);
  }
  const { error: eLayananHapus } = await admin
    .from("services")
    .delete()
    .like("nama", `${PENANDA_ISI}%`);
  if (eLayananHapus) throw new Error(`bersihkan services gagal: ${eLayananHapus.message}`);
}

async function main() {
  await bersihkan();

  const uidOwner = await uidAkun("owner@padma.test");

  // ==================== FIXTURE (service role) =============================
  const { data: layanan, error: eLayanan } = await admin
    .from("services")
    .insert({ id: crypto.randomUUID(), phase_id: "prekonsepsi", nama: NAMA_LAYANAN, aktif: true })
    .select("id")
    .single();
  if (eLayanan) throw new Error(`fixture layanan gagal: ${eLayanan.message}`);
  const idLayanan = layanan!.id as string;

  // Harga menempel di VARIAN, bukan di layanan, sejak Task 3/4. Trigger
  // `trg_terbitkan_varian_baku` (Ruling 11) sudah menerbitkan satu varian baku
  // (label kosong) begitu baris `services` di atas lahir — dicari di sini,
  // bukan disisipkan manual: menyisipkannya lagi akan melahirkan VARIAN KEDUA
  // untuk layanan yang sama, dan baris "Tarif baru" di langkah 3 di bawah
  // menjadi ambigu (dua varian per layanan fixture).
  const { data: varianBaku, error: eVarianBaku } = await admin
    .from("service_variants")
    .select("id")
    .eq("service_id", idLayanan)
    .single();
  if (eVarianBaku) {
    throw new Error(`varian baku tidak diterbitkan trigger: ${eVarianBaku.message}`);
  }
  const idVarian = varianBaku!.id as string;

  // `berlaku_sejak` jauh di masa lalu supaya tarif ini pasti yang berlaku pada
  // tanggal sesi fixture, tidak bergantung pada kapan `db reset` terakhir
  // dijalankan. Jalur service role sengaja dilewatkan trigger guard_tarif_varian_maju.
  const { error: eTarif } = await admin.from("variant_rates").insert({
    variant_id: idVarian,
    harga_klien: HARGA_LAMA,
    honor_mitra: HONOR_LAMA,
    berlaku_sejak: "2020-01-06",
  });
  if (eTarif) throw new Error(`fixture tarif gagal: ${eTarif.message}`);

  const { data: mitra, error: eMitra } = await admin
    .from("partners")
    .insert({ id: crypto.randomUUID(), nama: NAMA_MITRA, no_hp: "0811-0000-9401" })
    .select("id")
    .single();
  if (eMitra) throw new Error(`fixture mitra gagal: ${eMitra.message}`);
  const idMitra = mitra!.id as string;

  const { data: klien, error: eKlien } = await admin
    .from("clients")
    .insert({
      id: crypto.randomUUID(),
      padma_id: PADMA_ID,
      nama: NAMA_KLIEN,
      email: EMAIL_KLIEN,
      phase_id: "prekonsepsi",
    })
    .select("id")
    .single();
  if (eKlien) throw new Error(`fixture klien gagal: ${eKlien.message}`);
  const idKlien = klien!.id as string;

  const { error: eSesi } = await admin.from("sessions").insert(
    [TANGGAL_SESI_A, TANGGAL_SESI_B].map((tanggal) => ({
      client_id: idKlien,
      service_id: idLayanan,
      // `hitungRekap()` mencocokkan tarif ke sesi lewat `variant_id` sejak
      // Task 4 — sesi tanpa ini jatuh sebagai "tak bertarif", dan honor pekan
      // di langkah 2/4 di bawah akan terbaca nol.
      variant_id: idVarian,
      partner_id: idMitra,
      tanggal,
      status: "selesai",
      status_bayar: "belum",
      catatan: "",
      rekomendasi: "",
    })),
  );
  if (eSesi) throw new Error(`fixture sesi gagal: ${eSesi.message}`);

  const browser = await chromium.launch();
  try {
    const owner = await login(browser, "owner@padma.test");

    // ================= 1. Beranda owner ==================================
    {
      const page = await buka(owner, "/owner");
      const teks = await teksTerlihat(page);
      catat(
        "1. /owner menampilkan 'Panel Owner' dan ringkasan pekan berjalan",
        teks.includes("Panel Owner") &&
          // Label kartu dirender `uppercase` lewat CSS, dan `innerText`
          // mengembalikan teks TERKOMPUTASI — jadi pencocokannya harus buta
          // huruf besar-kecil, bukan disamakan dengan sumber JSX-nya.
          /sesi selesai pekan ini/i.test(teks) &&
          /margin padma pekan ini/i.test(teks),
        teks.slice(0, 200),
      );
      await page.close();
    }

    // ================= 2. Rekap SEBELUM tarif naik =======================
    {
      const page = await buka(owner, "/owner/rekap");
      const teks = await teksTerlihat(page);
      catat(
        "2. /owner/rekap menampilkan honor mitra uji dengan tarif pada tanggal sesi",
        teks.includes(NAMA_MITRA) &&
          teks.includes(HONOR_PEKAN.toLocaleString("id-ID")) &&
          teks.includes("2 sesi selesai"),
        `mencari "${NAMA_MITRA}" & Rp ${HONOR_PEKAN.toLocaleString("id-ID")}`,
      );
      await page.close();
    }

    // ================= 3. Rate card: tarif baru = BARIS BARU =============
    {
      const page = await buka(owner, "/owner/tarif");
      const sebelum = await teksTerlihat(page);
      const tampilLama =
        sebelum.includes(HARGA_LAMA.toLocaleString("id-ID")) &&
        sebelum.includes(HONOR_LAMA.toLocaleString("id-ID"));

      // Tombolnya bernama "Tarif baru" karena layanan ini sudah bertarif.
      await page
        .getByRole("row", { name: new RegExp(NAMA_LAYANAN) })
        .getByRole("button", { name: "Tarif baru" })
        .click();
      await page.getByLabel(`Harga klien ${NAMA_LAYANAN}`).fill(String(HARGA_BARU));
      await page.getByLabel(`Honor mitra ${NAMA_LAYANAN}`).fill(String(HONOR_BARU));
      await page.getByLabel(`Tanggal berlaku tarif ${NAMA_LAYANAN}`).fill(HARI_INI);
      await page.getByRole("button", { name: "Simpan tarif" }).click();
      await tungguIsi(page);
      await page.waitForTimeout(600);

      const { data: barisTarif } = await admin
        .from("variant_rates")
        .select("harga_klien, honor_mitra, berlaku_sejak")
        .eq("variant_id", idVarian)
        .order("berlaku_sejak");

      const dua = (barisTarif ?? []).length === 2;
      const lamaUtuh =
        barisTarif?.[0]?.harga_klien === HARGA_LAMA &&
        barisTarif?.[0]?.honor_mitra === HONOR_LAMA &&
        barisTarif?.[0]?.berlaku_sejak === "2020-01-06";
      const baruBenar =
        barisTarif?.[1]?.harga_klien === HARGA_BARU &&
        barisTarif?.[1]?.honor_mitra === HONOR_BARU &&
        barisTarif?.[1]?.berlaku_sejak === HARI_INI;

      catat(
        "3. /owner/tarif menampilkan nominal, dan tarif baru lahir sebagai BARIS BARU",
        tampilLama && dua && lamaUtuh && baruBenar,
        `nominal lama tampil: ${tampilLama}; baris: ${JSON.stringify(barisTarif)}`,
      );
      await page.close();
    }

    // ================= 4. Rekap pekan lama TIDAK bergeser ================
    {
      const page = await buka(owner, "/owner/rekap");
      const teks = await teksTerlihat(page);
      // Nominal tarif BARU sengaja dipilih supaya tidak satu pun angka
      // turunannya bertabrakan dengan angka pekan lama: honor bergeser akan
      // berbunyi Rp 1.110.000, sementara margin pekan lama (Rp 888.000) tetap
      // angka yang sah dan tidak boleh dituduh sebagai pergeseran.
      const honorBergeser = (HONOR_BARU * 2).toLocaleString("id-ID");
      catat(
        "4. rekap pekan yang sudah lewat TIDAK bergeser sesudah tarif naik",
        teks.includes(HONOR_PEKAN.toLocaleString("id-ID")) && !teks.includes(honorBergeser),
        `masih Rp ${HONOR_PEKAN.toLocaleString("id-ID")}, bukan Rp ${honorBergeser}`,
      );
      await page.close();
    }

    // ================= 5. Tandai dibayar =================================
    {
      const page = await buka(owner, "/owner/rekap");
      const baris = page.locator("div").filter({ hasText: NAMA_MITRA }).last();
      await baris.getByRole("button", { name: "Tandai dibayar" }).click();
      await page.waitForTimeout(1200);
      const sesudahKlik = await teksTerlihat(page);
      await page.close();

      const { data: tanda } = await admin
        .from("honor_marks")
        .select("week_start, ditandai_oleh, dibayar_pada")
        .eq("partner_id", idMitra);

      const satuBaris = (tanda ?? []).length === 1;
      const seninBenar = tanda?.[0]?.week_start === SENIN_LALU;
      const penandaOwner = tanda?.[0]?.ditandai_oleh === uidOwner;

      // Muat ulang: tandanya harus bertahan, dan tombolnya tidak boleh kembali —
      // tidak ada jalur pembatalan, jadi tombol yang muncul lagi adalah tombol
      // yang hanya bisa gagal.
      const ulang = await buka(owner, "/owner/rekap");
      const teksUlang = await teksTerlihat(ulang);
      const tombolLenyap =
        (await ulang
          .locator("div")
          .filter({ hasText: NAMA_MITRA })
          .last()
          .getByRole("button", { name: "Tandai dibayar" })
          .count()) === 0;
      await ulang.close();

      catat(
        "5. 'Tandai dibayar' melahirkan satu tanda Senin ber-ditandai_oleh uid OWNER",
        satuBaris && seninBenar && penandaOwner &&
          sesudahKlik.includes("Dibayar") &&
          teksUlang.includes("Dibayar") &&
          tombolLenyap,
        `tanda ${JSON.stringify(tanda)}; week_start diharapkan ${SENIN_LALU}; tombol lenyap: ${tombolLenyap}`,
      );
    }

    // ================= 6. Jalan pulang ke panel admin ====================
    {
      const page = await buka(owner, "/owner");
      // Navigasi Next adalah transisi klien: `waitForLoadState` sesudah klik
      // bisa kembali sebelum rutenya berpindah, dan pemeriksaan path-nya lolos
      // palsu sebagai "masih di /owner".
      await Promise.all([
        page.waitForURL((u) => u.pathname === "/admin", { timeout: 20_000 }),
        page.getByRole("link", { name: /Buka Panel Admin/ }).first().click(),
      ]);
      await tungguIsi(page);
      const path = new URL(page.url()).pathname;
      const teks = await teksTerlihat(page);
      catat(
        "6. owner punya jalan pulang yang bisa DIKLIK dari /owner ke /admin",
        path === "/admin" && teks.length > 0,
        `mendarat di ${path}`,
      );
      await page.close();
    }

    // ================= 8. KONTROL POSITIF pemindai nominal ===============
    // Dijalankan SEBELUM pemindaian /admin/**: bila pemindainya rusak, langkah
    // 7 akan hijau tanpa menguji apa pun, dan kegagalan itu harus terlihat
    // lebih dulu — bukan tersembunyi di balik sepuluh baris PASS.
    let pemindaiBekerja = false;
    {
      const page = await buka(owner, "/owner/tarif");
      const html = await page.content();
      await page.close();
      const temuan = [HARGA_LAMA, HONOR_LAMA, HARGA_BARU, HONOR_BARU]
        .map((n) => memuatNominal(html, n))
        .filter((t): t is string => t !== null);
      pemindaiBekerja = temuan.length === 4;
      catat(
        "8. KONTROL POSITIF: pemindai nominal MENEMUKAN keempat angka di /owner/tarif",
        pemindaiBekerja,
        `ditemukan: ${JSON.stringify(temuan)}`,
      );
    }

    // ================= 7. Money firewall di lapisan render ===============
    {
      const adminCtx = await login(browser, "admin@padma.test");
      const klienCtx = await login(browser, "ananda@padma.test");

      const page = await buka(adminCtx, "/owner");
      const pathOwner = new URL(page.url()).pathname;
      await page.close();
      catat(
        "7a. admin yang login DITOLAK di /owner",
        pathOwner !== "/owner",
        `mendarat di ${pathOwner}`,
      );

      // Nominal yang dicari: tarif uji DAN seluruh rate card seed. Membatasi
      // pencarian pada tarif uji saja akan melewatkan kebocoran yang hanya
      // menyentuh layanan seed — yaitu justru layanan yang dipakai panel admin
      // sehari-hari. `/owner/tarif` membaca `variant_rates` sejak Task 4, bukan
      // lagi `service_rates` — pemindainya harus mengikuti sumber yang sama
      // dengan yang benar-benar dirender, atau ia bisa hijau tanpa melihat apa
      // yang ditampilkan layar.
      const { data: seluruhTarif } = await admin
        .from("variant_rates")
        .select("harga_klien, honor_mitra");
      const nominal = [
        ...new Set(
          (seluruhTarif ?? []).flatMap((t) => [t.harga_klien as number, t.honor_mitra as number]),
        ),
      ];

      const bocor: string[] = [];
      let diperiksa = 0;
      for (const [ctx, rute] of [
        [adminCtx, RUTE_ADMIN],
        [klienCtx, RUTE_KLIEN],
      ] as const) {
        for (const path of rute) {
          const p = await buka(ctx, path);
          const tiba = new URL(p.url()).pathname;
          const html = await p.content();
          await p.close();
          diperiksa += 1;
          if (tiba !== path) {
            bocor.push(`${path}: dialihkan ke ${tiba} (rute tidak benar-benar diperiksa)`);
            continue;
          }
          for (const n of nominal) {
            const temuan = memuatNominal(html, n);
            if (temuan !== null) bocor.push(`${path}: memuat "${temuan}"`);
          }
        }
      }

      catat(
        `7b. nol nominal rate card di ${RUTE_ADMIN.length} rute /admin + ${RUTE_KLIEN.length} rute /passport`,
        bocor.length === 0 && diperiksa === RUTE_ADMIN.length + RUTE_KLIEN.length && pemindaiBekerja,
        bocor.length === 0
          ? `${diperiksa} rute diperiksa terhadap ${nominal.length} nominal, nol temuan`
          : bocor.join("; "),
      );

      await adminCtx.close();
      await klienCtx.close();
    }

    await owner.close();
  } finally {
    await browser.close();
    await bersihkan();
  }

  // ================= 9. Pembersihan wajib benar-benar bersih =============
  const { data: sisaLayanan } = await admin
    .from("services")
    .select("id")
    .like("nama", `${PENANDA_ISI}%`);
  const { data: sisaMitra } = await admin
    .from("partners")
    .select("id")
    .like("nama", `${PENANDA_ISI}%`);
  const { data: sisaKlien } = await admin
    .from("clients")
    .select("id")
    .like("email", `${PENANDA}%`);
  const { data: sisaTarif } = await admin
    .from("variant_rates")
    .select("id")
    .in("harga_klien", [HARGA_LAMA, HARGA_BARU]);

  catat(
    "9. seluruh data uji terhapus dan rate card klinik tidak ikut tersentuh",
    (sisaLayanan ?? []).length === 0 &&
      (sisaMitra ?? []).length === 0 &&
      (sisaKlien ?? []).length === 0 &&
      (sisaTarif ?? []).length === 0,
    `layanan ${(sisaLayanan ?? []).length}, mitra ${(sisaMitra ?? []).length}, klien ${(sisaKlien ?? []).length}, tarif uji ${(sisaTarif ?? []).length}`,
  );

  const gagal = hasil.filter((h) => !h.lolos);
  console.log(`\n${hasil.length - gagal.length}/${hasil.length} pemeriksaan lolos.`);
  if (gagal.length > 0) {
    console.error("GAGAL:\n" + gagal.map((g) => `  - ${g.nama}`).join("\n"));
    process.exit(1);
  }
  console.log(
    "Panel owner terbukti utuh: rate card insert-only, rekap berriwayat tarif, tanda bayar beridentitas owner, dan nol nominal di seluruh rute admin & passport.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
