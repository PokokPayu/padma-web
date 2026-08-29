import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createClientInvite } from "../src/lib/auth/link-client";

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
        email: "rina@padma.test",
        no_hp: "0857-0000-1111",
        phase_id: "kehamilan",
        // SENGAJA belum tertaut: inilah keadaan klien nyata sesudah admin
        // membuat datanya dan sebelum ia membuka tautan aktivasi.
        user_id: null,
        linked_at: null,
      },
    ],
    { onConflict: "padma_id" },
  );
  if (cErr) throw cErr;

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
  // kolom itu NOT NULL.
  const sesiDalamPaket = {
    client_id: ANANDA_CLIENT_ID,
    client_package_id: "55555555-5555-5555-5555-555555555501",
    status_bayar: "belum" as const, // sesi berpaket ikut status bayar paketnya
  };

  const { error: sErr } = await admin.from("sessions").upsert(
    [
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
    ],
    { onConflict: "id" },
  );
  if (sErr) throw sErr;

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
