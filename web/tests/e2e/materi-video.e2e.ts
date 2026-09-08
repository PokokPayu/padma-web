/**
 * E2E RANTAI PENUH VIDEO R2 (Task 8) — satu-satunya pembuktian bahwa Task 1-7
 * tersambung MENJADI SATU rantai lewat peramban & server sungguhan: unggahan
 * presigned dari peramban admin, gating RLS pada penerbitan URL tonton, dan
 * bucket yang benar-benar tertutup tanpa tanda tangan.
 *
 * Yang dibuktikan, berurutan:
 *   1. Admin membuat materi video lewat panel admin (form "Materi baru"),
 *      lalu mengunggah berkasnya lewat `<PengunggahVideo/>` — PUT presigned
 *      langsung dari peramban ke R2, tanpa berkas pernah singgah di server.
 *   2. `material_videos` BENAR-BENAR tercatat dengan kunci objek berbentuk
 *      `{materiId}/{apa saja}.mp4` dan MIME yang cocok — bukan cuma pesan
 *      "Video tersimpan." di panel.
 *   3. Pasien yang DITUGASKAN menerima presigned GET (RLS `berhak_isi_materi`
 *      mengizinkan) — bukan sekadar 200, tapi URL R2 sungguhan.
 *   4. URL itu TIDAK PERNAH muncul di HTML yang dikirim SERVER (respons
 *      navigasi asli, setara "view-source") — beda dari DOM peramban sesudah
 *      hidrasi, lihat catatan di bawah kenapa keduanya tidak sama.
 *   5. Objek R2 itu sendiri ditolak bila diambil TANPA tanda tangan — bucket
 *      benar-benar privat, bukan privat "menurut aplikasi saja".
 *   6. Pasien TANPA penugasan menerima 403 dan tidak pernah menerima URL.
 *   7. Seluruh baris uji & objek R2 bersih kembali sesudah skrip selesai.
 *
 * Prasyarat: `npx supabase start`, `npm run seed:users`, `npm run dev`,
 * dan kredensial R2 di `.env.local`.
 * Jalankan: `npm run test:e2e:video`.
 *
 * Sengaja BUKAN file *.test.ts agar `npm test` (vitest) tetap bisa jalan tanpa
 * server dev & peramban.
 *
 * PENYIMPANGAN DARI DRAF BRIEF (dicatat di sini, dengan rinciannya):
 *  - `idKlien()` diperbaiki: `clients.email` adalah kolom LANGSUNG (unique,
 *    lihat `supabase/migrations/20260828094716_init_schema.sql`), bukan lewat
 *    join `profiles` (yang tidak punya kolom email sama sekali, dan draf lama
 *    mengabaikan parameter `email`-nya — `limit(1)` polos akan mendarat di
 *    klien PERTAMA apa pun, bukan klien yang diminta).
 *  - [Diperbarui sesudah sapuan panel staf, rencana 2] Navigasi ke
 *    `/admin/materi/${materiId}` kini BENAR: isi materi hidup di halaman
 *    DETAIL dan Kartu "Isi" SELALU tampil di sana, tanpa gerbang (lihat
 *    dokblok `AksiMateri` di form-materi.tsx). Bullet ini semula (Task 8)
 *    mencatat sebaliknya — "rute itu tidak ada", dikelola inline lewat
 *    "Kelola isi" pada kartu daftar — yang sudah tidak berlaku; diperbaiki di
 *    sini persis pola `tests/e2e/materi-pdf.e2e.ts`.
 *  - [Diperbarui sesudah sapuan panel staf, rencana 2] Klik "+ Materi baru"
 *    kini menautkan ke `?ubah=baru`, BUKAN tombol yang membuka formulir
 *    inline "mulai TERTUTUP": keadaan panel hidup di URL sejak sapuan itu, dan
 *    gerbang kedua di dalam formulirnya sendiri dibuang commit `747d330`.
 *    Bullet ini semula mencatat perilaku pra-sapuan; diperbaiki supaya tidak
 *    berkontradiksi dengan kode di bawah.
 *  - Pemeriksaan 4 (URL tidak muncul di HTML) TIDAK memakai `page.content()`.
 *    `<PemutarVideo/>` menugaskan `video.src = url` sesudah hidup — dan `src`
 *    elemen media adalah atribut IDL yang MEREFLEKSI, jadi `page.content()`
 *    (yang membaca DOM HIDUP, persis panel Elements DevTools) akan tetap
 *    memuat URL-nya begitu efek komponen selesai jalan, tidak peduli seberapa
 *    cepat pemeriksaan dijalankan — ini diakui eksplisit di komentar
 *    `pemutar-video.tsx` sendiri. Yang benar-benar dijanjikan kode adalah
 *    "tidak muncul di view-source (Ctrl+U)" — yaitu BADAN RESPONS NAVIGASI
 *    ASLI dari server, sebelum JS apa pun jalan. Diganti dengan
 *    `context.request.get()` (pola `ambilHalaman` di materi-pdf.e2e.ts):
 *    memakai cookie sesi yang sama tanpa menjalankan satu baris JS pun,
 *    sehingga mengukur PERSIS apa yang dikirim server, bukan DOM sesudahnya.
 *  - Pemeriksaan 3 & 6 dipindah dari `page.evaluate(fetch(...))` ke
 *    `context.request.get()` untuk alasan yang sama (dan konsisten dengan
 *    `materi-pdf.e2e.ts`) — tidak ada bagian pemeriksaan ini yang butuh DOM
 *    peramban sungguhan, hanya sesi login sungguhan.
 *  - Rina TIDAK otomatis bisa login: ia sengaja disemai BELUM tertaut & tanpa
 *    akun auth (bahan test aktivasi, lihat `scripts/seed-users.ts`), dan
 *    `test:e2e:semua` menjalankan `access-matrix.e2e.ts` lebih dulu yang
 *    mengembalikannya ke keadaan itu di akhir. Skrip ini karena itu memakai
 *    `keadaanRina()`/`pastikanRinaBisaLogin()`/`pulihkanRina()` — DISALIN dari
 *    `materi-pdf.e2e.ts`, yang sudah memecahkan masalah persis ini — supaya
 *    Rina bisa login sesaat lalu keadaannya dikembalikan PERSIS di akhir.
 *  - Pembersihan disederhanakan jadi SATU fungsi `bersihkan()` yang menyapu
 *    lewat pola judul (bukan mengingat objek satu-per-satu): `materials` FK
 *    `material_videos`/`material_assignments` sama-sama `on delete cascade`
 *    (lihat `20260828105934_gate_material_video.sql` &
 *    `20260831110000_materi_penugasan.sql`), jadi menghapus baris `materials`
 *    sudah cukup untuk baris DB; objek R2-nya (bukan baris Postgres, tidak
 *    ikut cascade) disapu terpisah lewat `ListObjectsV2`+`DeleteObjects` per
 *    prefix `{materiId}/`. Dipanggil di AWAL (menyapu sisa run yang mati di
 *    tengah) maupun di `finally`.
 */
import { config } from "dotenv";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { createClient } from "@supabase/supabase-js";
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { tungguIsi } from "./_tunggu";

config({ path: [".env.local", ".env"] });

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const SANDI = "padma-dev-123";

// Spec §11: skrip video MELEWATKAN DIRINYA bila kredensial R2 tidak ada,
// supaya `test:e2e:semua` tetap hijau di mesin tanpa akun Cloudflare.
const R2 = {
  akun: process.env.R2_ACCOUNT_ID ?? "",
  kunci: process.env.R2_ACCESS_KEY_ID ?? "",
  rahasia: process.env.R2_SECRET_ACCESS_KEY ?? "",
  bucket: process.env.R2_BUCKET_VIDEO ?? "",
};
if (!R2.akun || !R2.kunci || !R2.rahasia || !R2.bucket) {
  console.log(
    "DILEWATI: kredensial R2 tidak lengkap di .env.local " +
      "(R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_VIDEO).",
  );
  process.exit(0);
}

const PENANDA = "E2E-VIDEO-R2";
const stempel = Date.now();
const JUDUL = `${PENANDA} ${stempel}`;

const EMAIL_ADMIN = "admin@padma.test";
const EMAIL_ANANDA = "ananda@padma.test";
const EMAIL_RINA = "rina@padma.test";
// id `clients`, bukan `auth.users` — dari scripts/seed-users.ts. Hanya dipakai
// oleh dance keadaan-Rina di bawah, BUKAN oleh idKlien() (yang sengaja query
// basis data, bukan menghardcode id — itulah tepatnya yang diminta task ini).
const RINA_CLIENT_ID = "44444444-4444-4444-4444-444444444402";

const svc = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

function klienR2(): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${R2.akun}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2.kunci, secretAccessKey: R2.rahasia },
  });
}

type Hasil = { nama: string; lolos: boolean; bukti: string };
const hasil: Hasil[] = [];
function catat(nama: string, lolos: boolean, bukti: string) {
  hasil.push({ nama, lolos, bukti });
  console.log(`${lolos ? "PASS" : "FAIL"}  ${nama}\n      ${bukti}`);
}

/**
 * Disalin PERSIS dari `tests/e2e/materi-pdf.e2e.ts` — termasuk `networkidle`
 * dan penjaga hidrasinya. Form masuk adalah controlled component: isian yang
 * ditulis sebelum React hydrate akan TERHAPUS, dan gejalanya bukan galat
 * melainkan login yang gagal secara acak.
 */
async function login(browser: Browser, email: string): Promise<BrowserContext> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE}/masuk`, { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Kata sandi").fill(SANDI);
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
  await page.close();
  return context;
}

/**
 * MP4 kecil yang STRUKTURNYA sah (ftyp + moov di depan + mdat) tetapi tidak
 * bisa didekode menjadi gambar. Cukup untuk membuktikan rantai PENYIMPANAN —
 * unggah, gating, penyajian — dan sengaja tidak berpura-pura membuktikan
 * pemutaran, yang menuntut encoder sungguhan.
 */
function buatMp4Uji(): Buffer {
  const box = (tipe: string, isi: Buffer) => {
    const h = Buffer.alloc(8);
    h.writeUInt32BE(8 + isi.length, 0);
    h.write(tipe, 4, "ascii");
    return Buffer.concat([h, isi]);
  };
  return Buffer.concat([
    box("ftyp", Buffer.concat([Buffer.from("isom"), Buffer.from([0, 0, 2, 0]), Buffer.from("isomiso2mp41")])),
    box("moov", Buffer.alloc(128, 1)),
    box("mdat", Buffer.alloc(8192, 7)),
  ]);
}

/**
 * Id `clients` milik `email` — BUKTI: `clients.email` adalah kolom LANGSUNG,
 * unique, ditautkan ke `auth.users` lewat `clients.user_id` (lihat
 * `supabase/migrations/20260828094716_init_schema.sql:58-68` &
 * `scripts/seed-users.ts` yang menulis `email: "ananda@padma.test"` langsung
 * ke baris `clients`). Diverifikasi manual sebelum skrip ini dijalankan:
 *   psql -c "select id, email, user_id from clients where email = ..."
 *   -> 44444444-4444-4444-4444-444444444401 | ananda@padma.test | <uuid>
 * Draf awal fungsi ini melakukan `clients.select("id, profiles!inner(id)").limit(1)`
 * — `profiles` tidak punya kolom email sama sekali (email hidup di
 * `auth.users`, hanya DISALIN ke `clients.email`), dan parameter `email` tidak
 * pernah dipakai memfilter apa pun: query itu selalu mendarat di klien
 * PERTAMA yang ada, apa pun `email` yang diminta.
 */
async function idKlien(email: string): Promise<string> {
  const { data, error } = await svc
    .from("clients")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (error) throw new Error(`Gagal mencari klien ${email}: ${error.message}`);
  return (data?.id as string | undefined) ?? "";
}

/**
 * Id `profiles`/`auth.users` (sama, `profiles.id` ditulis `= user!.id` di
 * `ensureUser()`, scripts/seed-users.ts) milik staf `email`.
 *
 * Dibutuhkan karena `paksa_aktor_penugasan()` (migration
 * `20260831110000_materi_penugasan.sql`) SENGAJA membiarkan
 * `ditugaskan_oleh` TIDAK diisi ketika `current_user` bukan
 * anon/authenticated/authenticator — persis peran service role yang skrip
 * ini pakai. Itu bukan lubang, itu bagian dari kontraknya: pemanggil non-API
 * (service role/migration/seed) WAJIB mengirim `ditugaskan_oleh` sendiri.
 * Tanpanya, insert ditolak basis data — bukan diam-diam lolos —
 * `not null constraint` pada kolom itu, yang persis ditemukan menjalankan
 * skrip ini pertama kali sebelum fungsi ini ada.
 */
async function idStaf(email: string): Promise<string> {
  const { data, error } = await svc.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw new Error(`Gagal mencari staf ${email}: ${error.message}`);
  const user = (data?.users ?? []).find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) throw new Error(`Staf ${email} tidak ditemukan.`);
  return user.id;
}

/**
 * Menyapu SELURUH materi bertanda `PENANDA` beserta objek R2-nya. Baris
 * `material_videos`/`material_assignments` ikut cascade lewat FK
 * `on delete cascade` (lihat komentar berkas) — hanya objek R2 (bukan baris
 * Postgres) yang perlu disapu manual di sini. Dipanggil di AWAL (menyapu sisa
 * run yang mati di tengah) maupun di `finally`.
 */
async function bersihkan(): Promise<void> {
  const { data: sisa } = await svc
    .from("materials")
    .select("id")
    .like("judul", `${PENANDA}%`);
  if (!sisa || sisa.length === 0) return;

  const s3 = klienR2();
  for (const m of sisa) {
    const id = m.id as string;
    const daftar = await s3.send(
      new ListObjectsV2Command({ Bucket: R2.bucket, Prefix: `${id}/` }),
    );
    const kunci = (daftar.Contents ?? [])
      .map((o) => o.Key)
      .filter((k): k is string => typeof k === "string")
      .map((Key) => ({ Key }));
    if (kunci.length > 0) {
      await s3.send(new DeleteObjectsCommand({ Bucket: R2.bucket, Delete: { Objects: kunci } }));
    }
    await svc.from("materials").delete().eq("id", id);
  }
}

type KeadaanRina = { userId: string | null; linkedAt: string | null; authUserId: string | null };

/** Disalin dari `materi-pdf.e2e.ts` — lihat catatan panjang di sana. */
async function keadaanRina(): Promise<KeadaanRina> {
  const { data: baris } = await svc
    .from("clients")
    .select("user_id, linked_at")
    .eq("id", RINA_CLIENT_ID)
    .single();
  const { data: daftar } = await svc.auth.admin.listUsers({ perPage: 1000 });
  const user = (daftar?.users ?? []).find((u) => u.email?.toLowerCase() === EMAIL_RINA);
  return {
    userId: (baris?.user_id as string | null) ?? null,
    linkedAt: (baris?.linked_at as string | null) ?? null,
    authUserId: user?.id ?? null,
  };
}

async function pastikanRinaBisaLogin(): Promise<void> {
  const { data: daftar } = await svc.auth.admin.listUsers({ perPage: 1000 });
  let user = (daftar?.users ?? []).find((u) => u.email?.toLowerCase() === EMAIL_RINA);
  if (!user) {
    const { data, error } = await svc.auth.admin.createUser({
      email: EMAIL_RINA,
      password: SANDI,
      email_confirm: true,
    });
    if (error) throw error;
    user = data.user;
  }
  const { error } = await svc
    .from("clients")
    .update({ user_id: user!.id, linked_at: new Date().toISOString() })
    .eq("id", RINA_CLIENT_ID);
  if (error) throw error;
}

async function pulihkanRina(semula: KeadaanRina): Promise<void> {
  await svc
    .from("clients")
    .update({ user_id: semula.userId, linked_at: semula.linkedAt })
    .eq("id", RINA_CLIENT_ID);
  if (!semula.authUserId) {
    const { data: daftar } = await svc.auth.admin.listUsers({ perPage: 1000 });
    for (const u of daftar?.users ?? []) {
      if (u.email?.toLowerCase() === EMAIL_RINA) await svc.auth.admin.deleteUser(u.id);
    }
  }
}

async function main() {
  await bersihkan();
  const semulaRina = await keadaanRina();

  const browser = await chromium.launch();
  let materiId = "";

  try {
    // ---- 1. Admin membuat materi video lalu mengunggah berkasnya ----
    const admin = await login(browser, EMAIL_ADMIN);
    const kerja = await admin.newPage();
    await kerja.goto(`${BASE}/admin/materi`, { waitUntil: "networkidle" });

    // "+ Materi baru" kini TAUTAN ke `?ubah=baru`; formulirnya langsung ada di
    // dalam panel. Komentar lama di sini menyebut formulir yang "mulai
    // TERTUTUP" — gerbang itu dibuang Tugas 3 (untuk sesi) dan commit
    // `747d330` (untuk materi & layanan).
    await kerja.getByRole("link", { name: "+ Materi baru" }).click();
    await tungguIsi(kerja);
    await kerja.locator('input[name="judul"]').fill(JUDUL);
    await kerja.locator('select[name="tipe"]').selectOption("video");
    // Nol checkbox layanan dicentang dengan sengaja: materi lahir "Tanpa
    // layanan", terbuka hanya lewat penugasan manual di bawah.
    await kerja.getByRole("button", { name: "Simpan materi", exact: true }).click();
    await kerja.locator('[role="dialog"]').waitFor({ state: "detached", timeout: 20_000 });
    await kerja.getByText(JUDUL).first().waitFor({ timeout: 20_000 });

    const { data: baris } = await svc
      .from("materials").select("id, tipe").eq("judul", JUDUL).maybeSingle();
    materiId = baris?.id ?? "";
    catat(
      "1. materi video dibuat lewat panel admin",
      materiId !== "" && baris?.tipe === "video",
      `id=${materiId} tipe=${String(baris?.tipe)}`,
    );
    if (materiId === "") throw new Error("materi tidak terbentuk");

    // Isi materi hidup di halaman DETAIL, dan Kartu "Isi" SELALU tampil.
    await kerja.getByRole("link", { name: JUDUL }).click();
    await tungguIsi(kerja);
    await kerja
      .locator('input[type="file"][accept="video/mp4,video/webm"]')
      .setInputFiles({ name: "uji.mp4", mimeType: "video/mp4", buffer: buatMp4Uji() });
    // Unggahan (presigned PUT ke R2 dari peramban) + pencatatan baris berjalan
    // sesudah "Simpan materi", di peramban admin sungguhan — inilah rantai
    // yang dibuktikan skrip ini, bukan dipotong lewat service role.
    await kerja.getByText("Video tersimpan.").first().waitFor({ timeout: 60_000 });

    const { data: vid } = await svc
      .from("material_videos").select("objek, mime").eq("material_id", materiId).maybeSingle();
    const objek = vid?.objek ?? "";
    catat(
      "2. baris video tercatat dengan kunci objek & MIME",
      objek.startsWith(`${materiId}/`) && objek.endsWith(".mp4") && vid?.mime === "video/mp4",
      `objek=${objek} mime=${String(vid?.mime)}`,
    );

    // Materi harus ditugaskan & diterbitkan agar pasien uji berhak. Ditulis
    // langsung lewat service role di sini: yang diuji rantai ini adalah
    // gating RLS pada PENYAJIAN video, bukan panel penugasan admin (yang
    // sudah dilatih `materi-pdf.e2e.ts`).
    const idAnanda = await idKlien(EMAIL_ANANDA);
    if (idAnanda === "") throw new Error(`Klien ${EMAIL_ANANDA} tidak ditemukan — periksa seed.`);
    const idAdmin = await idStaf(EMAIL_ADMIN);
    const { error: eAssign } = await svc
      .from("material_assignments")
      .insert({ material_id: materiId, client_id: idAnanda, ditugaskan_oleh: idAdmin });
    if (eAssign) throw new Error(`Gagal menugaskan materi: ${eAssign.message}`);
    const { error: eAktif } = await svc.from("materials").update({ aktif: true }).eq("id", materiId);
    if (eAktif) throw new Error(`Gagal mengaktifkan materi: ${eAktif.message}`);

    // ---- 2. Pasien BERHAK menerima URL ----
    // `context.request`, BUKAN `page.evaluate(fetch(...))`: memakai cookie
    // sesi yang sama tanpa membuka halaman — cukup untuk membuktikan
    // kontrak REST-nya, dan menghindari race dengan efek `<PemutarVideo/>`
    // (lihat pemeriksaan 4 di bawah untuk kenapa itu penting).
    const ananda = await login(browser, EMAIL_ANANDA);
    const rVideo = await ananda.request.get(`${BASE}/api/materi/${materiId}/video`, {
      failOnStatusCode: false,
    });
    const teksVideo = await rVideo.text();
    const urlTonton = rVideo.status() === 200 ? (JSON.parse(teksVideo) as { url: string }).url : "";
    catat(
      "3. pasien berhak menerima presigned URL",
      rVideo.status() === 200 && urlTonton.includes("r2.cloudflarestorage.com"),
      `HTTP ${rVideo.status()}`,
    );

    // ---- 3. URL tidak pernah muncul di HTML yang dikirim SERVER ----
    // BUKAN `page.content()`: itu membaca DOM HIDUP peramban (setara panel
    // Elements DevTools), dan `<PemutarVideo/>` menugaskan `video.src = url`
    // sesudah hidup — `src` elemen media adalah atribut IDL yang MEREFLEKSI,
    // jadi `page.content()` akan memuat URL-nya begitu efek komponen selesai,
    // tidak peduli seberapa cepat pemeriksaan dijalankan (diakui eksplisit di
    // komentar `pemutar-video.tsx`). Yang benar-benar dijanjikan kode adalah
    // "tidak muncul di view-source (Ctrl+U)" — badan respons navigasi ASLI
    // dari server, sebelum satu baris JS pun jalan. `context.request.get()`
    // mengambil PERSIS itu, memakai cookie sesi yang sama.
    const respHalaman = await ananda.request.get(`${BASE}/passport/materi/${materiId}`, {
      failOnStatusCode: false,
    });
    const html = await respHalaman.text();
    // `html.includes(JUDUL)` MENGIKAT: tanpanya, halaman yang gagal termuat
    // (redirect nyasar, 500, atau bahkan halaman kosong) JUGA lolos "tidak
    // mengandung URL R2" — bukan karena rahasianya terjaga, tapi karena
    // halamannya tidak pernah benar-benar merender apa pun. Menuntut judul
    // materi ITU SENDIRI muncul membuktikan kita membaca respons materi yang
    // BENAR dan BERHASIL, bukan halaman error yang kebetulan juga bersih URL.
    catat(
      "4. URL tidak muncul di HTML yang dikirim server (setara view-source), dan halamannya sungguh termuat",
      respHalaman.status() === 200 && html.includes(JUDUL) && !html.includes("r2.cloudflarestorage.com"),
      `HTTP ${respHalaman.status()}; panjang html=${html.length}; judul materi ditemukan=${html.includes(JUDUL)}`,
    );

    // ---- 4. Objek tidak bisa diambil tanpa tanda tangan ----
    const telanjang = urlTonton.split("?")[0];
    const rTelanjang = telanjang !== "" ? await fetch(telanjang) : null;
    catat(
      "5. objek R2 ditolak tanpa tanda tangan",
      telanjang !== "" && rTelanjang !== null && !rTelanjang.ok,
      `HTTP ${rTelanjang?.status ?? "(url kosong)"}`,
    );

    // ---- 5. Pasien TIDAK berhak tidak pernah menerima URL ----
    await pastikanRinaBisaLogin();
    const rina = await login(browser, EMAIL_RINA);
    const rTolak = await rina.request.get(`${BASE}/api/materi/${materiId}/video`, {
      failOnStatusCode: false,
    });
    const teksTolak = await rTolak.text();
    catat(
      "6. pasien tanpa hak DITOLAK dan tidak menerima URL",
      rTolak.status() === 403 && !teksTolak.includes("r2.cloudflarestorage.com"),
      `HTTP ${rTolak.status()}, badan=${teksTolak.slice(0, 60)}`,
    );

    await admin.close(); await ananda.close(); await rina.close();
  } finally {
    await browser.close();
    await pulihkanRina(semulaRina);
    await bersihkan();
  }

  // ---- 6. Pembersihan benar-benar bersih ----
  const { data: sisaMateri } = await svc
    .from("materials").select("id").like("judul", `${PENANDA}%`);
  let sisaObjek = 0;
  if (materiId) {
    const s3 = klienR2();
    const daftar = await s3.send(
      new ListObjectsV2Command({ Bucket: R2.bucket, Prefix: `${materiId}/` }),
    );
    sisaObjek = (daftar.Contents ?? []).length;
  }
  const sesudahRina = await keadaanRina();
  catat(
    "7. seluruh data uji, objek R2, dan keadaan Rina bersih kembali",
    (sisaMateri ?? []).length === 0 &&
      sisaObjek === 0 &&
      sesudahRina.userId === semulaRina.userId &&
      sesudahRina.authUserId === semulaRina.authUserId,
    `materi sisa: ${(sisaMateri ?? []).length}; objek R2 sisa: ${sisaObjek}; ` +
      `Rina user_id semula=${String(semulaRina.userId)} kini=${String(sesudahRina.userId)}; ` +
      `akun auth semula=${String(semulaRina.authUserId !== null)} kini=${String(sesudahRina.authUserId !== null)}`,
  );

  const gagal = hasil.filter((h) => !h.lolos);
  console.log(`\n${hasil.length - gagal.length}/${hasil.length} pemeriksaan lolos.`);
  if (gagal.length > 0) {
    console.error("GAGAL:\n" + gagal.map((g) => `  - ${g.nama}`).join("\n"));
    process.exit(1);
  }
  console.log(
    "Rantai penuh video terbukti: unggah presigned dari peramban -> gating RLS pada penerbitan URL -> bucket tertutup tanpa tanda tangan.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
