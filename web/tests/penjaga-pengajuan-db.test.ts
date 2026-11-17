/**
 * Pembatalan, ganti bidan, dan penjaga pengajuan bertagihan (B4, spec §6.3
 * batal klien, §6.5, §6.7 `status_bayar`).
 *
 * Yang dijaga di sini adalah kegagalan yang paling mahal di sekitar tagihan
 * sesi yang masih terbuka atau sudah dibayar:
 *
 *  - pengajuan yang uangnya SUDAH masuk ikut dibatalkan (oleh klien, admin,
 *    atau jalur REST mana pun) — uang orang lalu tidak punya sesi dan tidak
 *    punya pengajuan. Penjaganya berlaku untuk SEMUA peran, termasuk fungsi
 *    security definer dan service role;
 *  - pesanan lama yang masih bisa dibayar sesudah pengajuannya batal atau
 *    masukan harganya (bidan, varian, tanggal, jam, titik alamat) berubah —
 *    klien lalu membayar harga yang sudah tidak berlaku;
 *  - staf yang menulis `booking_requests.status_bayar` langsung lewat REST,
 *    tanpa jejak, tanpa penjaga transisi;
 *  - urutan kunci pengajuan -> pesanan (kebalikan webhook) yang membuat
 *    pembatalan berbalapan dengan pelunasan berakhir deadlock (Ruling 7).
 *
 * Klien uji BER-AKUN (`klien-kedua`) dipakai karena pembatalan klien kini RPC
 * bergerbang `auth.uid()`; layanan, varian, dan dua bidan bertitik MILIK
 * berkas ini (koordinat mitra seed dikosongkan berkas lain).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { dbUrl, querySql } from "./helpers/db";
import { skriningHijau } from "./helpers/skrining";
import {
  EMAIL_KLIEN_KEDUA,
  KLIEN_KEDUA_ID,
  bongkarKlienKedua,
  siapkanKlienKedua,
} from "./helpers/klien-kedua";
import { hariIniJakarta } from "@/lib/passport/waktu";
import { geserHari } from "@/lib/owner/pekan";
import { rakitInvoice } from "@/lib/pesanan/order-id";
import { STATUS_ANTRE, STATUS_PERMINTAAN } from "@/lib/jadwal/status";
import { normalkanAlamat } from "@/lib/transport/alamat";
import { KALIMAT_TAGIHAN_DITUTUP } from "@/lib/tagihan/terbuka";

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
}));

const { batalkanPengajuan } = await import("@/lib/passport/aksi");
const { perbaruiPermintaan } = await import("@/app/admin/sesi/aksi-ubah-permintaan");
const { verifikasiPengajuan } = await import("@/app/admin/bayar/aksi-pengajuan");
// Dimuat MALAS: berkas ini lahir di B4. Impor di puncak berkas membuat seluruh
// berkas gagal dimuat sebelum satu uji basis data pun sempat merah karena
// alasannya sendiri.
const aksiTagihan = () => import("@/app/admin/sesi/aksi-tagihan");

const svc = createAdminSupabase();

const KLIEN = KLIEN_KEDUA_ID;
const SVC_B4 = "11111111-1111-1111-1111-1111111114b4";
const VARIAN = "77777777-7777-7777-7777-7777777774b4";
const VARIAN_B = "77777777-7777-7777-7777-7777777775b4";
const MITRA = "33333333-3333-3333-3333-3333333334b4";
const MITRA_B = "33333333-3333-3333-3333-3333333335b4";

const TITIK_MITRA = { lat: -7.96662, lon: 112.632632 };
const TITIK_MITRA_B = { lat: -7.9801, lon: 112.6402 };
const ALAMAT = { teks: "Jl. Uji Penjaga Pengajuan No. 4", lat: -7.9666, lon: 112.6966 };

/** Kalimat P0001 penjaga beruang — VERBATIM dari brief B4. */
const KALIMAT_UANG_MASUK_SQL = "Pembayaran pengajuan ini sudah masuk dan sedang diperiksa admin.";
/** Kalimat yang klien baca di Passport saat pembatalannya ditolak karena uang sudah masuk. */
/** Kalimat P0001 penjaga masukan harga baris warisan QRIS (Ruling 8). */
const KALIMAT_WARISAN_BERUANG =
  "Pembayaran QRIS pengajuan ini sudah masuk. Konfirmasi jadwalnya dulu, lalu jadwal ulang dari sesi.";
const KALIMAT_UANG_MASUK_KLIEN =
  "Pembayaran Anda untuk pengajuan ini sudah kami terima dan sedang diperiksa admin, " +
  "jadi pengajuan tidak bisa dibatalkan dari sini. Admin PADMA akan menghubungi Anda.";

const HARI_INI = hariIniJakarta();
const TGL_KUNJUNGAN = geserHari(HARI_INI, 3);

let sesiAdmin: SupabaseClient;
let sesiKlien: SupabaseClient;
let idAdmin: string;
let idKlien: string;

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

async function bersihkan(): Promise<void> {
  // Sesi DULU: `sessions.booking_request_id` (FK tanpa on delete) menahan
  // penghapusan pengajuan. Jejak audit sesi tanpa FK, jadi disapu sendiri.
  const { data: ss } = await svc.from("sessions").select("id").eq("client_id", KLIEN);
  const idSesi = (ss ?? []).map((s) => s.id as string);
  if (idSesi.length) {
    await svc.from("jejak_status_bayar").delete().in("sesi_id", idSesi);
    await svc.from("jejak_jadwal").delete().in("sesi_id", idSesi);
    const { error } = await svc.from("sessions").delete().in("id", idSesi);
    if (error) throw error;
  }
  const { data: ps } = await svc.from("orders").select("id").eq("client_id", KLIEN);
  const idPs = (ps ?? []).map((p) => p.id as string);
  if (idPs.length) {
    await svc.from("jejak_pesanan").delete().in("pesanan_id", idPs);
    await svc.from("notifikasi_pesanan").delete().in("pesanan_id", idPs);
    const { error } = await svc.from("orders").delete().in("id", idPs);
    if (error) throw error;
  }
  const { error: eb } = await svc.from("booking_requests").delete().eq("client_id", KLIEN);
  if (eb) throw eb;
  await svc.from("screenings").delete().eq("client_id", KLIEN);
}

async function wajib<T extends { error: unknown }>(p: PromiseLike<T>): Promise<T> {
  const hasil = await p;
  if (hasil.error) throw hasil.error;
  return hasil;
}

async function bongkarKatalog(): Promise<void> {
  await svc.from("variant_rates").delete().in("variant_id", [VARIAN, VARIAN_B]);
  await svc.from("service_variants").delete().eq("service_id", SVC_B4);
  await svc.from("services").delete().eq("id", SVC_B4);
  await svc.from("partners").delete().in("id", [MITRA, MITRA_B]);
}

beforeAll(async () => {
  await bersihkan();
  await bongkarKatalog();
  await siapkanKlienKedua();

  sesiAdmin = await signInAs("admin@padma.test");
  sesiKlien = await signInAs(EMAIL_KLIEN_KEDUA);
  idAdmin = (await sesiAdmin.auth.getUser()).data.user!.id;
  idKlien = (await sesiKlien.auth.getUser()).data.user!.id;

  // Layanan NONAKTIF: tidak pernah muncul di katalog berkas lain.
  await wajib(
    svc.from("services").insert({
      id: SVC_B4,
      phase_id: "prekonsepsi",
      nama: "PAD-UJI Layanan Penjaga Pengajuan",
      deskripsi: "fixture",
      aktif: false,
    }),
  );
  await wajib(
    svc.from("service_variants").insert([
      { id: VARIAN, service_id: SVC_B4, label: "Uji B4", urutan: 90 },
      { id: VARIAN_B, service_id: SVC_B4, label: "Uji B4 lain", urutan: 91 },
    ]),
  );
  await wajib(
    svc.from("variant_rates").insert([
      { variant_id: VARIAN, harga_klien: 300_000, honor_mitra: 100_000, berlaku_sejak: "2026-01-01" },
      { variant_id: VARIAN_B, harga_klien: 350_000, honor_mitra: 100_000, berlaku_sejak: "2026-01-01" },
    ]),
  );
  await wajib(
    svc.from("partners").insert([
      { id: MITRA, nama: "PAD-UJI Bidan B4", no_hp: "0811-9400-0001", aktif: true, ...TITIK_MITRA },
      { id: MITRA_B, nama: "PAD-UJI Bidan B4 Pengganti", no_hp: "0811-9400-0002", aktif: true, ...TITIK_MITRA_B },
    ]),
  );
});

beforeEach(async () => {
  ref.sesi = sesiAdmin;
  await bersihkan();
  await wajib(svc.from("partners").update({ aktif: true }).in("id", [MITRA, MITRA_B]));
});

afterAll(async () => {
  await bersihkan();
  await bongkarKatalog();
  await bongkarKlienKedua();
});

/**
 * Pengajuan `mitra_siap` lewat transisi SAH (diminta -> mencari_mitra ->
 * mitra_siap), sehingga setiap penjaga ikut memeriksanya.
 */
async function pengajuanSiap(tanggal: string = TGL_KUNJUNGAN): Promise<string> {
  const skrining = await skriningHijau(svc, KLIEN);
  const { data } = await wajib(
    svc
      .from("booking_requests")
      .insert({
        client_id: KLIEN,
        service_id: SVC_B4,
        variant_id: VARIAN,
        tanggal,
        jam_mulai: "09:00",
        preferensi_waktu: "pagi",
        alamat: ALAMAT.teks,
        alamat_lat: ALAMAT.lat,
        alamat_lon: ALAMAT.lon,
        status: "diminta",
        screening_id: skrining,
      })
      .select("id")
      .single<{ id: string }>(),
  );
  const id = data!.id;
  await wajib(svc.from("booking_requests").update({ status: "mencari_mitra" }).eq("id", id));
  await wajib(
    svc.from("booking_requests").update({ status: "mitra_siap", partner_id: MITRA }).eq("id", id),
  );
  return id;
}

/** Tagihan diterbitkan sungguhan lewat `terbitkan_tagihan_sesi` (B2) dengan sesi admin. */
async function bertagihan(): Promise<{ id: string; pesananId: string }> {
  const id = await pengajuanSiap();
  const { data, error } = await sesiAdmin.rpc("terbitkan_tagihan_sesi", { p_permintaan_id: id });
  if (error) throw error;
  return { id, pesananId: data as string };
}

/**
 * Baris WARISAN QRIS (§7): `menunggu_bayar` TANPA satu pun pesanan. Dibangun
 * dengan service role seperti tagihan lama sebelum P3.
 */
async function warisan(statusBayar: "belum" | "menunggu_verifikasi" | "lunas" = "belum"): Promise<string> {
  const id = await pengajuanSiap();
  await wajib(
    svc
      .from("booking_requests")
      .update({ status: "menunggu_bayar", tenggat: new Date(Date.now() + 24 * 3_600_000).toISOString() })
      .eq("id", id),
  );
  if (statusBayar !== "belum") {
    await wajib(svc.from("booking_requests").update({ status_bayar: statusBayar }).eq("id", id));
  }
  return id;
}

/** SUCCESS DOKU lewat `terapkan_notifikasi_gateway` sungguhan (service role, persis webhook). */
async function lunasi(pesananId: string) {
  const [p] = await querySql<{ kode: string; percobaan: number; total: number }>(
    `select o.kode, o.percobaan,
            (select coalesce(sum(i.harga_beku), 0)::int from public.order_items i where i.pesanan_id = o.id) as total
       from public.orders o where o.id = $1`,
    [pesananId],
  );
  return svc.rpc("terapkan_notifikasi_gateway", {
    p_invoice: rakitInvoice(p.kode, p.percobaan),
    p_status: "SUCCESS",
    p_transaksi_id: `trx-uji-b4-${randomUUID()}`,
    p_kanal: "VIRTUAL_ACCOUNT_BCA",
    p_nominal: p.total,
    p_sidik: randomUUID(),
    p_sumber: "webhook",
  });
}

/**
 * Pengajuan TERTAHAN: pesanan lunas, sesi tidak lahir (bidan nonaktif saat
 * uang mendarat), pengajuan tetap `menunggu_bayar` dengan `status_bayar`
 * 'belum'. Satu-satunya tanda "uang sudah masuk" di sini adalah pesanan lunas.
 */
async function tertahan(): Promise<{ id: string; pesananId: string }> {
  const t = await bertagihan();
  await wajib(svc.from("partners").update({ aktif: false }).eq("id", MITRA));
  const { data, error } = await lunasi(t.pesananId);
  expect(error).toBeNull();
  expect(data).toBe("diterapkan");
  await wajib(svc.from("partners").update({ aktif: true }).eq("id", MITRA));
  expect(await sesiUntuk(t.id)).toEqual([]);
  expect((await pesanan(t.pesananId)).status).toBe("lunas");
  expect(await pengajuan(t.id)).toMatchObject({ status: "menunggu_bayar", status_bayar: "belum" });
  return t;
}

type BarisPengajuan = {
  status: string;
  status_bayar: string;
  screening_id: string | null;
  partner_id: string | null;
  tanggal: string;
  jam_mulai: string;
  alamat: string;
  alamat_lat: number | null;
  alamat_lon: number | null;
};

async function pengajuan(id: string): Promise<BarisPengajuan> {
  const [b] = await querySql<BarisPengajuan>(
    `select status::text, status_bayar::text, screening_id, partner_id, tanggal::text,
            jam_mulai::text, alamat, alamat_lat, alamat_lon
       from public.booking_requests where id = $1`,
    [id],
  );
  return b;
}

type BarisPesanan = {
  id: string;
  status: string;
  ditutup_pada: Date | null;
  butuh_tinjauan_pada: Date | null;
  sebab_tinjauan: string | null;
};

async function pesanan(pesananId: string): Promise<BarisPesanan> {
  const [o] = await querySql<BarisPesanan>(
    `select id, status::text, ditutup_pada, butuh_tinjauan_pada, sebab_tinjauan
       from public.orders where id = $1`,
    [pesananId],
  );
  return o;
}

async function hargaBeku(pesananId: string): Promise<number[]> {
  const baris = await querySql<{ harga_beku: number }>(
    `select harga_beku from public.order_items where pesanan_id = $1 order by urutan`,
    [pesananId],
  );
  return baris.map((b) => b.harga_beku);
}

/** Keterangan jejak `dibatalkan` sebuah pesanan. */
async function sebabDibatalkan(pesananId: string): Promise<string[]> {
  const baris = await querySql<{ keterangan: string }>(
    `select keterangan from public.jejak_pesanan where pesanan_id = $1 and kejadian = 'dibatalkan'`,
    [pesananId],
  );
  return baris.map((b) => b.keterangan);
}

async function kejadian(pesananId: string): Promise<string[]> {
  const baris = await querySql<{ kejadian: string }>(
    `select kejadian::text from public.jejak_pesanan where pesanan_id = $1`,
    [pesananId],
  );
  return baris.map((b) => b.kejadian).sort();
}

async function sesiUntuk(id: string) {
  return querySql<{ id: string; partner_id: string; jam_mulai: string; kabari_bidan_sejak: Date | null }>(
    `select id, partner_id, jam_mulai::text, kabari_bidan_sejak from public.sessions where booking_request_id = $1`,
    [id],
  );
}

/** Pesanan terbuka DITUTUP oleh mesin: `dibatalkan`, berstempel, berjejak. */
async function harusTertutup(pesananId: string, sebab: RegExp): Promise<void> {
  const o = await pesanan(pesananId);
  expect(o.status).toBe("dibatalkan");
  expect(o.ditutup_pada).not.toBeNull();
  const jejak = await sebabDibatalkan(pesananId);
  expect(jejak).toHaveLength(1);
  expect(jejak[0]).toMatch(sebab);
}

/** Klien pg mentah yang bertindak sebagai pengguna `authenticated` bersesi `sub`. */
async function sebagai(k: Client, sub: string): Promise<void> {
  await k.query("set local role authenticated");
  await k.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub, role: "authenticated" }),
  ]);
}

function formUbah(isi: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(isi)) f.set(k, v);
  return f;
}

/**
 * Nominatim palsu (pola tests/admin-klien.test.ts): hanya URL Nominatim yang
 * dijawab; Supabase lokal diteruskan ke `fetch` terpagar. Jawabannya titik
 * yang JAUH dari alamat fixture, sehingga geocode yang terjadi diam-diam
 * pasti menggeser koordinat — dan menutup pesanan terbuka.
 */
function stubNominatim() {
  const asli = globalThis.fetch;
  const palsu = vi.fn(
    async () =>
      new Response(JSON.stringify([{ lat: "-7.9123", lon: "112.6012", addresstype: "road" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", (...args: Parameters<typeof fetch>) => {
    const url = args[0] instanceof Request ? args[0].url : String(args[0]);
    return url.includes("nominatim") ? palsu() : asli(...args);
  });
  return palsu;
}

// ---------------------------------------------------------------------------
// Pembatalan oleh klien (§6.3)
// ---------------------------------------------------------------------------

describe("klien membatalkan pengajuan menunggu_bayar yang tagihannya terbuka", () => {
  beforeEach(() => {
    ref.sesi = sesiKlien;
  });

  it("pengajuan dibatalkan_klien, pesanan terbukanya dibatalkan berjejak; skrining TIDAK dilepas (C1 J3)", async () => {
    const { id, pesananId } = await bertagihan();
    const sebelum = await pengajuan(id);

    expect(await batalkanPengajuan(id)).toEqual({ ok: true });

    const b = await pengajuan(id);
    expect(b.status).toBe("dibatalkan_klien");
    expect(b.screening_id).toBe(sebelum.screening_id);
    await harusTertutup(pesananId, /dibatalkan klien/);
  });

  it("SATU transaksi: pembatalan yang digulung ikut menggulung penutupan pesanannya", async () => {
    // Pesanan sudah tertutup DI DALAM transaksi pembatalan (bukan langkah
    // susulan dari TS), dan menggulung pembatalan menghidupkan pesanannya lagi.
    const { id, pesananId } = await bertagihan();
    const k = new Client({ connectionString: dbUrl() });
    await k.connect();
    try {
      await k.query("begin");
      await sebagai(k, idKlien);
      await k.query("select public.batalkan_pengajuan_saya($1)", [id]);
      await k.query("reset role");
      const { rows } = await k.query<{ status: string }>(
        "select status::text from public.orders where id = $1",
        [pesananId],
      );
      expect(rows[0].status).toBe("dibatalkan");
    } finally {
      await k.query("rollback").catch(() => {});
      await k.end();
    }
    expect((await pengajuan(id)).status).toBe("menunggu_bayar");
    expect((await pesanan(pesananId)).status).toBe("menunggu_bayar");
    expect(await sebabDibatalkan(pesananId)).toEqual([]);
  });

  it("SUCCESS yang mendarat SESUDAH pembatalan tertangkap sebagai lunas_setelah_tutup; nol sesi", async () => {
    const { id, pesananId } = await bertagihan();
    expect(await batalkanPengajuan(id)).toEqual({ ok: true });

    const { error } = await lunasi(pesananId);
    expect(error).toBeNull();

    const o = await pesanan(pesananId);
    expect(o.status).toBe("dibatalkan");
    expect(o.butuh_tinjauan_pada).not.toBeNull();
    expect(o.sebab_tinjauan).toBe("lunas_setelah_tutup");
    expect(await kejadian(pesananId)).toContain("lunas_setelah_tutup");
    expect(await sesiUntuk(id)).toEqual([]);
    expect((await pengajuan(id)).status).toBe("dibatalkan_klien");
  });

  it("keadaan asal yang boleh dibatalkan di SQL = STATUS_ANTRE di TS (satu daftar, dua tempat)", async () => {
    // batalkan_pengajuan_saya menyalin STATUS_ANTRE ke SQL. Dua daftar yang
    // harus sepakat; uji ini membandingkan keduanya untuk SETIAP status.
    const hasil: Record<string, boolean> = {};
    const STATUS = [...STATUS_PERMINTAAN];
    for (const [i, status] of STATUS.entries()) {
      const skrining = await skriningHijau(svc, KLIEN);
      const { data } = await wajib(
        svc
          .from("booking_requests")
          .insert({
            client_id: KLIEN,
            service_id: SVC_B4,
            variant_id: VARIAN,
            partner_id: MITRA,
            tanggal: geserHari(HARI_INI, 10 + i),
            jam_mulai: "09:00",
            preferensi_waktu: "pagi",
            alamat: ALAMAT.teks,
            status,
            tenggat: status === "menunggu_bayar" ? new Date(Date.now() + 3_600_000).toISOString() : null,
            screening_id: skrining,
          })
          .select("id")
          .single<{ id: string }>(),
      );
      const { error } = await sesiKlien.rpc("batalkan_pengajuan_saya", { p_permintaan_id: data!.id });
      const ok = error === null;
      // Berhasil berarti SUNGGUH dibatalkan; ditolak berarti tidak tersentuh.
      expect((await pengajuan(data!.id)).status, `dari ${status}`).toBe(ok ? "dibatalkan_klien" : status);
      hasil[status] = ok;
    }
    const diharapkan = Object.fromEntries(STATUS.map((s) => [s, STATUS_ANTRE.includes(s)]));
    expect(hasil).toEqual(diharapkan);
  });

  it("pengajuan milik klien LAIN tidak bisa dibatalkan (kalimat sama dengan 'tidak ada')", async () => {
    const { id, pesananId } = await bertagihan();
    const ananda = await signInAs("ananda@padma.test");
    const { error } = await ananda.rpc("batalkan_pengajuan_saya", { p_permintaan_id: id });
    expect(error?.code).toBe("P0001");
    expect(error?.message).toBe("Pengajuan ini sudah dikonfirmasi atau sudah dibatalkan sebelumnya.");
    expect((await pengajuan(id)).status).toBe("menunggu_bayar");
    expect((await pesanan(pesananId)).status).toBe("menunggu_bayar");
  });

  it("akun tanpa rekam klien (admin) ditolak 42501", async () => {
    const { id } = await bertagihan();
    const { error } = await sesiAdmin.rpc("batalkan_pengajuan_saya", { p_permintaan_id: id });
    expect(error?.code).toBe("42501");
    expect((await pengajuan(id)).status).toBe("menunggu_bayar");
  });
});

// ---------------------------------------------------------------------------
// Pengajuan TERTAHAN (uang sudah masuk) — Review Focus 3
// ---------------------------------------------------------------------------

describe("pengajuan tertahan berpesanan lunas: tidak ada jalan membatalkannya", () => {
  it("klien membatalkan -> ditolak dengan kalimat yang bisa dipahami, bukan galat mentah", async () => {
    const { id, pesananId } = await tertahan();
    ref.sesi = sesiKlien;

    expect(await batalkanPengajuan(id)).toEqual({ ok: false, pesan: KALIMAT_UANG_MASUK_KLIEN });

    // Kalimat SQL-nya sendiri VERBATIM — pemetaan di TS bersandar padanya.
    const { error } = await sesiKlien.rpc("batalkan_pengajuan_saya", { p_permintaan_id: id });
    expect(error?.code).toBe("P0001");
    expect(error?.message).toBe(KALIMAT_UANG_MASUK_SQL);

    expect((await pengajuan(id)).status).toBe("menunggu_bayar");
    expect((await pesanan(pesananId)).status).toBe("lunas");
  });

  it("klien lewat REST langsung (jalur lama yang masih dijaga policy) juga ditolak", async () => {
    const { id } = await tertahan();
    const { error } = await sesiKlien
      .from("booking_requests")
      .update({ status: "dibatalkan_klien" })
      .eq("id", id)
      .select("id");
    expect(error?.code).toBe("P0001");
    expect(error?.message).toBe(KALIMAT_UANG_MASUK_SQL);
    expect((await pengajuan(id)).status).toBe("menunggu_bayar");
  });

  it("batalkanPengajuanStaf ditolak dengan kalimat P0001; skrining tetap dipegang", async () => {
    const { id, pesananId } = await tertahan();
    const sebelum = await pengajuan(id);
    const { batalkanPengajuanStaf } = await aksiTagihan();

    expect(await batalkanPengajuanStaf(id)).toEqual({ ok: false, pesan: KALIMAT_UANG_MASUK_SQL });

    const b = await pengajuan(id);
    expect(b.status).toBe("menunggu_bayar");
    expect(b.screening_id).toBe(sebelum.screening_id);
    expect((await pesanan(pesananId)).status).toBe("lunas");
  });

  it("cariMitra lewat REST (menunggu_bayar -> mencari_mitra) ditolak; bidan tetap", async () => {
    const { id } = await tertahan();
    const { error } = await sesiAdmin
      .from("booking_requests")
      .update({ status: "mencari_mitra", partner_id: null })
      .eq("id", id)
      .select("id");
    expect(error?.code).toBe("P0001");
    expect(error?.message).toBe(KALIMAT_UANG_MASUK_SQL);
    expect(await pengajuan(id)).toMatchObject({ status: "menunggu_bayar", partner_id: MITRA });
  });

  it("service role pun ditolak: penjaga berlaku untuk SEMUA peran, bukan hanya peran API", async () => {
    const { id } = await tertahan();
    const { error } = await svc
      .from("booking_requests")
      .update({ status: "dibatalkan_tenggat" })
      .eq("id", id)
      .select("id");
    expect(error?.code).toBe("P0001");
    expect(error?.message).toBe(KALIMAT_UANG_MASUK_SQL);
    expect((await pengajuan(id)).status).toBe("menunggu_bayar");
  });

  it("jadwal TETAP bisa diubah (jalan pemulihan): pesanan lunas utuh, lalu salurkan_sesi melahirkan sesi berjam baru", async () => {
    const { id, pesananId } = await tertahan();
    const harga = await hargaBeku(pesananId);

    const r = await perbaruiPermintaan(
      id,
      formUbah({ alamat: ALAMAT.teks, tanggal: TGL_KUNJUNGAN, jam: "10:00" }),
    );
    expect(r).toEqual({ ok: true });
    expect((await pengajuan(id)).jam_mulai).toBe("10:00:00");
    expect((await pesanan(pesananId)).status).toBe("lunas");
    expect(await hargaBeku(pesananId)).toEqual(harga);
    // Pesanan lunas tidak disentuh penutup sama sekali — tidak juga jejaknya.
    expect(await sebabDibatalkan(pesananId)).toEqual([]);

    const { data, error } = await svc.rpc("salurkan_sesi", { p_pesanan_id: pesananId });
    expect(error).toBeNull();
    expect(data).toBe("terkonfirmasi");
    const [s] = await sesiUntuk(id);
    expect(s.jam_mulai).toBe("10:00:00");
  });
});

// ---------------------------------------------------------------------------
// Pembatalan oleh admin (§6.5)
// ---------------------------------------------------------------------------

describe("batalkanPengajuanStaf", () => {
  it("berpesanan terbuka -> dibatalkan_tenggat, skrining DILEPAS, pesanan terbuka dibatalkan berjejak", async () => {
    const { id, pesananId } = await bertagihan();
    const { batalkanPengajuanStaf } = await aksiTagihan();

    expect(await batalkanPengajuanStaf(id)).toEqual({ ok: true });

    const b = await pengajuan(id);
    expect(b.status).toBe("dibatalkan_tenggat");
    expect(b.screening_id).toBeNull();
    await harusTertutup(pesananId, /dibatalkan admin/);
  });

  it("baris WARISAN tanpa pesanan (status_bayar belum) -> sah, skrining dilepas", async () => {
    const id = await warisan("belum");
    const { batalkanPengajuanStaf } = await aksiTagihan();
    expect(await batalkanPengajuanStaf(id)).toEqual({ ok: true });
    expect(await pengajuan(id)).toMatchObject({ status: "dibatalkan_tenggat", screening_id: null });
  });

  it("baris warisan status_bayar menunggu_verifikasi (bukti QRIS sudah masuk) -> ditolak", async () => {
    const id = await warisan("menunggu_verifikasi");
    const { batalkanPengajuanStaf } = await aksiTagihan();
    expect(await batalkanPengajuanStaf(id)).toEqual({ ok: false, pesan: KALIMAT_UANG_MASUK_SQL });
    const b = await pengajuan(id);
    expect(b.status).toBe("menunggu_bayar");
    expect(b.screening_id).not.toBeNull();
  });

  it("pengajuan yang tidak sedang menunggu pembayaran -> ditolak dengan kalimat, tidak berubah", async () => {
    const id = await pengajuanSiap();
    const { batalkanPengajuanStaf } = await aksiTagihan();
    const r = await batalkanPengajuanStaf(id);
    expect(r).toEqual({
      ok: false,
      pesan: "Pengajuan ini tidak sedang menunggu pembayaran, jadi tidak bisa dibatalkan dari sini.",
    });
    expect((await pengajuan(id)).status).toBe("mitra_siap");
  });
});

// ---------------------------------------------------------------------------
// Masukan harga berubah saat pesanan terbuka (§6.5)
// ---------------------------------------------------------------------------

describe("masukan harga berubah saat pesanan masih terbuka -> pesanan itu ditutup", () => {
  it("perbaruiPermintaan mengubah jam_mulai pada menunggu_bayar -> pesanan terbuka dibatalkan", async () => {
    const { id, pesananId } = await bertagihan();
    const r = await perbaruiPermintaan(
      id,
      formUbah({ alamat: ALAMAT.teks, tanggal: TGL_KUNJUNGAN, jam: "10:00" }),
    );
    // B5 (Ruling 10.2): penutupan tagihan terbuka DIKABARKAN ke admin.
    expect(r).toEqual({ ok: true, pesan: KALIMAT_TAGIHAN_DITUTUP });
    expect(await pengajuan(id)).toMatchObject({ status: "menunggu_bayar", jam_mulai: "10:00:00" });
    await harusTertutup(pesananId, /jam/);
  });

  it("gantiBidanMenungguBayar -> bidan berganti, pesanan terbuka dibatalkan", async () => {
    const { id, pesananId } = await bertagihan();
    const { gantiBidanMenungguBayar } = await aksiTagihan();
    expect(await gantiBidanMenungguBayar(id, MITRA_B)).toEqual({
      ok: true,
      pesan: KALIMAT_TAGIHAN_DITUTUP,
    });
    expect(await pengajuan(id)).toMatchObject({ status: "menunggu_bayar", partner_id: MITRA_B });
    await harusTertutup(pesananId, /bidan/);
  });

  it("membetulkan TEKS alamat lewat formulir sungguhan (peta tidak disentuh) -> TANPA geocode, titik tetap, pesanan TETAP terbuka", async () => {
    // Formulir sungguhan: `PemilihLokasi` menyemai lat/lon dari titik
    // tersimpan dan mengirim `pin_disentuh` KOSONG selama peta tidak disentuh.
    // Geocode ulang di sini akan menggeser (atau mengosongkan) titiknya dan
    // menutup tagihan tanpa admin pernah memutuskan memindahkan titik.
    const teksBaru = "Jl. Uji Penjaga Pengajuan No. 4, RT 02 (pagar hijau)";
    await svc.from("geocode_cache").delete().eq("alamat_normal", normalkanAlamat(teksBaru));
    const nominatim = stubNominatim();
    try {
      const { id, pesananId } = await bertagihan();
      const r = await perbaruiPermintaan(
        id,
        formUbah({
          alamat: teksBaru,
          tanggal: TGL_KUNJUNGAN,
          jam: "09:00",
          pin_disentuh: "",
          lat: String(ALAMAT.lat),
          lon: String(ALAMAT.lon),
        }),
      );
      expect(r).toEqual({ ok: true });
      const b = await pengajuan(id);
      expect(b.alamat).toBe(teksBaru);
      expect({ lat: b.alamat_lat, lon: b.alamat_lon }).toEqual({ lat: ALAMAT.lat, lon: ALAMAT.lon });
      expect(nominatim).not.toHaveBeenCalled();
      expect((await pesanan(pesananId)).status).toBe("menunggu_bayar");
      expect(await sebabDibatalkan(pesananId)).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
      await svc.from("geocode_cache").delete().eq("alamat_normal", normalkanAlamat(teksBaru));
    }
  });

  it.each([
    ["partner_id", { partner_id: MITRA_B }, /bidan/],
    ["variant_id", { variant_id: VARIAN_B }, /varian/],
    ["tanggal", { tanggal: geserHari(HARI_INI, 4) }, /tanggal/],
    ["jam_mulai", { jam_mulai: "10:00" }, /jam/],
    ["alamat_lat", { alamat_lat: -7.95 }, /lat/],
    ["alamat_lon", { alamat_lon: 112.7 }, /lon/],
  ] as const)(
    "%s berubah lewat jalur tulis MANA PUN (REST service role) -> pesanan terbuka ditutup bersebab",
    async (_kolom, ubah, sebab) => {
      const { id, pesananId } = await bertagihan();
      await wajib(svc.from("booking_requests").update(ubah).eq("id", id));
      await harusTertutup(pesananId, sebab);
    },
  );

  it("kolom bukan masukan harga (alamat teks, catatan, email_tagihan_pada) -> pesanan tetap terbuka", async () => {
    const { id, pesananId } = await bertagihan();
    await wajib(
      sesiAdmin
        .from("booking_requests")
        .update({ alamat: "Jl. Lain", catatan: "uji", email_tagihan_pada: new Date().toISOString() })
        .eq("id", id),
    );
    expect((await pesanan(pesananId)).status).toBe("menunggu_bayar");
  });

  it("menunggu_bayar -> mencari_mitra TANPA uang masuk (REST staf) -> pesanan terbuka ditutup", async () => {
    const { id, pesananId } = await bertagihan();
    await wajib(
      sesiAdmin
        .from("booking_requests")
        .update({ status: "mencari_mitra", partner_id: null })
        .eq("id", id),
    );
    expect((await pengajuan(id)).status).toBe("mencari_mitra");
    await harusTertutup(pesananId, /bidan pengajuan dilepas/);
  });
});

// ---------------------------------------------------------------------------
// Baris WARISAN QRIS yang uangnya sudah masuk (Ruling 8)
// ---------------------------------------------------------------------------

describe("baris warisan QRIS tanpa pesanan: masukan harga terkunci begitu uangnya masuk", () => {
  // Tanpa pesanan, tidak ada harga beku: angka yang admin cocokkan dengan
  // mutasi rekening dan jenjang yang dihitung konfirmasi_permintaan diturunkan
  // dari baris ini SAAT INI. Mengubah bidan/jadwal/titik diam-diam mengubah
  // tagihan yang sudah dibayar.
  it.each(["menunggu_verifikasi", "lunas"] as const)(
    "status_bayar %s: perbaruiPermintaan (jam) ditolak berkalimat, jam tetap",
    async (sb) => {
      const id = await warisan(sb);
      const r = await perbaruiPermintaan(
        id,
        formUbah({ alamat: ALAMAT.teks, tanggal: TGL_KUNJUNGAN, jam: "10:00" }),
      );
      expect(r).toEqual({ ok: false, pesan: KALIMAT_WARISAN_BERUANG });
      expect((await pengajuan(id)).jam_mulai).toBe("09:00:00");
    },
  );

  it.each(["menunggu_verifikasi", "lunas"] as const)(
    "status_bayar %s: gantiBidanMenungguBayar ditolak berkalimat, bidan tetap",
    async (sb) => {
      const id = await warisan(sb);
      const { gantiBidanMenungguBayar } = await aksiTagihan();
      expect(await gantiBidanMenungguBayar(id, MITRA_B)).toEqual({
        ok: false,
        pesan: KALIMAT_WARISAN_BERUANG,
      });
      expect((await pengajuan(id)).partner_id).toBe(MITRA);
    },
  );

  it("service role pun ditolak (SEMUA peran), titik alamat tetap", async () => {
    const id = await warisan("lunas");
    const { error } = await svc
      .from("booking_requests")
      .update({ alamat_lat: -7.95 })
      .eq("id", id)
      .select("id");
    expect(error?.code).toBe("P0001");
    expect(error?.message).toBe(KALIMAT_WARISAN_BERUANG);
    expect((await pengajuan(id)).alamat_lat).toBe(ALAMAT.lat);
  });

  it("teks alamat (bukan masukan harga) pada warisan lunas tetap boleh dibetulkan", async () => {
    const id = await warisan("lunas");
    const r = await perbaruiPermintaan(
      id,
      formUbah({ alamat: "Jl. Uji Penjaga Pengajuan No. 4A", tanggal: TGL_KUNJUNGAN, jam: "09:00", pin_disentuh: "" }),
    );
    expect(r).toEqual({ ok: true });
    expect((await pengajuan(id)).alamat).toBe("Jl. Uji Penjaga Pengajuan No. 4A");
  });

  it("status_bayar belum (uang belum masuk): jam dan bidan BOLEH diubah", async () => {
    const id = await warisan("belum");
    const r = await perbaruiPermintaan(
      id,
      formUbah({ alamat: ALAMAT.teks, tanggal: TGL_KUNJUNGAN, jam: "10:00" }),
    );
    expect(r).toEqual({ ok: true });
    const { gantiBidanMenungguBayar } = await aksiTagihan();
    expect(await gantiBidanMenungguBayar(id, MITRA_B)).toEqual({ ok: true });
    expect(await pengajuan(id)).toMatchObject({ jam_mulai: "10:00:00", partner_id: MITRA_B });
  });
});

// ---------------------------------------------------------------------------
// Ganti bidan
// ---------------------------------------------------------------------------

describe("ganti bidan", () => {
  it("pada pengajuan TERTAHAN: bidan berganti, pesanan tetap lunas berharga beku sama, salurkan_sesi -> terkonfirmasi", async () => {
    const { id, pesananId } = await tertahan();
    const harga = await hargaBeku(pesananId);
    const { gantiBidanMenungguBayar } = await aksiTagihan();

    expect(await gantiBidanMenungguBayar(id, MITRA_B)).toEqual({ ok: true });

    expect((await pengajuan(id)).partner_id).toBe(MITRA_B);
    const o = await pesanan(pesananId);
    expect(o.status).toBe("lunas");
    expect(await hargaBeku(pesananId)).toEqual(harga);
    expect(await sebabDibatalkan(pesananId)).toEqual([]);

    const { data, error } = await svc.rpc("salurkan_sesi", { p_pesanan_id: pesananId });
    expect(error).toBeNull();
    expect(data).toBe("terkonfirmasi");
    const [s] = await sesiUntuk(id);
    expect(s.partner_id).toBe(MITRA_B);
  });

  it("ke bidan NONAKTIF -> ditolak, bidan dan pesanan tidak berubah", async () => {
    const { id, pesananId } = await bertagihan();
    await wajib(svc.from("partners").update({ aktif: false }).eq("id", MITRA_B));
    const { gantiBidanMenungguBayar } = await aksiTagihan();
    expect(await gantiBidanMenungguBayar(id, MITRA_B)).toEqual({
      ok: false,
      pesan: "Bidan itu tidak aktif. Pilih bidan yang aktif.",
    });
    expect((await pengajuan(id)).partner_id).toBe(MITRA);
    expect((await pesanan(pesananId)).status).toBe("menunggu_bayar");
  });

  it("ke bidan yang SAMA -> ditolak berkalimat, bukan 'berhasil' yang tidak mengubah apa pun", async () => {
    const { id, pesananId } = await bertagihan();
    const { gantiBidanMenungguBayar } = await aksiTagihan();
    expect(await gantiBidanMenungguBayar(id, MITRA)).toEqual({
      ok: false,
      pesan: "Bidan itu sudah ditugaskan untuk pengajuan ini.",
    });
    expect((await pesanan(pesananId)).status).toBe("menunggu_bayar");
  });

  it("pengajuan yang tidak menunggu pembayaran -> ditolak", async () => {
    const id = await pengajuanSiap();
    const { gantiBidanMenungguBayar } = await aksiTagihan();
    expect(await gantiBidanMenungguBayar(id, MITRA_B)).toEqual({
      ok: false,
      pesan: "Bidan hanya bisa diganti di sini selama pengajuan menunggu pembayaran.",
    });
    expect((await pengajuan(id)).partner_id).toBe(MITRA);
  });
});

// ---------------------------------------------------------------------------
// Penjaga status_bayar (§6.7)
// ---------------------------------------------------------------------------

describe("booking_requests.status_bayar hanya ditulis fungsi mesin", () => {
  it("staf PATCH status_bayar lewat REST -> 42501, nilai tetap", async () => {
    const id = await warisan("menunggu_verifikasi");
    const { error } = await sesiAdmin
      .from("booking_requests")
      .update({ status_bayar: "lunas" })
      .eq("id", id)
      .select("id");
    expect(error?.code).toBe("42501");
    expect((await pengajuan(id)).status_bayar).toBe("menunggu_verifikasi");
  });

  it("staf INSERT pengajuan dengan status_bayar selain 'belum' lewat REST -> 42501", async () => {
    const skrining = await skriningHijau(svc, KLIEN);
    const { error } = await sesiAdmin.from("booking_requests").insert({
      client_id: KLIEN,
      service_id: SVC_B4,
      variant_id: VARIAN,
      partner_id: MITRA,
      tanggal: geserHari(HARI_INI, 5),
      jam_mulai: "09:00",
      preferensi_waktu: "pagi",
      alamat: ALAMAT.teks,
      status: "menunggu_bayar",
      tenggat: new Date(Date.now() + 3_600_000).toISOString(),
      status_bayar: "lunas",
      screening_id: skrining,
    });
    expect(error?.code).toBe("42501");
    const [n] = await querySql<{ n: number }>(
      "select count(*)::int as n from public.booking_requests where client_id = $1",
      [KLIEN],
    );
    expect(n.n).toBe(0);
  });

  it("staf PATCH kolom lain dengan status_bayar yang SAMA -> lolos (penjaga hanya menahan perubahan)", async () => {
    const id = await warisan("menunggu_verifikasi");
    await wajib(
      sesiAdmin
        .from("booking_requests")
        .update({ status_bayar: "menunggu_verifikasi", catatan: "dicek admin" })
        .eq("id", id),
    );
    expect((await pengajuan(id)).status_bayar).toBe("menunggu_verifikasi");
  });

  it("fungsi mesin (penyalur B3) tetap menulis status_bayar 'lunas' saat SUCCESS", async () => {
    const { id, pesananId } = await bertagihan();
    expect((await lunasi(pesananId)).data).toBe("diterapkan");
    expect(await pengajuan(id)).toMatchObject({ status: "dikonfirmasi", status_bayar: "lunas" });
  });
});

// ---------------------------------------------------------------------------
// Verifikasi bukti warisan (§7)
// ---------------------------------------------------------------------------

describe("verifikasiPengajuan memanggil verifikasi_bukti_warisan", () => {
  it("baris warisan menunggu_verifikasi -> lunas", async () => {
    const id = await warisan("menunggu_verifikasi");
    ref.sesi = sesiAdmin;
    expect(await verifikasiPengajuan(id)).toEqual({ ok: true });
    expect((await pengajuan(id)).status_bayar).toBe("lunas");
  });

  it("baris BERPESANAN ditolak walau status_bayar-nya menunggu_verifikasi", async () => {
    const { id } = await bertagihan();
    await wajib(svc.from("booking_requests").update({ status_bayar: "menunggu_verifikasi" }).eq("id", id));
    const r = await verifikasiPengajuan(id);
    expect(r).toEqual({
      ok: false,
      pesan: "Pengajuan ini dibayar lewat DOKU; tidak ada bukti transfer untuk diverifikasi.",
    });
    const { error } = await sesiAdmin.rpc("verifikasi_bukti_warisan", { p_permintaan_id: id });
    expect(error?.code).toBe("P0001");
    expect((await pengajuan(id)).status_bayar).toBe("menunggu_verifikasi");
  });

  it("baris warisan yang buktinya belum masuk (status_bayar belum) -> ditolak", async () => {
    const id = await warisan("belum");
    expect(await verifikasiPengajuan(id)).toEqual({
      ok: false,
      pesan: "Tagihan ini tidak sedang menunggu verifikasi.",
    });
    expect((await pengajuan(id)).status_bayar).toBe("belum");
  });
});

// ---------------------------------------------------------------------------
// Kabari bidan (§6.7)
// ---------------------------------------------------------------------------

describe("tandaiSudahDikabari", () => {
  it("mengosongkan penanda kabari_bidan_sejak sesi hasil penyalur", async () => {
    const { id, pesananId } = await bertagihan();
    expect((await lunasi(pesananId)).data).toBe("diterapkan");
    const [s] = await sesiUntuk(id);
    expect(s.kabari_bidan_sejak).not.toBeNull();

    const { tandaiSudahDikabari } = await aksiTagihan();
    expect(await tandaiSudahDikabari(s.id)).toEqual({ ok: true });
    expect((await sesiUntuk(id))[0].kabari_bidan_sejak).toBeNull();
  });

  it("sesi yang tidak ada -> ditolak dengan kalimat", async () => {
    const { tandaiSudahDikabari } = await aksiTagihan();
    expect(await tandaiSudahDikabari(randomUUID())).toEqual({
      ok: false,
      pesan: "Sesi tidak ditemukan.",
    });
  });
});

// ---------------------------------------------------------------------------
// Hak akses
// ---------------------------------------------------------------------------

describe("hak akses", () => {
  it.each([
    ["batalkan_pengajuan_staf", (id: string) => ({ p_permintaan_id: id })],
    ["ganti_bidan_permintaan", (id: string) => ({ p_permintaan_id: id, p_partner_id: MITRA_B })],
    ["verifikasi_bukti_warisan", (id: string) => ({ p_permintaan_id: id })],
  ] as const)("klien tidak bisa memanggil %s (42501), baris tidak berubah", async (fungsi, argumen) => {
    const id = await warisan("menunggu_verifikasi");
    const sebelum = await pengajuan(id);
    const { error } = await sesiKlien.rpc(fungsi, argumen(id));
    expect(error?.code).toBe("42501");
    expect(await pengajuan(id)).toEqual(sebelum);
  });

  it("aksi staf dengan sesi klien dihentikan requireRole", async () => {
    const id = await warisan("belum");
    ref.sesi = sesiKlien;
    const { batalkanPengajuanStaf, gantiBidanMenungguBayar, tandaiSudahDikabari } = await aksiTagihan();
    await expect(batalkanPengajuanStaf(id)).rejects.toThrow(/REDIRECT/);
    await expect(gantiBidanMenungguBayar(id, MITRA_B)).rejects.toThrow(/REDIRECT/);
    await expect(tandaiSudahDikabari(randomUUID())).rejects.toThrow(/REDIRECT/);
    expect((await pengajuan(id)).status).toBe("menunggu_bayar");
  });

  it.each([
    "public.tutup_pesanan_sesi_terbuka()",
    "public.guard_batal_permintaan_beruang()",
    "public.guard_status_bayar_permintaan()",
  ])("fungsi trigger %s tertutup bagi anon dan authenticated", async (fungsi) => {
    const [hak] = await querySql<{ anon: boolean; authenticated: boolean }>(
      `select has_function_privilege('anon', $1, 'execute') as anon,
              has_function_privilege('authenticated', $1, 'execute') as authenticated`,
      [fungsi],
    );
    expect(hak).toEqual({ anon: false, authenticated: false });
  });
});

// ---------------------------------------------------------------------------
// Urutan kunci (Ruling 7)
// ---------------------------------------------------------------------------

describe("URUTAN KUNCI pesanan -> pengajuan di setiap fungsi yang mengubah pengajuan bertagihan", () => {
  // Webhook (`terapkan_notifikasi_gateway` -> `salurkan_sesi`) mengunci
  // PESANAN lalu PENGAJUAN. Trigger penutup pesanan berjalan sesudah baris
  // pengajuan terkunci (pengajuan -> pesanan). Fungsi yang mengunci pengajuan
  // dulu lalu memicu trigger itu membalik urutan webhook: pembatalan yang
  // berbalapan dengan pelunasan berakhir deadlock. A memegang baris pengajuan;
  // B menjalankan fungsinya dan harus tertahan di sana SAMBIL sudah memegang
  // pesanannya.
  const KASUS = [
    { nama: "batalkan_pengajuan_saya", sql: "select public.batalkan_pengajuan_saya($1)", klien: true },
    { nama: "batalkan_pengajuan_staf", sql: "select public.batalkan_pengajuan_staf($1)", klien: false },
    {
      nama: "ganti_bidan_permintaan",
      sql: `select public.ganti_bidan_permintaan($1, '${MITRA_B}')`,
      klien: false,
    },
  ];

  it.each(KASUS)("$nama: menunggu baris pengajuan SESUDAH memegang pesanannya", async ({ sql, klien }) => {
    const { id, pesananId } = await bertagihan();
    const a = new Client({ connectionString: dbUrl() });
    const b = new Client({ connectionString: dbUrl() });
    await a.connect();
    await b.connect();
    let janjiB: Promise<unknown> | null = null;
    try {
      await a.query("begin");
      await a.query(`select 1 from public.booking_requests where id = $1 for update`, [id]);

      const pidB = (await b.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0].pid;
      await b.query("begin");
      await sebagai(b, klien ? idKlien : idAdmin);
      janjiB = b.query(sql, [id]);
      janjiB.catch(() => {});

      // B benar-benar MENUNGGU kunci. Dibaca lewat koneksi baru:
      // pg_stat_activity dibekukan per transaksi.
      let menunggu = false;
      for (let i = 0; i < 100 && !menunggu; i++) {
        const [s] = await querySql<{ w: string | null }>(
          `select wait_event_type as w from pg_stat_activity where pid = $1`,
          [pidB],
        );
        menunggu = s?.w === "Lock";
        if (!menunggu) await new Promise((r) => setTimeout(r, 50));
      }
      expect(menunggu).toBe(true);

      await a.query("savepoint coba");
      const galat = await a
        .query(`select 1 from public.orders where id = $1 for update nowait`, [pesananId])
        .then(
          () => null,
          (e: { code?: string }) => e,
        );
      // 55P03 lock_not_available: pesanan dipegang B, yang sedang menunggu
      // baris pengajuan — pesanan dikunci LEBIH DULU.
      expect(galat?.code).toBe("55P03");
      await a.query("rollback to savepoint coba");
    } finally {
      await a.query("rollback").catch(() => {});
      await a.end();
      if (janjiB) await janjiB.catch(() => {});
      await b.query("rollback").catch(() => {});
      await b.end();
    }
  });
});
