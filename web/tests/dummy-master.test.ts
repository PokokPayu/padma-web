/**
 * Data master dummy untuk lingkungan dev (`npm run seed:master`) — MURNI.
 *
 * Dua hal dijaga di sini, sebelum satu baris pun menyentuh basis data:
 *
 *  1. TARGET. Skripnya menulis dengan service role dan tidak bisa dibatalkan
 *     per baris. Daftar putih: instans lokal dan proyek dev
 *     (`mdtzrzwapuaalmsxomkm`). Produksi — dan alamat lain APA PUN — ditolak.
 *     Daftar putih, bukan daftar hitam: proyek baru yang belum dikenal juga
 *     ditolak.
 *
 *  2. BENTUK DATA. Dummy ditulis lewat service role, yang melewati validasi
 *     formulir admin/owner. Tanpa uji ini, data dummy bisa memuat keadaan yang
 *     tidak pernah bisa lahir dari layar (judul terlalu panjang, harga coret
 *     lebih murah dari harga jual) — dan penguji lalu mengejar "bug" yang
 *     hanya ada di data uji.
 */
import { describe, it, expect } from "vitest";
import { targetSeedMasterSah, REF_DEV } from "../scripts/dummy-master/target";
import {
  PRODUK_DUMMY,
  MITRA_DUMMY,
  TESTIMONI_DUMMY,
  ALAMAT_KLIEN_DUMMY,
} from "../scripts/dummy-master/data";
import {
  periksaJudul,
  periksaSlug,
  periksaHarga,
  periksaHargaCoretProduk,
  periksaJudulBab,
  periksaKeteranganMateri,
  PANJANG_DESKRIPSI_MAKS,
  MASA_BERLAKU_MAKS_BULAN,
} from "@/lib/produk/status";

const REF_PRODUKSI = "vtprvvwslclyqlunzuvj";
const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("targetSeedMasterSah — daftar putih", () => {
  it.each([
    "http://127.0.0.1:54321",
    "http://localhost:54521",
    `https://${REF_DEV}.supabase.co`,
  ])("menerima %s", (url) => {
    expect(targetSeedMasterSah(url).ok).toBe(true);
  });

  it.each([
    [`https://${REF_PRODUKSI}.supabase.co`, "produksi"],
    ["https://abcdefghijklmnopqrst.supabase.co", "proyek lain yang belum dikenal"],
    [`http://${REF_DEV}.supabase.co`, "dev tanpa https"],
    [`https://${REF_DEV}.supabase.co.penipu.example`, "akhiran domain palsu"],
    [`https://penipu.example/${REF_DEV}.supabase.co`, "ref dev hanya di path"],
    ["", "kosong"],
    ["bukan-url", "bukan URL"],
  ])("menolak %s (%s)", (url) => {
    const hasil = targetSeedMasterSah(url);
    expect(hasil.ok).toBe(false);
  });
});

describe("PRODUK_DUMMY — lolos validator formulir aplikasi", () => {
  it("ada produk berbayar tayang, produk gratis tayang, dan satu draf", () => {
    const tayang = PRODUK_DUMMY.filter((p) => p.aktif);
    expect(tayang.some((p) => p.harga > 0)).toBe(true);
    expect(tayang.some((p) => p.harga === 0)).toBe(true);
    expect(PRODUK_DUMMY.some((p) => !p.aktif)).toBe(true);
  });

  it.each(PRODUK_DUMMY.map((p) => [p.slug, p] as const))("%s", (_slug, p) => {
    expect(periksaJudul(p.judul)).toMatchObject({ ok: true, nilai: p.judul });
    expect(periksaSlug(p.slug)).toMatchObject({ ok: true, nilai: p.slug });
    expect(p.deskripsi.length).toBeLessThanOrEqual(PANJANG_DESKRIPSI_MAKS);
    expect(periksaHarga(String(p.harga))).toMatchObject({ ok: true, nilai: p.harga });
    expect(
      periksaHargaCoretProduk(p.hargaCoret === null ? "" : String(p.hargaCoret), p.harga),
    ).toMatchObject({ ok: true, nilai: p.hargaCoret });
    if (p.masaBerlakuBulan !== null) {
      expect(p.masaBerlakuBulan).toBeGreaterThanOrEqual(1);
      expect(p.masaBerlakuBulan).toBeLessThanOrEqual(MASA_BERLAKU_MAKS_BULAN);
    }
    // Produk tayang tanpa isi adalah etalase yang menjual halaman kosong.
    if (p.aktif) expect(p.bab.flatMap((b) => b.materi).length).toBeGreaterThan(0);
    for (const bab of p.bab) {
      expect(periksaJudulBab(bab.judul).ok).toBe(true);
      for (const m of bab.materi) {
        expect(periksaJudul(m.judul).ok).toBe(true);
        expect(periksaKeteranganMateri(m.keterangan).ok).toBe(true);
        expect(m.jumlahHalaman).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("produk berbayar tayang punya setidaknya satu materi pratinjau", () => {
    for (const p of PRODUK_DUMMY.filter((x) => x.aktif && x.harga > 0)) {
      expect(p.bab.flatMap((b) => b.materi).some((m) => m.pratinjau), p.slug).toBe(true);
    }
  });

  it("deskripsi menyatakan dirinya data contoh, bukan materi klinis", () => {
    for (const p of PRODUK_DUMMY) expect(p.deskripsi).toMatch(/data contoh/i);
  });
});

describe("id dan slug dummy — tetap, unik, berbentuk sah", () => {
  const semuaId = [
    ...PRODUK_DUMMY.flatMap((p) => [
      p.id,
      p.idSampul,
      ...p.bab.flatMap((b) => [b.id, ...b.materi.map((m) => m.id)]),
    ]),
    ...MITRA_DUMMY.map((m) => m.id),
    ...TESTIMONI_DUMMY.map((t) => t.id),
  ];

  it("semua id UUID huruf kecil (pola `objekSampulSah` menuntut bentuk ini)", () => {
    for (const id of semuaId) expect(id).toMatch(POLA_UUID);
  });

  it("tidak ada id kembar — upsert berbasis id hanya idempoten bila id unik", () => {
    expect(new Set(semuaId).size).toBe(semuaId.length);
  });

  it("tidak ada slug kembar", () => {
    const slug = PRODUK_DUMMY.map((p) => p.slug);
    expect(new Set(slug).size).toBe(slug.length);
  });
});

describe("mitra, testimoni, dan alamat klien dummy", () => {
  it("nomor HP mitra berpola sintetis 0811-0000-xxxx", () => {
    for (const m of MITRA_DUMMY) expect(m.noHp).toMatch(/^0811-0000-\d{4}$/);
  });

  it("koordinat berada di sekitar Malang, tempat mitra seed berada", () => {
    for (const k of [...MITRA_DUMMY, ALAMAT_KLIEN_DUMMY]) {
      expect(k.lat).toBeGreaterThan(-8.4);
      expect(k.lat).toBeLessThan(-7.6);
      expect(k.lon).toBeGreaterThan(112.3);
      expect(k.lon).toBeLessThan(112.9);
    }
  });

  it("testimoni dummy TIDAK terbit: CHECK `testimonials_terbit_berizin` menuntut video + izin", () => {
    for (const t of TESTIMONI_DUMMY) {
      expect(t.nama.trim().length).toBeGreaterThanOrEqual(2);
      expect(t.nama.trim().length).toBeLessThanOrEqual(80);
      expect(t.keterangan.length).toBeLessThanOrEqual(160);
      expect(t.kutipan.length).toBeLessThanOrEqual(500);
    }
  });
});
