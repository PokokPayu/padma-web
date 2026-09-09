/**
 * Saringan & paginasi daftar sesi, diuji SAMPAI KE BASIS DATA.
 *
 * Saringan yang memulangkan baris yang salah adalah cacat DATA. Membuktikannya
 * lewat markup berarti membuktikannya dengan cara yang paling tidak langsung —
 * dan markup yang benar di atas baris yang salah tetap terlihat benar.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { signInAs } from "./helpers/as-user";
import { PER_HAL } from "@/app/_shell/panel/daftar";
import { SARING_SESI, ambilDaftarSesi } from "@/lib/admin/sesi";

// Sumber `sesi.ts` dibaca SEKALI di sini — `require()` dinamis di dalam body
// `describe` (draf brief semula) ditolak `@typescript-eslint/no-require-imports`,
// dan membaca berkas yang sama dua kali (satu per describe) tidak menambah
// jaminan apa pun. Pola idiom rumah: `tests/panel-primitif.test.ts`.
const AKAR = path.resolve(__dirname, "..");
const SUMBER_SESI = readFileSync(path.join(AKAR, "src/lib/admin/sesi.ts"), "utf8");

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

// Lapisan data memakai sesi PENGGUNA (`createServerSupabase`), bukan service
// role — lihat komentar "why" di `src/lib/admin/sesi.ts`. Di vitest tidak ada
// cookie, jadi klien ber-SESI SUNGGUHAN disuntikkan lewat mock: RLS staf tetap
// berjalan apa adanya, persis seperti di server. Pola identik
// `tests/admin-mitra.test.ts`.
const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.sesi!,
}));

// Fixture SEED yang stabil — tidak diuji apa pun tentangnya di sini.
//
// Brief menulis ANANDA sebagai "22222222-2222-2222-2222-222222222201" — itu
// sebenarnya ID PAKET "Sankalpa Prima" (`supabase/seed.sql`), bukan ID klien.
// ID klien Ananda yang benar adalah `ANANDA_CLIENT_ID` di
// `scripts/seed-users.ts`, yang juga dipakai `tests/admin-mitra.test.ts`.
// Dengan ID paket, insert fixture gagal FK `sessions_client_id_fkey` dan
// seluruh uji di bawah merah dengan cara yang membingungkan (total lebih
// kecil dari N, bukan error yang jelas) — sudah diverifikasi lewat query
// manual sebelum baris ini ditulis.
const ANANDA = "44444444-4444-4444-4444-444444444401";
const SERVICE_FERTILITY_MASSAGE = "11111111-1111-1111-1111-111111111101";
const HARI_INI = "2026-06-15"; // Senin

const N = PER_HAL + 5;
const UJI_SESI = Array.from({ length: N }, (_, i) =>
  `66666666-6666-6666-6666-6666660000${String(i).padStart(2, "0")}`);
// Tiga sesi bertanggal khusus untuk saringan `waktu`, DI LUAR N di atas.
const SESI_LAMPAU = "66666666-6666-6666-6666-666666ffff01";
const SESI_PEKAN = "66666666-6666-6666-6666-666666ffff02";
const SESI_DEPAN = "66666666-6666-6666-6666-666666ffff03";
// Umpan untuk uji kombinasi status+jenjang di bawah: SELESAI tapi BERJENJANG.
// Tanpa baris ini, "status=selesai & jenjang=kosong" lulus sama saja walau
// saringan `jenjang` diam-diam diabaikan — seluruh UJI_SESI di atas sudah
// berstatus selesai DAN tanpa jenjang, jadi filter jenjang yang dilepas tidak
// pernah kelihatan. Baris ini harus MUNCUL di "status=selesai" polos dan
// HILANG begitu "jenjang=kosong" ditambahkan — itulah yang membuktikan kedua
// saringan benar-benar bekerja bersama, bukan cuma salah satunya.
const SESI_SELESAI_BERJENJANG = "66666666-6666-6666-6666-666666ffff04";
const SEMUA = [...UJI_SESI, SESI_LAMPAU, SESI_PEKAN, SESI_DEPAN, SESI_SELESAI_BERJENJANG];

let partnerId = "";
let variantId = "";

beforeAll(async () => {
  ref.sesi = await signInAs("admin@padma.test");

  await admin.from("sessions").delete().in("id", SEMUA);

  const { data: p } = await admin
    .from("partners").select("id").eq("aktif", true).limit(1).single<{ id: string }>();
  partnerId = p!.id;
  const { data: v } = await admin
    .from("service_variants").select("id")
    .eq("service_id", SERVICE_FERTILITY_MASSAGE).limit(1).single<{ id: string }>();
  variantId = v!.id;

  const dasar = {
    client_id: ANANDA,
    service_id: SERVICE_FERTILITY_MASSAGE,
    variant_id: variantId,
    partner_id: partnerId,
    jam_mulai: "09:00",
  };

  await admin.from("sessions").insert([
    // N sesi SELESAI tanpa jenjang — memenuhi lebih dari satu halaman DAN
    // menjadi bahan saringan `jenjang=kosong`.
    //
    // Tanggal SENGAJA "2026-07-15", bukan sebelum HARI_INI seperti draf
    // brief semula ("2026-06-10"): tanggal itu ikut lolos saringan
    // `waktu=lampau` (< HARI_INI), dan N=30 baris di situ MENGUBUR
    // SESI_LAMPAU keluar dari halaman 1 (urutan terbaru dulu) — uji
    // "waktu=lampau" merah bukan karena kode salah, tapi karena fixturenya
    // sendiri yang menutupi baris yang diuji. "2026-07-15" jatuh di luar
    // ketiga jendela `waktu` yang sempit (lampau/pekan_ini), sehingga hanya
    // numpang di `mendatang` — dan tidak satu uji `mendatang` pun memeriksa
    // KETIADAAN baris ini di sana.
    ...UJI_SESI.map((id) => ({ ...dasar, id, tanggal: "2026-07-15", status: "selesai" })),
    { ...dasar, id: SESI_LAMPAU, tanggal: "2026-01-05", status: "dibatalkan_padma" },
    { ...dasar, id: SESI_PEKAN, tanggal: HARI_INI, status: "terjadwal" },
    { ...dasar, id: SESI_DEPAN, tanggal: "2026-12-31", status: "terjadwal" },
    // Selesai DAN berjenjang — lihat komentar pada konstantanya di atas.
    // Tanggal SENGAJA lebih baru ("2026-08-01") daripada seluruh UJI_SESI
    // ("2026-07-15"): urutan hasil adalah tanggal TERBARU dulu, jadi baris
    // ini pasti jatuh di halaman 1 (indeks 0) pada uji "status=selesai" polos
    // di bawah, terlepas dari penata-dasi `id` — kalau tanggalnya sama dengan
    // UJI_SESI, id-nya (`...ffff04`) justru tersortir SESUDAH ke-30 baris
    // UJI_SESI dan terkubur di halaman 2, membuat uji itu merah karena
    // paginasi, bukan karena saringan.
    { ...dasar, id: SESI_SELESAI_BERJENJANG, tanggal: "2026-08-01", status: "selesai", jenjang: "5_10" },
  ]);
});

afterAll(async () => {
  await admin.from("sessions").delete().in("id", SEMUA);
});

describe("SARING_SESI", () => {
  it("nilai saringan status persis enum session_status", () => {
    expect([...SARING_SESI.status]).toEqual([
      "terjadwal",
      "berjalan",
      "selesai",
      "tidak_hadir",
      "dibatalkan_padma",
      "dibatalkan_klien",
    ]);
  });
});

describe("ambilDaftarSesi — saringan", () => {
  it("menyaring menurut status", async () => {
    const { baris } = await ambilDaftarSesi(
      { cari: "", saring: { status: "dibatalkan_padma" }, hal: 1 }, HARI_INI);
    expect(baris.length).toBeGreaterThan(0);
    expect(baris.every((s) => s.status === "dibatalkan_padma")).toBe(true);
  });

  it("saringan jenjang=kosong hanya memulangkan sesi tanpa jenjang", async () => {
    const { baris, total } = await ambilDaftarSesi(
      { cari: "", saring: { jenjang: "kosong" }, hal: 1 }, HARI_INI);
    expect(total).toBeGreaterThanOrEqual(N);
    expect(baris.every((s) => s.jenjang === null)).toBe(true);
  });

  it("saringan yang ditunjuk StatTile memulangkan PERSIS sesi selesai tanpa jenjang", async () => {
    // Tautan yang sintaksnya benar tetapi saringannya meleset tetap
    // meninggalkan admin memindai dengan mata. Yang diuji di sini bukan
    // href-nya (itu di admin-shell), melainkan barisnya.
    const gabungan = await ambilDaftarSesi(
      { cari: "", saring: { status: "selesai", jenjang: "kosong" }, hal: 1 }, HARI_INI);
    expect(gabungan.total).toBeGreaterThanOrEqual(N);
    expect(gabungan.baris.every((s) => s.status === "selesai" && s.jenjang === null)).toBe(true);
    // SESI_SELESAI_BERJENJANG adalah SELESAI tapi punya jenjang — ia HARUS
    // absen di sini. Tanpa baris umpan ini dan tanpa pemeriksaan ini, saringan
    // `jenjang` bisa diam-diam diabaikan (kode hanya menyaring `status`) dan
    // test di atas tetap hijau, karena seluruh N baris UJI_SESI kebetulan
    // sudah tanpa jenjang sejak awal.
    expect(gabungan.baris.some((s) => s.id === SESI_SELESAI_BERJENJANG)).toBe(false);

    // Sebagai pembanding: TANPA saringan jenjang, baris yang sama ITU HARUS
    // muncul — membuktikan ketiadaannya di atas memang karena saringan
    // `jenjang`, bukan karena baris itu tidak pernah lahir atau lolos filter
    // lain (mis. tanggal, `cari`).
    const hanyaStatus = await ambilDaftarSesi(
      { cari: "", saring: { status: "selesai" }, hal: 1 }, HARI_INI);
    expect(hanyaStatus.baris.some((s) => s.id === SESI_SELESAI_BERJENJANG)).toBe(true);
  });

  it("waktu=mendatang membuang yang sudah lewat, waktu=lampau kebalikannya", async () => {
    const depan = await ambilDaftarSesi(
      { cari: "", saring: { waktu: "mendatang" }, hal: 1 }, HARI_INI);
    expect(depan.baris.some((s) => s.id === SESI_DEPAN)).toBe(true);
    expect(depan.baris.some((s) => s.id === SESI_LAMPAU)).toBe(false);

    const lampau = await ambilDaftarSesi(
      { cari: "", saring: { waktu: "lampau" }, hal: 1 }, HARI_INI);
    expect(lampau.baris.some((s) => s.id === SESI_LAMPAU)).toBe(true);
    expect(lampau.baris.some((s) => s.id === SESI_DEPAN)).toBe(false);
  });

  it("waktu=pekan_ini memuat hari ini, membuang bulan lalu DAN akhir tahun", async () => {
    const { baris } = await ambilDaftarSesi(
      { cari: "", saring: { waktu: "pekan_ini" }, hal: 1 }, HARI_INI);
    const id = baris.map((s) => s.id);
    expect(id).toContain(SESI_PEKAN);
    expect(id).not.toContain(SESI_LAMPAU);
    expect(id).not.toContain(SESI_DEPAN);
  });

  it("mencari menurut nama klien DAN padma id", async () => {
    const nama = await ambilDaftarSesi({ cari: "ananda", saring: {}, hal: 1 }, HARI_INI);
    expect(nama.baris.length).toBeGreaterThan(0);
    expect(nama.baris.every((s) => s.namaKlien.toLowerCase().includes("ananda"))).toBe(true);

    const id = await ambilDaftarSesi(
      { cari: nama.baris[0].padmaId, saring: {}, hal: 1 }, HARI_INI);
    expect(id.baris.length).toBeGreaterThan(0);
  });

  it("kata cari diperlakukan sebagai HURUF, bukan wildcard SQL", async () => {
    // "%" sebagai wildcard akan mencocokkan SEMUA klien. Sebagai huruf, nol.
    const { baris } = await ambilDaftarSesi({ cari: "%", saring: {}, hal: 1 }, HARI_INI);
    expect(baris).toEqual([]);
  });
});

describe("ambilDaftarSesi — paginasi", () => {
  it("halaman 1 penuh dan halaman 2 BERISI", async () => {
    const p = { cari: "", saring: { jenjang: "kosong" }, hal: 1 };
    const h1 = await ambilDaftarSesi(p, HARI_INI);
    expect(h1.baris).toHaveLength(PER_HAL);

    // Halaman 2 WAJIB berisi. Fixture N = PER_HAL + 5 yang menjaminnya —
    // uji paginasi rencana 1 pernah LULUS HAMPA karena halaman 2 kosong dan
    // `[].every(...)` selalu true.
    const h2 = await ambilDaftarSesi({ ...p, hal: 2 }, HARI_INI);
    expect(h2.baris.length).toBeGreaterThan(0);

    // Tidak boleh ada baris yang muncul di kedua halaman.
    const tumpang = h1.baris.filter((a) => h2.baris.some((b) => b.id === a.id));
    expect(tumpang).toEqual([]);
  });

  it("total menghitung seluruh baris yang cocok, bukan hanya halaman ini", async () => {
    const { baris, total } = await ambilDaftarSesi(
      { cari: "", saring: { jenjang: "kosong" }, hal: 1 }, HARI_INI);
    expect(total).toBeGreaterThan(baris.length);
  });
});

describe("pagar identitas — lib/admin/sesi.ts", () => {
  it('bentuk metode .ilike("id"|"*_id", …) tidak dipakai', () => {
    expect(SUMBER_SESI).not.toMatch(/\.(?:ilike|like)\(\s*['"`](id|\w*_id)['"`]/);
  });

  it("di dalam .or(...) hanya padma_id yang boleh dicocokkan dengan pola", () => {
    const kolom = [...SUMBER_SESI.matchAll(/[,'"`](id|\w*_id)\.(?:ilike|like)\./g)].map((m) => m[1]);
    // Pagar bergigi: `ambilDaftarSesi` memang mencocokkan `padma_id`.
    expect(kolom.length).toBeGreaterThan(0);
    expect(kolom.filter((k) => k !== "padma_id")).toEqual([]);
  });
});

describe("money firewall", () => {
  it("lapisan data sesi tidak pernah menyebut tabel uang", () => {
    for (const tabel of ["variant_rates", "honor_marks", "transport_rates", "transport_khusus"]) {
      expect(SUMBER_SESI).not.toContain(tabel);
    }
  });
});
