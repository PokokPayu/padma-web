/**
 * PERMUKAAN ADMIN UNTUK MENUKAR HAK SESI (kredit jenjang 2).
 *
 * Yang dijaga di sini bukan tampilan melainkan satu kenyataan yang sempat
 * berlaku: `tukar_hak_sesi()` tidak punya pemanggil di luar uji, dan `hak_sesi`
 * tidak dibaca satu halaman pun. Klien yang membatalkan di jendela 2–24 jam
 * karena itu memegang kredit yang TIDAK ADA TOMBOLNYA — spec menjanjikan C3-a
 * "bisa dipakai sendiri", dan menerbitkan kredit yang tak bisa dibelanjakan
 * bukan menjalankan kebijakan.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { varianBaku } from "./helpers/varian";
import { nominalDalam } from "./helpers/nominal";

const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.sesi!,
}));

const admin = createAdminSupabase();

const KLIEN_UJI = "44444444-4444-4444-4444-4444444444e1";
const PADMA_ID_UJI = "PAD-UJI-HAK-01";
const SESI_ASAL = "66666666-6666-6666-6666-6666666661e1";
const SVC = "11111111-1111-1111-1111-111111111101";
const MITRA = "33333333-3333-3333-3333-333333333301";

// Jauh di masa depan supaya `hariIni` yang dipakai uji tidak pernah
// melewatinya; dan satu yang sudah lewat, supaya saringannya benar-benar diuji.
const BERLAKU = "2029-12-31";
const HANGUS = "2020-01-01";

const { hakBerlakuKlien } = await import("@/lib/admin/hak");

async function bersihkan() {
  await admin.from("hak_sesi").delete().eq("client_id", KLIEN_UJI);
  await admin.from("jejak_jadwal").delete().eq("sesi_id", SESI_ASAL);
  await admin.from("jejak_status_bayar").delete().eq("sesi_id", SESI_ASAL);
  await admin.from("sessions").delete().eq("id", SESI_ASAL);
  await admin.from("clients").delete().eq("id", KLIEN_UJI);
}

beforeAll(async () => {
  await bersihkan();
  ref.sesi = await signInAs("admin@padma.test");

  await admin.from("clients").insert({
    id: KLIEN_UJI,
    padma_id: PADMA_ID_UJI,
    nama: "Uji Hak Sesi",
    email: "uji-hak@padma.test",
    phase_id: "prekonsepsi",
  });

  await admin.from("sessions").insert({
    id: SESI_ASAL,
    client_id: KLIEN_UJI,
    service_id: SVC,
    variant_id: await varianBaku(admin, SVC),
    partner_id: MITRA,
    tanggal: "2027-08-01",
    jam_mulai: "09:00",
    status: "dibatalkan_klien",
    status_bayar: "lunas",
    alamat: "Jl. Uji Hak No. 3, Malang",
  });

  await admin.from("hak_sesi").insert([
    { client_id: KLIEN_UJI, service_id: SVC, kedaluwarsa: BERLAKU, sesi_asal_id: SESI_ASAL },
    { client_id: KLIEN_UJI, service_id: SVC, kedaluwarsa: HANGUS, sesi_asal_id: SESI_ASAL },
  ]);
});

afterAll(bersihkan);

describe("hakBerlakuKlien", () => {
  it("menampilkan hak yang masih berlaku beserta tanggal kedaluwarsanya", async () => {
    const hak = await hakBerlakuKlien(KLIEN_UJI, "2027-01-01");
    expect(hak).toHaveLength(1);
    expect(hak[0].kedaluwarsa).toBe(BERLAKU);
    // Nama layanan sungguhan dari seed, bukan sekadar "tidak kosong": string
    // cadangan ("Layanan") juga lolos length > 0 walau embed-nya gagal total.
    expect(hak[0].namaLayanan).toBe("Sankalpa Fertility Massage");
    expect(hak[0].tanggalAsal, "sesi asal ditarik terpisah — FK-nya sengaja tidak ada").toBe(
      "2027-08-01",
    );
  });

  it("hak yang sudah KEDALUWARSA tidak ditawarkan", async () => {
    const hak = await hakBerlakuKlien(KLIEN_UJI, "2027-01-01");
    expect(hak.some((h) => h.kedaluwarsa === HANGUS)).toBe(false);
  });

  it("ambangnya sama dengan RPC: kedaluwarsa HARI INI masih berlaku", async () => {
    // `tukar_hak_sesi()` menolak dengan `kedaluwarsa < hari ini`. Daftar yang
    // lebih ketat menyembunyikan hak yang masih diterima basis data — hak
    // hangus sehari lebih awal tanpa satu pun galat.
    const hak = await hakBerlakuKlien(KLIEN_UJI, BERLAKU);
    expect(hak).toHaveLength(1);
  });

  it("hak yang SUDAH DITUKAR tidak ditawarkan lagi", async () => {
    await admin
      .from("hak_sesi")
      .update({ dipakai_sesi_id: SESI_ASAL })
      .eq("client_id", KLIEN_UJI)
      .eq("kedaluwarsa", BERLAKU);

    const hak = await hakBerlakuKlien(KLIEN_UJI, "2027-01-01");
    expect(hak).toHaveLength(0);

    await admin
      .from("hak_sesi")
      .update({ dipakai_sesi_id: null })
      .eq("client_id", KLIEN_UJI)
      .eq("kedaluwarsa", BERLAKU);
  });

  it("KLIEN tidak bisa membaca hak klien lain lewat lapisan ini", async () => {
    // Dijalankan dengan sesi klien sungguhan: policy "hak_sesi: klien baca
    // miliknya" yang menyaringnya. Di bawah service role `user_role()`
    // mengembalikan 'klien' dan tidak satu pun pagar ikut diperiksa — uji yang
    // berjalan begitu buta terhadap kebocoran ini.
    const sebelumnya = ref.sesi;
    ref.sesi = await signInAs("ananda@padma.test");
    const hak = await hakBerlakuKlien(KLIEN_UJI, "2027-01-01");
    ref.sesi = sebelumnya;
    expect(hak).toHaveLength(0);
  });
});

describe("pagar lapisan & layar hak", () => {
  it("dibaca lewat sesi pengguna, tanpa service role, tanpa nominal", () => {
    const sumber = baca("src/lib/admin/hak.ts");
    expect(sumber).toContain("createServerSupabase");
    expect(sumber).not.toContain("createAdminSupabase");
    expect(sumber).not.toContain("SERVICE_ROLE");
    expect(nominalDalam(sumber), "nominal bocor").toEqual([]);
    expect(sumber).not.toContain("formatRupiah");
  });

  it("aksinya memanggil RPC, bukan menulis sessions/hak_sesi sendiri", () => {
    // Menulisnya langsung akan melewati SELURUH pagar `tukar_hak_sesi`
    // (kepemilikan, keterpakaian, kedaluwarsa, jam layanan, bentrok bidan,
    // waktu minimal) — dan melahirkan sesi berbayar tanpa satu pun di antaranya.
    const sumber = baca("src/app/admin/klien/[id]/aksi-hak.ts");
    expect(sumber).toContain('rpc("tukar_hak_sesi"');
    expect(sumber).not.toContain('.from("sessions")');
    expect(sumber).not.toContain('.from("hak_sesi")');
    expect(sumber).not.toContain("createAdminSupabase");
    expect(sumber).not.toContain("SERVICE_ROLE");
  });

  it("`data === null` diperlakukan GAGAL, bukan berhasil", () => {
    // `tukar_hak_sesi` memulangkan NULL — bukan galat — ketika haknya sudah
    // ditukar penukaran lain. Aksi yang hanya melihat `error` membuat admin
    // menutup layar yakin sesi penggantinya sudah ada.
    const sumber = baca("src/app/admin/klien/[id]/aksi-hak.ts");
    expect(sumber).toMatch(/if \(data === null\)/);
  });

  it("jam ditawarkan sebagai pilihan dari jam layanan, bukan medan waktu bebas", () => {
    const sumber = baca("src/app/admin/klien/[id]/kartu-hak.tsx");
    expect(sumber).not.toContain('type="time"');
    expect(sumber).toContain("jamPilihan.map");
    expect(sumber).toContain('name="mitra"');
    expect(sumber).toContain('name="hak"');
  });

  it("komponennya tidak mengambil data sendiri", () => {
    // Panel klien yang mengambil data sendiri berhenti bisa diuji sama sekali
    // (suite berjalan tanpa jsdom), dan menyeret klien Supabase ke bundel
    // peramban.
    const sumber = baca("src/app/admin/klien/[id]/kartu-hak.tsx");
    expect(sumber).not.toContain("@/lib/supabase");
  });
});
