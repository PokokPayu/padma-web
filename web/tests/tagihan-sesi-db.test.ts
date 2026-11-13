/**
 * Tagihan sesi menjadi pesanan beku (B2, spec §6.2, §6.5 kunci, D1).
 *
 * Fungsi yang diuji di sini menentukan BERAPA yang ditagihkan ke klien
 * sungguhan, jadi yang dijaga adalah kegagalan yang tidak bersuara:
 *
 *  - harga dihitung di SQL (`rincian_tagihan_permintaan`) dan harus sama
 *    persis dengan rumus TS lama sebelum rumus itu dihapus (D1);
 *  - tenggat = yang lebih dulu antara "24 jam lagi" dan jam kunjungan dalam
 *    kalender JAKARTA — Vercel dan Postgres berjalan UTC, dan salah zona
 *    menggeser tenggat tujuh jam tanpa satu galat pun (Review Focus 1);
 *  - dua klik "Terbitkan tagihan" yang bersamaan tidak boleh meninggalkan dua
 *    pesanan terbuka (Review Focus 2);
 *  - klien yang uangnya sudah masuk tidak pernah disodori tagihan kedua
 *    (`uang_sudah_masuk_permintaan`, Ruling 1).
 *
 * Semua fixture MILIK berkas ini (klien, layanan, varian, tarif varian, tiga
 * mitra): koordinat mitra seed dikosongkan berkas lain, dan tarif varian yang
 * diubah di sini tidak boleh menggeser tagihan berkas lain.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { dbUrl, querySql } from "./helpers/db";
import { skriningHijau } from "./helpers/skrining";
import { hariIniJakarta } from "@/lib/passport/waktu";
import { geserHari } from "@/lib/owner/pekan";
import { JAM_TENGGAT_PESANAN } from "@/lib/pesanan/status";
import { formatRupiah } from "@/lib/rupiah-publik";
import { LABEL_JENJANG, type JenjangTransport } from "@/lib/transport/jarak";
import { hitungTagihanPengajuan, KALIMAT_SEBAB_ADMIN } from "@/lib/tagihan/pengajuan";
import { rakitInvoice } from "@/lib/pesanan/order-id";

const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: async () => ref.sesi! }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NOTFOUND");
  },
  usePathname: () => "/admin/sesi",
}));

const { terbitkanTagihan } = await import("@/app/admin/sesi/aksi");
const { daftarTagihanPengajuanAdmin } = await import("@/lib/admin/tagihan-pengajuan");

const svc = createAdminSupabase();

const KLIEN = "44444444-4444-4444-4444-4444444442b2";
const PADMA_ID = "PAD-UJI-02B2";
const SVC_B2 = "11111111-1111-1111-1111-1111111112b2";
const VARIAN = "77777777-7777-7777-7777-7777777772b2";
const VARIAN_TANPA_TARIF = "77777777-7777-7777-7777-7777777772b3";
// Tarif layanan Rp0: dengan transport 0 totalnya Rp0, yang tidak bisa ditagih.
const VARIAN_GRATIS = "77777777-7777-7777-7777-7777777772b4";
const MITRA = "33333333-3333-3333-3333-3333333332b2";
const MITRA_TANPA_TITIK = "33333333-3333-3333-3333-3333333332b3";
const MITRA_NONAKTIF = "33333333-3333-3333-3333-3333333332b4";

// Titik mitra + tiga bujur alamat yang jaraknya diukur dengan `jarak_km` di
// basis data ini: 2,2 km (0_5), 7,0 km (5_10), 17,0 km (15_20).
const TITIK_MITRA = { lat: -7.96662, lon: 112.632632 };
const LAT_ALAMAT = -7.9666;
const LON_ALAMAT = { "0_5": 112.6526, "5_10": 112.6966, "15_20": 112.7869 } as const;

const HARI_INI = hariIniJakarta();
// Tarif varian fixture: lama sejak Januari, baru berlaku LIMA hari lagi. Tarif
// "sela" disisipkan oleh uji angka beku dan dibersihkan sesudahnya.
const HARGA_LAMA = 300_000;
const HARGA_BARU = 350_000;
const HARGA_SELA = 333_000;
const TGL_TARIF_BARU = geserHari(HARI_INI, 5);
const TGL_TARIF_SELA = geserHari(HARI_INI, 1);

const SETENGAH_JAM = 30 * 60_000;
const JAM = 3_600_000;

let sesiAdmin: SupabaseClient;
let ADMIN_UID = "";

type Pesanan = {
  id: string;
  kode: string;
  status: string;
  jenis: string;
  booking_request_id: string | null;
  client_id: string;
  jumlah_item: number;
  kedaluwarsa_pada: string;
  ditutup_pada: string | null;
};

type Item = {
  jenis: string;
  booking_request_id: string | null;
  product_id: string | null;
  judul_beku: string;
  harga_beku: number;
  urutan: number;
};

type Rincian = {
  layanan: number | null;
  transport: number | null;
  jenjang: JenjangTransport | null;
  sebab: string | null;
};

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

async function bersihkan(): Promise<void> {
  const { data: ps } = await svc.from("orders").select("id").eq("client_id", KLIEN);
  const ids = (ps ?? []).map((p) => p.id as string);
  if (ids.length) {
    // Jejak & notifikasi tanpa foreign key: tidak ikut terhapus bersama
    // pesanannya. `order_items` ikut lewat ON DELETE CASCADE.
    await svc.from("jejak_pesanan").delete().in("pesanan_id", ids);
    await svc.from("notifikasi_pesanan").delete().in("pesanan_id", ids);
    const { error } = await svc.from("orders").delete().in("id", ids);
    if (error) throw error;
  }
  const { error: eb } = await svc.from("booking_requests").delete().eq("client_id", KLIEN);
  if (eb) throw eb;
  await svc.from("screenings").delete().eq("client_id", KLIEN);
  await svc
    .from("variant_rates")
    .delete()
    .eq("variant_id", VARIAN)
    .eq("berlaku_sejak", TGL_TARIF_SELA);
}

async function wajib<T extends { error: unknown }>(p: PromiseLike<T>): Promise<T> {
  const hasil = await p;
  if (hasil.error) throw hasil.error;
  return hasil;
}

beforeAll(async () => {
  sesiAdmin = await signInAs("admin@padma.test");
  ref.sesi = sesiAdmin;
  const [admin] = await querySql<{ id: string }>(
    `select id from auth.users where email = 'admin@padma.test'`,
  );
  ADMIN_UID = admin.id;

  await bersihkan();
  await svc.from("variant_rates").delete().in("variant_id", [VARIAN, VARIAN_TANPA_TARIF, VARIAN_GRATIS]);
  await svc.from("service_variants").delete().eq("service_id", SVC_B2);
  await svc.from("services").delete().eq("id", SVC_B2);
  await svc.from("partners").delete().in("id", [MITRA, MITRA_TANPA_TITIK, MITRA_NONAKTIF]);
  await svc.from("clients").delete().eq("id", KLIEN);

  await wajib(
    svc.from("clients").insert({
      id: KLIEN,
      padma_id: PADMA_ID,
      nama: "Klien Uji Tagihan Sesi",
      email: "uji-tagihan-sesi-b2@padma.test",
      phase_id: "prekonsepsi",
    }),
  );
  // Layanan NONAKTIF: tidak pernah muncul di katalog berkas lain. Trigger
  // `trg_terbitkan_varian_baku` menerbitkan satu varian baku acak untuknya;
  // yang dipakai di sini dua varian ber-id tetap di bawah.
  await wajib(
    svc.from("services").insert({
      id: SVC_B2,
      phase_id: "prekonsepsi",
      nama: "PAD-UJI Layanan Tagihan Sesi",
      deskripsi: "fixture",
      aktif: false,
    }),
  );
  await wajib(
    svc.from("service_variants").insert([
      { id: VARIAN, service_id: SVC_B2, label: "Uji B2", urutan: 90 },
      { id: VARIAN_TANPA_TARIF, service_id: SVC_B2, label: "Uji B2 tanpa tarif", urutan: 91 },
      { id: VARIAN_GRATIS, service_id: SVC_B2, label: "Uji B2 gratis", urutan: 92 },
    ]),
  );
  await wajib(
    svc.from("variant_rates").insert([
      { variant_id: VARIAN, harga_klien: HARGA_LAMA, honor_mitra: 100_000, berlaku_sejak: "2026-01-01" },
      { variant_id: VARIAN, harga_klien: HARGA_BARU, honor_mitra: 100_000, berlaku_sejak: TGL_TARIF_BARU },
      { variant_id: VARIAN_GRATIS, harga_klien: 0, honor_mitra: 0, berlaku_sejak: "2026-01-01" },
    ]),
  );
  await wajib(
    svc.from("partners").insert([
      { id: MITRA, nama: "PAD-UJI Bidan B2", no_hp: "0811-9200-0001", aktif: true, ...TITIK_MITRA },
      { id: MITRA_TANPA_TITIK, nama: "PAD-UJI Bidan B2 Tanpa Titik", no_hp: "0811-9200-0002", aktif: true },
      {
        id: MITRA_NONAKTIF,
        nama: "PAD-UJI Bidan B2 Pensiun",
        no_hp: "0811-9200-0003",
        aktif: false,
        ...TITIK_MITRA,
      },
    ]),
  );
});

beforeEach(async () => {
  ref.sesi = sesiAdmin;
  await bersihkan();
});

afterAll(async () => {
  await bersihkan();
  await svc.from("variant_rates").delete().in("variant_id", [VARIAN, VARIAN_TANPA_TARIF, VARIAN_GRATIS]);
  await svc.from("service_variants").delete().eq("service_id", SVC_B2);
  await svc.from("services").delete().eq("id", SVC_B2);
  await svc.from("partners").delete().in("id", [MITRA, MITRA_TANPA_TITIK, MITRA_NONAKTIF]);
  await svc.from("clients").delete().eq("id", KLIEN);
});

type OpsiPengajuan = {
  tanggal?: string;
  jam?: string;
  mitra?: string;
  varian?: string;
  lon?: number | null;
  waktu?: "pagi" | "siang" | "sore";
};

/**
 * Pengajuan `mitra_siap` yang sampai di sana lewat transisi SAH
 * (diminta -> mencari_mitra -> mitra_siap), sehingga `guard_booking_perpindahan`
 * ikut memeriksanya. Bawaan: kunjungan tiga hari lagi pukul 09.00, 7 km (5_10).
 */
async function pengajuanSiap(opsi: OpsiPengajuan = {}): Promise<string> {
  const lon = opsi.lon === undefined ? LON_ALAMAT["5_10"] : opsi.lon;
  const skrining = await skriningHijau(svc, KLIEN);
  const { data } = await wajib(
    svc
      .from("booking_requests")
      .insert({
        client_id: KLIEN,
        service_id: SVC_B2,
        variant_id: opsi.varian ?? VARIAN,
        tanggal: opsi.tanggal ?? geserHari(HARI_INI, 3),
        jam_mulai: opsi.jam ?? "09:00",
        preferensi_waktu: opsi.waktu ?? "pagi",
        alamat: "Jl. Uji Tagihan Sesi No. 2",
        alamat_lat: lon === null ? null : LAT_ALAMAT,
        alamat_lon: lon,
        status: "diminta",
        screening_id: skrining,
      })
      .select("id")
      .single<{ id: string }>(),
  );
  const id = data!.id;
  await ubahPengajuan(id, { status: "mencari_mitra" });
  await ubahPengajuan(id, { status: "mitra_siap", partner_id: opsi.mitra ?? MITRA });
  return id;
}

async function ubahPengajuan(id: string, ubah: Record<string, unknown>): Promise<void> {
  await wajib(svc.from("booking_requests").update(ubah).eq("id", id));
}

async function pengajuan(id: string) {
  const [b] = await querySql<{
    status: string;
    status_bayar: string;
    tenggat: Date | null;
    email_tagihan_pada: Date | null;
  }>(
    `select status, status_bayar, tenggat, email_tagihan_pada from public.booking_requests where id = $1`,
    [id],
  );
  return b;
}

const terbit = (id: string, sesi: SupabaseClient = sesiAdmin) =>
  sesi.rpc("terbitkan_tagihan_sesi", { p_permintaan_id: id });

async function rincian(id: string): Promise<Rincian> {
  const { data, error } = await sesiAdmin.rpc("rincian_tagihan_permintaan", {
    p_permintaan_id: id,
  });
  expect(error).toBeNull();
  const baris = data as Rincian[];
  expect(baris).toHaveLength(1);
  return baris[0];
}

async function pesananUntuk(id: string): Promise<Pesanan[]> {
  return querySql<Pesanan>(
    `select id, kode, status::text, jenis::text, booking_request_id, client_id,
            jumlah_item, kedaluwarsa_pada::text, ditutup_pada::text
       from public.orders where booking_request_id = $1
      order by dibuat_pada, id`,
    [id],
  );
}

async function itemUntuk(pesananId: string): Promise<Item[]> {
  return querySql<Item>(
    `select jenis::text, booking_request_id, product_id, judul_beku, harga_beku, urutan
       from public.order_items where pesanan_id = $1 order by urutan`,
    [pesananId],
  );
}

async function jejakUntuk(pesananId: string) {
  return querySql<{ kejadian: string; keterangan: string | null; padma_id: string | null }>(
    `select kejadian::text, keterangan, padma_id from public.jejak_pesanan
      where pesanan_id = $1 order by dibuat_pada, id`,
    [pesananId],
  );
}

/** `booking_requests.tenggat` dan `orders.kedaluwarsa_pada` dibandingkan DI basis data, sampai mikrodetik. */
async function tenggatSamaDenganPesanan(id: string, pesananId: string): Promise<boolean> {
  const [b] = await querySql<{ sama: boolean }>(
    `select b.tenggat = o.kedaluwarsa_pada as sama
       from public.booking_requests b, public.orders o
      where b.id = $1 and o.id = $2`,
    [id, pesananId],
  );
  return b.sama;
}

async function semaiPesanan(
  bookingId: string,
  status: string,
  ubah: Record<string, unknown> = {},
): Promise<string> {
  const { data } = await wajib(
    svc
      .from("orders")
      .insert({
        kode: `PSN-261113-${randomUUID().slice(0, 6).toUpperCase()}`,
        client_id: KLIEN,
        jumlah_item: 1,
        jenis: "sesi",
        booking_request_id: bookingId,
        status,
        ditutup_pada: status === "menunggu_bayar" ? null : new Date().toISOString(),
        ...ubah,
      })
      .select("id")
      .single<{ id: string }>(),
  );
  return data!.id;
}

async function tandaiPesanan(pesananId: string, ubah: Record<string, unknown>): Promise<void> {
  await wajib(svc.from("orders").update(ubah).eq("id", pesananId));
}

/** SUCCESS dari DOKU lewat `terapkan_notifikasi_gateway` sungguhan (service role, seperti webhook). */
async function suksesGateway(pesananId: string): Promise<string> {
  const [p] = await querySql<{ kode: string; percobaan: number; total: number }>(
    `select o.kode, o.percobaan,
            (select coalesce(sum(i.harga_beku), 0)::int from public.order_items i where i.pesanan_id = o.id) as total
       from public.orders o where o.id = $1`,
    [pesananId],
  );
  const { data, error } = await svc.rpc("terapkan_notifikasi_gateway", {
    p_invoice: rakitInvoice(p.kode, p.percobaan),
    p_status: "SUCCESS",
    p_transaksi_id: `trx-uji-${randomUUID()}`,
    p_kanal: "VIRTUAL_ACCOUNT_BCA",
    p_nominal: p.total,
    p_sidik: randomUUID(),
  });
  if (error) throw error;
  return data as string;
}

/** Tinjauan bersebab lain dibuka DENGAN jam basis data (bukan jam mesin uji). */
async function bukaTinjauan(pesananId: string, sebab: string): Promise<void> {
  await querySql(
    `update public.orders set sebab_tinjauan = $2, butuh_tinjauan_pada = now() where id = $1`,
    [pesananId, sebab],
  );
}

async function uangSudahMasuk(id: string): Promise<boolean> {
  const [b] = await querySql<{ v: boolean }>(
    `select public.uang_sudah_masuk_permintaan($1) as v`,
    [id],
  );
  return b.v;
}

/**
 * Instan -> (tanggal, jam) DINDING Jakarta. Offset +07:00 ditulis eksplisit
 * dan dibuktikan balik; kalender mesin (TZ=UTC di vitest) tidak pernah dipakai.
 */
function dindingJakarta(instan: number): { tanggal: string; jam: string } {
  const iso = new Date(instan + 7 * JAM).toISOString();
  const hasil = { tanggal: iso.slice(0, 10), jam: iso.slice(11, 16) };
  expect(Date.parse(`${hasil.tanggal}T${hasil.jam}:00+07:00`)).toBe(instan);
  return hasil;
}

/** Batas setengah jam berikutnya (CHECK `booking_requests_jam_bulat`). */
const keAtasSetengahJam = (ms: number) => Math.ceil(ms / SETENGAH_JAM) * SETENGAH_JAM;
const keBawahSetengahJam = (ms: number) => Math.floor(ms / SETENGAH_JAM) * SETENGAH_JAM;

function galatSebab(error: { code?: string; message?: string; hint?: string | null } | null) {
  return { code: error?.code, message: error?.message, hint: error?.hint };
}

// ---------------------------------------------------------------------------
// uang_sudah_masuk_permintaan — SATU predikat untuk B2, B4, B6 (Ruling 1)
// ---------------------------------------------------------------------------

describe("uang_sudah_masuk_permintaan", () => {
  it("pengajuan tanpa pesanan dan status_bayar 'belum' -> false", async () => {
    const id = await pengajuanSiap();
    expect(await uangSudahMasuk(id)).toBe(false);
  });

  it.each(["lunas", "ditahan"])("syarat 1: pesanan %s untuk pengajuan itu -> true", async (status) => {
    const id = await pengajuanSiap();
    await semaiPesanan(id, status);
    expect(await uangSudahMasuk(id)).toBe(true);
  });

  it.each(["menunggu_bayar", "kedaluwarsa", "dibatalkan"])(
    "syarat 1 palsu: pesanan %s tanpa tinjauan -> false",
    async (status) => {
      const id = await pengajuanSiap();
      await semaiPesanan(id, status);
      expect(await uangSudahMasuk(id)).toBe(false);
    },
  );

  it("syarat 1 dibatasi ke pengajuan ITU: pesanan lunas milik pengajuan lain tidak dihitung", async () => {
    const id = await pengajuanSiap();
    const lain = await pengajuanSiap({ waktu: "sore" });
    await semaiPesanan(lain, "lunas");
    expect(await uangSudahMasuk(id)).toBe(false);
    expect(await uangSudahMasuk(lain)).toBe(true);
  });

  it("syarat 2: lunas_setelah_tutup yang belum ditutup -> true; sesudah tinjauan ditutup -> false", async () => {
    const id = await pengajuanSiap();
    const p = await semaiPesanan(id, "dibatalkan", {
      sebab_tinjauan: "lunas_setelah_tutup",
      butuh_tinjauan_pada: new Date().toISOString(),
    });
    expect(await uangSudahMasuk(id)).toBe(true);
    await tandaiPesanan(p, { butuh_tinjauan_pada: null });
    expect(await uangSudahMasuk(id)).toBe(false);
  });

  it("syarat 2 lewat JEJAK: SUCCESS mendarat di pesanan tertutup yang sudah bertinjauan selisih_status -> true; terbit ulang ditolak; sesudah tutup_tinjauan -> false", async () => {
    // terapkan_notifikasi_gateway mempertahankan sebab PERTAMA (coalesce):
    // pesanan ini tetap bersebab `selisih_status` walau uangnya sudah masuk.
    const id = await pengajuanSiap();
    const { data: p1 } = await terbit(id);
    const { data: p2 } = await terbit(id);
    await bukaTinjauan(p1 as string, "selisih_status");
    expect(await uangSudahMasuk(id)).toBe(false);

    expect(await suksesGateway(p1 as string)).toBe("tanpa_efek");
    const [o1] = await querySql<{ status: string; sebab_tinjauan: string }>(
      `select status::text, sebab_tinjauan from public.orders where id = $1`,
      [p1],
    );
    expect(o1).toEqual({ status: "dibatalkan", sebab_tinjauan: "selisih_status" });
    expect((await jejakUntuk(p1 as string)).map((j) => j.kejadian)).toContain("lunas_setelah_tutup");

    expect(await uangSudahMasuk(id)).toBe(true);
    const { error } = await terbit(id);
    expect(galatSebab(error)).toEqual({ code: "P0001", message: "uang_sudah_masuk", hint: "sebab_tagihan" });
    expect((await pesananUntuk(id)).filter((p) => p.status === "menunggu_bayar").map((p) => p.id)).toEqual([p2]);

    expect((await sesiAdmin.rpc("tutup_tinjauan", { p_pesanan_id: p1 })).error).toBeNull();
    expect(await uangSudahMasuk(id)).toBe(false);
    expect((await terbit(id)).error).toBeNull();
  });

  it("jejak lunas_setelah_tutup dari tinjauan yang SUDAH ditutup tidak mengunci tinjauan baru bersebab lain", async () => {
    const id = await pengajuanSiap();
    const { data: p1 } = await terbit(id);
    await terbit(id);
    expect(await suksesGateway(p1 as string)).toBe("tanpa_efek");
    expect(await uangSudahMasuk(id)).toBe(true);
    expect((await sesiAdmin.rpc("tutup_tinjauan", { p_pesanan_id: p1 })).error).toBeNull();
    expect(await uangSudahMasuk(id)).toBe(false);

    // Tinjauan BARU yang tidak ada hubungannya dengan uang: jejak lama lahir
    // sebelum tinjauan ini dibuka, jadi tidak dihitung.
    await bukaTinjauan(p1 as string, "selisih_status");
    expect(await uangSudahMasuk(id)).toBe(false);
  });

  it("syarat 2 palsu: tinjauan terbuka dengan sebab LAIN -> false", async () => {
    const id = await pengajuanSiap();
    await semaiPesanan(id, "dibatalkan", {
      sebab_tinjauan: "selisih_status",
      butuh_tinjauan_pada: new Date().toISOString(),
    });
    expect(await uangSudahMasuk(id)).toBe(false);
  });

  it.each(["menunggu_verifikasi", "lunas"])("syarat 3: status_bayar '%s' -> true", async (sb) => {
    const id = await pengajuanSiap();
    await ubahPengajuan(id, { status_bayar: sb });
    expect(await uangSudahMasuk(id)).toBe(true);
  });

  it("tertutup bagi anon DAN authenticated; staf pun tidak bisa memanggilnya lewat RPC", async () => {
    const [hak] = await querySql<{ anon: boolean; authenticated: boolean }>(
      `select has_function_privilege('anon', 'public.uang_sudah_masuk_permintaan(uuid)', 'execute') as anon,
              has_function_privilege('authenticated', 'public.uang_sudah_masuk_permintaan(uuid)', 'execute') as authenticated`,
    );
    expect(hak).toEqual({ anon: false, authenticated: false });

    const id = await pengajuanSiap();
    const { data, error } = await sesiAdmin.rpc("uang_sudah_masuk_permintaan", {
      p_permintaan_id: id,
    });
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
  });
});

// ---------------------------------------------------------------------------
// Terbit pertama
// ---------------------------------------------------------------------------

describe("terbitkan_tagihan_sesi — terbit pertama", () => {
  it("membekukan harga ke pesanan sesi dua item; pengajuan menunggu_bayar dengan tenggat = kedaluwarsa_pada", async () => {
    const id = await pengajuanSiap();
    const r = await rincian(id);
    expect(r).toMatchObject({ layanan: HARGA_LAMA, jenjang: "5_10", sebab: null });
    expect(r.transport).toBeGreaterThan(0);

    const { data, error } = await terbit(id);
    expect(error).toBeNull();

    const ps = await pesananUntuk(id);
    expect(ps).toHaveLength(1);
    const [p] = ps;
    expect(data).toBe(p.id);
    expect(p).toMatchObject({
      status: "menunggu_bayar",
      jenis: "sesi",
      booking_request_id: id,
      client_id: KLIEN,
      jumlah_item: 2,
      ditutup_pada: null,
    });
    // Kode dibangkitkan seperti pesanan produk: tanggal JAKARTA hari ini.
    expect(p.kode).toMatch(/^PSN-\d{6}-[0-9A-F]{6}$/);
    expect(p.kode.slice(4, 10)).toBe(HARI_INI.slice(2).replaceAll("-", ""));

    // Tanpa nama layanan di judul: nama layanan bisa mengungkap kondisi
    // kesehatan (§5.3).
    expect(await itemUntuk(p.id)).toEqual([
      {
        jenis: "sesi",
        booking_request_id: id,
        product_id: null,
        judul_beku: "Sesi kunjungan PADMA",
        harga_beku: r.layanan,
        urutan: 1,
      },
      {
        jenis: "sesi",
        booking_request_id: id,
        product_id: null,
        judul_beku: "Biaya transport",
        harga_beku: r.transport,
        urutan: 2,
      },
    ]);

    expect(await jejakUntuk(p.id)).toEqual([
      { kejadian: "dibuat", keterangan: "tagihan sesi", padma_id: PADMA_ID },
    ]);

    const b = await pengajuan(id);
    expect(b.status).toBe("menunggu_bayar");
    expect(b.status_bayar).toBe("belum");
    expect(await tenggatSamaDenganPesanan(id, p.id)).toBe(true);
  });

  it("setiap terbit dan terbit ulang mengosongkan email_tagihan_pada", async () => {
    // Tanda "email terkirim" di panel harus tentang tagihan INI.
    const id = await pengajuanSiap();
    await ubahPengajuan(id, { email_tagihan_pada: new Date().toISOString() });
    expect((await terbit(id)).error).toBeNull();
    expect((await pengajuan(id)).email_tagihan_pada).toBeNull();

    await ubahPengajuan(id, { email_tagihan_pada: new Date().toISOString() });
    expect((await terbit(id)).error).toBeNull();
    expect((await pengajuan(id)).email_tagihan_pada).toBeNull();
  });

  it("transport 0 -> SATU item, jumlah_item 1", async () => {
    const id = await pengajuanSiap({ lon: LON_ALAMAT["0_5"] });
    expect(await rincian(id)).toMatchObject({ jenjang: "0_5", transport: 0, sebab: null });

    expect((await terbit(id)).error).toBeNull();
    const [p] = await pesananUntuk(id);
    expect(p.jumlah_item).toBe(1);
    expect(await itemUntuk(p.id)).toEqual([
      expect.objectContaining({ judul_beku: "Sesi kunjungan PADMA", harga_beku: HARGA_LAMA, urutan: 1 }),
    ]);
  });
});

// ---------------------------------------------------------------------------
// Tenggat: least(now + JAM_TENGGAT_PESANAN, jam kunjungan di Asia/Jakarta)
// ---------------------------------------------------------------------------

describe("tenggat tagihan sesi", () => {
  it("kunjungan tiga hari lagi -> now + JAM_TENGGAT_PESANAN jam (±60 detik)", async () => {
    const id = await pengajuanSiap({ tanggal: geserHari(HARI_INI, 3), jam: "09:00" });
    const sebelum = Date.now();
    expect((await terbit(id)).error).toBeNull();
    const sesudah = Date.now();
    const [p] = await pesananUntuk(id);
    const tenggat = Date.parse(p.kedaluwarsa_pada);
    expect(tenggat).toBeGreaterThanOrEqual(sebelum + JAM_TENGGAT_PESANAN * JAM - 60_000);
    expect(tenggat).toBeLessThanOrEqual(sesudah + JAM_TENGGAT_PESANAN * JAM + 60_000);
    expect(await tenggatSamaDenganPesanan(id, p.id)).toBe(true);
  });

  it("kunjungan ±3 jam lagi -> tenggat = jam mulai kunjungan (lebih dulu dari 24 jam)", async () => {
    const mulai = keAtasSetengahJam(Date.now() + 3 * JAM);
    const { tanggal, jam } = dindingJakarta(mulai);
    const id = await pengajuanSiap({ tanggal, jam });
    expect((await terbit(id)).error).toBeNull();
    const [p] = await pesananUntuk(id);
    expect(Date.parse(p.kedaluwarsa_pada)).toBe(mulai);
    expect(await tenggatSamaDenganPesanan(id, p.id)).toBe(true);
  });

  it("Review Focus 1: kunjungan 2 jam lagi dibaca dalam kalender JAKARTA, bukan UTC", async () => {
    // Postgres dan Vercel berjalan UTC. `tanggal + jam_mulai` yang dibaca
    // sebagai UTC jatuh tujuh jam terlambat — tenggat yang seharusnya tepat di
    // jam kunjungan menjadi tujuh jam SESUDAH bidan datang.
    const mulai = keAtasSetengahJam(Date.now() + 2 * JAM);
    const { tanggal, jam } = dindingJakarta(mulai);
    const id = await pengajuanSiap({ tanggal, jam });
    expect((await terbit(id)).error).toBeNull();
    const [p] = await pesananUntuk(id);
    expect(Date.parse(p.kedaluwarsa_pada)).toBe(Date.parse(`${tanggal}T${jam}:00+07:00`));
  });

  it("jam kunjungan sudah lewat -> jam_kunjungan_lewat, nol pesanan, status tetap", async () => {
    const mulai = keBawahSetengahJam(Date.now() - JAM);
    const { tanggal, jam } = dindingJakarta(mulai);
    const id = await pengajuanSiap({ tanggal, jam });
    const { error } = await terbit(id);
    expect(galatSebab(error)).toEqual({
      code: "P0001",
      message: "jam_kunjungan_lewat",
      hint: "sebab_tagihan",
    });
    expect(await pesananUntuk(id)).toEqual([]);
    expect((await pengajuan(id)).status).toBe("mitra_siap");
  });
});

// ---------------------------------------------------------------------------
// Penolakan yang bisa ditindak admin
// ---------------------------------------------------------------------------

describe("tagihan tidak lengkap -> galat ber-hint sebab_tagihan dan nol pesanan", () => {
  async function tanpaTarifTransport15_20<T>(fn: () => Promise<T>): Promise<T> {
    // Tarif transport berlaku global dan semua jenjang bertarif sejak seed,
    // sedangkan kunjungan harus di masa depan. Satu-satunya jalan menuju
    // "tarif transport kosong" adalah melepas baris jenjang 15_20 SEMENTARA,
    // lalu menyisipkannya kembali persis (id dan nilainya) apa pun hasilnya.
    const { data: cadangan } = await wajib(
      svc.from("transport_rates").select("*").eq("jenjang", "15_20"),
    );
    expect((cadangan ?? []).length).toBeGreaterThan(0);
    await wajib(svc.from("transport_rates").delete().eq("jenjang", "15_20"));
    try {
      return await fn();
    } finally {
      await wajib(svc.from("transport_rates").insert(cadangan!));
    }
  }

  const kasus: Array<[string, OpsiPengajuan]> = [
    ["mitra_tanpa_titik", { mitra: MITRA_TANPA_TITIK }],
    ["alamat_tanpa_pin", { lon: null }],
    ["tarif_varian_kosong", { varian: VARIAN_TANPA_TARIF }],
    ["tarif_transport_kosong", { lon: LON_ALAMAT["15_20"] }],
  ];

  it.each(kasus)("%s", async (sebab, opsi) => {
    const id = await pengajuanSiap(opsi);
    const jalankan = async () => {
      expect((await rincian(id)).sebab).toBe(sebab);
      return terbit(id);
    };
    const { error } =
      sebab === "tarif_transport_kosong" ? await tanpaTarifTransport15_20(jalankan) : await jalankan();
    expect(galatSebab(error)).toEqual({ code: "P0001", message: sebab, hint: "sebab_tagihan" });
    expect(await pesananUntuk(id)).toEqual([]);
    const b = await pengajuan(id);
    expect(b.status).toBe("mitra_siap");
    expect(b.tenggat).toBeNull();
  });

  it("urutan sebab: tarif varian DAN tarif transport kosong -> tarif_varian_kosong", async () => {
    // Urutan yang sama dengan rumus TS lama: admin hanya bisa menindak satu
    // hal pada satu waktu, dan tarif varian yang paling sering hilang.
    const id = await pengajuanSiap({ varian: VARIAN_TANPA_TARIF, lon: LON_ALAMAT["15_20"] });
    const r = await tanpaTarifTransport15_20(() => rincian(id));
    expect(r).toEqual({ layanan: null, transport: null, jenjang: "15_20", sebab: "tarif_varian_kosong" });
  });

  it("total Rp0 -> total_nol, nol pesanan", async () => {
    // DOKU tidak bisa menagih Rp0, dan pesanan Rp0 tidak punya jalan ke lunas.
    const id = await pengajuanSiap({ varian: VARIAN_GRATIS, lon: LON_ALAMAT["0_5"] });
    expect(await rincian(id)).toEqual({ layanan: 0, transport: 0, jenjang: "0_5", sebab: null });
    const { error } = await terbit(id);
    expect(galatSebab(error)).toEqual({ code: "P0001", message: "total_nol", hint: "sebab_tagihan" });
    expect(await pesananUntuk(id)).toEqual([]);
    expect((await pengajuan(id)).status).toBe("mitra_siap");
  });

  it("layanan Rp0 dengan transport berbayar tetap terbit — yang ditolak TOTAL nol", async () => {
    const id = await pengajuanSiap({ varian: VARIAN_GRATIS });
    const r = await rincian(id);
    expect(r.layanan).toBe(0);
    expect(r.transport).toBeGreaterThan(0);
    expect((await terbit(id)).error).toBeNull();
    const [p] = await pesananUntuk(id);
    expect((await itemUntuk(p.id)).map((i) => i.harga_beku)).toEqual([0, r.transport]);
  });

  it("bidan nonaktif -> bidan_nonaktif", async () => {
    const id = await pengajuanSiap({ mitra: MITRA_NONAKTIF });
    const { error } = await terbit(id);
    expect(galatSebab(error)).toEqual({ code: "P0001", message: "bidan_nonaktif", hint: "sebab_tagihan" });
    expect(await pesananUntuk(id)).toEqual([]);
  });

  it("status di luar mitra_siap/menunggu_bayar -> permintaan_tidak_siap", async () => {
    const id = await pengajuanSiap();
    await ubahPengajuan(id, { status: "mencari_mitra", partner_id: null });
    const { error } = await terbit(id);
    expect(galatSebab(error)).toEqual({
      code: "P0001",
      message: "permintaan_tidak_siap",
      hint: "sebab_tagihan",
    });
    expect(await pesananUntuk(id)).toEqual([]);
  });

  it("id yang tidak ada -> permintaan_tidak_siap", async () => {
    const { error } = await terbit(randomUUID());
    expect(error?.message).toBe("permintaan_tidak_siap");
  });
});

// ---------------------------------------------------------------------------
// Hak akses
// ---------------------------------------------------------------------------

describe("hak akses", () => {
  it("klien yang login ditolak 42501 oleh KEDUA fungsi, nol pesanan", async () => {
    const id = await pengajuanSiap();
    const klien = await signInAs("ananda@padma.test");
    // Pesan gerbang ikut diperiksa: `terbitkan_tagihan_sesi` memanggil
    // `rincian_tagihan_permintaan` yang bergerbang sendiri, jadi 42501 saja
    // tetap hijau walau gerbang fungsi PENERBIT hilang.
    const t = await terbit(id, klien);
    expect(t.error?.code).toBe("42501");
    expect(t.error?.message).toBe("Hanya staf yang boleh menerbitkan tagihan.");
    const r = await klien.rpc("rincian_tagihan_permintaan", { p_permintaan_id: id });
    expect(r.error?.code).toBe("42501");
    expect(r.error?.message).toBe("Hanya staf yang boleh membaca rincian tagihan.");
    expect(await pesananUntuk(id)).toEqual([]);
    expect((await pengajuan(id)).status).toBe("mitra_siap");
  });

  it("anon tidak punya EXECUTE atas kedua fungsi", async () => {
    const [hak] = await querySql<{ terbit: boolean; rincian: boolean }>(
      `select has_function_privilege('anon', 'public.terbitkan_tagihan_sesi(uuid)', 'execute') as terbit,
              has_function_privilege('anon', 'public.rincian_tagihan_permintaan(uuid)', 'execute') as rincian`,
    );
    expect(hak).toEqual({ terbit: false, rincian: false });
  });

  it("hanya id pengajuan yang diterima — tidak ada angka dari pemanggil", async () => {
    const baris = await querySql<{ nama: string; args: string }>(
      `select p.proname as nama, pg_get_function_arguments(p.oid) as args
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('terbitkan_tagihan_sesi', 'rincian_tagihan_permintaan')
        order by 1`,
    );
    expect(baris).toEqual([
      { nama: "rincian_tagihan_permintaan", args: "p_permintaan_id uuid" },
      { nama: "terbitkan_tagihan_sesi", args: "p_permintaan_id uuid" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Terbit ulang dan kunci "uang sudah masuk" (§6.5)
// ---------------------------------------------------------------------------

describe("terbit ulang dari menunggu_bayar", () => {
  it("pesanan lama dibatalkan berjejak, pesanan baru terbuka, tenggat ikut pesanan baru", async () => {
    const id = await pengajuanSiap();
    const pertama = await terbit(id);
    expect(pertama.error).toBeNull();
    const kedua = await terbit(id);
    expect(kedua.error).toBeNull();
    expect(kedua.data).not.toBe(pertama.data);

    const ps = await pesananUntuk(id);
    expect(ps.map((p) => [p.id, p.status])).toEqual([
      [pertama.data, "dibatalkan"],
      [kedua.data, "menunggu_bayar"],
    ]);
    expect(ps[0].ditutup_pada).not.toBeNull();
    expect(await jejakUntuk(ps[0].id)).toEqual([
      { kejadian: "dibuat", keterangan: "tagihan sesi", padma_id: PADMA_ID },
      { kejadian: "dibatalkan", keterangan: "tagihan diterbitkan ulang", padma_id: PADMA_ID },
    ]);
    expect(await itemUntuk(ps[1].id)).toHaveLength(2);
    expect(Date.parse(ps[1].kedaluwarsa_pada)).toBeGreaterThan(Date.parse(ps[0].kedaluwarsa_pada));
    expect(await tenggatSamaDenganPesanan(id, ps[1].id)).toBe(true);
    expect((await pengajuan(id)).status).toBe("menunggu_bayar");
  });

  it.each(["lunas", "ditahan"])("pesanan %s -> uang_sudah_masuk, tidak ada pesanan baru", async (status) => {
    const id = await pengajuanSiap();
    const { data: p1 } = await terbit(id);
    await tandaiPesanan(p1 as string, { status, ditutup_pada: new Date().toISOString() });

    const { error } = await terbit(id);
    expect(galatSebab(error)).toEqual({ code: "P0001", message: "uang_sudah_masuk", hint: "sebab_tagihan" });
    const ps = await pesananUntuk(id);
    expect(ps.map((p) => p.status)).toEqual([status]);
  });

  it("lunas_setelah_tutup yang belum ditutup -> uang_sudah_masuk; sesudah tutup_tinjauan -> sah", async () => {
    const id = await pengajuanSiap();
    const { data: p1 } = await terbit(id);
    const { data: p2 } = await terbit(id);
    // Uang mendarat di pesanan PERTAMA yang sudah ditutup terbit ulang.
    await tandaiPesanan(p1 as string, {
      sebab_tinjauan: "lunas_setelah_tutup",
      butuh_tinjauan_pada: new Date().toISOString(),
    });

    const ditolak = await terbit(id);
    expect(galatSebab(ditolak.error)).toEqual({
      code: "P0001",
      message: "uang_sudah_masuk",
      hint: "sebab_tagihan",
    });
    expect((await pesananUntuk(id)).find((p) => p.id === p2)?.status).toBe("menunggu_bayar");

    // Refund manual di luar aplikasi, lalu staf menutup tinjauannya.
    expect((await sesiAdmin.rpc("tutup_tinjauan", { p_pesanan_id: p1 })).error).toBeNull();
    const sah = await terbit(id);
    expect(sah.error).toBeNull();
    const ps = await pesananUntuk(id);
    expect(ps.filter((p) => p.status === "menunggu_bayar").map((p) => p.id)).toEqual([sah.data]);
  });

  it("status_bayar 'menunggu_verifikasi' (sisa alur QRIS) -> uang_sudah_masuk", async () => {
    const id = await pengajuanSiap();
    const { data: p1 } = await terbit(id);
    await ubahPengajuan(id, { status_bayar: "menunggu_verifikasi" });
    const { error } = await terbit(id);
    expect(galatSebab(error)).toEqual({ code: "P0001", message: "uang_sudah_masuk", hint: "sebab_tagihan" });
    expect((await pesananUntuk(id)).map((p) => [p.id, p.status])).toEqual([[p1, "menunggu_bayar"]]);
    expect((await pengajuan(id)).status_bayar).toBe("menunggu_verifikasi");
  });

  it("kunci uang juga berlaku dari mitra_siap: pengajuan lunas yang diputar ulang lewat ganti bidan tidak ditagih dua kali", async () => {
    // menunggu_bayar -> mencari_mitra -> mitra_siap adalah jalan SAH (ganti
    // bidan). Tanpa pemeriksaan di status asal mana pun, "Terbitkan tagihan"
    // berikutnya menerbitkan tagihan kedua untuk uang yang sudah masuk.
    const id = await pengajuanSiap();
    const { data: p1 } = await terbit(id);
    await tandaiPesanan(p1 as string, { status: "lunas", ditutup_pada: new Date().toISOString() });
    await ubahPengajuan(id, { status: "mencari_mitra", partner_id: null, tenggat: null });
    await ubahPengajuan(id, { status: "mitra_siap", partner_id: MITRA });

    const { error } = await terbit(id);
    expect(galatSebab(error)).toEqual({ code: "P0001", message: "uang_sudah_masuk", hint: "sebab_tagihan" });
    expect((await pesananUntuk(id)).map((p) => p.status)).toEqual(["lunas"]);
    expect((await pengajuan(id)).status).toBe("mitra_siap");
  });
});

// ---------------------------------------------------------------------------
// Review Focus 2 — dua klik bersamaan
// ---------------------------------------------------------------------------

describe("dua panggilan bersamaan", () => {
  async function periksaSatuTerbuka(id: string) {
    const ps = await pesananUntuk(id);
    const terbuka = ps.filter((p) => p.status === "menunggu_bayar");
    expect(terbuka).toHaveLength(1);
    expect(await tenggatSamaDenganPesanan(id, terbuka[0].id)).toBe(true);
    // Setiap pesanan yang ditutup punya TEPAT satu jejak `dibatalkan`.
    for (const p of ps.filter((x) => x.status === "dibatalkan")) {
      const j = await jejakUntuk(p.id);
      expect(j.filter((x) => x.kejadian === "dibatalkan")).toHaveLength(1);
    }
    return ps;
  }

  it("dua terbit ULANG bersamaan -> keduanya sah berurutan, tepat satu pesanan terbuka", async () => {
    const id = await pengajuanSiap();
    expect((await terbit(id)).error).toBeNull();
    const hasil = await Promise.all([terbit(id), terbit(id)]);
    expect(hasil.map((h) => h.error)).toEqual([null, null]);
    expect(await periksaSatuTerbuka(id)).toHaveLength(3);
  });

  it("dua terbit PERTAMA bersamaan dari mitra_siap -> tepat satu pesanan terbuka", async () => {
    const id = await pengajuanSiap();
    const hasil = await Promise.all([terbit(id), terbit(id)]);
    expect(hasil.map((h) => h.error)).toEqual([null, null]);
    expect(await periksaSatuTerbuka(id)).toHaveLength(2);
  });

  it("webhook yang sedang melunasi pesanan lama membuat terbit ulang MENUNGGU, lalu menolak dengan uang_sudah_masuk", async () => {
    // Urutan kunci pesanan -> pengajuan. Bila predikat uang dibaca sebelum
    // pesanan terkunci, pelunasan yang belum commit tidak terlihat, pesanan
    // lama dilewati karena sudah bukan menunggu_bayar, dan tagihan KEDUA
    // terbit untuk klien yang sudah membayar.
    const id = await pengajuanSiap();
    const { data: p1 } = await terbit(id);
    const webhook = new Client({ connectionString: dbUrl() });
    await webhook.connect();
    try {
      await webhook.query("begin");
      await webhook.query("select id from public.orders where id = $1 for update", [p1]);
      await webhook.query(
        `update public.orders set status = 'lunas', lunas_pada = now(), ditutup_pada = now() where id = $1`,
        [p1],
      );

      let selesai = false;
      const ulang = terbit(id).then((h) => {
        selesai = true;
        return h;
      });
      await new Promise((r) => setTimeout(r, 750));
      expect(selesai).toBe(false);

      await webhook.query("commit");
      const { error } = await ulang;
      expect(galatSebab(error)).toEqual({ code: "P0001", message: "uang_sudah_masuk", hint: "sebab_tagihan" });
      const ps = await pesananUntuk(id);
      expect(ps.map((p) => [p.id, p.status])).toEqual([[p1, "lunas"]]);
      expect(ps.filter((p) => p.status === "menunggu_bayar")).toEqual([]);
    } finally {
      await webhook.query("rollback").catch(() => {});
      await webhook.end();
    }
  });

  it("kunci baris: panggilan kedua MENUNGGU transaksi pertama, lalu menjadi terbit ulang yang sah", async () => {
    // Deterministik, tidak bergantung pada keberuntungan penjadwalan:
    // transaksi pertama sengaja DITAHAN terbuka. Tanpa `for update` pada baris
    // pengajuan, panggilan kedua membaca `mitra_siap` yang basi, tidak melihat
    // pesanan pertama, lalu menabrak indeks unik per pengajuan (23505) — admin
    // mendapat galat mentah untuk klik yang sah.
    const id = await pengajuanSiap();
    const t1 = new Client({ connectionString: dbUrl() });
    await t1.connect();
    try {
      await t1.query("begin");
      await t1.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: ADMIN_UID, role: "authenticated" }),
      ]);
      await t1.query("set local role authenticated");
      const { rows } = await t1.query<{ id: string }>(
        "select public.terbitkan_tagihan_sesi($1) as id",
        [id],
      );

      let selesai = false;
      const kedua = terbit(id).then((h) => {
        selesai = true;
        return h;
      });
      await new Promise((r) => setTimeout(r, 750));
      expect(selesai).toBe(false);

      await t1.query("commit");
      const { data, error } = await kedua;
      expect(error).toBeNull();

      const ps = await periksaSatuTerbuka(id);
      expect(ps.map((p) => [p.id, p.status])).toEqual([
        [rows[0].id, "dibatalkan"],
        [data, "menunggu_bayar"],
      ]);
    } finally {
      await t1.query("rollback").catch(() => {});
      await t1.end();
    }
  });
});

// ---------------------------------------------------------------------------
// D1 — kesetaraan dengan rumus TS lama, sebelum rumus itu dihapus (B7)
// ---------------------------------------------------------------------------

describe("rincian_tagihan_permintaan setara dengan rumus TS lama (D1)", () => {
  /** Rumus TS lama, diberi baris tarif yang sama dan jenjang dihitung persis seperti pemanggilnya dulu. */
  async function rumusLama(id: string) {
    const [p] = await querySql<{
      variant_id: string;
      tanggal: string;
      alamat_lat: number | null;
      alamat_lon: number | null;
      lat: number | null;
      lon: number | null;
    }>(
      `select b.variant_id, b.tanggal::text, b.alamat_lat, b.alamat_lon, m.lat, m.lon
         from public.booking_requests b left join public.partners m on m.id = b.partner_id
        where b.id = $1`,
      [id],
    );
    const { data: tarif } = await wajib(
      svc.from("variant_rates").select("variant_id, harga_klien, berlaku_sejak"),
    );
    const { data: tarifTransport } = await wajib(
      svc.from("transport_rates").select("jenjang, tarif_klien, berlaku_sejak"),
    );
    let jenjang: JenjangTransport | null = null;
    if (p.lat != null && p.lon != null && p.alamat_lat != null && p.alamat_lon != null) {
      const { data: km } = await svc.rpc("jarak_km", {
        lat1: p.lat,
        lon1: p.lon,
        lat2: p.alamat_lat,
        lon2: p.alamat_lon,
      });
      const { data: j } = await svc.rpc("jenjang_dari_jarak", { km: km ?? 0 });
      jenjang = (j as JenjangTransport | null) ?? null;
    }
    return hitungTagihanPengajuan({
      variantId: p.variant_id,
      tanggal: p.tanggal,
      jenjang,
      sebabJenjangNull: p.lat != null && p.lon != null ? "alamat_tanpa_pin" : "mitra_tanpa_titik",
      tarif: (tarif ?? []).map((t) => ({
        variantId: t.variant_id as string,
        hargaKlien: t.harga_klien as number,
        berlakuSejak: t.berlaku_sejak as string,
      })),
      tarifTransport: (tarifTransport ?? []).map((t) => ({
        jenjang: t.jenjang as JenjangTransport,
        tarifKlien: t.tarif_klien as number,
        berlakuSejak: t.berlaku_sejak as string,
      })),
    });
  }

  const fixture: Array<[string, OpsiPengajuan, Partial<Rincian>]> = [
    ["jenjang terisi (5_10)", {}, { layanan: HARGA_LAMA, jenjang: "5_10", sebab: null }],
    ["tanpa pin alamat", { lon: null }, { layanan: HARGA_LAMA, jenjang: null, transport: null, sebab: "alamat_tanpa_pin" }],
    [
      "tarif varian berganti di antara hari ini dan tanggal kunjungan",
      { tanggal: geserHari(HARI_INI, 10) },
      { layanan: HARGA_BARU, jenjang: "5_10", sebab: null },
    ],
    ["transport nol (0_5)", { lon: LON_ALAMAT["0_5"] }, { layanan: HARGA_LAMA, jenjang: "0_5", transport: 0, sebab: null }],
    ["mitra tanpa titik", { mitra: MITRA_TANPA_TITIK }, { layanan: HARGA_LAMA, jenjang: null, sebab: "mitra_tanpa_titik" }],
    [
      "mitra tanpa titik DAN alamat tanpa pin (titik mitra didahulukan)",
      { mitra: MITRA_TANPA_TITIK, lon: null },
      { layanan: HARGA_LAMA, jenjang: null, transport: null, sebab: "mitra_tanpa_titik" },
    ],
    ["tarif varian kosong", { varian: VARIAN_TANPA_TARIF }, { layanan: null, jenjang: "5_10", sebab: "tarif_varian_kosong" }],
  ];

  async function samaDenganRumusLama(id: string, harapan: Partial<Rincian>): Promise<void> {
    const sql = await rincian(id);
    // Angka mutlak lebih dulu: kesetaraan dua rumus yang sama-sama salah
    // (mis. keduanya null) tidak membuktikan apa pun.
    expect(sql).toMatchObject(harapan);

    const ts = await rumusLama(id);
    expect(sql).toEqual({
      layanan: ts.layanan,
      transport: ts.transport,
      jenjang: ts.jenjang,
      sebab: ts.sebab,
    });

    // Jalur penuh yang dipakai produksi sebelum B2 (bacaan + rumus + format).
    const [lama] = await daftarTagihanPengajuanAdmin({ permintaanId: id });
    expect(lama.hargaLayanan).toBe(sql.layanan === null ? null : formatRupiah(sql.layanan));
    expect(lama.hargaTransport).toBe(sql.transport === null ? null : formatRupiah(sql.transport));
    expect(lama.labelJenjang).toBe(sql.jenjang === null ? null : LABEL_JENJANG[sql.jenjang]);
    expect(lama.sebab).toBe(sql.sebab);
  }

  it.each(fixture)("%s", async (_nama, opsi, harapan) => {
    await samaDenganRumusLama(await pengajuanSiap(opsi), harapan);
  });

  it("tarif TRANSPORT berganti di antara hari ini dan tanggal kunjungan", async () => {
    // Aturan "berlaku pada tanggal sesi" berlaku untuk transport juga. Baris
    // tarif sela ini global, jadi ia hidup hanya selama uji ini.
    const TARIF_SELA = 12_345;
    const { data: baris } = await wajib(
      svc
        .from("transport_rates")
        .insert({ jenjang: "5_10", tarif_klien: TARIF_SELA, honor_mitra: 0, berlaku_sejak: TGL_TARIF_BARU })
        .select("id")
        .single<{ id: string }>(),
    );
    try {
      const sebelum = await pengajuanSiap({ tanggal: geserHari(HARI_INI, 3) });
      const sesudah = await pengajuanSiap({ tanggal: geserHari(HARI_INI, 10), waktu: "sore" });
      const lama = (await rincian(sebelum)).transport;
      expect(lama).not.toBe(TARIF_SELA);
      await samaDenganRumusLama(sebelum, { jenjang: "5_10", transport: lama, sebab: null });
      await samaDenganRumusLama(sesudah, { jenjang: "5_10", transport: TARIF_SELA, sebab: null });
    } finally {
      await svc.from("transport_rates").delete().eq("id", baris!.id);
    }
  });
});

// ---------------------------------------------------------------------------
// Angka beku
// ---------------------------------------------------------------------------

describe("angka beku", () => {
  it("menaikkan tarif sesudah terbit tidak mengubah pesanan yang ada; terbit ulang memakai tarif baru", async () => {
    const id = await pengajuanSiap({ tanggal: geserHari(HARI_INI, 3) });
    const { data: p1 } = await terbit(id);
    expect((await itemUntuk(p1 as string))[0].harga_beku).toBe(HARGA_LAMA);

    await wajib(
      svc.from("variant_rates").insert({
        variant_id: VARIAN,
        harga_klien: HARGA_SELA,
        honor_mitra: 100_000,
        berlaku_sejak: TGL_TARIF_SELA,
      }),
    );
    expect((await rincian(id)).layanan).toBe(HARGA_SELA);
    expect((await itemUntuk(p1 as string))[0].harga_beku).toBe(HARGA_LAMA);

    const { data: p2, error } = await terbit(id);
    expect(error).toBeNull();
    expect((await itemUntuk(p2 as string))[0].harga_beku).toBe(HARGA_SELA);
    expect((await itemUntuk(p1 as string))[0].harga_beku).toBe(HARGA_LAMA);
  });
});

// ---------------------------------------------------------------------------
// Server action `terbitkanTagihan` di atas RPC
// ---------------------------------------------------------------------------

describe("terbitkanTagihan memanggil terbitkan_tagihan_sesi", () => {
  it("berhasil: satu pesanan sesi terbuka, pengajuan menunggu_bayar", async () => {
    const id = await pengajuanSiap();
    expect(await terbitkanTagihan(id)).toEqual({ ok: true });
    const ps = await pesananUntuk(id);
    expect(ps.map((p) => [p.jenis, p.status])).toEqual([["sesi", "menunggu_bayar"]]);
    expect(await tenggatSamaDenganPesanan(id, ps[0].id)).toBe(true);
  });

  it.each([
    ["alamat_tanpa_pin", { lon: null }],
    ["bidan_nonaktif", { mitra: MITRA_NONAKTIF }],
    ["total_nol", { varian: VARIAN_GRATIS, lon: LON_ALAMAT["0_5"] }],
  ] as Array<[keyof typeof KALIMAT_SEBAB_ADMIN, OpsiPengajuan]>)(
    "galat ber-hint '%s' menjadi kalimat admin, bukan kode Postgres",
    async (sebab, opsi) => {
      const id = await pengajuanSiap(opsi);
      const hasil = await terbitkanTagihan(id);
      expect(hasil.ok).toBe(false);
      expect(hasil.ok === false && hasil.pesan).toContain(KALIMAT_SEBAB_ADMIN[sebab]);
      expect(await pesananUntuk(id)).toEqual([]);
    },
  );

  it("uang sudah masuk -> kalimat admin uang_sudah_masuk", async () => {
    const id = await pengajuanSiap();
    expect(await terbitkanTagihan(id)).toEqual({ ok: true });
    const [p] = await pesananUntuk(id);
    await tandaiPesanan(p.id, { status: "lunas", ditutup_pada: new Date().toISOString() });
    const hasil = await terbitkanTagihan(id);
    expect(hasil.ok === false && hasil.pesan).toContain(KALIMAT_SEBAB_ADMIN.uang_sudah_masuk);
  });
});
