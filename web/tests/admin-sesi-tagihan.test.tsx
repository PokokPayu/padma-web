/**
 * Layar staf tagihan sesi (P3/B5, spec §6.2, §6.5, §6.7, D2-D4).
 *
 * Yang dijaga di sini:
 *  - `/admin/sesi` dan panel `?lihat=` NOL RUPIAH (D3), juga untuk pengajuan
 *    tertahan dan tenggat lewat; pesan WhatsApp tanpa angka;
 *  - kata keadaan tagihan dan tombol yang pantas untuk tiap keadaan, termasuk
 *    jalan pemulihan pengajuan TERTAHAN (ubah jadwal, ganti bidan) lewat layar;
 *  - admin DIBERI TAHU saat perubahan menutup tagihan terbuka;
 *  - penanda "Baru — kabari bidan" dan hitungannya;
 *  - `/admin/pesanan` menandai pesanan jenis Sesi dan menaut ke pengajuannya;
 *  - email tagihan (D2): gagal kirim tidak menggagalkan terbit, angkanya beku.
 *
 * Semua fixture MILIK berkas ini (klien, layanan nonaktif, varian, dua bidan
 * bertitik): koordinat mitra seed dikosongkan berkas lain.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { dbUrl, querySql } from "./helpers/db";
import { skriningHijau } from "./helpers/skrining";
import { nominalDalam } from "./helpers/nominal";
import { hariIniJakarta } from "@/lib/passport/waktu";
import { geserHari } from "@/lib/owner/pekan";
import { rakitInvoice } from "@/lib/pesanan/order-id";
import { formatRupiah } from "@/lib/rupiah-publik";

const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: async () => ref.sesi! }));

const surat = vi.hoisted(() => ({
  hasil: { ok: true, id: "email-uji" } as { ok: true; id: string } | { ok: false; sebab: string },
  terkirim: [] as { ke: string; subjek: string; html: string; teks: string }[],
}));
vi.mock("@/lib/email/kirim", () => ({
  kirimEmail: async (i: { ke: string; subjek: string; html: string; teks: string }) => {
    surat.terkirim.push(i);
    return surat.hasil;
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NOTFOUND");
  },
  usePathname: () => "/admin/sesi",
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

process.env.NEXT_PUBLIC_BASIS_URL = "https://padma.test";

const { default: SesiPage } = await import("@/app/admin/sesi/page");
const { terbitkanTagihan, kirimUlangEmailTagihan, jadwalkanSesi } = await import("@/app/admin/sesi/aksi");
const { perbaruiPermintaan } = await import("@/app/admin/sesi/aksi-ubah-permintaan");
const { gantiBidanMenungguBayar, tandaiSudahDikabari } = await import("@/app/admin/sesi/aksi-tagihan");
const { hitungAntrean } = await import("@/lib/admin/antrean");
const { bacaPesananStaf } = await import("@/lib/admin/pesanan");
const { TabelPesanan } = await import("@/app/admin/pesanan/tabel-pesanan");

const svc = createAdminSupabase();
const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

const KLIEN = "44444444-4444-4444-4444-4444444443b5";
const NAMA_KLIEN = "Klien Uji Layar Tagihan";
const EMAIL_KLIEN = "uji-layar-tagihan-b5@padma.test";
const SVC_B5 = "11111111-1111-1111-1111-1111111113b5";
const VARIAN = "77777777-7777-7777-7777-7777777773b5";
const MITRA = "33333333-3333-3333-3333-3333333333b5";
const MITRA_B = "33333333-3333-3333-3333-3333333334b5";
const TITIK_MITRA = { lat: -7.96662, lon: 112.632632 };
const TITIK_MITRA_B = { lat: -7.9801, lon: 112.6402 };
const ALAMAT = { teks: "Jl. Uji Layar Tagihan No. 5", lat: -7.9666, lon: 112.6966 };
const HARGA_LAYANAN = 300_000;

const TGL_KUNJUNGAN = geserHari(hariIniJakarta(), 3);

let sesiAdmin: SupabaseClient;

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

async function wajib<T extends { error: unknown }>(p: PromiseLike<T>): Promise<T> {
  const hasil = await p;
  if (hasil.error) throw hasil.error;
  return hasil;
}

async function bersihkan(): Promise<void> {
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
}

async function bongkarKatalog(): Promise<void> {
  await svc.from("variant_rates").delete().eq("variant_id", VARIAN);
  await svc.from("service_variants").delete().eq("service_id", SVC_B5);
  await svc.from("services").delete().eq("id", SVC_B5);
  await svc.from("partners").delete().in("id", [MITRA, MITRA_B]);
  await svc.from("clients").delete().eq("id", KLIEN);
}

beforeAll(async () => {
  sesiAdmin = await signInAs("admin@padma.test");
  ref.sesi = sesiAdmin;
  await bersihkan();
  await bongkarKatalog();
  await wajib(
    svc.from("clients").insert({
      id: KLIEN,
      padma_id: "PAD-UJI-03B5",
      nama: NAMA_KLIEN,
      email: EMAIL_KLIEN,
      no_hp: "0811-9500-0001",
      phase_id: "prekonsepsi",
    }),
  );
  await wajib(
    svc.from("services").insert({
      id: SVC_B5,
      phase_id: "prekonsepsi",
      nama: "PAD-UJI Layanan Layar Tagihan",
      deskripsi: "fixture",
      aktif: false,
    }),
  );
  await wajib(svc.from("service_variants").insert({ id: VARIAN, service_id: SVC_B5, label: "Uji B5", urutan: 90 }));
  await wajib(
    svc.from("variant_rates").insert({
      variant_id: VARIAN,
      harga_klien: HARGA_LAYANAN,
      honor_mitra: 100_000,
      berlaku_sejak: "2026-01-01",
    }),
  );
  await wajib(
    svc.from("partners").insert([
      { id: MITRA, nama: "PAD-UJI Bidan B5", no_hp: "0811-9500-0010", aktif: true, ...TITIK_MITRA },
      { id: MITRA_B, nama: "PAD-UJI Bidan B5 Pengganti", no_hp: "0811-9500-0011", aktif: true, ...TITIK_MITRA_B },
    ]),
  );
});

beforeEach(async () => {
  ref.sesi = sesiAdmin;
  surat.hasil = { ok: true, id: "email-uji" };
  surat.terkirim.length = 0;
  await bersihkan();
  await wajib(svc.from("partners").update({ aktif: true }).in("id", [MITRA, MITRA_B]));
});

afterAll(async () => {
  await bersihkan();
  await bongkarKatalog();
});

async function pengajuanSiap(): Promise<string> {
  const skrining = await skriningHijau(svc, KLIEN);
  const { data } = await wajib(
    svc
      .from("booking_requests")
      .insert({
        client_id: KLIEN,
        service_id: SVC_B5,
        variant_id: VARIAN,
        tanggal: TGL_KUNJUNGAN,
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
  await wajib(svc.from("booking_requests").update({ status: "mitra_siap", partner_id: MITRA }).eq("id", id));
  return id;
}

async function bertagihan(): Promise<{ id: string; pesananId: string }> {
  const id = await pengajuanSiap();
  const { data, error } = await sesiAdmin.rpc("terbitkan_tagihan_sesi", { p_permintaan_id: id });
  if (error) throw error;
  return { id, pesananId: data as string };
}

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
    p_transaksi_id: `trx-uji-b5-${randomUUID()}`,
    p_kanal: "VIRTUAL_ACCOUNT_BCA",
    p_nominal: p.total,
    p_sidik: randomUUID(),
    p_sumber: "webhook",
  });
}

/** Tertahan: pesanan lunas, bidan nonaktif saat uang mendarat, sesi tidak lahir. */
async function tertahan(): Promise<{ id: string; pesananId: string }> {
  const t = await bertagihan();
  await wajib(svc.from("partners").update({ aktif: false }).eq("id", MITRA));
  const { error } = await lunasi(t.pesananId);
  expect(error).toBeNull();
  await wajib(svc.from("partners").update({ aktif: true }).eq("id", MITRA));
  return t;
}

/** Baris warisan QRIS: menunggu_bayar tanpa pesanan. */
async function warisanBelum(): Promise<string> {
  const id = await pengajuanSiap();
  await wajib(
    svc
      .from("booking_requests")
      .update({ status: "menunggu_bayar", tenggat: new Date(Date.now() + 24 * 3_600_000).toISOString() })
      .eq("id", id),
  );
  return id;
}

async function warisanLunas(): Promise<string> {
  const id = await pengajuanSiap();
  await wajib(
    svc
      .from("booking_requests")
      .update({ status: "menunggu_bayar", tenggat: new Date(Date.now() + 24 * 3_600_000).toISOString() })
      .eq("id", id),
  );
  await wajib(svc.from("booking_requests").update({ status_bayar: "lunas" }).eq("id", id));
  return id;
}

/** UPDATE dengan trigger dimatikan untuk satu pernyataan: keadaan yang tak bisa dibangun lewat jalur sah. */
async function paksa(tabel: "orders" | "booking_requests", set: string, id: string): Promise<void> {
  const k = new Client({ connectionString: dbUrl() });
  await k.connect();
  try {
    await k.query("begin");
    await k.query("set local session_replication_role = replica");
    const h = await k.query(`update public.${tabel} set ${set} where id = $1`, [id]);
    if (h.rowCount !== 1) throw new Error(`paksa mengenai ${h.rowCount} baris`);
    await k.query("commit");
  } catch (e) {
    await k.query("rollback").catch(() => {});
    throw e;
  } finally {
    await k.end();
  }
}

async function render(sp: Record<string, string>): Promise<string> {
  return renderToStaticMarkup(
    await SesiPage({ searchParams: Promise.resolve({ cari: NAMA_KLIEN, ...sp }) }),
  );
}

/** TANPA `cari`: persis tautan dari /admin/pesanan. */
async function renderTanpaCari(sp: Record<string, string>): Promise<string> {
  return renderToStaticMarkup(await SesiPage({ searchParams: Promise.resolve(sp) }));
}

const lihat = (id: string) => render({ tab: "permintaan", lihat: id });

function hrefWa(html: string): string {
  const m = /href="(https:\/\/wa\.me\/[^"]*\?text=[^"]*)"/.exec(html);
  return m ? decodeURIComponent(m[1].replace(/&amp;/g, "&")) : "";
}

function formUbah(isi: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(isi)) f.set(k, v);
  return f;
}

// ---------------------------------------------------------------------------
// D3: nol rupiah
// ---------------------------------------------------------------------------

describe("/admin/sesi?lihat= NOL RUPIAH (D3)", () => {
  it("pengajuan menunggu_bayar terbuka: nominalDalam kosong, WA tanpa angka, memuat tautan Passport", async () => {
    const { id } = await bertagihan();
    const html = await lihat(id);
    expect(html).toContain("Menunggu pembayaran, tenggat");
    expect(nominalDalam(html), "nominal bocor di panel").toEqual([]);
    const wa = hrefWa(html);
    expect(wa, "tombol WA tidak ada").not.toBe("");
    expect(wa).not.toMatch(/rp/i);
    expect(nominalDalam(wa)).toEqual([]);
    expect(wa).toContain(`https://padma.test/passport/bayar/${id}`);
    expect(wa).toContain("Tagihan Anda sudah terbit. Bayar di Digital Passport");
  });

  it("pengajuan tertahan: nol rupiah", async () => {
    const { id } = await tertahan();
    const html = await lihat(id);
    expect(html).toContain("Pembayaran diterima — sesi tertahan");
    expect(nominalDalam(html)).toEqual([]);
    // Pengajuan tertahan TIDAK menawarkan WA tagihan (uangnya sudah masuk).
    expect(hrefWa(html)).toBe("");
    expect(html).not.toContain("Kirim tagihan via WA");
  });

  it("tenggat lewat: nol rupiah", async () => {
    const { id, pesananId } = await bertagihan();
    await paksa("orders", "kedaluwarsa_pada = now() - interval '1 hour'", pesananId);
    const html = await lihat(id);
    expect(html).toContain("Tenggat lewat");
    expect(nominalDalam(html)).toEqual([]);
  });

  it("daftar permintaan dan tab sesi juga nol rupiah", async () => {
    await bertagihan();
    expect(nominalDalam(await render({}))).toEqual([]);
    expect(nominalDalam(await render({ tab: "sesi" }))).toEqual([]);
  });

  it("sumber panel & halaman tidak lagi merakit nominal", () => {
    for (const rel of ["src/app/admin/sesi/panel-permintaan.tsx", "src/app/admin/sesi/page.tsx"]) {
      const s = baca(rel);
      expect(s, rel).not.toContain("daftarTagihanPengajuanAdmin");
      expect(s, rel).not.toContain("hargaLayanan");
      expect(s, rel).not.toContain("formatRupiah");
    }
  });
});

// ---------------------------------------------------------------------------
// Kata keadaan & tombol
// ---------------------------------------------------------------------------

describe("kata keadaan dan tombol di panel permintaan", () => {
  it("terbuka: WA, email, Terbitkan ulang, Batalkan pengajuan, Ganti bidan; TANPA Konfirmasi jadwal", async () => {
    const { id } = await bertagihan();
    const html = await lihat(id);
    for (const t of ["Kirim tagihan via WA", "Terbitkan ulang", "Batalkan pengajuan", "Ganti bidan"]) {
      expect(html, t).toContain(t);
    }
    expect(html).toMatch(/Kirim (ulang )?email/i);
    expect(html).not.toContain("Konfirmasi jadwal");
  });

  it("baris warisan lunas tanpa pesanan: ADA Konfirmasi jadwal", async () => {
    const id = await warisanLunas();
    const html = await lihat(id);
    expect(html).toContain("Konfirmasi jadwal");
    expect(html).not.toContain("Terbitkan ulang");
  });

  it("tenggat lewat: Terbitkan ulang dan Batalkan pengajuan, tanpa WA", async () => {
    const { id, pesananId } = await bertagihan();
    await paksa("orders", "kedaluwarsa_pada = now() - interval '1 hour'", pesananId);
    const html = await lihat(id);
    expect(html).toContain("Terbitkan ulang");
    expect(html).toContain("Batalkan pengajuan");
    expect(html).not.toContain("Kirim tagihan via WA");
  });

  it("tanda tinjauan: 'Pembayaran perlu ditinjau' bertaut /admin/pesanan", async () => {
    const { id, pesananId } = await bertagihan();
    await paksa("orders", "butuh_tinjauan_pada = now(), sebab_tinjauan = 'selisih_status'", pesananId);
    const html = await lihat(id);
    expect(html).toContain("Pembayaran perlu ditinjau");
    expect(html).toContain('href="/admin/pesanan"');
    expect(html).not.toContain("Batalkan pengajuan");
  });

  it("TERTAHAN: form ubah jadwal/alamat dan Ganti bidan tersedia (Ruling 10.1), Batalkan tidak", async () => {
    const { id } = await tertahan();
    const html = await lihat(id);
    expect(html).toContain("Simpan perubahan");
    expect(html).toContain("Ganti bidan");
    expect(html).toContain('href="/admin/pesanan"');
    expect(html).not.toContain("Batalkan pengajuan");
    expect(html).not.toContain("Terbitkan ulang");
  });

  it("tagihan ditutup perubahan masukan harga: kata 'Tagihan ditutup — terbitkan ulang'", async () => {
    const { id } = await bertagihan();
    const r = await perbaruiPermintaan(id, formUbah({ alamat: ALAMAT.teks, tanggal: TGL_KUNJUNGAN, jam: "10:00" }));
    expect(r.ok).toBe(true);
    const html = await lihat(id);
    expect(html).toContain("Tagihan ditutup — terbitkan ulang");
    expect(html).toContain("Terbitkan ulang");
  });
});

// ---------------------------------------------------------------------------
// Ruling 10.2: admin diberi tahu
// ---------------------------------------------------------------------------

describe("perubahan yang menutup tagihan terbuka DIKABARKAN ke admin (Ruling 10.2)", () => {
  const KALIMAT = /Tagihan yang sedang terbuka ditutup.*terbitkan ulang/i;

  it("perbaruiPermintaan pada menunggu_bayar bertagihan terbuka -> ok + kalimat", async () => {
    const { id } = await bertagihan();
    const r = await perbaruiPermintaan(id, formUbah({ alamat: ALAMAT.teks, tanggal: TGL_KUNJUNGAN, jam: "10:00" }));
    expect(r.ok).toBe(true);
    expect((r as { pesan?: string }).pesan).toMatch(KALIMAT);
  });

  it("gantiBidanMenungguBayar pada tagihan terbuka -> ok + kalimat", async () => {
    const { id } = await bertagihan();
    const r = await gantiBidanMenungguBayar(id, MITRA_B);
    expect(r.ok).toBe(true);
    expect((r as { pesan?: string }).pesan).toMatch(KALIMAT);
  });

  it("tanpa tagihan terbuka (tertahan) -> {ok:true} polos, tanpa kalimat palsu", async () => {
    const { id } = await tertahan();
    const r = await perbaruiPermintaan(id, formUbah({ alamat: ALAMAT.teks + " (RT 2)", tanggal: TGL_KUNJUNGAN, jam: "09:00" }));
    expect(r).toEqual({ ok: true });
    expect(await gantiBidanMenungguBayar(id, MITRA_B)).toEqual({ ok: true });
  });

  it("perubahan yang TIDAK menutup tagihan (teks alamat saja) -> {ok:true} polos", async () => {
    const { id } = await bertagihan();
    const r = await perbaruiPermintaan(id, formUbah({ alamat: ALAMAT.teks + " (RT 2)", tanggal: TGL_KUNJUNGAN, jam: "09:00" }));
    expect(r).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// Kabari bidan
// ---------------------------------------------------------------------------

describe("penanda 'Baru — kabari bidan' (§6.7)", () => {
  it("sesi hasil penyalur bertanda; 'Sudah dikabari' menghapusnya; hitungAntrean ikut", async () => {
    const dasar = (await hitungAntrean()).kabariBidan;
    const { id, pesananId } = await bertagihan();
    const { error } = await lunasi(pesananId);
    expect(error).toBeNull();
    const [s] = await querySql<{ id: string }>(`select id from public.sessions where booking_request_id = $1`, [id]);
    expect(s).toBeTruthy();

    const daftar = await render({ tab: "sesi" });
    expect(daftar).toContain("Baru — kabari bidan");
    expect(nominalDalam(daftar)).toEqual([]);
    expect((await hitungAntrean()).kabariBidan).toBe(dasar + 1);

    const panel = await render({ tab: "sesi", ubah: s.id });
    expect(panel).toContain("Sudah dikabari");

    expect(await tandaiSudahDikabari(s.id)).toEqual({ ok: true });
    expect(await render({ tab: "sesi" })).not.toContain("Baru — kabari bidan");
    expect((await hitungAntrean()).kabariBidan).toBe(dasar);
  });

  it("sesi jalur 2 (jadwalkanSesi) TIDAK bertanda", async () => {
    // `jadwalkanSesi` menolak layanan nonaktif; fixture diaktifkan hanya selama uji ini.
    await wajib(svc.from("services").update({ aktif: true }).eq("id", SVC_B5));
    try {
      const r = await jadwalkanSesi(
        formUbah({
          client_id: KLIEN,
          service_id: SVC_B5,
          variant_id: VARIAN,
          partner_id: MITRA,
          tanggal: geserHari(hariIniJakarta(), 5),
          jam: "09:00",
        }),
      );
      expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
    } finally {
      await svc.from("services").update({ aktif: false }).eq("id", SVC_B5);
    }
    const [s] = await querySql<{ n: number }>(`select count(*)::int n from public.sessions where client_id = $1`, [KLIEN]);
    expect(s.n).toBe(1);
    expect(await render({ tab: "sesi" })).not.toContain("Baru — kabari bidan");
  });

  it("sesi batal tidak ditandai dan tidak dihitung", async () => {
    const dasar = (await hitungAntrean()).kabariBidan;
    const { id, pesananId } = await bertagihan();
    await lunasi(pesananId);
    const [s] = await querySql<{ id: string }>(`select id from public.sessions where booking_request_id = $1`, [id]);
    await wajib(svc.from("sessions").update({ status: "dibatalkan_klien" }).eq("id", s.id));
    expect(await render({ tab: "sesi" })).not.toContain("Baru — kabari bidan");
    expect((await hitungAntrean()).kabariBidan).toBe(dasar);
  });
});

// ---------------------------------------------------------------------------
// /admin/pesanan
// ---------------------------------------------------------------------------

describe("/admin/pesanan: pesanan jenis Sesi", () => {
  it("berlabel 'Sesi' dan menaut ke pengajuannya", async () => {
    const { id, pesananId } = await bertagihan();
    const { terbuka } = await bacaPesananStaf();
    const baris = terbuka.find((p) => p.id === pesananId)!;
    expect(baris.jenis).toBe("sesi");
    expect(baris.bookingRequestId).toBe(id);
    const html = renderToStaticMarkup(<TabelPesanan baris={[baris]} />);
    expect(html).toMatch(/>Sesi</);
    expect(html).toContain(`href="/admin/sesi?tab=permintaan&amp;lihat=${id}"`);
  });

  it("pesanan produk TIDAK memuat label Sesi maupun tautan ke /admin/sesi", () => {
    const html = renderToStaticMarkup(
      <TabelPesanan
        baris={[
          {
            id: "11111111-1111-1111-1111-111111111111",
            kode: "PSN-261120-AD0001",
            status: "menunggu_bayar",
            percobaan: 1,
            padmaId: "PAD-X",
            jumlahItem: 1,
            dibuatPada: "2026-11-20T01:00:00Z",
            kedaluwarsaPada: "2026-11-21T01:00:00Z",
            lunasPada: null,
            diperiksaPada: null,
            butuhTinjauanPada: null,
            sebabTinjauan: null,
            kanal: null,
            transaksiId: null,
            statusGateway: null,
            jenis: "produk_digital",
            bookingRequestId: null,
            items: [],
            nominalTagih: null,
            nominalDiterima: null,
          },
        ]}
      />,
    );
    expect(html).not.toMatch(/>Sesi</);
    expect(html).not.toContain("/admin/sesi");
  });
});

// ---------------------------------------------------------------------------
// Email (D2)
// ---------------------------------------------------------------------------

describe("email tagihan (D2)", () => {
  it("kirimEmail gagal -> terbitkanTagihan tetap ok, pesanan terbit, email_tagihan_pada null", async () => {
    surat.hasil = { ok: false, sebab: "uji" };
    const id = await pengajuanSiap();
    expect(await terbitkanTagihan(id)).toEqual({ ok: true });
    const [o] = await querySql<{ n: number }>(
      `select count(*)::int n from public.orders where booking_request_id = $1 and status = 'menunggu_bayar'`,
      [id],
    );
    expect(o.n).toBe(1);
    const [b] = await querySql<{ email_tagihan_pada: Date | null }>(
      `select email_tagihan_pada from public.booking_requests where id = $1`,
      [id],
    );
    expect(b.email_tagihan_pada).toBeNull();
  });

  it("kirimEmail sukses -> isi memuat total beku & /passport/bayar/<id>, tanpa 'unggah' / QRIS", async () => {
    const id = await pengajuanSiap();
    expect(await terbitkanTagihan(id)).toEqual({ ok: true });
    expect(surat.terkirim).toHaveLength(1);
    const [{ total }] = await querySql<{ total: number }>(
      `select sum(i.harga_beku)::int total from public.order_items i where i.booking_request_id = $1`,
      [id],
    );
    const e = surat.terkirim[0];
    expect(e.ke).toBe(EMAIL_KLIEN);
    for (const isi of [e.html, e.teks]) {
      expect(isi).toContain(formatRupiah(total));
      expect(isi).toContain(`https://padma.test/passport/bayar/${id}`);
      expect(isi).not.toMatch(/unggah|qris/i);
      // Ruling 11: kebijakan sebenarnya, bukan pelepasan otomatis.
      expect(isi).toContain("tim PADMA akan menghubungi Anda untuk menerbitkan ulang atau membatalkan");
      expect(isi).not.toMatch(/lepas untuk klien lain/);
    }
    expect(e.teks).toContain(formatRupiah(HARGA_LAYANAN));
    const [b] = await querySql<{ email_tagihan_pada: Date | null }>(
      `select email_tagihan_pada from public.booking_requests where id = $1`,
      [id],
    );
    expect(b.email_tagihan_pada).not.toBeNull();
  });

  it("angka email = harga BEKU: tarif yang berubah sesudah terbit tidak menggeser email kirim-ulang", async () => {
    const id = await pengajuanSiap();
    await terbitkanTagihan(id);
    const awal = surat.terkirim[0].teks;
    await wajib(
      svc.from("variant_rates").insert({
        variant_id: VARIAN,
        harga_klien: HARGA_LAYANAN + 50_000,
        honor_mitra: 100_000,
        berlaku_sejak: TGL_KUNJUNGAN,
      }),
    );
    try {
      expect(await kirimUlangEmailTagihan(id)).toEqual({ ok: true });
      expect(surat.terkirim[1].teks).toBe(awal);
    } finally {
      await svc.from("variant_rates").delete().eq("variant_id", VARIAN).eq("harga_klien", HARGA_LAYANAN + 50_000);
    }
  });

  it("kirim ulang tanpa pesanan terbuka -> kalimat, bukan email", async () => {
    const { id, pesananId } = await bertagihan();
    expect(pesananId).toBeTruthy();
    await perbaruiPermintaan(id, formUbah({ alamat: ALAMAT.teks, tanggal: TGL_KUNJUNGAN, jam: "10:00" }));
    const r = await kirimUlangEmailTagihan(id);
    expect(r.ok).toBe(false);
    expect(surat.terkirim).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Ruling 10.3 dan bentuk berkas
// ---------------------------------------------------------------------------

describe("kalimat total_nol dan bentuk berkas", () => {
  it("total_nol tidak mengirim admin ke menu owner-only: Owner menetapkan tarif", async () => {
    const { KALIMAT_SEBAB_ADMIN } = await import("@/lib/tagihan/pengajuan");
    expect(KALIMAT_SEBAB_ADMIN.total_nol).toBe(
      "Total tagihan nol — Owner menetapkan tarif varian dan transport di menu Tarif/Transport.",
    );
    // Kalimat ini sampai ke /admin/sesi (nol rupiah): tidak satu pun boleh cocok pola nominal.
    for (const [sebab, kalimat] of Object.entries(KALIMAT_SEBAB_ADMIN)) {
      expect(nominalDalam(kalimat), sebab).toEqual([]);
    }
  });

  it("migrasi view menambah booking_request_id DI UJUNG", () => {
    const m = baca("supabase/migrations/20261113140500_item_staf_pengajuan.sql");
    expect(m).toMatch(/i\.product_id,\s*i\.booking_request_id\s+from public\.order_items/);
  });
});

// ---------------------------------------------------------------------------
// Fix round 1
// ---------------------------------------------------------------------------

describe("I1: ?lihat= membuka panel walau baris tidak ada di halaman daftar", () => {
  it("pengajuan tertahan, tanpa cari", async () => {
    const { id } = await tertahan();
    const html = await renderTanpaCari({ tab: "permintaan", lihat: id });
    expect(html).toContain(`Permintaan — ${NAMA_KLIEN}`);
    expect(html).toContain("Pembayaran diterima — sesi tertahan");
    expect(nominalDalam(html)).toEqual([]);
  });

  it("status DI LUAR antrean (dibatalkan_tenggat + tinjauan lunas_setelah_tutup), tanpa cari", async () => {
    const { id, pesananId } = await bertagihan();
    await paksa("booking_requests", "status = 'dibatalkan_tenggat'", id);
    await paksa("orders", "butuh_tinjauan_pada = now(), sebab_tinjauan = 'lunas_setelah_tutup'", pesananId);
    const html = await renderTanpaCari({ tab: "permintaan", lihat: id });
    expect(html).toContain(`Permintaan — ${NAMA_KLIEN}`);
    // Dan memang BUKAN baris daftar aktif: itulah yang membuat jalur id diperlukan.
    expect(html).not.toContain(`data-permintaan="${id}"`);
  });

  it("baris jatuh di HALAMAN KE-2 daftar antrean (>25 baris lebih awal), tanpa cari", async () => {
    const { id } = await bertagihan();
    await paksa("booking_requests", `tanggal = '${geserHari(hariIniJakarta(), 400)}'`, id);
    for (let i = 0; i < 26; i++) {
      const skrining = await skriningHijau(svc, KLIEN);
      await wajib(
        svc.from("booking_requests").insert({
          client_id: KLIEN,
          service_id: SVC_B5,
          variant_id: VARIAN,
          tanggal: geserHari(hariIniJakarta(), 4 + i),
          jam_mulai: "09:00",
          preferensi_waktu: "pagi",
          alamat: ALAMAT.teks,
          alamat_lat: ALAMAT.lat,
          alamat_lon: ALAMAT.lon,
          status: "diminta",
          screening_id: skrining,
        }),
      );
    }
    const html = await renderTanpaCari({ tab: "permintaan", lihat: id });
    expect(html).not.toContain(`data-permintaan="${id}"`);
    expect(html).toContain(`Permintaan — ${NAMA_KLIEN}`);
    expect(html).toContain("Menunggu pembayaran, tenggat");
  });

  it("id sembarang atau bukan uuid TIDAK membuka panel dan tidak melempar", async () => {
    for (const lihatNilai of ["bukan-uuid", "00000000-0000-0000-0000-000000000000"]) {
      const html = await renderTanpaCari({ tab: "permintaan", lihat: lihatNilai });
      expect(html).not.toContain("Permintaan — ");
    }
  });
});

describe("I2: baris warisan belum dibayar", () => {
  it("hanya Terbitkan ulang / Batalkan / Ganti bidan: tanpa WA 'sudah terbit' dan tanpa kalimat email", async () => {
    const id = await warisanBelum();
    const html = await lihat(id);
    expect(html).toContain("Belum dibayar (tagihan lama)");
    for (const t of ["Terbitkan ulang", "Batalkan pengajuan", "Ganti bidan"]) expect(html, t).toContain(t);
    expect(html).not.toContain("Kirim tagihan via WA");
    expect(hrefWa(html)).toBe("");
    expect(html).not.toMatch(/Kirim (ulang )?email|kirim manual dengan tombol/i);
  });
});

describe("Ruling 11", () => {
  it("'Batalkan pengajuan' dijaga confirm() di sumber komponen klien", () => {
    const s = baca("src/app/admin/sesi/aksi-permintaan.tsx");
    const i = s.indexOf("batalkanPengajuanStaf(permintaanId)");
    expect(i).toBeGreaterThan(0);
    const sebelum = s.slice(Math.max(0, i - 600), i);
    expect(sebelum).toMatch(/if\s*\(\s*!confirm\(/);
    expect(sebelum).toMatch(/return;/);
  });

  it("form ubah dan kalimat 'Ganti bidan' TIDAK tampil di keadaan yang akan menolaknya", async () => {
    // perlu_ditinjau
    const a = await bertagihan();
    await paksa("orders", "butuh_tinjauan_pada = now(), sebab_tinjauan = 'selisih_status'", a.pesananId);
    const htmlA = await lihat(a.id);
    expect(htmlA).toContain("Pembayaran perlu ditinjau");
    expect(htmlA).not.toContain("Simpan perubahan");
    expect(htmlA).not.toMatch(/tekan\s+(“|&quot;|")?Ganti bidan/);
    expect(htmlA).not.toContain("ditetapkan untuk jadwal");
    await bersihkan();
    // warisan lunas
    const w = await warisanLunas();
    const htmlW = await lihat(w);
    expect(htmlW).not.toContain("Simpan perubahan");
    expect(htmlW).not.toContain("ditetapkan untuk jadwal");
  });

  it("form ubah + kalimat tetap tampil bila boleh (tagihan terbuka)", async () => {
    const { id } = await bertagihan();
    const html = await lihat(id);
    expect(html).toContain("Simpan perubahan");
    expect(html).toContain("ditetapkan untuk jadwal");
  });

  it("bacaan SESUDAH tulisan yang gagal tidak mengubah hasil menjadi galat: perubahan tersimpan, {ok:true}", async () => {
    const { id } = await bertagihan();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    let panggilanOrders = 0;
    const palsu: Record<string, unknown> = {
      select: () => palsu,
      eq: () => palsu,
      in: () => palsu,
      then: (res: (v: unknown) => unknown) => res({ count: null, error: { message: "gagal baca uji" } }),
    };
    ref.sesi = new Proxy(sesiAdmin, {
      get(target, prop, penerima) {
        if (prop === "from") {
          return (tabel: string) => {
            if (tabel === "orders" && ++panggilanOrders > 1) return palsu;
            return target.from(tabel);
          };
        }
        const nilai = Reflect.get(target, prop, penerima);
        return typeof nilai === "function" ? nilai.bind(target) : nilai;
      },
    });
    try {
      const r = await perbaruiPermintaan(id, formUbah({ alamat: ALAMAT.teks, tanggal: TGL_KUNJUNGAN, jam: "10:00" }));
      expect(r).toEqual({ ok: true });
      expect(panggilanOrders).toBeGreaterThan(1);
      expect(log).toHaveBeenCalled();
    } finally {
      log.mockRestore();
      ref.sesi = sesiAdmin;
    }
    const [b] = await querySql<{ jam_mulai: string }>(`select jam_mulai::text from public.booking_requests where id = $1`, [id]);
    expect(b.jam_mulai).toBe("10:00:00");
  });
});
