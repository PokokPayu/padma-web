/**
 * PAGAR PENSIUN JALUR QRIS PENGAJUAN (P3/B7, spec §6.8 dan §7).
 *
 * Tagihan sesi kini pesanan DOKU. Yang dijaga di sini adalah bahwa sisa jalur
 * lama TIDAK hidup kembali diam-diam: rute unggah bukti, cron tenggat, fungsi
 * pembatalnya di SQL, dan rumus harga di TS. Yang TETAP: penampil bukti staf
 * `GET /api/bukti/[permintaan]`, `hapusBukti`, dan bucket `bukti-bayar`.
 *
 * Tab "tagihan pengajuan" di `/admin/bayar` dibatasi ke baris WARISAN, yaitu
 * pengajuan TANPA pesanan, dan angkanya dibaca dari
 * `rincian_tagihan_permintaan` (SQL), bukan dihitung ulang di TS.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { querySql } from "./helpers/db";
import { skriningHijau } from "./helpers/skrining";
import { hariIniJakarta } from "@/lib/passport/waktu";
import { geserHari } from "@/lib/owner/pekan";
import { formatRupiah } from "@/lib/rupiah-publik";
import { LABEL_JENJANG } from "@/lib/transport/jarak";

const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: async () => ref.sesi! }));

const { daftarTagihanPengajuanAdmin } = await import("@/lib/admin/tagihan-pengajuan");

const AKAR = path.resolve(__dirname, "..");
const ada = (rel: string) => existsSync(path.join(AKAR, rel));
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

function berkasSumber(dir: string, hasil: string[] = []): string[] {
  for (const nama of readdirSync(path.join(AKAR, dir))) {
    const rel = path.join(dir, nama);
    if (statSync(path.join(AKAR, rel)).isDirectory()) berkasSumber(rel, hasil);
    else if (/\.(ts|tsx)$/.test(nama)) hasil.push(rel);
  }
  return hasil;
}

describe("berkas jalur lama sudah tiada", () => {
  it.each([
    "src/app/api/cron/tenggat",
    "src/app/api/bukti/route.ts",
    "src/app/passport/bayar/[id]/unggah-bukti.tsx",
    "tests/cron-tenggat.test.ts",
  ])("%s tidak ada", (rel) => {
    expect(ada(rel), rel).toBe(false);
  });

  it("yang TETAP hidup: penampil bukti staf dan pembersih cron pesanan", () => {
    expect(ada("src/app/api/bukti/[permintaan]/route.ts")).toBe(true);
    expect(ada("src/app/api/cron/pesanan/route.ts")).toBe(true);
    expect(baca("src/app/admin/bayar/aksi-pengajuan.ts")).toContain("hapusBukti");
  });
});

describe("rumus harga TS dan pembatal tenggat tidak tersisa di src/", () => {
  const sumber = berkasSumber("src");
  const kata = [
    "hitungTagihanPengajuan",
    "sudahLewatTenggat",
    "batalkan_lewat_tenggat",
    "cron/tenggat",
    "UnggahBukti",
    "unggah-bukti",
  ];

  it.each(kata)("%s tidak muncul di src/ (komentar pun tidak)", (k) => {
    const kena = sumber.filter((rel) => baca(rel).includes(k));
    expect(kena, k).toEqual([]);
  });

  it("tipe tarif milik rumus lama dan cabang unggah di LangkahBayar sudah dibuang", () => {
    expect(baca("src/lib/tagihan/pengajuan.ts")).not.toMatch(/export type BarisTarif/);
    expect(baca("src/app/passport/bayar/cara-bayar.tsx")).not.toContain("unggahDiSini");
  });

  it("KALIMAT_SEBAB_* tetap ada (dipakai gerbang dan layar)", () => {
    const s = baca("src/lib/tagihan/pengajuan.ts");
    expect(s).toContain("KALIMAT_SEBAB_ADMIN");
    expect(s).toContain("KALIMAT_SEBAB_KLIEN");
  });

  it("labelSisaWaktu dan sisaJam tetap ada", () => {
    const s = baca("src/lib/tagihan/tenggat.ts");
    expect(s).toContain("export function labelSisaWaktu");
    expect(s).toContain("export function sisaJam");
  });
});

describe("dokumentasi tidak menjanjikan rute yang sudah mati", () => {
  it("README tidak memuat /api/cron/tenggat maupun POST /api/bukti", () => {
    const readme = baca("README.md");
    expect(readme).not.toContain("/api/cron/tenggat");
    expect(readme).not.toMatch(/\| `\/api\/bukti` \|/);
    expect(readme).toContain("/api/bukti/[permintaan]");
  });

  it(".env.example tidak menyebut cron tenggat, tetapi CRON_SECRET tetap ada", () => {
    const env = baca(".env.example");
    expect(env).not.toContain("/api/cron/tenggat");
    expect(env).toMatch(/^CRON_SECRET=/m);
  });
});

describe("migrasi pensiun", () => {
  it("berkasnya ada dan hanya menjatuhkan batalkan_lewat_tenggat", () => {
    const rel = "supabase/migrations/20261113140700_pensiun_tenggat.sql";
    expect(ada(rel)).toBe(true);
    expect(baca(rel)).toMatch(/drop function public\.batalkan_lewat_tenggat\(\)/i);
  });

  it("pg_proc tidak memuat batalkan_lewat_tenggat", async () => {
    const baris = await querySql<{ n: string }>(
      "select count(*) as n from pg_proc where proname = 'batalkan_lewat_tenggat'",
    );
    expect(Number(baris[0].n)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Baris warisan: pengajuan TANPA pesanan, angka dari SQL
// ---------------------------------------------------------------------------

const svc = createAdminSupabase();
const KLIEN = "44444444-4444-4444-4444-4444444442b7";
const SVC_B7 = "11111111-1111-1111-1111-1111111112b7";
const VARIAN = "77777777-7777-7777-7777-7777777772b7";
const MITRA = "33333333-3333-3333-3333-3333333332b7";
const HARGA = 300_000;
const HARI_INI = hariIniJakarta();
let sesiAdmin: SupabaseClient;

type Rincian = { layanan: number | null; transport: number | null; jenjang: string | null; sebab: string | null };

async function wajib<T extends { error: unknown }>(p: PromiseLike<T>): Promise<T> {
  const h = await p;
  if (h.error) throw h.error;
  return h;
}

async function bersihkan(): Promise<void> {
  const { data: ps } = await svc.from("orders").select("id").eq("client_id", KLIEN);
  const ids = (ps ?? []).map((p) => p.id as string);
  if (ids.length) {
    await svc.from("jejak_pesanan").delete().in("pesanan_id", ids);
    await svc.from("notifikasi_pesanan").delete().in("pesanan_id", ids);
    await wajib(svc.from("orders").delete().in("id", ids));
  }
  await wajib(svc.from("booking_requests").delete().eq("client_id", KLIEN));
  await svc.from("screenings").delete().eq("client_id", KLIEN);
}

async function hapusFixture(): Promise<void> {
  await bersihkan();
  await svc.from("variant_rates").delete().eq("variant_id", VARIAN);
  await svc.from("service_variants").delete().eq("service_id", SVC_B7);
  await svc.from("services").delete().eq("id", SVC_B7);
  await svc.from("partners").delete().eq("id", MITRA);
  await svc.from("clients").delete().eq("id", KLIEN);
}

beforeAll(async () => {
  sesiAdmin = await signInAs("admin@padma.test");
  ref.sesi = sesiAdmin;
  await hapusFixture();
  await wajib(
    svc.from("clients").insert({
      id: KLIEN,
      padma_id: "PAD-UJI-02B7",
      nama: "Klien Uji Pensiun QRIS",
      email: "uji-pensiun-qris-b7@padma.test",
      phase_id: "prekonsepsi",
    }),
  );
  await wajib(
    svc.from("services").insert({
      id: SVC_B7,
      phase_id: "prekonsepsi",
      nama: "PAD-UJI Layanan Pensiun QRIS",
      deskripsi: "fixture",
      aktif: false,
    }),
  );
  await wajib(
    svc.from("service_variants").insert({ id: VARIAN, service_id: SVC_B7, label: "Uji B7", urutan: 90 }),
  );
  await wajib(
    svc
      .from("variant_rates")
      .insert({ variant_id: VARIAN, harga_klien: HARGA, honor_mitra: 100_000, berlaku_sejak: "2026-01-01" }),
  );
  await wajib(
    svc.from("partners").insert({
      id: MITRA,
      nama: "PAD-UJI Bidan B7",
      no_hp: "0811-9200-0007",
      aktif: true,
      lat: -7.96662,
      lon: 112.632632,
    }),
  );
});

beforeEach(async () => {
  ref.sesi = sesiAdmin;
  await bersihkan();
});

afterAll(hapusFixture);

/** Pengajuan `mitra_siap` lewat transisi sah; kunjungan tiga hari lagi, 7 km. */
async function pengajuanSiap(jam = "09:00"): Promise<string> {
  const skrining = await skriningHijau(svc, KLIEN);
  const { data } = await wajib(
    svc
      .from("booking_requests")
      .insert({
        client_id: KLIEN,
        service_id: SVC_B7,
        variant_id: VARIAN,
        tanggal: geserHari(HARI_INI, 3),
        jam_mulai: jam,
        preferensi_waktu: "pagi",
        alamat: "Jl. Uji Pensiun QRIS No. 7",
        alamat_lat: -7.9666,
        alamat_lon: 112.6966,
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

/** Baris warisan yang sungguh dari era QRIS: menunggu_bayar, tanpa pesanan. */
async function warisanMenungguBayar(): Promise<string> {
  const id = await pengajuanSiap();
  await wajib(
    svc
      .from("booking_requests")
      .update({ status: "menunggu_bayar", tenggat: new Date(Date.now() + 3_600_000).toISOString() })
      .eq("id", id),
  );
  return id;
}

async function rincianSql(id: string): Promise<Rincian> {
  const { data, error } = await sesiAdmin.rpc("rincian_tagihan_permintaan", { p_permintaan_id: id });
  expect(error).toBeNull();
  return (data as Rincian[])[0];
}

describe("daftarTagihanPengajuanAdmin hanya memulangkan baris WARISAN", () => {
  it("angka baris warisan sama dengan rincian_tagihan_permintaan, dan layanannya angka tetap", async () => {
    const id = await warisanMenungguBayar();
    const sql = await rincianSql(id);
    expect(sql.layanan).toBe(HARGA);
    expect(sql.jenjang).toBe("5_10");
    expect(sql.transport).not.toBeNull();

    const daftar = await daftarTagihanPengajuanAdmin();
    const baris = daftar.find((b) => b.permintaanId === id);
    expect(baris, "baris warisan tidak muncul").toBeDefined();
    expect(baris!.hargaLayanan).toBe(formatRupiah(HARGA));
    expect(baris!.hargaTransport).toBe(formatRupiah(sql.transport!));
    expect(baris!.total).toBe(formatRupiah(HARGA + sql.transport!));
    expect(baris!.labelJenjang).toBe(LABEL_JENJANG["5_10"]);
    expect(baris!.sebab).toBeNull();
  });

  it("pengajuan yang PUNYA pesanan tidak dipulangkan, tidak muncul di daftar", async () => {
    const warisan = await warisanMenungguBayar();
    const bertagihan = await pengajuanSiap("10:00");
    const { error } = await sesiAdmin.rpc("terbitkan_tagihan_sesi", { p_permintaan_id: bertagihan });
    expect(error).toBeNull();
    const [pesanan] = await querySql<{ n: string }>(
      "select count(*) as n from public.orders where booking_request_id = $1",
      [bertagihan],
    );
    expect(Number(pesanan.n)).toBe(1);

    const daftar = await daftarTagihanPengajuanAdmin();
    expect(daftar.map((b) => b.permintaanId)).toContain(warisan);
    expect(daftar.map((b) => b.permintaanId)).not.toContain(bertagihan);
  });
});

describe("judul tab menyebut warisan QRIS", () => {
  it("judul bagian pengajuan di page.tsx", () => {
    const s = baca("src/app/admin/bayar/page.tsx");
    expect(s).toMatch(/warisan QRIS/i);
  });
});
