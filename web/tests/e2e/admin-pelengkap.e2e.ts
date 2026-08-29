/**
 * E2E rantai PELENGKAP admin (Plan 3B Task 8) — skrip kelima.
 *
 * Empat skrip E2E yang sudah ada (access-matrix, funnel-skrining, passport,
 * admin-operasional) membuktikan rantai Plan 3A. Tiga modul yang lahir di Plan
 * 3B — verifikasi pembayaran, pengaturan, dan materi — TIDAK punya bukti
 * otomatis satu pun di lapisan ini. Yang paling mahal di antaranya:
 *
 *   TIDAK ADA satu pun test yang menjaga `jejak_status_bayar.peran_aktor` dari
 *   regresi menjadi 'service_role'.
 *
 * Itulah SATU-SATUNYA alasan tabel jejak dibuat. Seluruh pagar arsitektur
 * "panel admin WAJIB createServerSupabase(), BUKAN createAdminSupabase()" ada
 * demi baris itu: di bawah service role jejaknya TETAP TERBIT — dengan
 * `aktor_id: null, peran_aktor: 'service_role'` — yaitu bukti yang tidak
 * menyebut siapa pun, yaitu bukan bukti. tests/admin-shell.test.ts memindai
 * STRING "createAdminSupabase" di src/app/admin/**, dan pemindaian string
 * tidak melihat jalur lain menuju service role (helper baru, re-export,
 * variabel). Skrip ini memeriksa AKIBATNYA lewat browser sungguhan.
 *
 * Rantai yang dibuktikan:
 *   1. Klien menekan "Saya sudah bayar" di Passport → status menjadi
 *      `menunggu_verifikasi`, BUKAN `lunas`, dan jejaknya menyebut
 *      peran_aktor 'klien' dengan aktor_id klien itu.
 *   2. Badge "Klaim pembayaran" di /admin menyalakan angkanya, admin MENGKLIK
 *      kartunya menuju /admin/bayar, dan item itu ada di sana sebagai
 *      "Menunggu verifikasi" — sementara SESI ANGGOTA PAKET tidak pernah ikut
 *      muncul (tagihan hantu) dan angka badge sama persis dengan jumlah baris
 *      yang benar-benar bisa diverifikasi.
 *   3. Admin menekan "Tandai lunas" → baris jejak baru berbunyi
 *      peran_aktor 'admin' dengan aktor_id AKUN ADMIN YANG MENEKANNYA.
 *   4. Klien memuat ulang Passport-nya dan melihat "Lunas".
 *   5. Admin mengubah nomor WhatsApp, alamat, & jam operasional di
 *      /admin/pengaturan → ketiganya merambat ke halaman publik (/skrining
 *      untuk nomor, footer landing untuk ketiganya).
 *   6. Admin menonaktifkan sebuah materi → klien tidak bisa lagi membaca
 *      babnya LEWAT REST (bukan sekadar hilang dari layarnya), dan bisa lagi
 *      sesudah diaktifkan kembali.
 *
 * Prasyarat: `npx supabase start`, `npm run seed:users`, `npm run dev`.
 * Jalankan: `npm run test:e2e:pelengkap`.
 * Sengaja BUKAN file *.test.ts agar `npm test` (vitest) tetap bisa jalan tanpa
 * server dev & browser.
 *
 * IDEMPOTEN: seluruh data uji berpenanda `e2e-pelengkap-` / `E2E-PLKP` dan
 * dibersihkan lewat service role di awal (sisa run yang mati di tengah) maupun
 * di akhir. Data seed tidak disentuh sama sekali — layanan & materi uji dibuat
 * sendiri, supaya menonaktifkan materi di langkah 6 tidak pernah menyentuh
 * materi milik klien demo. Setelan `app_settings` DIUBAH di langkah 5 dan
 * dikembalikan ke nilai semula di `finally`; `jejak_status_bayar` sengaja TANPA
 * FK sehingga tidak ikut cascade — barisnya dihapus manual (kelas bug yang
 * sudah pernah terjadi: jejak yatim menumpuk lintas run).
 */
import { config } from "dotenv";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

config({ path: [".env.local", ".env"] });

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const PASSWORD = "padma-dev-123";

const PENANDA = "e2e-pelengkap-";
const PENANDA_ISI = "E2E-PLKP";
const stempel = Date.now();
const EMAIL_KLIEN = `${PENANDA}${stempel}@padma.test`;
const NAMA_KLIEN = `${PENANDA_ISI} Klien ${stempel}`;
const PADMA_ID = `PAD-9${String(stempel).slice(-3)}-${String(stempel).slice(-4)}`;
const NAMA_LAYANAN = `${PENANDA_ISI} Layanan ${stempel}`;
const NAMA_PAKET = `${PENANDA_ISI} Paket ${stempel}`;
const JUDUL_MATERI = `${PENANDA_ISI} Materi ${stempel}`;

/** Mitra & fase dari seed — dirujuk, tidak diubah. */
const MITRA_SEED = "33333333-3333-3333-3333-333333333301";
const FASE = "prekonsepsi";
const TANGGAL_SESI = "2026-11-17";
const TANGGAL_SESI_PAKET = "2026-11-18";

/**
 * Nilai setelan bertanda. Nomor WA wajib lolos `periksaNilai("nomor_wa")`:
 * digit saja, 8–15 digit sesudah normalisasi.
 */
const WA_UJI = `628${String(stempel).slice(-10)}`;
const ALAMAT_UJI = `${PENANDA_ISI} Kemang Jakarta Selatan`;
const JAM_UJI = `${PENANDA_ISI} Senin-Sabtu 08.00-20.00 WIB`;

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
 * Teks yang benar-benar TERLIHAT. `textContent("body")` ikut memungut payload
 * RSC Next.js di dalam <script>, sehingga pemeriksaan "nilai baru muncul"
 * lolos palsu untuk nilai yang hanya ada di payload.
 */
async function teksTerlihat(page: Page): Promise<string> {
  return (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
}

function memuat(teks: string, penggal: string): boolean {
  return teks.toLowerCase().includes(penggal.toLowerCase());
}

async function login(browser: Browser, email: string): Promise<BrowserContext> {
  const context = await browser.newContext();
  // Tombol klaim membuka wa.me lewat window.open sesudah action-nya sukses.
  // Tanpa ini, tab baru itu mencoba memuat situs luar dan menggantung di mesin
  // tanpa jaringan — kegagalan yang tidak ada hubungannya dengan yang diuji.
  await context.route("https://wa.me/**", (r) => r.abort());
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
      (u) =>
        !u.pathname.startsWith("/masuk") && !u.pathname.startsWith("/setelah-masuk"),
      { timeout: 20_000 },
    ),
    page.getByRole("button", { name: "Masuk", exact: true }).click(),
  ]);
  await page.waitForLoadState("networkidle");
  console.log(`      [login ${email}] mendarat di ${page.url()}`);
  await page.close();
  return context;
}

/** Klien supabase-js ber-SESI klien uji: dipakai menembak REST langsung. */
async function sesiKlienRest(): Promise<SupabaseClient> {
  const c = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  const { error } = await c.auth.signInWithPassword({
    email: EMAIL_KLIEN,
    password: PASSWORD,
  });
  if (error) throw new Error(`Gagal login klien uji: ${error.message}`);
  return c;
}

/** uid akun demo, dibaca lewat service role (bukan ditebak dari email). */
async function uidAkun(email: string): Promise<string> {
  const { data } = await admin.auth.admin.listUsers();
  const u = (data?.users ?? []).find((x) => x.email === email);
  if (!u) throw new Error(`Akun ${email} tidak ada — jalankan npm run seed:users.`);
  return u.id;
}

/**
 * Pembersihan lewat service role.
 *
 * Urutannya mengikat:
 *  - `jejak_status_bayar` sengaja TANPA foreign key supaya tidak ikut tersapu
 *    cascade; barisnya harus dihapus MENURUT id sesi/paketnya, dan HARUS
 *    dihapus lebih dulu selagi id itu masih bisa dicari.
 *  - `clients.user_id` menunjuk `auth.users(id)` tanpa `on delete`, jadi akun
 *    auth dihapus paling akhir.
 *  - `materials` menyapu bab & videonya lewat cascade; `services` baru bisa
 *    hilang sesudah sesi, materi, DAN paketnya hilang.
 *  - `client_packages` ikut tersapu saat `clients` dihapus (cascade), tetapi
 *    `sessions.client_package_id` TIDAK bercascade — sesi harus lebih dulu.
 *    `packages` sendiri tidak bercascade dari `services`: barisnya dihapus
 *    manual, dan baru bisa sesudah tidak ada `client_packages` yang menunjuk.
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
    const { data: paket } = await admin
      .from("client_packages")
      .select("id")
      .eq("client_id", k.id);
    for (const p of paket ?? []) {
      await admin.from("jejak_status_bayar").delete().eq("paket_klien_id", p.id);
    }
    await admin.from("sessions").delete().eq("client_id", k.id);
    await admin.from("clients").delete().eq("id", k.id);
  }

  const { data: layanan } = await admin
    .from("services")
    .select("id")
    .like("nama", `${PENANDA_ISI}%`);
  for (const l of layanan ?? []) {
    await admin.from("materials").delete().eq("service_id", l.id);
    await admin.from("service_rates").delete().eq("service_id", l.id);
    await admin.from("packages").delete().eq("service_id", l.id);
    await admin.from("services").delete().eq("id", l.id);
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

  // Nilai setelan semula — dikembalikan di `finally`. Dibaca SEBELUM apa pun
  // diubah: kalau skrip mati di tengah, inilah satu-satunya pegangan pemulihan.
  const { data: setelanAwal } = await admin.from("app_settings").select("key, value");
  const semula = new Map((setelanAwal ?? []).map((b) => [b.key as string, b.value as string]));

  const browser = await chromium.launch();
  let idSesiUji = "";
  // Dideklarasikan DI LUAR `try`: pemeriksaan "tidak ada jejak yatim" di bawah
  // baru bermakna kalau id-nya masih terpegang sesudah barisnya dihapus.
  let idSesiPaket = "";
  let idPaketKlien = "";
  try {
    // =============== FIXTURE (service role — bukan bagian yang diuji) ========
    const { data: layananUji, error: eLayanan } = await admin
      .from("services")
      .insert({ phase_id: FASE, nama: NAMA_LAYANAN, deskripsi: "fixture E2E", aktif: true })
      .select("id")
      .single();
    if (eLayanan) throw eLayanan;

    const { data: userBaru, error: eUser } = await admin.auth.admin.createUser({
      email: EMAIL_KLIEN,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: NAMA_KLIEN },
    });
    if (eUser) throw eUser;
    const UID_KLIEN = userBaru.user!.id;

    const { data: klienUji, error: eKlien } = await admin
      .from("clients")
      .insert({
        padma_id: PADMA_ID,
        nama: NAMA_KLIEN,
        email: EMAIL_KLIEN,
        no_hp: "0899-0000-0002",
        phase_id: FASE,
        user_id: UID_KLIEN,
        linked_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (eKlien) throw eKlien;

    // Satu sesi SELESAI & BELUM dibayar: ia sekaligus tagihan (sesi lepas) dan
    // dasar hak baca materi layanan itu.
    const { data: sesiUji, error: eSesi } = await admin
      .from("sessions")
      .insert({
        client_id: klienUji.id,
        service_id: layananUji.id,
        partner_id: MITRA_SEED,
        tanggal: TANGGAL_SESI,
        status: "selesai",
        status_bayar: "belum",
      })
      .select("id")
      .single();
    if (eSesi) throw eSesi;
    idSesiUji = sesiUji.id as string;

    // --- Fixture "tagihan hantu" ------------------------------------------
    // Satu paket LUNAS berisi satu sesi. Sesi anggota paket tidak pernah
    // memikul tagihannya sendiri (constraint `sessions_bayar_hanya_lepas`
    // memaksa status_bayar-nya tetap 'belum'), sehingga saringan naif
    // `status_bayar <> 'lunas'` akan memungutnya sebagai tagihan yang sudah
    // dibayar dua kali. Fixture ini ada supaya ketidakhadirannya di
    // /admin/bayar benar-benar diuji, bukan diasumsikan.
    const { data: paketUji, error: ePaket } = await admin
      .from("packages")
      .insert({ service_id: layananUji.id, nama: NAMA_PAKET, jumlah_sesi: 3, aktif: true })
      .select("id")
      .single();
    if (ePaket) throw ePaket;

    // status_bayar sengaja dibiarkan default 'belum' lalu DIUBAH: INSERT
    // dengan status ≠ 'belum' ditolak `guard_insert_status_bayar` (42501),
    // sedangkan transisi 'belum' -> 'lunas' memang jalur yang sah.
    const { data: paketKlien, error: ePaketKlien } = await admin
      .from("client_packages")
      .insert({ client_id: klienUji.id, package_id: paketUji.id, status: "aktif" })
      .select("id")
      .single();
    if (ePaketKlien) throw ePaketKlien;
    idPaketKlien = paketKlien.id as string;
    const { error: eLunasPaket } = await admin
      .from("client_packages")
      .update({ status_bayar: "lunas" })
      .eq("id", paketKlien.id);
    if (eLunasPaket) throw eLunasPaket;

    const { data: sesiPaket, error: eSesiPaket } = await admin
      .from("sessions")
      .insert({
        client_id: klienUji.id,
        service_id: layananUji.id,
        partner_id: MITRA_SEED,
        client_package_id: paketKlien.id,
        tanggal: TANGGAL_SESI_PAKET,
        status: "terjadwal",
        status_bayar: "belum",
      })
      .select("id")
      .single();
    if (eSesiPaket) throw eSesiPaket;
    idSesiPaket = sesiPaket.id as string;

    const { data: materiUji, error: eMateri } = await admin
      .from("materials")
      .insert({
        service_id: layananUji.id,
        judul: JUDUL_MATERI,
        tipe: "ebook",
        deskripsi: "fixture E2E",
        aktif: true,
      })
      .select("id")
      .single();
    if (eMateri) throw eMateri;
    await admin.from("material_chapters").insert([
      { material_id: materiUji.id, urutan: 1, judul: `${PENANDA_ISI} Bab 1`, isi: "isi bab satu" },
      { material_id: materiUji.id, urutan: 2, judul: `${PENANDA_ISI} Bab 2`, isi: "isi bab dua" },
    ]);

    const restKlien = await sesiKlienRest();
    const UID_ADMIN = await uidAkun("admin@padma.test");

    // Jejak yang lahir dari fixture (INSERT sesi) sengaja diabaikan: yang
    // dihitung di bawah selalu jejak SESUDAH cap waktu ini.
    const sejak = new Date().toISOString();

    // =============== 1. Klien mengklaim sudah bayar =========================
    const ctxKlien = await login(browser, EMAIL_KLIEN);
    const halamanKlien = await ctxKlien.newPage();
    await halamanKlien.goto(`${BASE}/passport/bayar`, { waitUntil: "networkidle" });

    const barisPassport = halamanKlien.locator("[data-tagihan]");
    const barisSesiLepas = barisPassport.filter({ hasText: NAMA_LAYANAN });
    catat(
      "1a. tagihan sesi lepas muncul sebagai Belum dibayar",
      (await barisSesiLepas.count()) === 1 &&
        (await barisSesiLepas.getAttribute("data-tagihan")) === "belum",
      `isi: ${(await teksTerlihat(halamanKlien)).slice(0, 140)}`,
    );

    // Sisi klien dari pagar yang sama: passport memuat PAKETNYA, bukan sesi
    // anggotanya. Dua item, bukan tiga — kalau sesi berpaket ikut terdaftar,
    // klien akan ditagih untuk sesuatu yang paketnya sudah melunasi.
    catat(
      "1a2. sesi anggota paket tidak menjadi tagihan terpisah di passport klien",
      (await barisPassport.count()) === 2 &&
        (await barisPassport.filter({ hasText: NAMA_PAKET }).count()) === 1,
      `${await barisPassport.count()} baris tagihan (paket + sesi lepas)`,
    );

    await halamanKlien
      .getByRole("button", { name: /Saya sudah bayar/i })
      .click();
    await halamanKlien
      .locator('[data-tagihan="menunggu_verifikasi"]')
      .waitFor({ state: "visible", timeout: 20_000 });

    const { data: sesudahKlaim } = await admin
      .from("sessions")
      .select("status_bayar")
      .eq("id", idSesiUji)
      .single();
    catat(
      "1b. klaim klien berhenti di menunggu_verifikasi — TIDAK PERNAH lunas",
      sesudahKlaim!.status_bayar === "menunggu_verifikasi",
      `status_bayar: ${sesudahKlaim!.status_bayar}`,
    );

    const { data: jejakKlaim } = await admin
      .from("jejak_status_bayar")
      .select("status_lama, status_baru, aktor_id, peran_aktor, dicatat_pada")
      .eq("sesi_id", idSesiUji)
      .gt("dicatat_pada", sejak)
      .order("dicatat_pada");
    catat(
      "1c. jejak klaim menyebut KLIEN itu sendiri, bukan service_role",
      (jejakKlaim ?? []).length === 1 &&
        jejakKlaim![0].peran_aktor === "klien" &&
        jejakKlaim![0].aktor_id === UID_KLIEN &&
        jejakKlaim![0].status_baru === "menunggu_verifikasi",
      `peran_aktor: ${jejakKlaim?.[0]?.peran_aktor}; aktor_id cocok: ${
        jejakKlaim?.[0]?.aktor_id === UID_KLIEN
      }`,
    );

    // =============== 2. Item masuk antrean admin ============================
    const ctxAdmin = await login(browser, "admin@padma.test");
    const kerja = await ctxAdmin.newPage();
    await kerja.goto(`${BASE}/admin`, { waitUntil: "networkidle" });

    // Angka dibaca dari kartu dashboard, BUKAN dihitung ulang di skrip ini:
    // yang diuji justru apakah angka yang dilihat admin sama dengan pekerjaan
    // yang benar-benar bisa ia selesaikan.
    const kartuKlaim = kerja.locator('a[href="/admin/bayar"]', {
      hasText: "Klaim pembayaran",
    });
    const angkaBadge = Number((await kartuKlaim.innerText()).match(/\d+/)?.[0] ?? -1);
    catat(
      "2a. kartu 'Klaim pembayaran' di /admin menyalakan angka (badge menyala)",
      angkaBadge >= 1,
      `angka kartu: ${angkaBadge}`,
    );

    // Ditekan, bukan di-goto: kartu yang tidak bisa diklik adalah alarm yang
    // tidak punya tujuan — keadaan yang sempat nyata selama modulnya belum ada.
    await Promise.all([
      kerja.waitForURL(`${BASE}/admin/bayar`, { timeout: 20_000 }),
      kartuKlaim.click(),
    ]);
    await kerja.waitForLoadState("networkidle");

    const barisTagihan = kerja.locator(`[data-item="sesi:${idSesiUji}"]`);
    catat(
      "2b. tagihan itu muncul di antrean admin dengan status menunggu_verifikasi",
      (await barisTagihan.count()) === 1 &&
        (await barisTagihan.getAttribute("data-status")) === "menunggu_verifikasi" &&
        memuat(await barisTagihan.innerText(), PADMA_ID),
      (await barisTagihan.innerText()).replace(/\s+/g, " "),
    );

    // Inti pagar "tagihan hantu": sesi anggota paket TIDAK boleh punya baris
    // sendiri, sementara PAKETNYA memang punya. Keduanya diperiksa bersama —
    // memeriksa ketidakhadiran saja akan hijau juga bila seluruh fixture gagal
    // terbaca.
    catat(
      "2c. sesi anggota paket TIDAK punya baris tagihan sendiri (tanpa hantu)",
      (await kerja.locator(`[data-item="sesi:${idSesiPaket}"]`).count()) === 0 &&
        (await kerja.locator(`[data-item="paket:${paketKlien.id}"]`).count()) === 1,
      `baris sesi berpaket: ${await kerja
        .locator(`[data-item="sesi:${idSesiPaket}"]`)
        .count()}; baris paketnya: ${await kerja
        .locator(`[data-item="paket:${paketKlien.id}"]`)
        .count()}`,
    );

    // Badge yang tidak sama dengan daftarnya adalah alarm yang tidak bisa
    // dibersihkan: admin menekan setiap tombol yang ada lalu angkanya tetap
    // menyala. Angka kartu dibandingkan dengan baris yang benar-benar
    // menunggu verifikasi di halaman ini.
    const barisMenunggu = await kerja
      .locator('[data-item][data-status="menunggu_verifikasi"]')
      .count();
    catat(
      "2d. angka badge sama persis dengan jumlah baris menunggu_verifikasi",
      angkaBadge === barisMenunggu,
      `badge ${angkaBadge} vs baris ${barisMenunggu}`,
    );

    catat(
      "2e. tidak ada nominal rupiah di antrean pembayaran (money firewall)",
      !/Rp\s?\d/.test(await teksTerlihat(kerja)),
      "hanya status & label item, tanpa angka uang",
    );

    // =============== 3. Admin menandai lunas — INTI SKRIP INI ===============
    const sebelumLunas = new Date().toISOString();
    await barisTagihan.getByRole("button", { name: "Tandai lunas" }).click();
    await kerja
      .locator(`[data-item="sesi:${idSesiUji}"][data-status="lunas"]`)
      .waitFor({ state: "visible", timeout: 20_000 });

    const { data: sesudahLunas } = await admin
      .from("sessions")
      .select("status_bayar")
      .eq("id", idSesiUji)
      .single();
    catat(
      "3a. status pembayaran sesi menjadi lunas",
      sesudahLunas!.status_bayar === "lunas",
      `status_bayar: ${sesudahLunas!.status_bayar}`,
    );

    const { data: jejakLunas } = await admin
      .from("jejak_status_bayar")
      .select("status_lama, status_baru, aktor_id, peran_aktor")
      .eq("sesi_id", idSesiUji)
      .gt("dicatat_pada", sebelumLunas);
    const j = (jejakLunas ?? [])[0];
    catat(
      "3b. JEJAK KEPUTUSAN UANG menyebut peran_aktor 'admin' (bukan service_role)",
      (jejakLunas ?? []).length === 1 &&
        j.peran_aktor === "admin" &&
        j.status_lama === "menunggu_verifikasi" &&
        j.status_baru === "lunas",
      `peran_aktor: ${j?.peran_aktor}; ${j?.status_lama} -> ${j?.status_baru}`,
    );
    catat(
      "3c. aktor_id-nya adalah AKUN ADMIN yang benar-benar menekan tombolnya",
      j?.aktor_id === UID_ADMIN,
      `aktor_id: ${String(j?.aktor_id)} (admin@padma.test = ${UID_ADMIN})`,
    );

    // =============== 4. Klien melihat hasilnya ==============================
    await halamanKlien.goto(`${BASE}/passport/bayar`, { waitUntil: "networkidle" });
    // Baris DIPILIH menurut labelnya, bukan menurut statusnya: paket fixture
    // juga berstatus lunas, sehingga menghitung `[data-tagihan="lunas"]` saja
    // akan hijau bahkan bila keputusan admin tidak pernah sampai ke klien.
    const barisSesiSesudah = halamanKlien
      .locator("[data-tagihan]")
      .filter({ hasText: NAMA_LAYANAN });
    catat(
      "4a. passport klien menampilkan item itu sebagai Lunas",
      (await barisSesiSesudah.count()) === 1 &&
        (await barisSesiSesudah.getAttribute("data-tagihan")) === "lunas" &&
        memuat(await barisSesiSesudah.innerText(), "Lunas"),
      `isi: ${(await barisSesiSesudah.innerText()).replace(/\s+/g, " ")}`,
    );
    catat(
      "4b. tombol klaim tidak lagi ditawarkan untuk item yang sudah lunas",
      (await halamanKlien.getByRole("button", { name: /Saya sudah bayar/i }).count()) === 0,
      "tombol klaim hilang sesudah lunas",
    );

    // =============== 5. Pengaturan merambat ke halaman publik ===============
    await kerja.goto(`${BASE}/admin/pengaturan`, { waitUntil: "networkidle" });
    for (const [kunci, nilai] of [
      ["nomor_wa", WA_UJI],
      ["alamat_klinik", ALAMAT_UJI],
      ["jam_operasional", JAM_UJI],
    ] as const) {
      const kartu = kerja.locator(`form[data-kunci="${kunci}"]`);
      await kartu.locator('input[name="nilai"]').fill(nilai);
      await kartu.getByRole("button", { name: "Simpan" }).click();
      await kartu
        .getByText("Tersimpan. Halaman publik sudah memakai nilai baru.")
        .waitFor({ state: "visible", timeout: 20_000 });
    }

    const { data: setelanBaru } = await admin
      .from("app_settings")
      .select("key, value")
      .in("key", ["nomor_wa", "alamat_klinik", "jam_operasional"]);
    const peta = new Map((setelanBaru ?? []).map((b) => [b.key as string, b.value as string]));
    catat(
      "5a. ketiga setelan tersimpan lewat panel",
      peta.get("nomor_wa") === WA_UJI &&
        peta.get("alamat_klinik") === ALAMAT_UJI &&
        peta.get("jam_operasional") === JAM_UJI,
      `nomor_wa=${peta.get("nomor_wa")}`,
    );

    // Pengunjung ANONIM, bukan tab admin: yang diuji adalah halaman publiknya.
    const ctxTamu = await browser.newContext();
    const tamu = await ctxTamu.newPage();
    await tamu.goto(`${BASE}/skrining`, { waitUntil: "networkidle" });
    const htmlSkrining = await tamu.content();
    const waLama = semula.get("nomor_wa") ?? "";
    // Yang dicari adalah NOMORNYA, bukan `wa.me/<nomor>`: tautan WhatsApp di
    // wizard baru dirakit pada LANGKAH TERAKHIR (komponen "use client"), jadi
    // muatan awal halaman hanya membawa nomor itu sebagai prop `nomorWaLink`.
    // Justru prop itulah yang dipanggang ke `.next/server/app/skrining.rsc`
    // saat build — sumber kegagalan senyap yang membuat `revalidatePath
    // ("/skrining")` wajib ada di server action-nya.
    catat(
      "5b. nomor WA baru merambat ke wizard /skrining (bukan nomor lama)",
      htmlSkrining.includes(WA_UJI) && (waLama === "" || !htmlSkrining.includes(waLama)),
      `${WA_UJI} ${htmlSkrining.includes(WA_UJI) ? "ada" : "TIDAK ada"}; nomor lama ${waLama} ${
        htmlSkrining.includes(waLama) ? "MASIH ada" : "sudah hilang"
      }`,
    );

    await tamu.goto(`${BASE}/`, { waitUntil: "networkidle" });
    const htmlLanding = await tamu.content();
    catat(
      "5b2. CTA WhatsApp landing memakai nomor baru (href, bukan sekadar payload)",
      htmlLanding.includes(`https://wa.me/${WA_UJI}`),
      `https://wa.me/${WA_UJI} ${
        htmlLanding.includes(`https://wa.me/${WA_UJI}`) ? "terbit" : "TIDAK terbit"
      } di landing`,
    );
    const teksLanding = await teksTerlihat(tamu);
    catat(
      "5c. alamat & jam operasional benar-benar tampil di footer landing",
      memuat(teksLanding, ALAMAT_UJI) && memuat(teksLanding, JAM_UJI),
      `alamat: ${memuat(teksLanding, ALAMAT_UJI)}; jam: ${memuat(teksLanding, JAM_UJI)}`,
    );
    catat(
      "5d. footer tidak lagi menampilkan alamat yang ditulis keras",
      !memuat(teksLanding, "Melayani area Jabodetabek"),
      memuat(teksLanding, "Melayani area Jabodetabek")
        ? "teks lama masih terpampang"
        : "alamat sepenuhnya datang dari app_settings",
    );
    await ctxTamu.close();

    // =============== 6. Nonaktifkan materi menutup ISI-nya ==================
    const bacaBab = async () =>
      (await restKlien.from("material_chapters").select("id").eq("material_id", materiUji.id))
        .data ?? [];

    catat(
      "6a. klien berhak membaca bab materi itu sebelum dinonaktifkan",
      (await bacaBab()).length === 2,
      `${(await bacaBab()).length} bab terbaca lewat REST`,
    );

    await kerja.goto(`${BASE}/admin/materi`, { waitUntil: "networkidle" });
    const kartuMateri = kerja.locator("li", { hasText: JUDUL_MATERI }).first();
    // `exact: true` MENGIKAT: pencocokan nama getByRole bawaan Playwright adalah
    // SUBSTRING tanpa peduli huruf besar/kecil, sehingga { name: "Aktifkan" }
    // ikut mencocoki tombol "NonAKTIFKAN" yang masih terpampang. Tanpa `exact`,
    // `waitFor` di bawah selesai SEKETIKA pada tombol lama — dan pemeriksaan
    // berikutnya membaca basis data sebelum server action-nya mendarat, lalu
    // melapor "2 bab masih terbaca" seolah gating materi jebol. Kegagalan
    // harness yang menyamar sebagai temuan keamanan.
    await kartuMateri.getByRole("button", { name: "Nonaktifkan", exact: true }).click();
    await kartuMateri
      .getByRole("button", { name: "Aktifkan", exact: true })
      .waitFor({ state: "visible", timeout: 20_000 });

    // Lapis kedua supaya selektor yang salah sasaran tidak pernah bisa membuat
    // pemeriksaan di bawah "hijau karena tidak terjadi apa-apa".
    const { data: metaNonaktif } = await admin
      .from("materials")
      .select("aktif")
      .eq("id", materiUji.id)
      .single();
    catat(
      "6b0. panel benar-benar menulis aktif=false (bukan sekadar tombol berganti)",
      metaNonaktif!.aktif === false,
      `materials.aktif: ${String(metaNonaktif!.aktif)}`,
    );

    const babSesudah = await bacaBab();
    catat(
      "6b. materi nonaktif menutup ISI-nya lewat REST, bukan sekadar UI",
      babSesudah.length === 0,
      `${babSesudah.length} bab terbaca klien sesudah dinonaktifkan`,
    );

    const { data: metaMateri } = await restKlien
      .from("materials")
      .select("id")
      .eq("id", materiUji.id);
    catat(
      "6c. baris materi-nya TETAP terbaca klien (menghindari bug partner_publik)",
      (metaMateri ?? []).length === 1,
      "metadata materi tidak ikut menghilang dari riwayat",
    );

    await kartuMateri.getByRole("button", { name: "Aktifkan", exact: true }).click();
    await kartuMateri
      .getByRole("button", { name: "Nonaktifkan", exact: true })
      .waitFor({ state: "visible", timeout: 20_000 });
    catat(
      "6d. materi yang diaktifkan kembali membuka isinya lagi",
      (await bacaBab()).length === 2,
      `${(await bacaBab()).length} bab terbaca lagi`,
    );
  } finally {
    await browser.close();

    // Setelan dikembalikan PERSIS: nomor WA menggerakkan seluruh CTA aplikasi,
    // dan run berikutnya (serta suite vitest) meng-assert nilai seed-nya.
    for (const kunci of ["nomor_wa", "alamat_klinik", "jam_operasional"]) {
      const nilai = semula.get(kunci);
      if (nilai === undefined) {
        await admin.from("app_settings").delete().eq("key", kunci);
      } else {
        await admin.from("app_settings").upsert({ key: kunci, value: nilai }, { onConflict: "key" });
      }
    }
    if (idSesiUji) await admin.from("jejak_status_bayar").delete().eq("sesi_id", idSesiUji);
    if (idSesiPaket) await admin.from("jejak_status_bayar").delete().eq("sesi_id", idSesiPaket);
    if (idPaketKlien) {
      await admin.from("jejak_status_bayar").delete().eq("paket_klien_id", idPaketKlien);
    }
    await bersihkan();
  }

  // ================= 7. Pembersihan wajib benar-benar bersih ===============
  const { data: sisaKlien } = await admin
    .from("clients")
    .select("id")
    .like("email", `${PENANDA}%`);
  const { data: sisaLayanan } = await admin
    .from("services")
    .select("id")
    .like("nama", `${PENANDA_ISI}%`);
  const { data: daftarUser } = await admin.auth.admin.listUsers();
  const sisaUser = (daftarUser?.users ?? []).filter((u) =>
    (u.email ?? "").startsWith(PENANDA),
  );
  // Ketiga sasaran diperiksa terpisah: `jejak_status_bayar` sengaja TANPA
  // foreign key supaya tidak ikut tersapu cascade, jadi tidak ada satu pun
  // penghapusan induk yang membuktikan barisnya hilang. Jejak paket menempel di
  // kolom LAIN (`paket_klien_id`) — memeriksa `sesi_id` saja akan hijau sambil
  // meninggalkan baris yatim setiap kali skrip ini berjalan.
  // id kosong disaring lebih dulu: `sesi_id.eq.` tanpa nilai adalah uuid tidak
  // sah dan PostgREST menjawabnya 400, sehingga `jejakYatim` menjadi null dan
  // pemeriksaannya lolos PALSU justru pada run yang mati di tengah fixture.
  const sasaranJejak = [
    ...(idSesiUji ? [`sesi_id.eq.${idSesiUji}`] : []),
    ...(idSesiPaket ? [`sesi_id.eq.${idSesiPaket}`] : []),
    ...(idPaketKlien ? [`paket_klien_id.eq.${idPaketKlien}`] : []),
  ];
  const { data: jejakYatim, error: eJejakYatim } = sasaranJejak.length
    ? await admin.from("jejak_status_bayar").select("id").or(sasaranJejak.join(","))
    : { data: [], error: null };
  if (eJejakYatim) throw eJejakYatim;

  catat(
    "7a. seluruh data uji terhapus, termasuk jejak yang tidak ikut cascade",
    (sisaKlien ?? []).length === 0 &&
      (sisaLayanan ?? []).length === 0 &&
      sisaUser.length === 0 &&
      (jejakYatim ?? []).length === 0,
    `klien ${(sisaKlien ?? []).length}, layanan ${(sisaLayanan ?? []).length}, akun ${sisaUser.length}, jejak ${(jejakYatim ?? []).length}`,
  );

  const { data: setelanAkhir } = await admin
    .from("app_settings")
    .select("key, value")
    .order("key");
  catat(
    "7b. app_settings kembali persis seperti sebelum skrip berjalan",
    JSON.stringify(
      (setelanAkhir ?? []).map((b) => [b.key, b.value]),
    ) === JSON.stringify([...semula.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    JSON.stringify((setelanAkhir ?? []).map((b) => `${b.key}=${b.value}`)),
  );

  const gagal = hasil.filter((h) => !h.lolos);
  console.log(`\n${hasil.length - gagal.length}/${hasil.length} pemeriksaan lolos.`);
  if (gagal.length > 0) {
    console.error("GAGAL:\n" + gagal.map((g) => `  - ${g.nama}`).join("\n"));
    process.exit(1);
  }
  console.log(
    "Rantai pelengkap terbukti utuh: klaim → verifikasi admin (jejak beraktor nyata) → passport klien → pengaturan → gating materi.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
