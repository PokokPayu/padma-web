/**
 * MODUL VERIFIKASI PEMBAYARAN (/admin/bayar).
 *
 * Inilah tempat siklus uang klinik ditutup: klien menekan "Saya sudah bayar"
 * di passport, admin mencocokkan bukti dengan mutasi, lalu menekan "Tandai
 * lunas". Karena keputusannya soal uang dan tidak ada nominal di layar, satu-
 * satunya hal yang membuat modul ini bisa dipertanggungjawabkan adalah JEJAK
 * AUDIT-nya — dan jejak itu hanya berguna bila menyebut MANUSIA yang menekan
 * tombol. Karena itu test pertama yang wajib hijau di sini bukan "status
 * berubah", melainkan "jejaknya menyebut peran_aktor 'admin' dengan aktor_id
 * yang benar, bukan service_role".
 *
 * Lima kelas kegagalan yang dijaga berkas ini, semuanya SENYAP:
 *
 *  1. TAGIHAN HANTU. Saringan daftar admin wajib IDENTIK dengan
 *     `susunTagihan()` di `@/lib/passport/turunan` — sesi berpaket dan sesi
 *     batal bukan tagihan. Saringan naif (`status_bayar <> 'lunas'`) memberi
 *     admin baris yang tidak pernah dilihat kliennya, dan karena `belum ->
 *     lunas` diizinkan DB, ia bisa benar-benar "melunasi" hantu itu berikut
 *     jejak audit palsunya.
 *  2. BADGE YANG TIDAK BISA DIBERSIHKAN. Badge `klaimMenunggu` wajib sama
 *     dengan jumlah baris menunggu verifikasi di daftar — satu SESI SELALU
 *     satu ITEM, bahkan yang berjenjang (Task 9): rincian transportnya
 *     hidup sebagai MEDAN `rincianTransport` pada item sesi itu sendiri,
 *     bukan item kedua ber-`id` sama. Draf pertama Task 9 melanggar invarian
 *     ini (item kedua ber-id sama untuk transport), dan lolos dari test di
 *     bawah semata karena fixturenya kebetulan tidak pernah men-set sesi
 *     berjenjang ke 'menunggu_verifikasi' — lihat fixture
 *     `SESI_TRANSPORT_MENUNGGU` di describe "baris transport". Bila berbeda,
 *     admin membuka modulnya dan tidak menemukan apa pun untuk dipadamkan.
 *  3. KEADAAN TUJUAN SEBAGAI PARAMETER. Prototipe memakai
 *     `<select onchange="ubahStatusBayar(id, this.value)">` — status dikirim
 *     dari browser. Bentuk celah itu sudah pernah tembus di proyek ini, jadi
 *     di sini ada DUA action dengan status tertulis mati, dan tombolnya
 *     dirender bersyarat menurut status barisnya.
 *  4. SUKSES PALSU. UPDATE yang tertahan `WHERE status_bayar IN (...)` dijawab
 *     PostgREST 200 + [] — melaporkan "berhasil" tanpa memeriksa panjangnya
 *     berarti admin melihat "lunas" untuk baris yang tidak berubah sama sekali.
 *  5. PEMUTARAN MUNDUR. 'lunas' tidak boleh diputar lewat UI. DB pun
 *     menolaknya (42501), tetapi lapis aplikasi tidak boleh mengandalkan itu:
 *     yang sampai ke pengguna harus pesan yang bisa dibaca, bukan kode Postgres.
 *
 * Higiene: setiap perubahan `status_bayar` menulis satu baris
 * `jejak_status_bayar`, dan tabel jejak SENGAJA tanpa foreign key (cascade akan
 * menghapus tepat bukti yang menjelaskan penghapusan). Fixture di sini karena
 * itu menyapu jejaknya sendiri — lihat tests/jejak-yatim.test.ts.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { varianBaku } from "./helpers/varian";
import { nominalDalam } from "./helpers/nominal";
import { PER_HAL } from "@/app/_shell/panel/daftar";

const admin = createAdminSupabase();
const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

const KLIEN = "44444444-4444-4444-4444-444444444401"; // Ananda (tertaut)
const PADMA_ID = "PAD-2607-0012";
const PAKET_TIPE = "22222222-2222-2222-2222-222222222201";
const SVC_MASSAGE = "11111111-1111-1111-1111-111111111101";
const SVC_NUTRISI = "11111111-1111-1111-1111-111111111103";
const MITRA_A = "33333333-3333-3333-3333-333333333301";
const TGL = "2026-12-23";
const HANTU = "00000000-0000-0000-0000-000000000000";

const PAKET_UJI = "55555555-5555-5555-5555-5555555555c1";
const SESI_MENUNGGU = "66666666-6666-6666-6666-6666666666c1";
const SESI_BELUM = "66666666-6666-6666-6666-6666666666c2";
const SESI_LUNAS = "66666666-6666-6666-6666-6666666666c3";
const SESI_BATAL = "66666666-6666-6666-6666-6666666666c4";
const SESI_PAKET = "66666666-6666-6666-6666-6666666666c5";

const SESI_UJI = [SESI_MENUNGGU, SESI_BELUM, SESI_LUNAS, SESI_BATAL, SESI_PAKET];

// Lapisan data & action memakai sesi pengguna (`createServerSupabase`), yang
// membaca cookies() dan hanya bermakna di dalam request scope. Modulnya
// diganti klien Supabase ber-SESI NYATA: RLS dan requireRole tetap berjalan
// apa adanya, persis seperti di server.
const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.sesi!,
}));

const jejakCache = vi.hoisted(() => ({ revalidate: [] as string[] }));
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => {
    jejakCache.revalidate.push(p);
  },
}));

// `redirect()` melempar di dalam request Next. Di test ia dijadikan error yang
// bisa dibaca supaya "penjaga peran hilang" menjadi MERAH, bukan senyap.
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NOTFOUND");
  },
  usePathname: () => "/admin/bayar",
}));

const tagihanMod = await import("@/lib/admin/tagihan");
const { daftarTagihanAdmin, SARING_BAYAR } = tagihanMod;
const { hitungKlaimMenunggu } = await import("@/lib/admin/antrean");
const { tandaiLunas, tolakKlaim } = await import("@/app/admin/bayar/aksi");
const { TabelBayar } = await import("@/app/admin/bayar/tabel-bayar");
const { default: BayarPage } = await import("@/app/admin/bayar/page");
const { ambilPaket, ambilSesi } = await import("@/lib/passport/data");
const { susunTagihan } = await import("@/lib/passport/turunan");

// `daftarTagihanAdmin()` sekarang menerima `ParamDaftar` dan memulangkan
// `{ baris, total }` alih-alih `ItemTagihanAdmin[]` telanjang. Pemanggilan
// lama di berkas ini (dua puluhan) semuanya meminta SELURUH tagihan halaman
// pertama tanpa saringan maupun pencarian — satu pembungkus di sini
// menggantikan mengedit tiap pemanggilan satu per satu.
const semuaTagihan = async () => (await daftarTagihanAdmin({ cari: "", saring: {}, hal: 1 })).baris;

const sumberAksi = baca("src/app/admin/bayar/aksi.ts");
const sumberHalaman = baca("src/app/admin/bayar/page.tsx");
const sumberTabel = baca("src/app/admin/bayar/tabel-bayar.tsx");
const sumberStatus = baca("src/app/admin/bayar/status.ts");
const sumberData = baca("src/lib/admin/tagihan.ts");

let sesiAdmin: SupabaseClient;
let sesiKlien: SupabaseClient;
let idAdmin: string;

// ---------------------------------------------------------------------------
// Perkakas
// ---------------------------------------------------------------------------

async function bersihkan() {
  // Jejak DULU: tabel jejak sengaja tanpa FK, jadi ia tidak ikut tersapu saat
  // barisnya dihapus. Tanpa baris ini `npm test` menumpuk jejak yatim per run.
  await admin.from("jejak_status_bayar").delete().in("sesi_id", SESI_UJI);
  await admin.from("jejak_status_bayar").delete().eq("paket_klien_id", PAKET_UJI);
  await admin.from("sessions").delete().in("id", SESI_UJI);
  await admin.from("client_packages").delete().eq("id", PAKET_UJI);
}

/**
 * Bahan uji ditulis lewat SERVICE ROLE, bukan lewat jalur yang diuji:
 * `guard_insert_status_bayar` melarang peran API melahirkan baris uang
 * berstatus selain 'belum', dan itu memang pagar yang ingin dipertahankan.
 */
async function siapkan() {
  await bersihkan();

  // Paket uji SENDIRI, bukan paket seed: mengubah status bayar paket seed akan
  // diwarisi berkas test lain (beranda, bayar passport) yang membacanya apa adanya.
  await admin.from("client_packages").insert({
    id: PAKET_UJI,
    client_id: KLIEN,
    package_id: PAKET_TIPE,
    tanggal_mulai: TGL,
    status_bayar: "menunggu_verifikasi",
  });

  await admin.from("sessions").insert([
    baris(SESI_MENUNGGU, { status_bayar: "menunggu_verifikasi", service_id: SVC_NUTRISI }),
    baris(SESI_BELUM, { status_bayar: "belum" }),
    baris(SESI_LUNAS, { status_bayar: "lunas" }),
    // Sesi batal yang terlanjur mengklaim: bukan tagihan, tidak pernah masuk
    // daftar maupun badge.
    baris(SESI_BATAL, { status: "dibatalkan_padma", status_bayar: "menunggu_verifikasi" }),
    // Sesi di dalam paket. `sessions_bayar_hanya_lepas` memaksa 'belum' —
    // status bayarnya mengikuti paketnya, dan ia tidak boleh muncul sendiri.
    baris(SESI_PAKET, { client_package_id: PAKET_UJI, status_bayar: "belum" }),
  ]);
}

// Sejak Task 9 `sessions.variant_id` NOT NULL: id-nya lahir
// `gen_random_uuid()` saat migrasi/trigger berjalan, jadi dibaca dari basis
// data sekali di `beforeAll` alih-alih ditulis literal.
const variantPerSvc = new Map<string, string>();

function baris(id: string, ubah: Record<string, unknown>) {
  const dasar = {
    id,
    client_id: KLIEN,
    client_package_id: null,
    service_id: SVC_MASSAGE,
    partner_id: MITRA_A,
    tanggal: TGL,
    status: "terjadwal",
    catatan: "",
    rekomendasi: "",
    jam_mulai: "09:00",
    ...ubah,
  };
  const serviceId = dasar.service_id as string;
  const variantId = (dasar as Record<string, unknown>).variant_id ?? variantPerSvc.get(serviceId);
  return { ...dasar, variant_id: variantId };
}

async function statusSesi(id: string): Promise<string> {
  const { data } = await admin.from("sessions").select("status_bayar").eq("id", id).single();
  return data!.status_bayar as string;
}

async function statusPaket(id: string): Promise<string> {
  const { data } = await admin
    .from("client_packages")
    .select("status_bayar")
    .eq("id", id)
    .single();
  return data!.status_bayar as string;
}

async function jejakSesi(id: string) {
  const { data } = await admin
    .from("jejak_status_bayar")
    .select("*")
    .eq("sesi_id", id)
    .order("dicatat_pada", { ascending: false });
  return data ?? [];
}

beforeAll(async () => {
  sesiAdmin = await signInAs("admin@padma.test");
  sesiKlien = await signInAs("ananda@padma.test");
  // Identitas diambil dari sesi, BUKAN dari `profiles ... limit(1)`: admin
  // berhak membaca SELURUH profil, jadi baris pertama sembarang belum tentu
  // miliknya sendiri.
  const { data } = await sesiAdmin.auth.getUser();
  idAdmin = data.user!.id;
  variantPerSvc.set(SVC_MASSAGE, await varianBaku(admin, SVC_MASSAGE));
  variantPerSvc.set(SVC_NUTRISI, await varianBaku(admin, SVC_NUTRISI));
});

beforeEach(async () => {
  ref.sesi = sesiAdmin;
  jejakCache.revalidate.length = 0;
  await siapkan();
});

afterAll(bersihkan);

// ---------------------------------------------------------------------------
// Daftar tagihan admin
// ---------------------------------------------------------------------------

describe("daftar tagihan admin", () => {
  it("memuat sesi lepas yang menunggu verifikasi; paket digerbang (K11, Task 2)", async () => {
    const daftar = await semuaTagihan();
    const kunci = daftar.map((t) => `${t.jenis}:${t.id}`);
    expect(kunci).toContain(`sesi:${SESI_MENUNGGU}`);
    // Sebelum gerbang R4 (Task 2): baris ini menegaskan `paket:${PAKET_UJI}`
    // ikut di daftar. `daftarTagihanAdmin()` kini digerbang sejalan dengan
    // `ambilPaket()` sisi klien (Task 1) — yang tetap dijaga adalah sesi
    // lepas di atas, TIDAK berubah oleh gerbang paket.
    expect(kunci).not.toContain(`paket:${PAKET_UJI}`);
  });

  it("membawa nama klien dan PADMA ID — antrean ini dibaca manusia", async () => {
    const item = (await semuaTagihan()).find((t) => t.id === SESI_MENUNGGU);
    expect(item).toBeDefined();
    expect(item!.namaKlien).toContain("Ananda");
    expect(item!.padmaId).toBe(PADMA_ID);
    expect(item!.label.length).toBeGreaterThan(0);
  });

  it("TIDAK memuat sesi yang sudah tercakup paket (tagihan hantu)", async () => {
    const daftar = await semuaTagihan();
    expect(daftar.map((t) => t.id)).not.toContain(SESI_PAKET);
  });

  it("TIDAK memuat sesi batal", async () => {
    const daftar = await semuaTagihan();
    expect(daftar.map((t) => t.id)).not.toContain(SESI_BATAL);
  });

  it("invarian menyeluruh: TIAP baris sesi di daftar benar-benar lepas & tidak batal", async () => {
    // Bukan hanya baris uji — seluruh daftar. Satu sesi berpaket yang lolos
    // berarti admin bisa "melunasi" sesuatu yang kliennya tidak pernah lihat.
    const idSesi = (await semuaTagihan())
      .filter((t) => t.jenis === "sesi")
      .map((t) => t.id);
    if (idSesi.length > 0) {
      const { data } = await admin
        .from("sessions")
        .select("id, status, client_package_id")
        .in("id", idSesi);
      for (const s of data ?? []) {
        expect(s.client_package_id, `sesi ${s.id} berpaket`).toBeNull();
        expect(s.status, `sesi ${s.id} batal`).not.toBe("dibatalkan_padma");
      }
      expect((data ?? []).length).toBe(idSesi.length);
    }
  });

  it("saringan sesi IDENTIK dengan susunTagihan() yang dilihat klien", async () => {
    // Bukti terkuat bahwa admin dan klien melihat daftar SESI yang sama: item
    // milik Ananda di daftar admin harus persis sama dengan tagihan yang
    // tersusun dari sisi Ananda sendiri.
    //
    // Perbandingan ini disempitkan ke jenis "sesi": sejak saklar K11 (Task 1
    // gerbang sisi klien, Task 2/R4 gerbang sisi staf) KEDUA jalur —
    // `ambilPaket()` klien dan `daftarTagihanAdmin()` admin — sama-sama tidak
    // lagi membawa baris paket (lihat tests/paket-tersembunyi.test.tsx).
    // Yang tetap dijaga: parity SESI antara admin dan klien di baris terakhir
    // sebelumnya; baris terakhir SEKARANG membuktikan gerbang staf benar-benar
    // menutup jalan paket juga, bukan cuma jalan klien.
    //
    // Dipanggil lewat `semuaTagihan()` (adapter halaman-1 di puncak berkas)
    // sesudah sapuan panel memberi `daftarTagihanAdmin()` parameter
    // `ParamDaftar` — yang diuji tetap daftar yang sama, bukan versi yang
    // dilonggarkan.
    const daftarAdmin = (await semuaTagihan()).filter((t) => t.padmaId === PADMA_ID);
    const milikAdmin = daftarAdmin
      .filter((t) => t.jenis === "sesi")
      .map((t) => `${t.jenis}:${t.id}`)
      .sort();

    ref.sesi = sesiKlien;
    const [paket, sesi] = await Promise.all([ambilPaket(KLIEN), ambilSesi(KLIEN)]);
    ref.sesi = sesiAdmin;
    const milikKlien = susunTagihan({ paket, sesi })
      .filter((t) => t.jenis === "sesi")
      .map((t) => `${t.jenis}:${t.id}`)
      .sort();

    expect(milikAdmin).toEqual(milikKlien);
    expect(daftarAdmin.some((t) => t.jenis === "paket")).toBe(false);
  });

  it("terurut menurut kemendesakan: menunggu verifikasi, belum, lunas", async () => {
    // Yang menunggu verifikasi naik ke atas — itulah pekerjaan admin hari ini.
    const urut = { menunggu_verifikasi: 0, belum: 1, lunas: 2 } as const;
    const peringkat = (await semuaTagihan()).map((t) => urut[t.status]);
    expect(peringkat.length).toBeGreaterThan(1);
    for (let i = 1; i < peringkat.length; i++) {
      expect(peringkat[i]).toBeGreaterThanOrEqual(peringkat[i - 1]);
    }
    expect(peringkat[0]).toBe(0); // ada yang menunggu, dan ia yang pertama
  });

  it("BADGE = jumlah baris menunggu verifikasi di daftar", async () => {
    // Badge yang berbeda dari daftarnya adalah alarm yang tidak bisa
    // dipadamkan: angkanya naik, admin membuka modulnya, tidak ada yang bisa
    // dikerjakan.
    const daftar = await semuaTagihan();
    const menunggu = daftar.filter((t) => t.status === "menunggu_verifikasi").length;
    expect(await hitungKlaimMenunggu()).toBe(menunggu);
  });

  it("badge turun tepat satu setelah satu klaim diverifikasi", async () => {
    const sebelum = await hitungKlaimMenunggu();
    const r = await tandaiLunas("sesi", SESI_MENUNGGU);
    expect(r.ok).toBe(true);
    expect(await hitungKlaimMenunggu()).toBe(sebelum - 1);

    const daftar = await semuaTagihan();
    expect(daftar.filter((t) => t.status === "menunggu_verifikasi").length).toBe(
      sebelum - 1,
    );
  });
});

// ---------------------------------------------------------------------------
// Saringan & paginasi (Task 5)
// ---------------------------------------------------------------------------

describe("daftarTagihanAdmin — saringan & paginasi", () => {
  it("nilai saringan persis enum pay_status", () => {
    expect([...SARING_BAYAR.status]).toEqual(["belum", "menunggu_verifikasi", "lunas"]);
  });

  it("menyaring menurut status bayar", async () => {
    const { baris } = await daftarTagihanAdmin({
      cari: "", saring: { status: "lunas" }, hal: 1,
    });
    expect(baris.length).toBeGreaterThan(0);
    expect(baris.every((t) => t.status === "lunas")).toBe(true);
  });

  it("mencari menurut nama klien dan PADMA ID", async () => {
    const semua = await daftarTagihanAdmin({ cari: "", saring: {}, hal: 1 });
    expect(semua.baris.length).toBeGreaterThan(0);
    const sasaran = semua.baris[0];

    const perNama = await daftarTagihanAdmin({
      cari: sasaran.namaKlien.slice(0, 4), saring: {}, hal: 1,
    });
    expect(perNama.baris.some((t) => t.id === sasaran.id)).toBe(true);

    const perId = await daftarTagihanAdmin({ cari: sasaran.padmaId, saring: {}, hal: 1 });
    expect(perId.baris.some((t) => t.id === sasaran.id)).toBe(true);
  });

  it("halaman tidak pernah melebihi PER_HAL, dan total menghitung seluruhnya", async () => {
    const { baris, total } = await daftarTagihanAdmin({ cari: "", saring: {}, hal: 1 });
    expect(baris.length).toBeLessThanOrEqual(PER_HAL);
    expect(total).toBeGreaterThanOrEqual(baris.length);
  });

  it("saringan yang tidak mencocokkan apa pun memulangkan total 0, bukan total semua", async () => {
    // Total yang tetap penuh selagi daftarnya kosong membuat paginasi
    // menawarkan halaman yang tidak pernah ada isinya — persis cacat yang
    // ditemukan pada saringan paket di rencana 1.
    const { baris, total } = await daftarTagihanAdmin({
      cari: "zzz-tidak-ada-klien-bernama-ini", saring: {}, hal: 1,
    });
    expect(baris).toEqual([]);
    expect(total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Label tagihan menyertakan varian (Task 7)
// ---------------------------------------------------------------------------

describe("daftarTagihanAdmin — label sesi menyertakan varian", () => {
  // Fixture SENDIRI, bukan SVC_MASSAGE/SVC_NUTRISI seed: dua sesi layanan
  // yang sama bisa berbeda harga bila variannya berbeda, dan label yang tidak
  // menyebut variannya membuat klien ditagih untuk hal yang salah.
  const SVC_VARIAN = "11111111-1111-1111-1111-111111111c01";
  const VARIAN_NAMED = "77777777-7777-7777-7777-777777777c01";
  const SESI_VARIAN = "66666666-6666-6666-6666-666666666c01";

  beforeAll(async () => {
    await admin.from("services").insert({
      id: SVC_VARIAN,
      phase_id: "prekonsepsi",
      nama: "PAD-UJI Layanan Varian Tagihan",
      deskripsi: "fixture",
    });
    // Trigger `trg_terbitkan_varian_baku` sudah menerbitkan varian baku untuk
    // layanan di atas; baris di bawah adalah varian BERNAMA yang dipesan sesi
    // uji ini — beda varian, beda harga, karena itu labelnya wajib beda juga.
    await admin.from("service_variants").insert({
      id: VARIAN_NAMED,
      service_id: SVC_VARIAN,
      label: "VIP",
      durasi_menit: 90,
      format: "private",
      urutan: 1,
    });
    await admin.from("sessions").insert(
      baris(SESI_VARIAN, {
        service_id: SVC_VARIAN,
        variant_id: VARIAN_NAMED,
        status_bayar: "belum",
      }),
    );
  });

  afterAll(async () => {
    await admin.from("sessions").delete().eq("id", SESI_VARIAN);
    // `service_variants` dulu — FK menahan penghapusan `services` di bawah.
    // Dihapus per SERVICE_ID (bukan hanya VARIAN_NAMED): trigger
    // `trg_terbitkan_varian_baku` menerbitkan satu varian baku otomatis
    // dengan id acak yang tidak kita catat.
    await admin.from("service_variants").delete().eq("service_id", SVC_VARIAN);
    await admin.from("services").delete().eq("id", SVC_VARIAN);
  });

  it("label menyertakan nama layanan DAN label varian", async () => {
    const item = (await semuaTagihan()).find((t) => t.id === SESI_VARIAN);
    expect(item).toBeDefined();
    expect(item!.label).toContain("PAD-UJI Layanan Varian Tagihan");
    expect(item!.label).toContain("VIP");
    expect(item!.label).toMatch(/90 menit/);
  });

  it("varian BAKU (tanpa nama) tidak menambah apa pun ke label — perilaku lama dipertahankan", async () => {
    // SESI_MENUNGGU (fixture modul ini) tidak pernah menyetel `variant_id`,
    // jadi baris ini membuktikan sesi TANPA varian bernama tetap berlabel
    // persis seperti sebelum Task 7: "<nama layanan> · <tanggal>" — satu
    // pemisah " · " saja.
    const item = (await semuaTagihan()).find((t) => t.id === SESI_MENUNGGU);
    expect(item).toBeDefined();
    expect((item!.label.match(/ · /g) ?? []).length).toBe(1);
  });

  // Ruling 13 (Task 9): sebelum ini, `susunTagihan()` sisi klien tidak
  // menyebut varian sama sekali sementara `daftarTagihanAdmin()` sudah
  // menyebutnya sejak Task 7 — admin dan klien membaca label BERBEDA untuk
  // sesi yang SAMA, dan jaminan "label klien & admin sama persis" yang
  // tertulis di `susunTagihan()` jadi bohong. Dua test di bawah membuktikan
  // klien kini menyebut variannya, dan bahwa keduanya kembali identik.
  it("label sesi klien (susunTagihan) menyebut varian yang sama seperti admin (Ruling 13)", async () => {
    ref.sesi = sesiKlien;
    const [paket, sesi] = await Promise.all([ambilPaket(KLIEN), ambilSesi(KLIEN)]);
    ref.sesi = sesiAdmin;

    const item = susunTagihan({ paket, sesi }).find((t) => t.id === SESI_VARIAN);
    expect(item).toBeDefined();
    expect(item!.label).toContain("VIP");
    expect(item!.label).toMatch(/90 menit/);
  });

  it("label klien dan label admin IDENTIK huruf demi huruf untuk sesi ber-varian yang sama (Ruling 13)", async () => {
    const labelAdmin = (await semuaTagihan()).find((t) => t.id === SESI_VARIAN)!.label;

    ref.sesi = sesiKlien;
    const [paket, sesi] = await Promise.all([ambilPaket(KLIEN), ambilSesi(KLIEN)]);
    ref.sesi = sesiAdmin;
    const labelKlien = susunTagihan({ paket, sesi }).find((t) => t.id === SESI_VARIAN)!.label;

    expect(labelKlien).toBe(labelAdmin);
  });
});

// ---------------------------------------------------------------------------
// Baris TRANSPORT di tagihan admin & klien (Task 9)
// ---------------------------------------------------------------------------
describe("daftarTagihanAdmin & susunTagihan — baris transport (Task 9, fix round 1)", () => {
  // Fixture SENDIRI, sama polanya dengan describe varian di atas: sesi
  // berjenjang butuh kolom `sessions.jenjang` yang tidak disentuh fixture
  // modul ini (SESI_UJI seluruhnya `jenjang: null`).
  const SESI_TRANSPORT = "66666666-6666-6666-6666-6666666666c6"; // 10_15, belum
  // Berjenjang DAN 'menunggu_verifikasi' — prasyarat uji invarian badge di
  // bawah. Draf pertama Task 9 hijau semata karena SESI_TRANSPORT di atas
  // memilih 'belum', satu-satunya status yang tidak pernah menyentuh cabang
  // badge (`hitungKlaimMenunggu`) sama sekali.
  const SESI_TRANSPORT_MENUNGGU = "66666666-6666-6666-6666-6666666666c7"; // 5_10, menunggu
  const SESI_JAUH_BELUM = "66666666-6666-6666-6666-6666666666c8"; // di_atas_20, TANPA transport_khusus
  const SESI_JAUH_SUDAH = "66666666-6666-6666-6666-6666666666c9"; // di_atas_20, DENGAN transport_khusus

  beforeAll(async () => {
    await admin.from("sessions").insert([
      baris(SESI_TRANSPORT, { status_bayar: "belum", jenjang: "10_15" }),
      baris(SESI_TRANSPORT_MENUNGGU, { status_bayar: "menunggu_verifikasi", jenjang: "5_10" }),
      baris(SESI_JAUH_BELUM, { status_bayar: "belum", jenjang: "di_atas_20" }),
      baris(SESI_JAUH_SUDAH, { status_bayar: "belum", jenjang: "di_atas_20" }),
    ]);
    await admin
      .from("transport_khusus")
      .insert({ session_id: SESI_JAUH_SUDAH, tarif_klien: 80000, honor_mitra: 60000 });
  });

  afterAll(async () => {
    const SESI = [SESI_TRANSPORT, SESI_TRANSPORT_MENUNGGU, SESI_JAUH_BELUM, SESI_JAUH_SUDAH];
    await admin.from("transport_khusus").delete().eq("session_id", SESI_JAUH_SUDAH);
    // Jejak DULU — alasan yang sama persis dengan `bersihkan()` di atas: tabel
    // jejak sengaja TANPA foreign key, jadi menghapus sesinya tidak menyapu
    // jejaknya. `SESI_TRANSPORT_MENUNGGU` lahir ber-`status_bayar`
    // 'menunggu_verifikasi', dan itulah yang menerbitkan satu baris jejak;
    // tanpa sapuan ini `tests/jejak-yatim.test.ts` memerah setiap kali suite
    // penuh dijalankan — dan ia MEMANG memerah sekali di sini sebelum baris
    // ini ada.
    await admin.from("jejak_status_bayar").delete().in("sesi_id", SESI);
    await admin.from("sessions").delete().in("id", SESI);
  });

  // --- Ruling 16: transport adalah RINCIAN pada item sesi, bukan item kedua ---

  it("sesi berjenjang menghasilkan SATU item; rincianTransport terisi (Ruling 16)", async () => {
    const daftar = (await semuaTagihan()).filter((t) => t.id === SESI_TRANSPORT);
    expect(daftar).toHaveLength(1);
    expect(daftar[0].jenis).toBe("sesi");
    // >10–15 km — LABEL_JENJANG (@/lib/transport/jarak), SATU-SATUNYA sumber.
    expect(daftar[0].rincianTransport).toContain(">10–15 km");
    // Label sesinya sendiri TIDAK bercampur dengan rincian transport.
    expect(daftar[0].label).not.toContain("Transport");
  });

  it("rincianTransport null untuk sesi tanpa jenjang (SESI_MENUNGGU dkk.)", async () => {
    const daftar = await semuaTagihan();
    expect(daftar.filter((t) => t.id === SESI_MENUNGGU)).toHaveLength(1);
    expect(daftar.find((t) => t.id === SESI_MENUNGGU)!.rincianTransport).toBeNull();
  });

  it("badge klaimMenunggu tetap sama dengan jumlah baris menunggu_verifikasi walau ADA sesi berjenjang yang menunggu", async () => {
    const daftar = await semuaTagihan();
    // Prasyarat fixture: benar-benar berjenjang DAN menunggu_verifikasi —
    // tanpa baris ini, test bisa hijau tanpa pernah menguji apa pun.
    const baris = daftar.find((t) => t.id === SESI_TRANSPORT_MENUNGGU);
    expect(baris?.status).toBe("menunggu_verifikasi");
    expect(baris?.rincianTransport).not.toBeNull();

    const menunggu = daftar.filter((t) => t.status === "menunggu_verifikasi").length;
    expect(await hitungKlaimMenunggu()).toBe(menunggu);
  });

  // --- Ruling 26: yang menentukan bukan penimpa, melainkan ADA/TIDAKNYA nominal ---

  it("sesi di_atas_20 TANPA transport_khusus tapi bertarif DASAR: rincianTransport TERISI (Ruling 26)", async () => {
    // Uji ini DIBALIK, bukan dihapus. Ruling 17 dulu memakai "tidak punya
    // `transport_khusus`" sebagai definisi "belum bertarif" — benar selama
    // CHECK `transport_rates_bukan_per_kasus` hidup. Sejak migrasi
    // `tarif_dasar_di_atas_20` mencabutnya dan `seed.sql` mengisi tarif DASAR
    // `di_atas_20`, sesi ini SUDAH punya nominal (klien pun sudah ditagih
    // dengannya), jadi menyembunyikan rinciannya berarti panel admin
    // menyangkal apa yang sudah dibayar klien.
    //
    // Gerbangnya sendiri tidak diubah: ia tetap bertanya lewat view
    // `sesi_menunggu_tarif_transport`. Yang berubah adalah arti view itu
    // (migrasi `20260914130000_menunggu_tarif_hanya_tanpa_nominal`), dan
    // uji ini mengunci arti barunya dari sisi konsumennya.
    const item = (await semuaTagihan()).find((t) => t.id === SESI_JAUH_BELUM)!;
    expect(item.rincianTransport).toContain(">20 km");
    expect(nominalDalam(item.rincianTransport ?? ""), "nominal bocor").toEqual([]);
  });

  it("sesi di_atas_20 SUDAH punya transport_khusus: rincianTransport terisi, TETAP tanpa nominal", async () => {
    const item = (await semuaTagihan()).find((t) => t.id === SESI_JAUH_SUDAH)!;
    expect(item.rincianTransport).toContain(">20 km");
    expect(nominalDalam(item.rincianTransport ?? ""), "nominal bocor").toEqual([]);
  });

  // --- Ruling 25 (gelombang perbaikan akhir): gagal TERTUTUP, bukan lempar ---

  /**
   * Ganjalan tipis di atas klien Supabase SUNGGUHAN: SETIAP tabel lain tetap
   * lewat ke klien asli (RLS & data nyata tetap berlaku), tapi query ke
   * `sesi_menunggu_tarif_transport` dipaksa memulangkan `{ data: null, error }`
   * — mensimulasikan PGRST205 (schema cache belum reload) atau timeout tanpa
   * benar-benar mematikan koneksi database uji.
   */
  function klienGalatMenungguTransport(asli: SupabaseClient): SupabaseClient {
    const hasilGalat = { data: null, error: { message: "galat paksa (uji Ruling 25)" } };
    // Proxy generik: setiap pemanggilan method (select/returns/…) mengembalikan
    // proxy yang sama untuk mendukung chaining apa pun, dan `await` di ujung
    // rantai (yang membaca `.then`) diselesaikan dengan `hasilGalat`.
    const stub: unknown = new Proxy(() => {}, {
      apply: () => stub,
      get: (_t, prop) =>
        prop === "then" ? (resolve: (v: unknown) => void) => resolve(hasilGalat) : () => stub,
    });
    return new Proxy(asli, {
      get(target, prop, receiver) {
        if (prop === "from") {
          return (tabel: string) =>
            tabel === "sesi_menunggu_tarif_transport"
              ? stub
              : Reflect.get(target, "from").call(target, tabel);
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as SupabaseClient;
  }

  it("view sesi_menunggu_tarif_transport gagal dibaca -> TIDAK SATU PUN sesi di_atas_20 mendapat rincianTransport (gagal tertutup, Ruling 25)", async () => {
    const sebelumnya = ref.sesi;
    ref.sesi = klienGalatMenungguTransport(sesiAdmin);
    const daftar = await semuaTagihan();
    ref.sesi = sebelumnya;

    // SESI_JAUH_BELUM (belum bertarif) DAN SESI_JAUH_SUDAH (SUDAH bertarif
    // transport_khusus) keduanya harus null — tanpa view ini, tagihan.ts
    // tidak punya cara membedakan siapa yang sudah dan belum. Menampilkan
    // rincian untuk SESI_JAUH_SUDAH sekalipun (karena kebetulan ia memang
    // sudah bertarif) masih salah: itu berarti nasibnya bergantung isi tabel,
    // bukan pada apakah view berhasil dibaca — arsitektur yang sama akan
    // menagih SESI_JAUH_BELUM begitu urutan datanya kebetulan berbeda.
    const jauhBelum = daftar.find((t) => t.id === SESI_JAUH_BELUM)!;
    const jauhSudah = daftar.find((t) => t.id === SESI_JAUH_SUDAH)!;
    expect(jauhBelum.rincianTransport).toBeNull();
    expect(jauhSudah.rincianTransport).toBeNull();

    // Jenjang LAIN (bukan di_atas_20) tidak pernah bergantung pada view ini
    // sama sekali — kegagalannya tidak boleh ikut menelan rincian yang sehat.
    const dekat = daftar.find((t) => t.id === SESI_TRANSPORT)!;
    expect(dekat.rincianTransport).toContain(">10–15 km");
  });

  it("klien MENDAPAT rincian transport untuk di_atas_20, tanpa nominal (Ruling 26 mencabut Ruling 17)", async () => {
    // Dibalik bersama gerbang di `susunTagihan()`. Keputusan konservatif
    // Ruling 17 ("klien tidak punya cara memverifikasi apakah tarifnya sudah
    // ditetapkan") berdiri di atas doktrin `di_atas_20` = ketiadaan tarif.
    // Sejak tarif DASAR ada, `di_atas_20` tidak lagi berbeda dari
    // `0_5`..`15_20` bagi klien — dan klien yang sama sudah membaca nominal
    // transport >20 km di kartu tagihan pengajuan pada halaman yang SAMA.
    //
    // Klien tetap TIDAK menerima satu nominal pun lewat baris ini: yang
    // dirakit hanya label jenjang + tanggal.
    ref.sesi = sesiKlien;
    const [paket, sesi] = await Promise.all([ambilPaket(KLIEN), ambilSesi(KLIEN)]);
    ref.sesi = sesiAdmin;
    const item = susunTagihan({ paket, sesi }).find((t) => t.id === SESI_JAUH_SUDAH);
    expect(item?.rincianTransport).toContain(">20 km");
    expect(nominalDalam(item?.rincianTransport ?? ""), "nominal bocor ke klien").toEqual([]);
  });

  // --- Parity & money firewall ---

  it("rincianTransport klien (susunTagihan) dan admin (daftarTagihanAdmin) IDENTIK huruf demi huruf", async () => {
    const rincianAdmin = (await semuaTagihan()).find((t) => t.id === SESI_TRANSPORT)!
      .rincianTransport;
    expect(rincianAdmin).not.toBeNull();

    ref.sesi = sesiKlien;
    const [paket, sesi] = await Promise.all([ambilPaket(KLIEN), ambilSesi(KLIEN)]);
    ref.sesi = sesiAdmin;
    const rincianKlien = susunTagihan({ paket, sesi }).find((t) => t.id === SESI_TRANSPORT)!
      .rincianTransport;

    expect(rincianKlien).toBe(rincianAdmin);
  });

  it("admin/tagihan.ts tidak pernah menyebut tabel uang transport, dan memakai anti-join view (money firewall)", () => {
    // Rincian transport dirangkai HANYA dari `sessions.jenjang` (enum, bukan
    // nominal) — modul ini tidak butuh, dan tidak boleh, membaca
    // `transport_rates`/`transport_khusus` sama sekali. Kepastian "sesi
    // di_atas_20 ini sudah bertarif" datang dari anti-join ke
    // `sesi_menunggu_tarif_transport` (Task 8) — BUKAN dari mencoba membaca
    // `transport_khusus` langsung (yang akan dijawab `[]` oleh RLS, dibaca
    // naif sebagai "tidak ada yang menunggu").
    expect(sumberData).not.toContain("transport_rates");
    expect(sumberData).not.toContain("transport_khusus");
    expect(sumberData).toContain("sesi_menunggu_tarif_transport");
  });
});

// ---------------------------------------------------------------------------
// tandaiLunas
// ---------------------------------------------------------------------------

describe("tandaiLunas", () => {
  it("dari 'menunggu_verifikasi' berhasil — DAN jejaknya menyebut admin yang menekan", async () => {
    const r = await tandaiLunas("sesi", SESI_MENUNGGU);
    expect(r.ok).toBe(true);
    expect(await statusSesi(SESI_MENUNGGU)).toBe("lunas");

    const jejak = await jejakSesi(SESI_MENUNGGU);
    expect(jejak.length).toBeGreaterThanOrEqual(1);
    expect(jejak[0]).toMatchObject({
      status_lama: "menunggu_verifikasi",
      status_baru: "lunas",
      peran_aktor: "admin",
    });
    // INTI GUNANYA MODUL INI: bukan "ada barisnya", tetapi barisnya menyebut
    // MANUSIA. Di bawah service role nilainya akan null / 'service_role'.
    expect(jejak[0].aktor_id).toBe(idAdmin);
    expect(jejak[0].peran_aktor).not.toBe("service_role");
    expect(jejak[0].paket_klien_id).toBeNull();
  });

  it("dari 'belum' juga berhasil — klien yang transfer & lapor langsung", async () => {
    const r = await tandaiLunas("sesi", SESI_BELUM);
    expect(r.ok).toBe(true);
    expect(await statusSesi(SESI_BELUM)).toBe("lunas");
    const jejak = await jejakSesi(SESI_BELUM);
    expect(jejak[0]).toMatchObject({ status_lama: "belum", status_baru: "lunas" });
  });

  it("paket klien: jejaknya menempel pada paket, bukan pada sesi", async () => {
    const r = await tandaiLunas("paket", PAKET_UJI);
    expect(r.ok).toBe(true);
    expect(await statusPaket(PAKET_UJI)).toBe("lunas");

    const { data: jejak } = await admin
      .from("jejak_status_bayar")
      .select("*")
      .eq("paket_klien_id", PAKET_UJI)
      .order("dicatat_pada", { ascending: false });
    expect(jejak![0]).toMatchObject({
      status_lama: "menunggu_verifikasi",
      status_baru: "lunas",
      peran_aktor: "admin",
      sesi_id: null,
    });
    expect(jejak![0].aktor_id).toBe(idAdmin);
  });

  it("baris yang SUDAH lunas ditolak — tanpa mengubah apa pun, tanpa jejak baru", async () => {
    const sebelum = (await jejakSesi(SESI_LUNAS)).length;
    const r = await tandaiLunas("sesi", SESI_LUNAS);
    expect(r.ok).toBe(false);
    expect(await statusSesi(SESI_LUNAS)).toBe("lunas");
    expect((await jejakSesi(SESI_LUNAS)).length).toBe(sebelum);
  });

  it("baris yang tidak ada ditolak, bukan 'ok' palsu", async () => {
    // UPDATE yang tidak mengenai baris mana pun dijawab PostgREST 200 + [].
    const r = await tandaiLunas("sesi", HANTU);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.pesan.length > 0).toBe(true);
  });

  it("sesi BERPAKET tidak bisa dilunasi lewat modul ini", async () => {
    // Ia tidak pernah muncul di daftar; kalau id-nya tetap di-POST, jawabannya
    // tetap penolakan — tampilan bukan pagar.
    const r = await tandaiLunas("sesi", SESI_PAKET);
    expect(r.ok).toBe(false);
    expect(await statusSesi(SESI_PAKET)).toBe("belum");
  });

  it("menyegarkan cache admin DAN halaman bayar klien", async () => {
    await tandaiLunas("sesi", SESI_MENUNGGU);
    expect(jejakCache.revalidate).toContain("/admin/bayar");
    expect(jejakCache.revalidate).toContain("/admin");
    expect(jejakCache.revalidate).toContain("/passport/bayar");
  });

  it("PENJAGA PERAN: klien yang login tidak bisa melunasi tagihannya sendiri", async () => {
    ref.sesi = sesiKlien;
    await expect(tandaiLunas("sesi", SESI_MENUNGGU)).rejects.toThrow(/REDIRECT/);
    ref.sesi = sesiAdmin;
    expect(await statusSesi(SESI_MENUNGGU)).toBe("menunggu_verifikasi");
  });
});

// ---------------------------------------------------------------------------
// tolakKlaim
// ---------------------------------------------------------------------------

describe("tolakKlaim", () => {
  it("hanya dari 'menunggu_verifikasi' — klaim yang buktinya tidak cocok", async () => {
    const r = await tolakKlaim("sesi", SESI_MENUNGGU);
    expect(r.ok).toBe(true);
    expect(await statusSesi(SESI_MENUNGGU)).toBe("belum");

    const jejak = await jejakSesi(SESI_MENUNGGU);
    expect(jejak[0]).toMatchObject({
      status_lama: "menunggu_verifikasi",
      status_baru: "belum",
      peran_aktor: "admin",
    });
    expect(jejak[0].aktor_id).toBe(idAdmin);
  });

  it("baris 'belum' ditolak — tidak ada klaim yang bisa ditolak di sana", async () => {
    const sebelum = (await jejakSesi(SESI_BELUM)).length;
    const r = await tolakKlaim("sesi", SESI_BELUM);
    expect(r.ok).toBe(false);
    expect(await statusSesi(SESI_BELUM)).toBe("belum");
    expect((await jejakSesi(SESI_BELUM)).length).toBe(sebelum);
  });

  it("baris 'lunas' TIDAK bisa diputar mundur lewat UI", async () => {
    // Membalik status sesudah rekap pekan berjalan adalah rekonsiliasi, bukan
    // toggle. DB pun menolaknya (42501) — tetapi yang sampai ke admin harus
    // pesan yang bisa dibaca, bukan kode Postgres.
    const sebelum = (await jejakSesi(SESI_LUNAS)).length;
    const r = await tolakKlaim("sesi", SESI_LUNAS);
    expect(r.ok).toBe(false);
    expect(await statusSesi(SESI_LUNAS)).toBe("lunas");
    expect((await jejakSesi(SESI_LUNAS)).length).toBe(sebelum);
  });

  it("paket klien juga bisa ditolak klaimnya", async () => {
    const r = await tolakKlaim("paket", PAKET_UJI);
    expect(r.ok).toBe(true);
    expect(await statusPaket(PAKET_UJI)).toBe("belum");
  });

  it("PENJAGA PERAN: klien yang login tidak bisa menolak klaimnya sendiri", async () => {
    ref.sesi = sesiKlien;
    await expect(tolakKlaim("sesi", SESI_MENUNGGU)).rejects.toThrow(/REDIRECT/);
    ref.sesi = sesiAdmin;
    expect(await statusSesi(SESI_MENUNGGU)).toBe("menunggu_verifikasi");
  });
});

// ---------------------------------------------------------------------------
// Halaman & tabel
// ---------------------------------------------------------------------------

describe("halaman /admin/bayar", () => {
  it("menampilkan klien, PADMA ID, item, dan status", async () => {
    const markup = renderToStaticMarkup(await BayarPage({ searchParams: Promise.resolve({}) }));
    expect(markup).toContain("Ananda");
    expect(markup).toContain(PADMA_ID);
    expect(markup).toContain("Menunggu verifikasi");
  });

  it("menjelaskan alurnya dan bahwa nominal disampaikan lewat WhatsApp", async () => {
    const markup = renderToStaticMarkup(await BayarPage({ searchParams: Promise.resolve({}) }));
    expect(markup).toMatch(/WhatsApp/);
    expect(markup).toMatch(/Menunggu verifikasi/);
  });

  it("TIDAK ada <select> pengubah status — status tidak pernah datang dari browser", async () => {
    const markup = renderToStaticMarkup(await BayarPage({ searchParams: Promise.resolve({}) }));
    expect(markup).not.toContain("<select");
    expect(sumberTabel).not.toContain("onChange");
  });

  it("TIDAK ada nominal uang di seluruh modul (money firewall)", async () => {
    const markup = renderToStaticMarkup(await BayarPage({ searchParams: Promise.resolve({}) }));
    expect(nominalDalam(markup), "nominal bocor").toEqual([]);
    for (const sumber of [sumberHalaman, sumberTabel, sumberAksi, sumberStatus, sumberData]) {
      expect(nominalDalam(sumber), "nominal bocor").toEqual([]);
      expect(sumber).not.toContain("service_rates");
      expect(sumber).not.toContain("variant_rates");
      expect(sumber).not.toContain("honor_marks");
    }
  });

  it("pencarian yang tidak cocok menampilkan pesan pencarian, bukan tabel kosong", async () => {
    // Beda kalimat, beda arti: ini BUKAN "belum ada tagihan sama sekali"
    // (yang salah bila datanya sebenarnya ada, hanya tersaring habis).
    const markup = renderToStaticMarkup(
      await BayarPage({
        searchParams: Promise.resolve({ cari: "zzz-tidak-ada-klien-bernama-ini" }),
      }),
    );
    expect(markup).toContain("Tidak ada tagihan yang cocok dengan pencarian ini");
    expect(markup).not.toContain("<table");
  });

  it("daftar kosong TANPA pencarian/saringan aktif menampilkan kalimat hari-pertama, bukan kalimat pencarian", async () => {
    // BLOCKING 3 (review sapuan panel): sebelum perbaikan ini, page.tsx
    // merender "tidak cocok dengan pencarian ini" UNTUK SEMUA kekosongan,
    // termasuk klinik yang baru dipasang dan belum pernah menerima satu
    // tagihan pun — mengeklaim ada pencarian yang gagal padahal tidak ada
    // satu pun yang dicari. `daftarTagihanAdmin` di-spy supaya baris kosong
    // bisa diuji tanpa mengosongkan basis data lokal yang dipakai bersama.
    const spy = vi
      .spyOn(tagihanMod, "daftarTagihanAdmin")
      .mockResolvedValue({ baris: [], total: 0 });
    try {
      const markup = renderToStaticMarkup(
        await BayarPage({ searchParams: Promise.resolve({}) }),
      );
      expect(markup).toContain(
        "Belum ada tagihan yang perlu diverifikasi",
      );
      expect(markup).not.toContain("cocok dengan pencarian ini");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("tombol dirender BERSYARAT menurut status barisnya", () => {
  const contoh = [
    {
      jenis: "sesi" as const,
      id: SESI_MENUNGGU,
      namaKlien: "Ananda Putri",
      padmaId: PADMA_ID,
      label: "Nutrisi · 23 Desember 2026",
      rincianTransport: null,
      status: "menunggu_verifikasi" as const,
    },
    {
      jenis: "sesi" as const,
      id: SESI_BELUM,
      namaKlien: "Ananda Putri",
      padmaId: PADMA_ID,
      label: "Massage · 23 Desember 2026",
      rincianTransport: null,
      status: "belum" as const,
    },
    {
      jenis: "sesi" as const,
      id: SESI_LUNAS,
      namaKlien: "Ananda Putri",
      padmaId: PADMA_ID,
      label: "Massage · 23 Desember 2026",
      rincianTransport: null,
      status: "lunas" as const,
    },
  ];

  /** Potongan markup satu baris, dipisah lewat penanda data-item. */
  function potongBaris(markup: string, id: string): string {
    const bagian = markup.split('data-item="');
    const cocok = bagian.find((b) => b.startsWith(`sesi:${id}"`));
    expect(cocok, `baris ${id} tidak dirender`).toBeDefined();
    return cocok!;
  }

  const markup = () =>
    renderToStaticMarkup(createElement(TabelBayar, { item: contoh }));

  it("baris 'menunggu_verifikasi' mendapat DUA aksi", () => {
    const b = potongBaris(markup(), SESI_MENUNGGU);
    expect(b).toContain("Tandai lunas");
    expect(b).toContain("Tolak klaim");
  });

  it("baris 'belum' hanya mendapat 'Tandai lunas'", () => {
    const b = potongBaris(markup(), SESI_BELUM);
    expect(b).toContain("Tandai lunas");
    expect(b).not.toContain("Tolak klaim");
  });

  it("baris 'lunas' TIDAK mendapat aksi apa pun", () => {
    const b = potongBaris(markup(), SESI_LUNAS);
    expect(b).not.toContain("Tandai lunas");
    expect(b).not.toContain("Tolak klaim");
  });

  it("TabelBayar TIDAK LAGI memutuskan kosongnya sendiri (Task 5 — pindah ke page.tsx)", () => {
    // Sebelumnya komponen ini menjawab `item: []` dengan pesannya sendiri.
    // Sejak bilah cari & saring ada, kalimat yang benar berbeda menurut
    // sebabnya — "belum ada tagihan sama sekali" vs "tidak cocok dengan
    // pencarian ini" — dan hanya `page.tsx` yang tahu bedanya (lihat uji
    // "pencarian yang tidak cocok…" di describe "halaman /admin/bayar").
    // Tabel sendiri sekarang HANYA merender kerangka tabelnya, kosong atau
    // tidak.
    const m = renderToStaticMarkup(createElement(TabelBayar, { item: [] }));
    expect(m).toContain("<table");
    expect(m).not.toMatch(/tagihan yang perlu diverifikasi/i);
  });
});

// ---------------------------------------------------------------------------
// Bentuk berkas
// ---------------------------------------------------------------------------

describe("bentuk berkas modul bayar", () => {
  it("KEADAAN TUJUAN BUKAN PARAMETER: dua action, status tertulis mati", () => {
    expect(tandaiLunas.length).toBe(2); // (jenis, id) saja
    expect(tolakKlaim.length).toBe(2);
    for (const pola of [
      /function\s+tandaiLunas\([^)]*status\s*:/,
      /function\s+tolakKlaim\([^)]*status\s*:/,
      /function\s+tandaiLunas\([^)]*tujuan\s*:/,
      /function\s+tolakKlaim\([^)]*tujuan\s*:/,
    ]) {
      expect(sumberAksi).not.toMatch(pola);
    }
    expect(sumberAksi).toMatch(/"lunas"/);
    // Tabel tidak boleh mengirim status apa pun ke server.
    expect(sumberTabel).not.toMatch(/tandaiLunas\([^)]*status/);
  });

  it("SETIAP action memanggil requireRole(['admin','owner']) di dalam dirinya", () => {
    const jumlahAction = [...sumberAksi.matchAll(/^export\s+async\s+function\s+\w+/gm)].length;
    const jumlahGuard = [
      ...sumberAksi.matchAll(/await\s+requireRole\(\s*\[\s*"admin"\s*,\s*"owner"\s*\]\s*\)/g),
    ].length;
    expect(jumlahAction).toBe(2);
    expect(jumlahGuard).toBeGreaterThanOrEqual(1);
  });

  it("UPDATE selalu .select('id') lalu diperiksa panjangnya", () => {
    // 200 + [] adalah jawaban UPDATE yang tertahan; melaporkan sukses tanpa
    // memeriksa panjangnya adalah kebohongan senyap.
    expect(sumberAksi).toContain('.select("id")');
    expect(sumberAksi).toMatch(/length\s*===\s*0/);
  });

  it("berkas 'use server' hanya mengekspor fungsi async", () => {
    const ekspor = [...sumberAksi.matchAll(/^export\s+(?!type\b)(\w+)/gm)].map((m) => m[1]);
    expect([...new Set(ekspor)]).toEqual(["async"]);
  });

  it("memakai sesi pengguna, bukan service role", () => {
    for (const sumber of [sumberAksi, sumberHalaman, sumberTabel, sumberStatus, sumberData]) {
      expect(sumber).not.toContain("createAdminSupabase");
      expect(sumber).not.toContain("SERVICE_ROLE");
    }
    expect(sumberData).toContain("createServerSupabase");
  });

  it("tanggal tidak pernah dihitung dengan aritmatika Date", () => {
    for (const sumber of [sumberAksi, sumberHalaman, sumberTabel, sumberData]) {
      expect(sumber).not.toContain("toISOString");
      expect(sumber).not.toContain("setDate(");
      expect(sumber).not.toContain("getDay(");
    }
  });

  it("tidak menuliskan data klien ke log", () => {
    for (const sumber of [sumberAksi, sumberHalaman, sumberTabel, sumberData]) {
      expect(sumber).not.toContain("console.");
    }
  });

  it("layout admin TIDAK ikut diubah (matriks peran tetap satu panggilan)", () => {
    const layout = baca("src/app/admin/layout.tsx");
    expect([...layout.matchAll(/requireRole\(/g)]).toHaveLength(1);
    expect(layout).toMatch(/requireRole\(\s*\[\s*"admin"\s*,\s*"owner"\s*\]\s*\)/);
    expect(baca("src/app/admin/page.tsx")).toContain('href="/admin/skrining"');
  });

  it("navigasi & dashboard menautkan modulnya", () => {
    expect(baca("src/app/admin/_shell/nav-admin.tsx")).toContain('href: "/admin/bayar"');
    expect(baca("src/app/admin/page.tsx")).toContain('href="/admin/bayar"');
  });
});
