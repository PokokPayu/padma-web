/**
 * Klien membayar tagihan sesi dari Digital Passport (B6, spec §6.3, §7 sisi
 * klien).
 *
 * Yang dijaga di sini adalah kegagalan yang tidak bersuara di sisi KLIEN:
 *
 *  - pemanggil membaca tagihan orang lain lewat RPC `tagihan_sesi_saya`
 *    (security definer — RLS tidak menyaring di dalamnya, `auth.uid()` yang
 *    menyaring);
 *  - rincian yang tampil dihitung ulang dari tarif hari ini, bukan dari angka
 *    BEKU yang ditagihkan DOKU — klien membaca satu angka dan membayar angka
 *    lain;
 *  - tombol Bayar tetap ditawarkan (atau rute tetap menerbitkan tautan) untuk
 *    pengajuan yang uangnya SUDAH masuk — tagihan kedua atas uang yang sama;
 *  - halaman kembali dari DOKU tidak memicu Lapis 1b, sehingga pembayaran
 *    yang webhook-nya hilang tidak pernah terlihat oleh orang yang baru
 *    membayarnya;
 *  - QRIS dan unggah bukti jalur pengajuan lama masih tampil di halaman yang
 *    kini dibayar lewat DOKU.
 *
 * Klien BER-AKUN `klien-kedua` adalah pemilik tagihan; Ananda (seed) adalah
 * "klien lain". Layanan, varian, dan bidan bertitik MILIK berkas ini
 * (koordinat mitra seed dikosongkan berkas lain). `fetch` ke host DOKU
 * di-stub; kunci uji palsu.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { anonClient, signInAs } from "./helpers/as-user";
import { querySql } from "./helpers/db";
import { skriningHijau } from "./helpers/skrining";
import {
  EMAIL_KLIEN_KEDUA,
  KLIEN_KEDUA_ID,
  bongkarKlienKedua,
  siapkanKlienKedua,
} from "./helpers/klien-kedua";
import { setujuiDokumenUntukUji } from "./helpers/persetujuan";
import { hariIniJakarta } from "@/lib/passport/waktu";
import { geserHari } from "@/lib/owner/pekan";
import { rakitInvoice } from "@/lib/pesanan/order-id";
import { formatRupiah } from "@/lib/rupiah-publik";

const asliFetch = globalThis.fetch;
const ref = vi.hoisted(() => ({
  sesi: null as SupabaseClient | null,
  /** Setiap permintaan yang sampai ke host DOKU: metode, url, badan. */
  doku: [] as { metode: string; url: string; badan: string }[],
}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: async () => ref.sesi! }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NOTFOUND");
  },
  usePathname: () => "/passport/bayar",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));

const { ambilTagihanPengajuan, ambilTagihanPengajuanSatu, keadaanTagihanKlien, KEADAAN_BISA_DIBAYAR } =
  await import("@/lib/tagihan/baca");
type TagihanPengajuan = Awaited<ReturnType<typeof ambilTagihanPengajuan>>[number];
const { default: HalamanBayarSatu } = await import("@/app/passport/bayar/[id]/page");
const { default: HalamanBayar } = await import("@/app/passport/bayar/page");
const { POST: bayar } = await import("@/app/api/pesanan/sesi/[permintaan]/bayar/route");
const { mintaTautanSesi, bayarLaluAlihkan, TombolBayar } = await import(
  "@/app/passport/bayar/[id]/tombol-bayar"
);
const { batalkanPengajuan } = await import("@/lib/passport/aksi");

const svc = createAdminSupabase();

const KLIEN = KLIEN_KEDUA_ID;
const SVC_B6 = "11111111-1111-1111-1111-1111111116b6";
const VARIAN = "77777777-7777-7777-7777-7777777776b6";
const MITRA = "33333333-3333-3333-3333-3333333336b6";
const HANTU = "00000000-0000-0000-0000-000000000000";

const TITIK_MITRA = { lat: -7.96662, lon: 112.632632 };
// 7 km dari titik mitra (jenjang 5_10, diukur `jarak_km` basis data ini).
const ALAMAT = { teks: "Jl. Uji Bayar Passport No. 6", lat: -7.9666, lon: 112.6966 };
const HARGA_LAYANAN = 300_000;

const HARI_INI = hariIniJakarta();
const TGL_KUNJUNGAN = geserHari(HARI_INI, 3);

/** Kalimat spec §6.3/§7 — VERBATIM. */
const KALIMAT_KEDALUWARSA = "Tagihan kedaluwarsa. Admin akan menghubungi Anda.";
const KALIMAT_TERTAHAN = "Pembayaran diterima, jadwal sedang disiapkan admin";
const KALIMAT_BUKTI = "Bukti Anda sedang diperiksa admin";

let sesiKlien: SupabaseClient;
let sesiAnanda: SupabaseClient;
let sesiAdmin: SupabaseClient;
let uidKlien = "";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

async function wajib<T extends { error: unknown }>(p: PromiseLike<T>): Promise<T> {
  const hasil = await p;
  if (hasil.error) throw hasil.error;
  return hasil;
}

async function bersihkan(): Promise<void> {
  // Sesi DULU: `sessions.booking_request_id` (FK tanpa on delete) menahan
  // penghapusan pengajuan. Jejak sesi & pesanan tanpa FK, jadi disapu sendiri.
  const { data: ss } = await svc.from("sessions").select("id").eq("client_id", KLIEN);
  const idSesi = (ss ?? []).map((s) => s.id as string);
  if (idSesi.length) {
    await svc.from("jejak_status_bayar").delete().in("sesi_id", idSesi);
    await svc.from("jejak_jadwal").delete().in("sesi_id", idSesi);
    await wajib(svc.from("sessions").delete().in("id", idSesi));
  }
  const { data: ps } = await svc.from("orders").select("id").eq("client_id", KLIEN);
  const idPs = (ps ?? []).map((p) => p.id as string);
  if (idPs.length) {
    await svc.from("jejak_pesanan").delete().in("pesanan_id", idPs);
    await svc.from("notifikasi_pesanan").delete().in("pesanan_id", idPs);
    await wajib(svc.from("orders").delete().in("id", idPs));
  }
  await wajib(svc.from("booking_requests").delete().eq("client_id", KLIEN));
  await svc.from("screenings").delete().eq("client_id", KLIEN);
  // Tarif "sesudah terbit" milik uji angka beku.
  await svc.from("variant_rates").delete().eq("variant_id", VARIAN).neq("berlaku_sejak", "2026-01-01");
}

async function bongkarKatalog(): Promise<void> {
  await svc.from("variant_rates").delete().eq("variant_id", VARIAN);
  await svc.from("service_variants").delete().eq("service_id", SVC_B6);
  await svc.from("services").delete().eq("id", SVC_B6);
  await svc.from("partners").delete().eq("id", MITRA);
}

beforeAll(async () => {
  await bersihkan().catch(() => {});
  await bongkarKatalog();
  await siapkanKlienKedua();

  sesiAdmin = await signInAs("admin@padma.test");
  sesiKlien = await signInAs(EMAIL_KLIEN_KEDUA);
  sesiAnanda = await signInAs("ananda@padma.test");
  uidKlien = (await sesiKlien.auth.getUser()).data.user!.id;

  // Layanan NONAKTIF: tidak pernah muncul di katalog berkas lain.
  await wajib(
    svc.from("services").insert({
      id: SVC_B6,
      phase_id: "prekonsepsi",
      nama: "PAD-UJI Layanan Bayar Passport",
      deskripsi: "fixture",
      aktif: false,
    }),
  );
  await wajib(svc.from("service_variants").insert({ id: VARIAN, service_id: SVC_B6, label: "Uji B6", urutan: 90 }));
  await wajib(
    svc.from("variant_rates").insert({
      variant_id: VARIAN,
      harga_klien: HARGA_LAYANAN,
      honor_mitra: 100_000,
      berlaku_sejak: "2026-01-01",
    }),
  );
  await wajib(
    svc.from("partners").insert({
      id: MITRA,
      nama: "PAD-UJI Bidan B6",
      no_hp: "0811-9600-0001",
      aktif: true,
      ...TITIK_MITRA,
    }),
  );
});

beforeEach(async () => {
  ref.sesi = sesiKlien;
  ref.doku = [];
  vi.stubEnv("DOKU_CLIENT_ID", "klien-uji-doku");
  vi.stubEnv("DOKU_SECRET_KEY", "kunci-uji-doku");
  vi.stubEnv("DOKU_PRODUKSI", "false");
  vi.stubEnv("NEXT_PUBLIC_BASIS_URL", "https://padma.test");
  vi.stubGlobal("fetch", (...args: Parameters<typeof fetch>) => {
    const url = args[0] instanceof Request ? args[0].url : String(args[0]);
    if (/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/)/.test(url)) return asliFetch(...args);
    if (url.startsWith("https://api-sandbox.doku.com")) {
      const init = (args[1] ?? {}) as RequestInit;
      ref.doku.push({ metode: init.method ?? "GET", url, badan: String(init.body ?? "") });
      if (url.includes("/orders/v1/status/")) {
        // "Invoice tidak dikenal" — Lapis 1b membaca ini sebagai belum ada vonis.
        return Promise.resolve(new Response("{}", { status: 404 }));
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({ response: { payment: { url: "https://sandbox.doku.test/bayar/b6", token_id: "t" } } }),
          { status: 200 },
        ),
      );
    }
    throw new Error(`[uji] host luar tak terduga: ${url}`);
  });
  await bersihkan();
  await wajib(svc.from("partners").update({ aktif: true }).eq("id", MITRA));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await bersihkan();
  await bongkarKatalog();
  await bongkarKlienKedua();
});

/** Pengajuan `mitra_siap` lewat transisi SAH (diminta -> mencari_mitra -> mitra_siap). */
async function pengajuanSiap(jam = "09:00"): Promise<string> {
  const skrining = await skriningHijau(svc, KLIEN);
  const { data } = await wajib(
    svc
      .from("booking_requests")
      .insert({
        client_id: KLIEN,
        service_id: SVC_B6,
        variant_id: VARIAN,
        tanggal: TGL_KUNJUNGAN,
        jam_mulai: jam,
        // `booking_requests_antrean_unik` berkunci preferensi waktu, bukan jam.
        preferensi_waktu: jam < "12:00" ? "pagi" : "siang",
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
  await wajib(svc.from("booking_requests").update({ status: "mitra_siap", partner_id: MITRA }).eq("id", id));
  return id;
}

/** Tagihan diterbitkan sungguhan lewat `terbitkan_tagihan_sesi` (B2) dengan sesi admin. */
async function bertagihan(): Promise<{ id: string; pesananId: string }> {
  const id = await pengajuanSiap();
  const { data, error } = await sesiAdmin.rpc("terbitkan_tagihan_sesi", { p_permintaan_id: id });
  if (error) throw error;
  return { id, pesananId: data as string };
}

/** Baris WARISAN QRIS (§7): `menunggu_bayar` TANPA satu pun pesanan. */
async function warisan(statusBayar: "belum" | "menunggu_verifikasi" | "lunas"): Promise<string> {
  const id = await pengajuanSiap("13:00");
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
async function sukses(pesananId: string, selisih = 0) {
  const [p] = await querySql<{ kode: string; percobaan: number; total: number }>(
    `select o.kode, o.percobaan,
            (select coalesce(sum(i.harga_beku), 0)::int from public.order_items i where i.pesanan_id = o.id) as total
       from public.orders o where o.id = $1`,
    [pesananId],
  );
  const { data, error } = await svc.rpc("terapkan_notifikasi_gateway", {
    p_invoice: rakitInvoice(p.kode, p.percobaan),
    p_status: "SUCCESS",
    p_transaksi_id: `trx-uji-b6-${randomUUID()}`,
    p_kanal: "VIRTUAL_ACCOUNT_BCA",
    p_nominal: p.total + selisih,
    p_sidik: randomUUID(),
    p_sumber: "webhook",
  });
  if (error) throw error;
  return data as string;
}

/** Pesanan lunas, sesi TIDAK lahir (bidan nonaktif saat uang mendarat). */
async function tertahan(): Promise<{ id: string; pesananId: string }> {
  const t = await bertagihan();
  await wajib(svc.from("partners").update({ aktif: false }).eq("id", MITRA));
  expect(await sukses(t.pesananId)).toBe("diterapkan");
  await wajib(svc.from("partners").update({ aktif: true }).eq("id", MITRA));
  return t;
}

/**
 * Uang mendarat di pesanan LAMA yang sudah ditutup terbit ulang, sementara
 * pesanan baru masih terbuka: `uang_sudah_masuk_permintaan` benar, tetapi
 * pesanan terkini tetap `menunggu_bayar`. Inilah keadaan yang membuat
 * "pesanan terbuka" saja tidak cukup sebagai syarat tombol Bayar.
 */
async function uangDiPesananLama(): Promise<{ id: string; lama: string; baru: string }> {
  const { id, pesananId: lama } = await bertagihan();
  const { data: baru, error } = await sesiAdmin.rpc("terbitkan_tagihan_sesi", { p_permintaan_id: id });
  if (error) throw error;
  await sukses(lama);
  const [o] = await querySql<{ status: string }>(`select status::text from public.orders where id = $1`, [lama]);
  expect(o.status).toBe("dibatalkan");
  return { id, lama, baru: baru as string };
}

async function itemBeku(pesananId: string) {
  return querySql<{ judul: string; harga: number }>(
    `select judul_beku as judul, harga_beku as harga from public.order_items
      where pesanan_id = $1 order by urutan`,
    [pesananId],
  );
}

async function pesanan(id: string) {
  const [o] = await querySql<{ kode: string; percobaan: number }>(
    `select kode, percobaan from public.orders where id = $1`,
    [id],
  );
  return o;
}

type Baris = {
  permintaan_id: string;
  nama_layanan: string;
  status_permintaan: string;
  status_bayar: string;
  pesanan_id: string | null;
  kode: string | null;
  status_pesanan: string | null;
  kedaluwarsa_pada: string | null;
  butuh_tinjauan: boolean;
  uang_sudah_masuk: boolean;
  tautan_baru: boolean;
  sesi_id: string | null;
  items: { judul: string; harga: number }[];
};

async function rpc(sesi: SupabaseClient, id?: string): Promise<Baris[]> {
  const { data, error } = await sesi.rpc(
    "tagihan_sesi_saya",
    id === undefined ? {} : { p_permintaan_id: id },
  );
  expect(error).toBeNull();
  return data as Baris[];
}

const renderDetail = async (id: string) =>
  renderToStaticMarkup(await HalamanBayarSatu({ params: Promise.resolve({ id }) }));

function mintaBayar(id: string) {
  return bayar(new Request(`http://127.0.0.1/api/pesanan/sesi/${id}/bayar`, { method: "POST" }), {
    params: Promise.resolve({ permintaan: id }),
  });
}

const dokuBuat = () => ref.doku.filter((d) => d.metode === "POST" && d.url.endsWith("/checkout/v1/payment"));
const dokuStatus = () => ref.doku.filter((d) => d.metode === "GET" && d.url.includes("/orders/v1/status/"));

// ---------------------------------------------------------------------------
// RPC tagihan_sesi_saya
// ---------------------------------------------------------------------------

describe("RPC tagihan_sesi_saya", () => {
  it("pemilik membaca tagihannya: pesanan terkini, kode, dan items dari angka BEKU", async () => {
    const { id, pesananId } = await bertagihan();
    const [b] = await rpc(sesiKlien, id);

    expect(b.permintaan_id).toBe(id);
    expect(b.nama_layanan).toBe("PAD-UJI Layanan Bayar Passport");
    expect(b.pesanan_id).toBe(pesananId);
    expect(b.status_pesanan).toBe("menunggu_bayar");
    expect(b.kode).toBe((await pesanan(pesananId)).kode);
    expect(b.uang_sudah_masuk).toBe(false);
    expect(b.tautan_baru).toBe(false);
    expect(b.items).toEqual(await itemBeku(pesananId));
    expect(b.items[0]).toEqual({ judul: "Sesi kunjungan PADMA", harga: HARGA_LAYANAN });
  });

  it("items tetap angka beku walau tarif berubah sesudah tagihan terbit", async () => {
    const { id, pesananId } = await bertagihan();
    // Tarif BARU yang berlaku sebelum tanggal kunjungan: rumus hari ini
    // (`rincian_tagihan_permintaan`) kini memulangkan 999.000.
    await wajib(
      svc.from("variant_rates").insert({
        variant_id: VARIAN,
        harga_klien: 999_000,
        honor_mitra: 100_000,
        berlaku_sejak: HARI_INI,
      }),
    );
    const { data: rumus } = await sesiAdmin.rpc("rincian_tagihan_permintaan", { p_permintaan_id: id });
    expect((rumus as { layanan: number }[])[0].layanan).toBe(999_000);

    const [b] = await rpc(sesiKlien, id);
    expect(b.items[0].harga).toBe(HARGA_LAYANAN);
    expect(b.items).toEqual(await itemBeku(pesananId));
  });

  it("klien LAIN membaca nol baris — dengan id maupun tanpa", async () => {
    const { id } = await bertagihan();
    expect(await rpc(sesiAnanda, id)).toEqual([]);
    expect((await rpc(sesiAnanda)).map((b) => b.permintaan_id)).not.toContain(id);
    // Kontrol: pemiliknya memang melihatnya tanpa id.
    expect((await rpc(sesiKlien)).map((b) => b.permintaan_id)).toContain(id);
  });

  it("anon tidak bisa memanggilnya", async () => {
    const { id } = await bertagihan();
    const { data, error } = await anonClient().rpc("tagihan_sesi_saya", { p_permintaan_id: id });
    expect(error).not.toBeNull();
    expect(data).toBeNull();
    const [hak] = await querySql<{ anon: boolean; publik: boolean; auth: boolean }>(
      `select has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
              has_function_privilege('public', p.oid, 'EXECUTE') as publik,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'tagihan_sesi_saya'`,
    );
    expect(hak).toEqual({ anon: false, publik: false, auth: true });
  });

  it("pengajuan yang belum bertagihan tidak ikut; baris warisan tanpa pesanan ikut", async () => {
    const siap = await pengajuanSiap();
    const lama = await warisan("menunggu_verifikasi");
    const semua = await rpc(sesiKlien);
    expect(semua.map((b) => b.permintaan_id)).not.toContain(siap);
    const w = semua.find((b) => b.permintaan_id === lama)!;
    expect(w).toMatchObject({ pesanan_id: null, status_bayar: "menunggu_verifikasi", items: [] });
  });

  it("lunas lalu sesi lahir: tetap terbaca (sudah dikonfirmasi) dan membawa sesi_id", async () => {
    const { id, pesananId } = await bertagihan();
    expect(await sukses(pesananId)).toBe("diterapkan");
    const [sesi] = await querySql<{ id: string }>(
      `select id from public.sessions where booking_request_id = $1`,
      [id],
    );
    const [b] = await rpc(sesiKlien, id);
    expect(b).toMatchObject({
      status_permintaan: "dikonfirmasi",
      status_pesanan: "lunas",
      sesi_id: sesi.id,
      uang_sudah_masuk: true,
    });
  });

  it("uang di pesanan lama yang tertutup: uang_sudah_masuk benar walau pesanan terkini terbuka", async () => {
    const { id, baru } = await uangDiPesananLama();
    const [b] = await rpc(sesiKlien, id);
    expect(b).toMatchObject({ pesanan_id: baru, status_pesanan: "menunggu_bayar", uang_sudah_masuk: true });
  });

  it("tautan_baru: benar sesudah tautan dicatat, salah bila tautannya lebih dari 30 menit", async () => {
    const { id, pesananId } = await bertagihan();
    const { error } = await sesiKlien.rpc("catat_tautan_gateway", {
      p_pesanan_id: pesananId,
      p_percobaan: 1,
      p_tautan: "https://sandbox.doku.test/bayar/lama",
    });
    expect(error).toBeNull();
    expect((await rpc(sesiKlien, id))[0].tautan_baru).toBe(true);

    await wajib(
      svc
        .from("orders")
        .update({ tautan_terbit_pada: new Date(Date.now() - 31 * 60_000).toISOString() })
        .eq("id", pesananId),
    );
    expect((await rpc(sesiKlien, id))[0].tautan_baru).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// keadaanTagihanKlien — tabel §6.3 dan §7, murni
// ---------------------------------------------------------------------------

describe("keadaanTagihanKlien (tabel §6.3 dan §7)", () => {
  const SEKARANG = new Date("2030-01-01T00:00:00Z");
  const nanti = new Date(SEKARANG.getTime() + 3_600_000).toISOString();
  const lewat = new Date(SEKARANG.getTime() - 60_000).toISOString();
  const dasar: TagihanPengajuan = {
    permintaanId: "p",
    namaLayanan: "Layanan",
    tanggal: "2030-01-02",
    jamMulai: "09:00:00",
    statusPermintaan: "menunggu_bayar",
    statusBayar: "belum",
    pesananId: "o",
    kode: "PSN-300101-ABCDEF",
    statusPesanan: "menunggu_bayar",
    kedaluwarsaPada: nanti,
    butuhTinjauan: false,
    uangSudahMasuk: false,
    tautanBaru: false,
    sesiId: null,
    items: [{ judul: "Sesi kunjungan PADMA", harga: 300_000 }],
    total: 300_000,
  };
  const k = (ubah: Partial<TagihanPengajuan>) => keadaanTagihanKlien({ ...dasar, ...ubah }, SEKARANG);

  it("menunggu_bayar sebelum tenggat -> bayar", () => {
    expect(k({})).toBe("bayar");
  });
  it("tautan baru dan pesanan masih menunggu_bayar -> diproses", () => {
    expect(k({ tautanBaru: true })).toBe("diproses");
  });
  it("tautan baru TIDAK menunda tenggat: sesudah tenggat -> kedaluwarsa", () => {
    expect(k({ tautanBaru: true, kedaluwarsaPada: lewat })).toBe("kedaluwarsa");
  });
  it("lunas dengan sesi -> lunas_sesi", () => {
    expect(k({ statusPesanan: "lunas", sesiId: "s", uangSudahMasuk: true })).toBe("lunas_sesi");
  });
  it("lunas tanpa sesi -> lunas_tertahan, walau penyalur menandainya tinjauan", () => {
    expect(k({ statusPesanan: "lunas", uangSudahMasuk: true })).toBe("lunas_tertahan");
    expect(k({ statusPesanan: "lunas", uangSudahMasuk: true, butuhTinjauan: true })).toBe("lunas_tertahan");
  });
  it("ditahan -> diperiksa, oleh statusnya sendiri", () => {
    // Tanpa tanda uang/tinjauan: klausa `ditahan` harus berdiri sendiri, bukan
    // menumpang pada dua tanda lain yang kebetulan biasanya ikut menyala.
    expect(k({ statusPesanan: "ditahan" })).toBe("diperiksa");
    expect(k({ statusPesanan: "ditahan", uangSudahMasuk: true, butuhTinjauan: true })).toBe("diperiksa");
  });
  it("pesanan terbuka bertinjauan -> diperiksa", () => {
    expect(k({ butuhTinjauan: true })).toBe("diperiksa");
  });
  it("pesanan terbuka tetapi uang sudah masuk (pesanan lama) -> diperiksa, tanpa tombol", () => {
    expect(k({ uangSudahMasuk: true })).toBe("diperiksa");
    expect(k({ uangSudahMasuk: true, tautanBaru: true })).toBe("diperiksa");
  });
  it("menunggu_bayar sesudah tenggat -> kedaluwarsa", () => {
    expect(k({ kedaluwarsaPada: lewat })).toBe("kedaluwarsa");
  });
  it("pesanan kedaluwarsa -> kedaluwarsa", () => {
    expect(k({ statusPesanan: "kedaluwarsa", kedaluwarsaPada: lewat })).toBe("kedaluwarsa");
  });
  it("pesanan terkini dibatalkan tanpa uang (ditutup karena harga berubah) -> dialihkan, tanpa tombol", () => {
    expect(k({ statusPesanan: "dibatalkan" })).toBe("warisan_dialihkan");
  });
  it("tanpa pesanan: belum / menunggu_verifikasi / lunas -> tiga keadaan warisan", () => {
    const tanpa = { pesananId: null, kode: null, statusPesanan: null, kedaluwarsaPada: null, items: [], total: null };
    expect(k({ ...tanpa, statusBayar: "belum" })).toBe("warisan_dialihkan");
    expect(k({ ...tanpa, statusBayar: "menunggu_verifikasi", uangSudahMasuk: true })).toBe("warisan_bukti");
    expect(k({ ...tanpa, statusBayar: "lunas", uangSudahMasuk: true })).toBe("warisan_lunas");
  });
  it("hanya bayar dan diproses yang bisa dibayar", () => {
    expect([...KEADAAN_BISA_DIBAYAR].sort()).toEqual(["bayar", "diproses"]);
  });
});

// ---------------------------------------------------------------------------
// Pembaca TS
// ---------------------------------------------------------------------------

describe("ambilTagihanPengajuan / ambilTagihanPengajuanSatu", () => {
  it("membaca lewat RPC dengan sesi pemanggil: rincian beku dan total", async () => {
    const { id, pesananId } = await bertagihan();
    const t = await ambilTagihanPengajuanSatu(id);
    const beku = await itemBeku(pesananId);
    expect(t).toMatchObject({ permintaanId: id, pesananId, statusPesanan: "menunggu_bayar" });
    expect(t!.items).toEqual(beku);
    expect(t!.total).toBe(beku.reduce((s, i) => s + i.harga, 0));
    expect((await ambilTagihanPengajuan()).map((x) => x.permintaanId)).toContain(id);
  });

  it("milik klien lain, id karangan, dan id bukan uuid -> null tanpa melempar", async () => {
    const { id } = await bertagihan();
    ref.sesi = sesiAnanda;
    expect(await ambilTagihanPengajuanSatu(id)).toBeNull();
    expect(await ambilTagihanPengajuanSatu(HANTU)).toBeNull();
    expect(await ambilTagihanPengajuanSatu("bukan-uuid")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Halaman /passport/bayar/[id]
// ---------------------------------------------------------------------------

describe("halaman /passport/bayar/[id]", () => {
  it("keadaan bayar: tombol Bayar, rincian beku, sisa waktu — tanpa QRIS dan tanpa unggah", async () => {
    const { id, pesananId } = await bertagihan();
    const m = await renderDetail(id);
    const beku = await itemBeku(pesananId);

    expect(m).toContain(`data-bayar="${id}"`);
    expect(beku).toHaveLength(2);
    for (const i of beku) {
      expect(m).toContain(i.judul);
      expect(m).toContain(formatRupiah(i.harga));
    }
    // `data-total` adalah kontrak E2E; nilainya total angka beku.
    const total = formatRupiah(beku.reduce((s, i) => s + i.harga, 0));
    expect(m).toMatch(new RegExp(`data-total="?[^>]*>${total}<`));
    expect(m).toMatch(/\d+ jam lagi/);
    expect(m).not.toMatch(/qris/i);
    expect(m).not.toMatch(/unggah/i);
    expect(m).not.toContain('type="file"');
    // §6.5: tidak ada pembatalan otomatis karena tenggat.
    expect(m).not.toMatch(/dilepas/);
  });

  it("kedaluwarsa: 'Admin akan menghubungi Anda.' tanpa tombol Bayar", async () => {
    const { id, pesananId } = await bertagihan();
    await wajib(
      svc
        .from("orders")
        .update({ kedaluwarsa_pada: new Date(Date.now() - 60_000).toISOString() })
        .eq("id", pesananId),
    );
    const m = await renderDetail(id);
    expect(m).toContain(KALIMAT_KEDALUWARSA);
    expect(m).not.toContain("data-bayar");
  });

  it("lunas, sesi tertahan: 'Pembayaran diterima, jadwal sedang disiapkan admin', tanpa tombol", async () => {
    const { id } = await tertahan();
    const m = await renderDetail(id);
    expect(m).toContain(KALIMAT_TERTAHAN);
    expect(m).not.toContain("data-bayar");
  });

  it("uang sudah masuk lewat pesanan lama: 'Pembayaran sedang diperiksa admin', tanpa tombol", async () => {
    const { id } = await uangDiPesananLama();
    const m = await renderDetail(id);
    expect(m).toContain("Pembayaran sedang diperiksa admin");
    expect(m).not.toContain("data-bayar");
  });

  it("lunas, sesi lahir: tautan ke jadwalnya di Passport", async () => {
    const { id, pesananId } = await bertagihan();
    await sukses(pesananId);
    const [sesi] = await querySql<{ id: string }>(
      `select id from public.sessions where booking_request_id = $1`,
      [id],
    );
    const m = await renderDetail(id);
    expect(m).toContain(`href="/passport/sesi/${sesi.id}"`);
    expect(m).not.toContain("data-bayar");
  });

  it("baris warisan menunggu_verifikasi: 'Bukti Anda sedang diperiksa admin', tanpa QRIS/unggah", async () => {
    const id = await warisan("menunggu_verifikasi");
    const m = await renderDetail(id);
    expect(m).toContain(KALIMAT_BUKTI);
    expect(m).not.toMatch(/qris/i);
    expect(m).not.toMatch(/unggah/i);
    expect(m).not.toContain("data-bayar");
  });

  it("milik klien lain dan id bukan uuid berakhir notFound", async () => {
    const { id } = await bertagihan();
    ref.sesi = sesiAnanda;
    await expect(renderDetail(id)).rejects.toThrow("NOTFOUND");
    ref.sesi = sesiKlien;
    await expect(renderDetail("bukan-uuid")).rejects.toThrow("NOTFOUND");
  });

  it("Lapis 1b: membuka halaman menanyakan Check Status untuk pesanan sesi terbuka milik pemanggil", async () => {
    const { id, pesananId } = await bertagihan();
    // Lebih tua dari jeda lima menit, belum pernah diperiksa.
    await wajib(
      svc
        .from("orders")
        .update({ dibuat_pada: new Date(Date.now() - 10 * 60_000).toISOString(), diperiksa_pada: null })
        .eq("id", pesananId),
    );
    const p = await pesanan(pesananId);

    await renderDetail(id);

    expect(dokuStatus().map((d) => d.url)).toContain(
      `https://api-sandbox.doku.com/orders/v1/status/${rakitInvoice(p.kode, p.percobaan)}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Daftar /passport/bayar
// ---------------------------------------------------------------------------

describe("daftar /passport/bayar — tagihan sesi", () => {
  it("tagihan yang bisa dibayar tampil dengan tombol Bayar dan tautan ke halamannya", async () => {
    const { id } = await bertagihan();
    const m = renderToStaticMarkup(await HalamanBayar());
    expect(m).toContain(`href="/passport/bayar/${id}"`);
    expect(m).toContain(`data-bayar="${id}"`);
  });

  it("tagihan yang sudah lunas dan sesinya lahir tidak lagi tampil sebagai tagihan", async () => {
    const { id, pesananId } = await bertagihan();
    await sukses(pesananId);
    const m = renderToStaticMarkup(await HalamanBayar());
    expect(m).not.toContain(`data-tagihan="${id}"`);
  });
});

// ---------------------------------------------------------------------------
// Rute POST /api/pesanan/sesi/[permintaan]/bayar
// ---------------------------------------------------------------------------

describe("POST /api/pesanan/sesi/[permintaan]/bayar", () => {
  it("pemilik -> 200 { url }; DOKU menerima invoice pesanan itu, callback ke halamannya, dua item generik", async () => {
    const { id, pesananId } = await bertagihan();
    const jawab = await mintaBayar(id);
    expect(jawab.status).toBe(200);
    expect(await jawab.json()).toEqual({ url: "https://sandbox.doku.test/bayar/b6" });

    expect(dokuBuat()).toHaveLength(1);
    const badan = JSON.parse(dokuBuat()[0].badan);
    const p = await pesanan(pesananId);
    expect(badan.order.invoice_number).toBe(rakitInvoice(p.kode, p.percobaan));
    expect(badan.order.callback_url).toBe(`https://padma.test/passport/bayar/${id}`);
    expect(badan.order.line_items.map((i: { name: string }) => i.name)).toEqual([
      "Sesi kunjungan PADMA",
      "Biaya transport",
    ]);
    // Nama layanan bisa mengungkap kondisi kesehatan (§5.3).
    expect(dokuBuat()[0].badan).not.toContain("PAD-UJI Layanan Bayar Passport");
  });

  it("klien lain -> 409 'Tagihan tidak ditemukan.', nol panggilan DOKU", async () => {
    const { id } = await bertagihan();
    ref.sesi = sesiAnanda;
    const jawab = await mintaBayar(id);
    expect(jawab.status).toBe(409);
    expect((await jawab.json()).pesan).toBe("Tagihan tidak ditemukan.");
    expect(dokuBuat()).toHaveLength(0);
  });

  it("uang sudah masuk (pesanan lama) -> 409, nol panggilan DOKU walau pesanan terkini terbuka", async () => {
    const { id } = await uangDiPesananLama();
    const jawab = await mintaBayar(id);
    expect(jawab.status).toBe(409);
    expect(dokuBuat()).toHaveLength(0);
  });

  it("tanpa persetujuan S&K -> 403 perlu_persetujuan, nol panggilan DOKU", async () => {
    const { id } = await bertagihan();
    await wajib(svc.from("persetujuan_akun").delete().eq("user_id", uidKlien));
    try {
      const jawab = await mintaBayar(id);
      expect(jawab.status).toBe(403);
      expect((await jawab.json()).kode).toBe("perlu_persetujuan");
      expect(dokuBuat()).toHaveLength(0);
    } finally {
      await setujuiDokumenUntukUji(svc, uidKlien);
    }
  });

  it("tanpa sesi -> 401", async () => {
    const { id } = await bertagihan();
    ref.sesi = anonClient();
    expect((await mintaBayar(id)).status).toBe(401);
    expect(dokuBuat()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tombol Bayar — keputusan murni, tanpa jsdom
// ---------------------------------------------------------------------------

describe("tombol Bayar", () => {
  const jawabJson = (status: number, isi: unknown) =>
    (async () => new Response(JSON.stringify(isi), { status })) as unknown as typeof fetch;

  it("memanggil rute sesi dengan POST", async () => {
    const panggilan: [string, RequestInit | undefined][] = [];
    const ambil = (async (u: string, i?: RequestInit) => {
      panggilan.push([u, i]);
      return new Response(JSON.stringify({ url: "https://doku.test/x" }), { status: 200 });
    }) as unknown as typeof fetch;
    await mintaTautanSesi("abc", ambil);
    expect(panggilan).toEqual([["/api/pesanan/sesi/abc/bayar", { method: "POST" }]]);
  });

  it("200 -> dialihkan ke url DOKU", async () => {
    const arah: string[] = [];
    const h = await bayarLaluAlihkan("abc", (u) => arah.push(u), jawabJson(200, { url: "https://doku.test/x" }));
    expect(h).toEqual({ jenis: "url", url: "https://doku.test/x" });
    expect(arah).toEqual(["https://doku.test/x"]);
  });

  it("409 / 502 / 503 -> kalimat rute, TIDAK dialihkan", async () => {
    for (const status of [409, 502, 503]) {
      const arah: string[] = [];
      const h = await bayarLaluAlihkan("abc", (u) => arah.push(u), jawabJson(status, { pesan: `p${status}` }));
      expect(h).toEqual({ jenis: "pesan", pesan: `p${status}` });
      expect(arah).toEqual([]);
    }
  });

  it("jaringan mati -> kalimat coba lagi, TIDAK dialihkan", async () => {
    const arah: string[] = [];
    const putus = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const h = await bayarLaluAlihkan("abc", (u) => arah.push(u), putus);
    expect(h.jenis).toBe("pesan");
    expect(arah).toEqual([]);
  });

  it("401 -> masuk; 403 perlu_persetujuan -> persetujuan", async () => {
    expect(await mintaTautanSesi("abc", jawabJson(401, {}))).toEqual({ jenis: "masuk" });
    expect(await mintaTautanSesi("abc", jawabJson(403, { kode: "perlu_persetujuan" }))).toEqual({
      jenis: "persetujuan",
    });
  });

  it("dirender sebagai tombol bertanda data-bayar", () => {
    const m = renderToStaticMarkup(
      createElement(TombolBayar, { permintaanId: "abc", label: "Bayar sekarang" }),
    );
    expect(m).toMatch(/<button[^>]*data-bayar="abc"[^>]*>Bayar sekarang<\/button>/);
  });
});

// ---------------------------------------------------------------------------
// Pembatalan baris warisan (temuan tertunda B4)
// ---------------------------------------------------------------------------

describe("klien membatalkan baris warisan menunggu_verifikasi", () => {
  it("ditolak dengan kalimat §7 'Bukti Anda sedang diperiksa admin', bukan 'sudah kami terima'", async () => {
    const id = await warisan("menunggu_verifikasi");
    const r = await batalkanPengajuan(id);
    expect(r.ok).toBe(false);
    const pesan = (r as { pesan: string }).pesan;
    expect(pesan).toContain(KALIMAT_BUKTI);
    expect(pesan).not.toContain("sudah kami terima");
  });
});
