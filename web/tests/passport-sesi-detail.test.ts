/**
 * DETAIL SATU SESI DI PASSPORT (`/passport/sesi/[id]`).
 *
 * Sebelum halaman ini ada, catatan bidan hidup di dalam laci yang mengembang
 * pada kartu daftar. Dua akibatnya yang diperbaiki di sini:
 *
 *  1. SELURUH catatan perawatan ikut terkirim ke perangkat bersama halaman
 *     daftar, terbuka atau tidak — dokblok `kartu-sesi.tsx` sendiri mengakuinya
 *     ("teks ini memang sudah ikut terkirim"). Passport sering dibuka di ruang
 *     bersama. Dengan halaman sendiri, catatan sebuah sesi hanya diambil
 *     ketika sesi itu yang dibuka, dan test terakhir berkas ini menjaganya.
 *  2. Tidak ada tautan ke satu sesi. Klien tidak bisa menyimpan, membagikan,
 *     atau kembali ke kunjungan tertentu.
 *
 * Yang paling penting dijaga: `ambilSesiSatu` menerima id dari URL. Tanpa
 * saringan `client_id` yang eksplisit — di samping RLS — halaman ini menjadi
 * cara membaca riwayat perawatan orang lain dengan menebak UUID.
 *
 * Data uji memakai tanggal khusus (2026-12-30) dan dibersihkan di `afterAll`:
 * `passport-beranda.test.ts` meng-assert jumlah stempel Ananda PERSIS.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { varianBaku } from "./helpers/varian";

const admin = createAdminSupabase();

const ANANDA = "44444444-4444-4444-4444-444444444401";
const RINA = "44444444-4444-4444-4444-444444444402";
const SVC = "11111111-1111-1111-1111-111111111101"; // Fertility Massage
const MITRA = "33333333-3333-3333-3333-333333333301"; // Bidan Sri Wahyuni
const TGL = "2026-12-30";
const HANTU = "00000000-0000-0000-0000-000000000000";

const CATATAN = "Otot bahu kanan masih tegang; pijatan diperdalam bertahap.";
const REKOMENDASI = "Kompres hangat 10 menit sebelum tidur, tiga hari ke depan.";

const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: async () => ref.sesi! }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOTFOUND");
  },
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  usePathname: () => "/passport/sesi",
  useRouter: () => ({ push: () => {} }),
}));

const { ambilSesiSatu } = await import("@/lib/passport/data");
const { default: HalamanDetailSesi } = await import("@/app/passport/sesi/[id]/page");
const { default: HalamanSesi } = await import("@/app/passport/sesi/page");

const renderDetail = async (id: string) =>
  renderToStaticMarkup(await HalamanDetailSesi({ params: Promise.resolve({ id }) }));

let sesiAnanda: SupabaseClient;
let idSesiAnanda = "";
let idSesiRina = "";

async function bersihkan() {
  const { data } = await admin.from("sessions").select("id").eq("tanggal", TGL);
  const ids = (data ?? []).map((s) => s.id as string);
  if (ids.length) await admin.from("jejak_status_bayar").delete().in("sesi_id", ids);
  await admin.from("sessions").delete().eq("tanggal", TGL);
}

beforeAll(async () => {
  sesiAnanda = await signInAs("ananda@padma.test");
  ref.sesi = sesiAnanda;
  await bersihkan();

  const varian = await varianBaku(admin, SVC);
  const { data, error } = await admin
    .from("sessions")
    .insert([
      {
        client_id: ANANDA,
        service_id: SVC,
        variant_id: varian,
        partner_id: MITRA,
        tanggal: TGL,
        jam_mulai: "09:00",
        status: "selesai",
        alamat: "Jl. Ijen 5, Malang",
        catatan: CATATAN,
        rekomendasi: REKOMENDASI,
      },
      {
        client_id: RINA,
        service_id: SVC,
        variant_id: varian,
        partner_id: MITRA,
        tanggal: TGL,
        jam_mulai: "13:00",
        status: "selesai",
        alamat: "Jl. Kawi 9, Malang",
        catatan: "Catatan milik Rina yang tidak boleh terbaca Ananda.",
        rekomendasi: "",
      },
    ])
    .select("id, client_id")
    .returns<{ id: string; client_id: string }[]>();
  if (error) throw error;

  idSesiAnanda = data.find((s) => s.client_id === ANANDA)!.id;
  idSesiRina = data.find((s) => s.client_id === RINA)!.id;
});

afterAll(async () => {
  await bersihkan();
});

describe("ambilSesiSatu", () => {
  it("memulangkan catatan dan rekomendasi bidan untuk sesi milik klien", async () => {
    ref.sesi = sesiAnanda;
    const sesi = await ambilSesiSatu(ANANDA, idSesiAnanda);

    expect(sesi?.id).toBe(idSesiAnanda);
    expect(sesi?.catatan).toBe(CATATAN);
    expect(sesi?.rekomendasi).toBe(REKOMENDASI);
    // Nama bidan datang dari `partner_publik`, bukan embed — pola yang sama
    // dengan `ambilSesi`, dan alasannya tertulis di sana.
    expect(sesi?.namaMitra).toBe("Bidan Sri Wahyuni");
    expect(sesi?.alamat).toBe("Jl. Ijen 5, Malang");
  });

  it("memulangkan null untuk sesi milik klien lain", async () => {
    ref.sesi = sesiAnanda;
    expect(await ambilSesiSatu(ANANDA, idSesiRina)).toBeNull();
  });

  it("memulangkan null untuk id karangan, tanpa melempar", async () => {
    ref.sesi = sesiAnanda;
    expect(await ambilSesiSatu(ANANDA, HANTU)).toBeNull();
  });
});

describe("halaman /passport/sesi/[id]", () => {
  it("menampilkan catatan bidan dengan ruang penuh, bukan di dalam laci", async () => {
    ref.sesi = sesiAnanda;
    const m = await renderDetail(idSesiAnanda);

    expect(m).toContain(CATATAN);
    expect(m).toContain(REKOMENDASI);
    expect(m).toContain("Bidan Sri Wahyuni");
    // `hidden` adalah cara laci lama menyembunyikan isinya. Halaman ini tidak
    // menyembunyikan apa pun: kliennya sudah memilih sesi mana yang dibuka.
    expect(m).not.toContain("hidden=");
  });

  it("sesi milik klien lain berakhir notFound, bukan halaman kosong", async () => {
    ref.sesi = sesiAnanda;
    await expect(renderDetail(idSesiRina)).rejects.toThrow("NOTFOUND");
  });

  it("id karangan berakhir notFound", async () => {
    ref.sesi = sesiAnanda;
    await expect(renderDetail(HANTU)).rejects.toThrow("NOTFOUND");
  });

  it("menaut kembali ke riwayat", async () => {
    ref.sesi = sesiAnanda;
    expect(await renderDetail(idSesiAnanda)).toContain('href="/passport/sesi"');
  });
});

describe("daftar /passport/sesi", () => {
  it("setiap kartu menaut ke detail sesinya", async () => {
    ref.sesi = sesiAnanda;
    const m = renderToStaticMarkup(await HalamanSesi());

    expect(m).toContain(`href="/passport/sesi/${idSesiAnanda}"`);
  });

  it("TIDAK lagi mengirimkan catatan perawatan bersama daftar", async () => {
    ref.sesi = sesiAnanda;
    const m = renderToStaticMarkup(await HalamanSesi());

    // Inilah alasan laci itu dipensiunkan: Passport sering dibuka di ruang
    // bersama, dan sebelum ini SELURUH catatan perawatan ikut terkirim ke
    // perangkat bersama halaman daftar — terbuka atau tidak.
    expect(m).not.toContain(CATATAN);
    expect(m).not.toContain(REKOMENDASI);
  });
});
