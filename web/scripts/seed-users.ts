import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { createClientInvite } from "../src/lib/auth/link-client";
import { namaObjekHalaman } from "../src/lib/materi/rasterisasi";

// Kredensial dev ada di .env.local (lihat vitest.config.ts yang memakai
// DOTENV_CONFIG_PATH=".env.local"); .env dipakai sebagai cadangan.
config({ path: [".env.local", ".env"] });

function adminClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

const PASSWORD = "padma-dev-123";

export const ANANDA_CLIENT_ID = "44444444-4444-4444-4444-444444444401";
export const RINA_CLIENT_ID = "44444444-4444-4444-4444-444444444402";

const BUCKET_MATERI_HALAMAN = "materi-halaman";

/**
 * Halaman e-book demo — Task 10, ronde perbaikan 1; diperluas ke KEDUA
 * materi ebook demo di Task 11 fix ronde 2.
 *
 * `supabase/seed.sql` menulis baris `material_pages` untuk kedua materi
 * ebook demo — "Panduan Siklus Subur" (…702, terbuka) DAN "Panduan ASI
 * Perah" (…704, terkunci) — tapi SQL murni tidak bisa menaruh BYTE gambar ke
 * bucket storage — itu jalur Storage API, bukan `insert`. Tanpa objek
 * sungguhan di sini, membuka salah satu e-book itu menampilkan `<img>` 404 —
 * reader yang tampak rusak persis kelas masalah yang dirapikan berulang kali
 * di rencana ini (layar menjanjikan sesuatu yang tidak benar). Objek
 * sungguhan diunggah DI SINI, lewat service role, sesudah `db reset`
 * menjalankan `seed.sql` — satu-satunya urutan yang mungkin.
 *
 * `…704` BUKAN pengecualian yang "aman dibiarkan fiktif" — draf pertama
 * fix ronde 2 beralasan begitu ("Ananda tidak pernah berhak, jadi tidak
 * relevan") dan reviewer membantahnya dengan test yang SUDAH ADA di repo
 * ini: `tests/admin-sesi-catatan.test.ts` ("materi layanan itu ikut TERBUKA
 * untuk klien") membuktikan menandai SATU sesi Lactation Hero SIAPA PUN
 * selesai — aksi admin sehari-hari, dan searah karena `DELETE sessions`
 * sudah dicabut — langsung membuka `…704` lewat cabang otomatis
 * `berhak_isi_materi`. Baris tanpa objek sungguhan berarti pembukaan itu
 * berakhir gambar 404 permanen, bukan cuma teoretis.
 *
 * Materi id, jumlah halaman, dan dimensi (1600×2263) WAJIB SAMA PERSIS
 * dengan baris `material_pages` di `supabase/seed.sql` untuk id yang sama —
 * keduanya mendeskripsikan objek yang sama dari dua sisi (baris DB vs. byte
 * storage) dan harus disepakati manual karena SQL tidak bisa memanggil
 * `sharp`.
 */
const MATERI_EBOOK_DEMO = [
  { id: "77777777-7777-7777-7777-777777777702", jumlahHalaman: 3 },
  { id: "77777777-7777-7777-7777-777777777704", jumlahHalaman: 3 },
];
const LEBAR_DEMO = 1600;
const TINGGI_DEMO = 2263;

/**
 * Idempoten lewat `upsert: true` — mengunggah ulang menimpa objek lama di
 * path yang sama, bukan menduplikasinya atau gagal. Aman dipanggil setiap
 * `npm run seed:users` maupun setiap globalSetup vitest.
 *
 * Gambarnya sengaja POLOS (warna solid + nomor halaman) — bukan konten
 * ebook sungguhan. Yang dibuktikan bucket ini ADA dan bisa disajikan lewat
 * rute `/api/materi/[id]/halaman/[n]`, bukan mutu visualnya.
 */
async function unggahHalamanMateriDemo(admin: SupabaseClient) {
  for (const { id: materiId, jumlahHalaman } of MATERI_EBOOK_DEMO) {
    for (let halaman = 1; halaman <= jumlahHalaman; halaman++) {
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${LEBAR_DEMO}" height="${TINGGI_DEMO}">` +
        `<rect width="100%" height="100%" fill="#EFEDE4"/>` +
        `<text x="50%" y="50%" font-family="serif" font-size="160" fill="#132518" ` +
        `text-anchor="middle" dominant-baseline="middle">Halaman ${halaman}</text>` +
        `</svg>`;

      const buffer = await sharp({
        create: {
          width: LEBAR_DEMO,
          height: TINGGI_DEMO,
          channels: 3,
          background: "#EFEDE4",
        },
      })
        .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
        // 82 mengikuti nilai yang sama dipakai `bakarWatermark`
        // (src/lib/materi/watermark.ts) — bukan konstanta `KUALITAS_WEBP` di
        // rasterisasi.ts, yang satuannya 0–1 untuk `canvas.toBlob` peramban,
        // bukan 0–100 yang diminta `sharp`.
        .webp({ quality: 82 })
        .toBuffer();

      const { error } = await admin.storage
        .from(BUCKET_MATERI_HALAMAN)
        .upload(namaObjekHalaman(materiId, halaman), buffer, {
          contentType: "image/webp",
          upsert: true,
        });
      if (error) throw error;
    }
  }
}

/**
 * Token undangan Rina untuk DEV & TEST.
 *
 * Rina sengaja dibiarkan BELUM tertaut (bahan uji penautan). Sejak penautan
 * wajib bertoken (migration 20260828220000), "belum tertaut" saja tidak lagi
 * cukup untuk mengujinya — perlu token yang nilainya diketahui test. Yang
 * tersimpan di DB tetap hanya SHA-256-nya, jadi nilai di sini tidak membocorkan
 * apa pun tentang token produksi: setiap undangan sungguhan diterbitkan acak
 * oleh `createClientInvite()`.
 */
export const TOKEN_UNDANGAN_RINA = "undangan-dev-rina-KxN7pQ2sVt4bZ9mLwR3hJf";

/** Alamat email fixture "klien yang belum mengaktifkan akunnya". */
export const EMAIL_RINA = "rina@padma.test";

/**
 * Mengembalikan fixture Rina ke keadaan "BELUM DIAKTIFKAN" — dan sejak K1
 * (spec 8 September 2026) keadaan itu menuntut SATU syarat lagi.
 *
 * Dulu cukup `clients.user_id IS NULL`: penautan hanya mungkin lewat token
 * undangan, jadi baris tanpa `user_id` memang baris yang belum diaktifkan
 * siapa pun. Sejak jalur kedua hidup, EMAIL TERKONFIRMASI juga menautkan.
 * Artinya "belum diaktifkan" sekarang berarti dua hal sekaligus:
 *
 *   (1) barisnya belum bertuan          — dijamin upsert di `seedUsers()`;
 *   (2) TIDAK ADA akun auth yang sudah membuktikan alamat email itu miliknya
 *       — dijamin fungsi ini.
 *
 * Tanpa (2) fixture-nya rusak SENYAP, dan itu bukan kemungkinan teoretis:
 * beberapa berkas test membuat `rina@padma.test` terkonfirmasi lewat service
 * role, dan satu run yang mati di tengah (atau sesi lain yang memakai stack
 * lokal yang sama) meninggalkannya hidup. Sesudah itu `npm run seed:users`
 * lalu login biasa sebagai Rina membuka Passport-nya tanpa pernah menyentuh
 * tautan aktivasi — perilaku yang BENAR menurut K1, tetapi menghapus seluruh
 * guna fixture ini. Berkas seed lain di repo ini sudah memegang prinsip yang
 * sama: keadaan awal dev/test dijamin, bukan diharapkan.
 *
 * Menghapus akun auth hanya sah karena ini seed DEV atas alamat fixture
 * `@padma.test` yang tidak pernah ada di produksi.
 */
async function pastikanRinaBelumDiaktifkan(admin: SupabaseClient) {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  for (const u of data.users) {
    if (u.email?.toLowerCase() !== EMAIL_RINA) continue;

    // `client_invites.used_by` menunjuk `auth.users(id)` tanpa ON DELETE, jadi
    // akun yang PERNAH menukarkan undangan tidak bisa dihapus selama jejaknya
    // masih menunjuk padanya. Inilah yang membuat `auth.admin.deleteUser`
    // gagal DIAM-DIAM di beberapa berkas test (nilai baliknya tidak dibaca) —
    // dan karena itulah akun sisa yang terkonfirmasi bisa menumpuk di stack
    // lokal. Jejaknya dilepas di sini; `createClientInvite` tepat sesudah
    // pemanggil fungsi ini toh menerbitkan ulang undangan Rina dengan
    // `used_at`/`used_by` kosong.
    const { error: jejakErr } = await admin
      .from("client_invites")
      .update({ used_by: null })
      .eq("used_by", u.id);
    if (jejakErr) throw jejakErr;

    const { error: hapusErr } = await admin.auth.admin.deleteUser(u.id);
    // Dilempar, tidak ditelan: kalau akun sisa itu tidak bisa dibuang, fixture
    // "belum diaktifkan" tidak berlaku lagi dan test yang bersandar padanya
    // akan lulus karena alasan yang salah.
    if (hapusErr) {
      throw new Error(
        `akun auth sisa ${EMAIL_RINA} tidak bisa dihapus: ${hapusErr.message}`,
      );
    }
  }
}

/**
 * Peta service_id → id varian BAKU, dibaca dari basis data alih-alih ditulis
 * literal: id varian dibuat `gen_random_uuid()` oleh migrasi Task 1, jadi
 * tidak ada nilai tetap yang bisa ditebak sebelum seed jalan.
 *
 * "Baku" di sini artinya SAMA seperti dipilih backfill migrasi
 * `sesi_menunjuk_varian` (order by urutan, created_at, id) — bukan disaring
 * lewat `label = ''`, supaya kedua jalur (migrasi utk data lama, seed utk
 * data baru) sepakat pada varian yang sama walau kelak sebuah layanan
 * memperoleh varian bertingkat.
 */
async function petaVarianBaku(
  admin: SupabaseClient,
  serviceIds: string[],
): Promise<Map<string, string>> {
  const peta = new Map<string, string>();
  for (const serviceId of new Set(serviceIds)) {
    const { data, error } = await admin
      .from("service_variants")
      .select("id")
      .eq("service_id", serviceId)
      // Tanpa ini, dua layanan seed di bawah (`…111107` Purnama Recovery
      // Massage dan `…111109` Shishu Parent Touch) memulangkan varian BAKU-
      // nya yang sengaja dinonaktifkan tepat di atas (kedua layanan itu diberi
      // varian bertingkat AKTIF sebagai pengganti — "satu layanan dua harga
      // utama aktif" sengaja dicegah). Sesi/permintaan jadwal yang dibuat
      // lewat peta ini untuk salah satu dari dua layanan tersebut lalu diam-
      // diam menunjuk variant_id nonaktif — sah secara FK, tetapi tak pernah
      // muncul di katalog/rate card mana pun.
      .eq("aktif", true)
      .order("urutan", { ascending: true })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(1)
      .single();
    if (error) throw error;
    peta.set(serviceId, data.id as string);
  }
  return peta;
}

async function ensureUser(
  admin: SupabaseClient,
  email: string,
  nama: string,
  role: "klien" | "admin" | "owner",
) {
  const { data: list } = await admin.auth.admin.listUsers();
  let user = list.users.find((u) => u.email === email);
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: nama },
    });
    if (error) throw error;
    user = data.user;
  }
  const { error: pErr } = await admin
    .from("profiles")
    .upsert({ id: user!.id, role, nama });
  if (pErr) throw pErr;
  return user!;
}

/**
 * Idempoten: aman dijalankan berkali-kali (user dibuat hanya bila belum ada,
 * sisanya upsert). Dipakai oleh `npm run seed:users` DAN oleh globalSetup
 * vitest (tests/global-setup.ts) supaya `npm test` tidak lagi bergantung pada
 * langkah manual sesudah `npx supabase db reset`.
 */
export async function seedUsers() {
  const admin = adminClient();
  await ensureUser(admin, "owner@padma.test", "Pemilik PADMA", "owner");
  await ensureUser(admin, "admin@padma.test", "Admin PADMA", "admin");
  const ananda = await ensureUser(admin, "ananda@padma.test", "Ananda Putri", "klien");

  // Klien tertaut (Ananda) + klien belum tertaut (Rina, bahan test penautan).
  //
  // Ananda ditautkan LANGSUNG lewat service role. Itu sah di sini: seed dev
  // adalah setup, bukan alur pengguna — service role di server memang jalur
  // resmi untuk mengisi `clients.user_id` (persis yang dipakai penautan
  // bertoken). Yang tidak boleh adalah penautan yang dipicu pengguna tanpa
  // token; seed tidak melewati jalur itu.
  const { error: cErr } = await admin.from("clients").upsert(
    [
      {
        id: ANANDA_CLIENT_ID,
        padma_id: "PAD-2607-0012",
        nama: "Ananda Putri",
        email: "ananda@padma.test",
        no_hp: "0812-3456-7890",
        phase_id: "prekonsepsi",
        user_id: ananda.id,
        linked_at: "2026-07-06T09:00:00Z",
      },
      {
        id: RINA_CLIENT_ID,
        padma_id: "PAD-2608-0019",
        nama: "Rina Hapsari",
        email: EMAIL_RINA,
        no_hp: "0857-0000-1111",
        phase_id: "kehamilan",
        // SENGAJA belum tertaut: inilah keadaan klien nyata sesudah admin
        // membuat datanya dan sebelum ia membuka tautan aktivasi. Syarat
        // KEDUANYA (tidak ada akun auth atas alamat ini) ditegakkan
        // `pastikanRinaBelumDiaktifkan` tepat di bawah — lihat dokblok-nya.
        user_id: null,
        linked_at: null,
      },
    ],
    { onConflict: "padma_id" },
  );
  if (cErr) throw cErr;

  // Dijalankan SESUDAH upsert di atas, bukan sebelumnya: upsert itulah yang
  // melepas `clients.user_id` Rina, dan `clients.user_id -> auth.users(id)`
  // tidak punya ON DELETE — menghapus akunnya lebih dulu akan ditolak FK.
  await pastikanRinaBelumDiaktifkan(admin);

  // Undangan aktivasi Rina — token yang nilainya diketahui test, diterbitkan
  // ulang setiap seed (upsert) sehingga `npm test` idempoten walau run
  // sebelumnya sudah memakai tokennya.
  //
  // Upsert di atas selalu mengembalikan Rina ke keadaan BELUM tertaut, jadi
  // penjaga "klien sudah tertaut" pada createClientInvite tidak pernah menyala
  // di sini — dan bila suatu saat menyala, seed harus MATI, bukan diam: itu
  // berarti keadaan awal dev/test tidak lagi seperti yang diasumsikan test.
  const undanganRina = await createClientInvite(RINA_CLIENT_ID, {
    token: TOKEN_UNDANGAN_RINA,
  });
  if (!undanganRina.ok) {
    throw new Error(`undangan seed Rina ditolak: ${undanganRina.alasan}`);
  }

  const { error: cpErr } = await admin.from("client_packages").upsert(
    {
      id: "55555555-5555-5555-5555-555555555501",
      client_id: "44444444-4444-4444-4444-444444444401",
      package_id: "22222222-2222-2222-2222-222222222201",
      tanggal_mulai: "2026-07-06",
      status_bayar: "lunas",
    },
    { onConflict: "id" },
  );
  if (cpErr) throw cpErr;

  // Perjalanan Ananda dibuat UTUH, bukan sekadar cukup untuk test: passport
  // yang tampil 1/8 sesi tanpa badge tidak menunjukkan apa pun saat demo.
  // Susunannya: 6 sesi selesai di dalam paket Sankalpa Prima (progres 6/8),
  // 1 sesi terjadwal sebagai penanda "berikutnya" pada stempel ke-7, dan
  // 1 sesi LEPAS yang belum dibayar sebagai bahan halaman Bayar.
  //
  // Tiga layanan berbeda dipakai (Fertility Massage, Flow Yoga, Konsultasi
  // Nutrisi) sehingga lahir 3 badge. Layanan 1106 Lactation Hero SENGAJA tidak
  // pernah dijalani — materi gating hanya terbukti selama ada layanan yang
  // belum pernah disentuh Ananda.
  //
  // `catatan`, `rekomendasi`, dan `status_bayar` ditulis eksplisit di SETIAP
  // baris: upsert massal PostgREST memakai gabungan kunci seluruh objek dan
  // mengisi yang tidak disebut dengan NULL (bukan DEFAULT), sedangkan ketiga
  // kolom itu NOT NULL. `variant_id` kena aturan yang sama (lihat
  // `petaVarianBaku` di atas) — makanya ditambahkan lewat `.map()` sesudah
  // daftar sesi tersusun, bukan diandalkan pada default kolom.
  const sesiDalamPaket = {
    client_id: ANANDA_CLIENT_ID,
    client_package_id: "55555555-5555-5555-5555-555555555501",
    status_bayar: "belum" as const, // sesi berpaket ikut status bayar paketnya
  };

  const risalahSesi = [
    // ---- 6 sesi SELESAI dalam paket Sankalpa Prima (progres 6/8) ----
    {
      ...sesiDalamPaket,
      id: "66666666-6666-6666-6666-666666666601",
      service_id: "11111111-1111-1111-1111-111111111101", // Fertility Massage
      partner_id: "33333333-3333-3333-3333-333333333301",
      tanggal: "2026-07-08",
      status: "selesai",
      catatan:
        "Sesi perkenalan. Pijat relaksasi & pemetaan kondisi awal — ketegangan menumpuk di punggung bawah, kualitas tidur kurang.",
      rekomendasi:
        "Jaga tidur 7–8 jam, mulai catat siklus haid di lembar yang kami berikan.",
    },
    {
      ...sesiDalamPaket,
      id: "66666666-6666-6666-6666-666666666602",
      service_id: "11111111-1111-1111-1111-111111111101",
      partner_id: "33333333-3333-3333-3333-333333333301",
      tanggal: "2026-07-15",
      status: "selesai",
      catatan:
        "Ketegangan punggung bawah jauh berkurang. Klien mulai rutin jalan pagi bersama pasangan.",
      rekomendasi:
        "Lanjutkan jalan pagi 30 menit; kompres hangat bila pegal kembali.",
    },
    {
      ...sesiDalamPaket,
      id: "66666666-6666-6666-6666-666666666603",
      service_id: "11111111-1111-1111-1111-111111111102", // Flow Yoga
      partner_id: "33333333-3333-3333-3333-333333333302",
      tanggal: "2026-07-22",
      status: "selesai",
      catatan:
        "Latihan pernapasan & gerakan dasar. Klien cepat menangkap teknik napas diafragma.",
      rekomendasi:
        "Ulangi rangkaian napas & gerakan dasar di rumah, 15 menit, 3× sepekan.",
    },
    {
      ...sesiDalamPaket,
      id: "66666666-6666-6666-6666-666666666604",
      service_id: "11111111-1111-1111-1111-111111111101",
      partner_id: "33333333-3333-3333-3333-333333333301",
      tanggal: "2026-07-29",
      status: "selesai",
      catatan:
        "Tubuh merespons baik; keluhan pegal hampir hilang. Suasana hati membaik dibanding sesi pertama.",
      rekomendasi:
        "Pertahankan rutinitas. Sesi berikutnya fokus pada area pinggul.",
    },
    {
      ...sesiDalamPaket,
      id: "66666666-6666-6666-6666-666666666605",
      service_id: "11111111-1111-1111-1111-111111111103", // Konsultasi Nutrisi
      partner_id: "33333333-3333-3333-3333-333333333302",
      tanggal: "2026-08-12",
      status: "selesai",
      catatan:
        "Evaluasi pola makan sepekan. Asupan protein & asam folat masih kurang dari kebutuhan promil.",
      rekomendasi:
        "Ikuti menu contoh yang kami berikan; tambah satu porsi protein pada tiap waktu makan.",
    },
    {
      ...sesiDalamPaket,
      id: "66666666-6666-6666-6666-666666666606",
      service_id: "11111111-1111-1111-1111-111111111101",
      partner_id: "33333333-3333-3333-3333-333333333301",
      tanggal: "2026-08-19",
      status: "selesai",
      catatan:
        "Siklus tercatat lebih teratur dua bulan terakhir. Respons tubuh sangat baik terhadap rangkaian perawatan.",
      rekomendasi:
        "Lanjutkan seluruh rutinitas — perjalanan Anda berjalan sesuai rencana.",
    },
    // ---- sesi TERJADWAL berikutnya (stempel ke-7 = penanda "berikutnya") ----
    // Sengaja jauh (Des 2026) supaya tampilan demo tidak berubah menjadi
    // "tidak ada sesi berikutnya" hanya karena tanggal seed terlewat.
    {
      ...sesiDalamPaket,
      id: "66666666-6666-6666-6666-666666666607",
      service_id: "11111111-1111-1111-1111-111111111102",
      partner_id: "33333333-3333-3333-3333-333333333302",
      tanggal: "2026-12-04",
      status: "terjadwal",
      catatan: "",
      rekomendasi: "",
    },
    // ---- sesi LEPAS yang belum dibayar (bahan halaman Bayar) ----
    {
      id: "66666666-6666-6666-6666-666666666608",
      client_id: ANANDA_CLIENT_ID,
      service_id: "11111111-1111-1111-1111-111111111103",
      client_package_id: null, // di luar paket → menjadi item tagihan sendiri
      partner_id: "33333333-3333-3333-3333-333333333302",
      tanggal: "2026-12-11",
      status: "terjadwal",
      catatan: "",
      rekomendasi: "",
      status_bayar: "belum",
    },
  ];

  const petaVarian = await petaVarianBaku(
    admin,
    risalahSesi.map((s) => s.service_id),
  );
  const { error: sErr } = await admin.from("sessions").upsert(
    risalahSesi.map((s) => ({
      ...s,
      variant_id: petaVarian.get(s.service_id),
    })),
    { onConflict: "id" },
  );
  if (sErr) throw sErr;

  await unggahHalamanMateriDemo(admin);
}

// Hanya jalan bila dieksekusi langsung (`npm run seed:users`), bukan saat
// diimpor oleh globalSetup vitest.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  seedUsers()
    .then(() => {
      console.log("Seed pengguna & data demo selesai.");
      console.log(
        `Tautan aktivasi Rina (dev): http://localhost:3000/aktivasi?token=${TOKEN_UNDANGAN_RINA}`,
      );
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
