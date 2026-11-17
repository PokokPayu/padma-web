/**
 * HALAMAN BAYAR YANG DIPECAH (`/passport/bayar` + `/passport/bayar/[id]`).
 *
 * Sebelum ini, satu gulungan menampung empat seksi berurutan: tagihan
 * pengajuan yang bertenggat, tagihan sesi, QRIS, lalu tiga langkah pembayaran.
 * Bentuk kegagalannya bukan galat melainkan JARAK: nominal di puncak, QRIS
 * jauh di bawah, dan tombol unggah kembali ke puncak. Satu tagihan kini punya
 * satu layar (sejak P3 dibayar lewat DOKU, tanpa QRIS dan tanpa unggah).
 *
 * Dua hal yang dijaga berkas ini, dan yang kedua yang paling gampang hilang
 * lagi tanpa disadari:
 *
 *  1. KEPEMILIKAN. `/passport/bayar/[id]` menarik satu tagihan menurut id dari
 *     URL. Tanpa saringan `client_id`, id yang ditebak seseorang memulangkan
 *     tagihan — berikut nominal dan jadwal — milik klien lain.
 *
 *  2. JALUR QRIS PENGAJUAN SUDAH PENSIUN (P3/B6, spec §6.8, §7). Fixture di
 *     berkas ini adalah baris WARISAN: `menunggu_bayar` tanpa pesanan. Yang
 *     klien lihat untuknya kalimat §7 — tagihannya dialihkan ke pembayaran
 *     baru — tanpa QRIS, tanpa unggah, dan tanpa tombol Bayar. Tagihan yang
 *     sudah berupa pesanan DOKU diuji di `tests/passport-bayar-sesi.test.ts`.
 *
 * Data uji memakai tanggal khusus (2026-12-31) dan dibersihkan di `afterAll`.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { varianBaku } from "./helpers/varian";
import { skriningHijau } from "./helpers/skrining";

const admin = createAdminSupabase();

const ANANDA = "44444444-4444-4444-4444-444444444401";
const RINA = "44444444-4444-4444-4444-444444444402";
const SVC = "11111111-1111-1111-1111-111111111101"; // Fertility Massage
const MITRA = "33333333-3333-3333-3333-333333333301";
const TGL = "2026-12-31";
const HANTU = "00000000-0000-0000-0000-000000000000";

const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: async () => ref.sesi! }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOTFOUND");
  },
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  usePathname: () => "/passport/bayar",
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

const { ambilTagihanPengajuanSatu, keadaanTagihanKlien } = await import("@/lib/tagihan/baca");
const { default: HalamanBayar } = await import("@/app/passport/bayar/page");
const { default: HalamanBayarSatu } = await import("@/app/passport/bayar/[id]/page");

const renderDetail = async (id: string) =>
  renderToStaticMarkup(await HalamanBayarSatu({ params: Promise.resolve({ id }) }));

let sesiAnanda: SupabaseClient;
let idAnanda = "";
let idRina = "";
const skrining: string[] = [];

async function bersihkan() {
  await admin.from("booking_requests").delete().eq("tanggal", TGL);
  // MENURUT ID, bukan prefiks `UJI-%`: prefiks itu milik bersama 18 berkas uji
  // dan vitest berjalan paralel — menghapus menurut prefiks berarti mencabut
  // skrining yang sedang dipakai berkas lain di pertengahan jalan.
  if (skrining.length) await admin.from("screenings").delete().in("id", skrining);
  skrining.length = 0;
}

beforeAll(async () => {
  sesiAnanda = await signInAs("ananda@padma.test");
  ref.sesi = sesiAnanda;
  await bersihkan();

  const varian = await varianBaku(admin, SVC);
  const sAnanda = await skriningHijau(admin, ANANDA);
  const sRina = await skriningHijau(admin, RINA);
  skrining.push(sAnanda, sRina);

  // Tenggat jauh di depan supaya "sisa waktu" tidak pernah berubah menjadi
  // "lewat" di tengah jalan test.
  const tenggat = new Date(Date.now() + 20 * 3600 * 1000).toISOString();

  const { data, error } = await admin
    .from("booking_requests")
    .insert([
      {
        client_id: ANANDA,
        service_id: SVC,
        variant_id: varian,
        partner_id: MITRA,
        screening_id: sAnanda,
        tanggal: TGL,
        jam_mulai: "09:00",
        preferensi_waktu: "pagi",
        status: "menunggu_bayar",
        status_bayar: "belum",
        tenggat,
      },
      {
        client_id: RINA,
        service_id: SVC,
        variant_id: varian,
        partner_id: MITRA,
        screening_id: sRina,
        tanggal: TGL,
        jam_mulai: "13:00",
        preferensi_waktu: "siang",
        status: "menunggu_bayar",
        status_bayar: "belum",
        tenggat,
      },
    ])
    .select("id, client_id")
    .returns<{ id: string; client_id: string }[]>();
  if (error) throw error;

  idAnanda = data.find((p) => p.client_id === ANANDA)!.id;
  idRina = data.find((p) => p.client_id === RINA)!.id;
});

afterAll(async () => {
  await bersihkan();
});

describe("ambilTagihanPengajuanSatu", () => {
  it("memulangkan baris warisan milik klien: tanpa pesanan, keadaan dialihkan", async () => {
    ref.sesi = sesiAnanda;
    const t = await ambilTagihanPengajuanSatu(idAnanda);

    expect(t?.permintaanId).toBe(idAnanda);
    expect(t?.namaLayanan).toBe("Sankalpa Fertility Massage");
    expect(t?.statusBayar).toBe("belum");
    expect(t?.pesananId).toBeNull();
    expect(t?.items).toEqual([]);
    expect(keadaanTagihanKlien(t!)).toBe("warisan_dialihkan");
  });

  it("memulangkan null untuk tagihan milik klien lain", async () => {
    ref.sesi = sesiAnanda;
    expect(await ambilTagihanPengajuanSatu(idRina)).toBeNull();
  });

  it("memulangkan null untuk id karangan, tanpa melempar", async () => {
    ref.sesi = sesiAnanda;
    expect(await ambilTagihanPengajuanSatu(HANTU)).toBeNull();
  });
});

describe("halaman /passport/bayar/[id]", () => {
  it("baris warisan belum dibayar: kalimat §7, tanpa QRIS, tanpa unggah, tanpa tombol Bayar", async () => {
    ref.sesi = sesiAnanda;
    const m = await renderDetail(idAnanda);

    expect(m).toContain("Sankalpa Fertility Massage");
    expect(m).toContain(
      "Tagihan Anda sedang dialihkan ke pembayaran baru; admin akan mengirimkannya.",
    );
    expect(m).not.toMatch(/qris/i);
    expect(m).not.toMatch(/unggah/i);
    expect(m).not.toContain('type="file"');
    expect(m).not.toContain("data-bayar");
  });

  it("tagihan milik klien lain berakhir notFound", async () => {
    ref.sesi = sesiAnanda;
    await expect(renderDetail(idRina)).rejects.toThrow("NOTFOUND");
  });

  it("id karangan berakhir notFound", async () => {
    ref.sesi = sesiAnanda;
    await expect(renderDetail(HANTU)).rejects.toThrow("NOTFOUND");
  });

  it("menaut kembali ke daftar tagihan", async () => {
    ref.sesi = sesiAnanda;
    expect(await renderDetail(idAnanda)).toContain('href="/passport/bayar"');
  });
});

describe("daftar /passport/bayar", () => {
  it("kartu tagihan yang menunggu pembayaran menaut ke halamannya sendiri", async () => {
    ref.sesi = sesiAnanda;
    const m = renderToStaticMarkup(await HalamanBayar());

    expect(m).toContain(`href="/passport/bayar/${idAnanda}"`);
    // Dan TIDAK menawarkan tagihan klien lain.
    expect(m).not.toContain(idRina);
  });

  it("tidak lagi menumpuk QRIS dan unggahan di gulungan yang sama", async () => {
    ref.sesi = sesiAnanda;
    const m = renderToStaticMarkup(await HalamanBayar());

    // Unggah bukti jalur pengajuan sudah pensiun (§6.8) — di daftar tidak ada
    // satu pun kontrol berkas.
    expect(m).not.toContain('type="file"');
    // QRIS tetap TERSEDIA di sini (tagihan sesi lepas ditagih lewat WhatsApp
    // dan tidak punya halaman sendiri), tetapi TERLIPAT: ia tidak boleh lagi
    // mendorong tagihan bertenggat keluar dari layar pertama.
    expect(m).toContain("qris-padma");
    expect(m).toMatch(/<details/);
  });
});
