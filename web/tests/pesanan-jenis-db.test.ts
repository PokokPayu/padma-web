/**
 * Jenis pesanan (B1, spec §6.6/§6.10): `orders.jenis` + `booking_request_id`,
 * dan dua invarian "satu pesanan terbuka" yang menggantikan satu indeks lama:
 * satu terbuka PRODUK per klien, satu terbuka per PENGAJUAN.
 *
 * Yang dijaga di sini adalah kegagalan sunyi: tagihan sesi yang terbuka tidak
 * boleh tampil sebagai "pesanan terbuka" di keranjang/tombol beli, tidak boleh
 * menghalangi klien membeli produk, dan tidak boleh masuk laporan penjualan
 * produk digital (P4).
 *
 * Supabase lokal dipakai bersama: jalankan berkas ini sendirian.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { querySql } from "./helpers/db";
import { varianBaku } from "./helpers/varian";
import { skriningHijau } from "./helpers/skrining";

const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.sesi!,
}));

const { pesananTerbukaSaya } = await import("@/lib/keranjang/baca");
const { bacaPenjualan } = await import("@/lib/penjualan/baca");
const { nilaiBaris } = await import("@/lib/penjualan/hitung");

const svc = createAdminSupabase();
const AKAR = path.resolve(__dirname, "..");

const KLIEN = "44444444-4444-4444-4444-444444444401"; // Ananda
const KLIEN_EMAIL = "ananda@padma.test";
const SVC = "11111111-1111-1111-1111-111111111101";
const MITRA = "33333333-3333-3333-3333-333333333301";
// Tanggal khusus berkas ini; dua jam berbeda supaya dua pengajuan tidak
// bertabrakan di unique dedup booking_requests.
const TGL = "2026-12-28";

let VARIAN: string;
let produkId = "";

const kode = () => `PSN-261113-${randomUUID().slice(0, 6).toUpperCase()}`;

async function bersihkan(): Promise<void> {
  const { data: ps } = await svc.from("orders").select("id").eq("client_id", KLIEN);
  for (const p of ps ?? []) {
    await svc.from("jejak_pesanan").delete().eq("pesanan_id", p.id);
    await svc.from("notifikasi_pesanan").delete().eq("pesanan_id", p.id);
  }
  await svc.from("orders").delete().eq("client_id", KLIEN);
  await svc.from("cart_items").delete().eq("client_id", KLIEN);
  await svc.from("booking_requests").delete().eq("tanggal", TGL);
  await svc.from("screenings").delete().like("kode", "UJI-%");
  if (produkId) {
    await svc.from("digital_products").delete().eq("id", produkId);
    produkId = "";
  }
}

beforeAll(async () => {
  VARIAN = await varianBaku(svc, SVC);
});
beforeEach(bersihkan);
afterAll(bersihkan);

/** Pengajuan `menunggu_bayar` yang sah (tenggat wajib ada). */
async function pengajuan(jam: string): Promise<string> {
  const skrining = await skriningHijau(svc, KLIEN);
  const { data, error } = await svc
    .from("booking_requests")
    .insert({
      client_id: KLIEN,
      service_id: SVC,
      variant_id: VARIAN,
      partner_id: MITRA,
      tanggal: TGL,
      jam_mulai: jam,
      preferensi_waktu: "pagi",
      status: "menunggu_bayar",
      tenggat: new Date(Date.now() + 24 * 3_600_000).toISOString(),
      screening_id: skrining,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data!.id as string;
}

/** Pesanan sesi lewat service role; kembalikan hasil mentah supaya galat bisa diuji. */
async function pesananSesi(
  bookingId: string | null,
  ubah: Record<string, unknown> = {},
) {
  return svc
    .from("orders")
    .insert({
      kode: kode(),
      client_id: KLIEN,
      jumlah_item: 1,
      jenis: "sesi",
      booking_request_id: bookingId,
      ...ubah,
    })
    .select("id")
    .single();
}

async function semaiProduk(): Promise<string> {
  const slug = `pj-${Date.now()}-${randomUUID().slice(0, 4)}`;
  const { data, error } = await svc
    .from("digital_products")
    .insert({ judul: `Uji ${slug}`, slug, aktif: true })
    .select("id")
    .single();
  if (error) throw error;
  produkId = data!.id as string;
  const { error: eh } = await svc
    .from("digital_product_prices")
    .insert({ product_id: produkId, harga: 100_000, berlaku_sejak: "2026-09-01" });
  if (eh) throw eh;
  return produkId;
}

describe("indeks dan check", () => {
  it("indeks lama tiada; dua indeks baru ada dengan predikat jenis", async () => {
    const baris = await querySql<{ indexname: string; indexdef: string }>(
      `select indexname, indexdef from pg_indexes
        where schemaname = 'public' and tablename = 'orders'`,
    );
    const nama = baris.map((b) => b.indexname);
    expect(nama).not.toContain("pesanan_terbuka_satu_per_klien");
    const produk = baris.find((b) => b.indexname === "pesanan_produk_terbuka_satu_per_klien");
    expect(produk?.indexdef).toMatch(/jenis/);
    expect(baris.map((b) => b.indexname)).toContain("pesanan_sesi_terbuka_satu_per_pengajuan");
  });

  it("jenis 'sesi' tanpa booking_request_id ditolak 23514", async () => {
    const { error } = await pesananSesi(null);
    expect(error?.code).toBe("23514");
  });

  it("jenis 'produk_digital' dengan booking_request_id ditolak 23514", async () => {
    const id = await pengajuan("08:00");
    const { error } = await pesananSesi(id, { jenis: "produk_digital" });
    expect(error?.code).toBe("23514");
  });
});

describe("invarian satu pesanan terbuka", () => {
  it("klien dengan pesanan sesi terbuka tetap bisa membuat pesanan produk", async () => {
    const id = await pengajuan("08:00");
    const { error: e1 } = await pesananSesi(id);
    expect(e1).toBeNull();
    const p = await semaiProduk();
    const klien = await signInAs(KLIEN_EMAIL);
    const { data, error } = await klien.rpc("buat_pesanan_keranjang", { p_product_ids: [p] });
    expect(error).toBeNull();
    expect((data as { pesanan_id: string }[])[0].pesanan_id).toBeTruthy();
  });

  it("klien dengan pesanan produk terbuka tetap bisa punya pesanan sesi terbuka", async () => {
    const p = await semaiProduk();
    const klien = await signInAs(KLIEN_EMAIL);
    const { error: e1 } = await klien.rpc("buat_pesanan_keranjang", { p_product_ids: [p] });
    expect(e1).toBeNull();
    const id = await pengajuan("08:00");
    const { error } = await pesananSesi(id);
    expect(error).toBeNull();
  });

  it("dua pesanan sesi terbuka untuk pengajuan BERBEDA milik klien yang sama sah", async () => {
    const a = await pengajuan("08:00");
    const b = await pengajuan("10:00");
    expect((await pesananSesi(a)).error).toBeNull();
    expect((await pesananSesi(b)).error).toBeNull();
  });

  it("pesanan sesi terbuka kedua untuk pengajuan yang SAMA ditolak 23505", async () => {
    const a = await pengajuan("08:00");
    expect((await pesananSesi(a)).error).toBeNull();
    const { error } = await pesananSesi(a);
    expect(error?.code).toBe("23505");
    expect(error?.message).toContain("pesanan_sesi_terbuka_satu_per_pengajuan");
  });

  it("dua pesanan produk terbuka milik klien yang sama tetap ditolak 23505", async () => {
    const mk = () =>
      svc.from("orders").insert({ kode: kode(), client_id: KLIEN, jumlah_item: 1 });
    expect((await mk()).error).toBeNull();
    const { error } = await mk();
    expect(error?.code).toBe("23505");
    expect(error?.message).toContain("pesanan_produk_terbuka_satu_per_klien");
  });
});

describe("definisi buat_pesanan_keranjang (penjaga deterministik)", () => {
  async function badan(): Promise<string> {
    const r = await querySql<{ d: string }>(
      `select pg_get_functiondef('public.buat_pesanan_keranjang(uuid[], boolean)'::regprocedure) as d`,
    );
    return r[0].d;
  }

  it("handler unique_violation mengenal nama kendala baru, bukan yang lama", async () => {
    // Balapan di bawah hanya bukti perilaku dan tidak selalu menyentuh
    // handler; yang deterministik adalah isi fungsi yang hidup.
    const d = await badan();
    expect(d).toContain("v_kendala = 'pesanan_produk_terbuka_satu_per_klien'");
    expect(d).not.toContain("'pesanan_terbuka_satu_per_klien'");
  });

  it("KEDUA pemilihan pesanan terbuka (awal dan di handler) memikul filter produk", async () => {
    // Dua klausa `from public.orders o where client_id + menunggu_bayar`
    // persis; masing-masing wajib langsung disusul `o.jenis = 'produk_digital'`.
    const d = await badan();
    const semua = d.match(
      /from public\.orders o\s+where o\.client_id = v_client_id and o\.status = 'menunggu_bayar'/g,
    );
    const berfilter = d.match(
      /from public\.orders o\s+where o\.client_id = v_client_id and o\.status = 'menunggu_bayar'\s+and o\.jenis = 'produk_digital'/g,
    );
    expect(semua).toHaveLength(2);
    expect(berfilter).toHaveLength(2);
  });
});

describe("balapan checkout produk", () => {
  it("panggilan paralel yang kalah balapan lewat indeks baru dipulangkan ke pesanan yang menang, tanpa galat", async () => {
    // Pemilihan pesanan terbuka tidak mengunci baris yang belum ada, jadi
    // yang kalah menerima 23505 dari `pesanan_produk_terbuka_satu_per_klien`.
    // Handlernya harus MENGENAL nama kendala baru itu; nama lama membuatnya
    // `raise` dan pembeli melihat galat mentah.
    const p = await semaiProduk();
    const klien = await signInAs(KLIEN_EMAIL);
    const hasil = await Promise.all(
      Array.from({ length: 24 }, () =>
        klien.rpc("buat_pesanan_keranjang", { p_product_ids: [p] }),
      ),
    );
    expect(hasil.map((h) => h.error?.code ?? null)).toEqual(Array(24).fill(null));
    const ids = new Set(hasil.map((h) => (h.data as { pesanan_id: string }[])[0].pesanan_id));
    expect(ids.size).toBe(1);
  });
});

describe("pembaca 'pesanan terbuka' hanya melihat produk", () => {
  it("batalkan_pesanan_saya atas pesanan sesi tidak membatalkan apa pun", async () => {
    const id = await pengajuan("08:00");
    const { data: s } = await pesananSesi(id);
    const klien = await signInAs(KLIEN_EMAIL);
    const { data, error } = await klien.rpc("batalkan_pesanan_saya", { p_pesanan_id: s!.id });
    // Kontrak fungsi: yang tak kena baris mana pun memulangkan false, bukan true.
    expect(data).not.toBe(true);
    const { data: sesudah } = await svc.from("orders").select("status").eq("id", s!.id).single();
    expect(sesudah!.status).toBe("menunggu_bayar");
  });

  it("pesananTerbukaSaya tidak memulangkan pesanan sesi, tetap memulangkan pesanan produk", async () => {
    const id = await pengajuan("08:00");
    await pesananSesi(id);
    ref.sesi = await signInAs(KLIEN_EMAIL);
    expect(await pesananTerbukaSaya(KLIEN)).toBeNull();

    const p = await semaiProduk();
    const { error } = await ref.sesi.rpc("buat_pesanan_keranjang", { p_product_ids: [p] });
    expect(error).toBeNull();
    expect(await pesananTerbukaSaya(KLIEN)).not.toBeNull();
  });

  it("bacaan orders di tombol-beli disaring ke jenis produk_digital", () => {
    const sumber = readFileSync(path.join(AKAR, "src/app/produk/[slug]/tombol-beli.tsx"), "utf8");
    const mulai = sumber.indexOf('.from("orders")');
    expect(mulai).toBeGreaterThan(0);
    expect(sumber.slice(mulai, mulai + 300)).toContain('.eq("jenis", "produk_digital")');
  });
});

describe("P4: laporan penjualan hanya produk digital", () => {
  it("pesanan sesi lunas tidak masuk bacaPenjualan dan total tidak bergeser", async () => {
    const id = await pengajuan("08:00");
    const sb = await signInAs("admin@padma.test");
    const opsi = {
      mulai: "2026-12-01T00:00:00+07:00",
      sampai: "2027-01-01T00:00:00+07:00",
      clientId: KLIEN,
      klien: sb,
    };
    const hitung = (b: Awaited<ReturnType<typeof bacaPenjualan>>["baris"]) =>
      b.reduce((t, x) => t + (nilaiBaris(x) ?? 0), 0);

    const sebelum = await bacaPenjualan(opsi);

    const { data: s, error } = await pesananSesi(id, {
      status: "lunas",
      ditutup_pada: "2026-12-10T05:00:00Z",
      lunas_pada: "2026-12-10T05:00:00Z",
    });
    expect(error).toBeNull();
    const { error: ei } = await svc.from("order_items").insert({
      pesanan_id: s!.id,
      jenis: "sesi",
      booking_request_id: id,
      judul_beku: "Sesi kunjungan PADMA",
      harga_beku: 500_000,
      urutan: 1,
    });
    expect(ei).toBeNull();

    const sesudah = await bacaPenjualan(opsi);
    expect(sesudah.baris.map((b) => b.pesananId)).not.toContain(s!.id);
    expect(sesudah.baris.length).toBe(sebelum.baris.length);
    expect(hitung(sesudah.baris)).toBe(hitung(sebelum.baris));
  });

  it("pesanan sesi bayar-lewat-tenggat yang hanya terjangkau lewat notifikasi rentang (putaran 1b) juga tidak masuk", async () => {
    const id = await pengajuan("08:00");
    const sb = await signInAs("admin@padma.test");
    // Kedaluwarsa di NOVEMBER, dibayar lewat tenggat (di luar rentang), tetapi notifikasinya
    // jatuh di DESEMBER: hanya putaran 1(b) + `susulan` yang bisa memungutnya.
    const { data: s, error } = await pesananSesi(id, {
      status: "kedaluwarsa",
      ditutup_pada: "2026-11-10T05:00:00Z",
    });
    expect(error).toBeNull();
    await svc.from("order_items").insert({
      pesanan_id: s!.id,
      jenis: "sesi",
      booking_request_id: id,
      judul_beku: "Sesi kunjungan PADMA",
      harga_beku: 500_000,
      urutan: 1,
    });
    const { error: en } = await svc.from("notifikasi_pesanan").insert({
      pesanan_id: s!.id,
      sidik: randomUUID(),
      status_gateway: "SUCCESS",
      nominal_diterima: 500_000,
      diterima_pada: "2026-12-10T05:00:00Z",
    });
    expect(en).toBeNull();

    const { baris } = await bacaPenjualan({
      mulai: "2026-12-01T00:00:00+07:00",
      sampai: "2027-01-01T00:00:00+07:00",
      clientId: KLIEN,
      klien: sb,
    });
    expect(baris.map((b) => b.pesananId)).not.toContain(s!.id);

    // KONTROL: pesanan PRODUK dengan keadaan identik memang terjangkau lewat
    // jalur ini. Tanpanya, "tidak muncul" bisa berarti jalurnya mati.
    const pid = await semaiProduk();
    const { data: k, error: ek } = await svc
      .from("orders")
      .insert({
        kode: kode(),
        client_id: KLIEN,
        jumlah_item: 1,
        status: "kedaluwarsa",
        ditutup_pada: "2026-11-10T05:00:00Z",
      })
      .select("id")
      .single();
    expect(ek).toBeNull();
    await svc.from("order_items").insert({
      pesanan_id: k!.id,
      jenis: "produk_digital",
      product_id: pid,
      judul_beku: "Produk kontrol",
      harga_beku: 100_000,
      urutan: 1,
    });
    await svc.from("notifikasi_pesanan").insert({
      pesanan_id: k!.id,
      sidik: randomUUID(),
      status_gateway: "SUCCESS",
      nominal_diterima: 100_000,
      diterima_pada: "2026-12-10T05:00:00Z",
    });
    const { baris: lagi } = await bacaPenjualan({
      mulai: "2026-12-01T00:00:00+07:00",
      sampai: "2027-01-01T00:00:00+07:00",
      clientId: KLIEN,
      klien: sb,
    });
    expect(lagi.map((b) => b.pesananId)).toContain(k!.id);
    expect(lagi.map((b) => b.pesananId)).not.toContain(s!.id);
  });
});
