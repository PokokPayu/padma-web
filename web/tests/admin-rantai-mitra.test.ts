/**
 * RANTAI ADMIN: cari bidan -> tetapkan bidan -> konfirmasi (spec C1 J7).
 *
 * Tiga hal yang diuji di sini, dan ketiganya bisa hilang sendiri-sendiri:
 *   1. perpindahan status yang sah DAN yang tidak — termasuk lompatan yang
 *      ditembak langsung ke basis data, tanpa lewat server action;
 *   2. konfirmasi tetap melahirkan TEPAT SATU sesi saat dua panggilan berjalan
 *      bersamaan — pengerasan lama (migration `sesi_dari_permintaan`) tidak
 *      boleh hilang saat konfirmasi pindah ke dalam fungsi Postgres;
 *   3. pagar DI DALAM `konfirmasi_permintaan()` — ia `security definer`,
 *      sehingga RLS mati dan penjaganya harus hidup di badan fungsi.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { varianBaku } from "./helpers/varian";
import { querySql } from "./helpers/db";

const admin = createAdminSupabase();

const KLIEN = "44444444-4444-4444-4444-444444444401"; // Ananda
const SVC = "11111111-1111-1111-1111-111111111101"; // Fertility Massage
const MITRA = "33333333-3333-3333-3333-333333333301";
const MITRA_NONAKTIF = "33333333-3333-3333-3333-3333333333e1";
const TGL = "2026-12-27"; // tanggal khusus berkas ini, tidak dipakai berkas lain
const JAM = "09:00";

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

const { cariMitra, pilihMitra, konfirmasiPermintaan } = await import("@/app/admin/sesi/aksi");

let VARIAN: string;
let sesiAdmin: SupabaseClient;

async function bersihkan() {
  // Sesi DULU, baru permintaannya: `sessions.booking_request_id` menahan
  // penghapusan permintaan yang sudah menjadi sesi (FK tanpa on delete).
  await admin.from("sessions").delete().eq("tanggal", TGL);
  await admin.from("booking_requests").delete().eq("tanggal", TGL);
}

/** Membuat satu permintaan pada status tertentu, memakai service role. */
async function permintaanPada(status: string, partnerId: string | null = null): Promise<string> {
  const { data, error } = await admin
    .from("booking_requests")
    .insert({
      client_id: KLIEN,
      service_id: SVC,
      variant_id: VARIAN,
      partner_id: partnerId,
      tanggal: TGL,
      jam_mulai: JAM,
      preferensi_waktu: "pagi",
      alamat: "Jl. Uji Rantai No. 7",
      status,
    })
    .select("id")
    .single<{ id: string }>();
  if (error) throw error;
  return data.id;
}

async function statusPermintaan(id: string): Promise<string | null> {
  const { data } = await admin
    .from("booking_requests")
    .select("status")
    .eq("id", id)
    .maybeSingle<{ status: string }>();
  return data?.status ?? null;
}

async function sesiDari(id: string) {
  const { data } = await admin
    .from("sessions")
    .select("id, partner_id, jam_mulai, status, jenjang, jenjang_sumber")
    .eq("booking_request_id", id);
  return data ?? [];
}

beforeAll(async () => {
  sesiAdmin = await signInAs("admin@padma.test");
  ref.sesi = sesiAdmin;
  VARIAN = await varianBaku(admin, SVC);
  await bersihkan();
});

beforeEach(async () => {
  ref.sesi = sesiAdmin;
  await bersihkan();
});

afterAll(bersihkan);

describe("rantai admin: cari bidan", () => {
  it("memindahkan diminta -> mencari_mitra", async () => {
    const id = await permintaanPada("diminta");
    expect(await cariMitra(id)).toEqual({ ok: true });
    expect(await statusPermintaan(id)).toBe("mencari_mitra");
  });

  it("menolak dari keadaan yang bukan diminta, dengan kalimat", async () => {
    const id = await permintaanPada("mitra_siap", MITRA);
    const hasil = await cariMitra(id);
    expect(hasil.ok).toBe(false);
    expect(await statusPermintaan(id)).toBe("mitra_siap");
  });
});

describe("rantai admin: tetapkan bidan", () => {
  it("memindahkan mencari_mitra -> mitra_siap DAN mengisi partner_id", async () => {
    const id = await permintaanPada("mencari_mitra");
    expect(await pilihMitra(id, MITRA)).toEqual({ ok: true });

    const { data } = await admin
      .from("booking_requests")
      .select("status, partner_id")
      .eq("id", id)
      .maybeSingle<{ status: string; partner_id: string | null }>();
    expect(data?.status).toBe("mitra_siap");
    expect(data?.partner_id).toBe(MITRA);
  });

  it("menolak mitra NONAKTIF dengan kalimat, bukan kode Postgres", async () => {
    // FK hanya menolak partner_id yang TIDAK ADA, bukan mitra yang sudah
    // pensiun — dan daftar pilihan di UI menyaring `aktif`, sementara server
    // action tidak pernah melewati UI itu.
    const id = await permintaanPada("mencari_mitra");
    const hasil = await pilihMitra(id, MITRA_NONAKTIF);
    expect(hasil.ok).toBe(false);
    expect(hasil.ok === false && hasil.pesan).toMatch(/mitra/i);
    expect(await statusPermintaan(id)).toBe("mencari_mitra");
  });
});

describe("konfirmasi hanya dari mitra_siap", () => {
  it("MENOLAK permintaan yang masih diminta — lompatan tidak boleh", async () => {
    const id = await permintaanPada("diminta");
    const hasil = await konfirmasiPermintaan(id);
    expect(hasil.ok).toBe(false);
    expect(await sesiDari(id)).toEqual([]);
  });

  it("sesi mewarisi mitra dan JAM dari baris permintaan", async () => {
    const id = await permintaanPada("mitra_siap", MITRA);
    expect(await konfirmasiPermintaan(id)).toEqual({ ok: true });

    const sesi = await sesiDari(id);
    expect(sesi.length).toBe(1);
    expect(sesi[0].partner_id).toBe(MITRA);
    expect(sesi[0].jam_mulai).toBe("09:00:00");
    expect(sesi[0].status).toBe("terjadwal");
  });

  it("DUA konfirmasi bersamaan tetap melahirkan TEPAT SATU sesi", async () => {
    // Pengerasan lama tidak boleh hilang saat rantai diperpanjang MAUPUN saat
    // konfirmasi pindah ke dalam fungsi Postgres. Kegagalannya berbentuk klien
    // kedatangan bidan dua kali, tanpa satu pun error.
    const id = await permintaanPada("mitra_siap", MITRA);
    const hasil = await Promise.all([konfirmasiPermintaan(id), konfirmasiPermintaan(id)]);
    expect(hasil.filter((h) => h.ok).length).toBe(1);
    expect((await sesiDari(id)).length).toBe(1);
  });
});

describe("konfirmasi_permintaan() sebagai RPC — pagar di dalam fungsinya", () => {
  it("KLIEN yang login tidak bisa memanggilnya langsung", async () => {
    // `security definer` mematikan RLS, jadi penjaga perannya harus hidup DI
    // DALAM fungsi. Tanpa itu, klien mana pun bisa mengonfirmasi permintaan
    // jadwalnya sendiri lewat satu panggilan RPC.
    const id = await permintaanPada("mitra_siap", MITRA);
    const sesiKlien = await signInAs("ananda@padma.test");
    const { error } = await sesiKlien.rpc("konfirmasi_permintaan", {
      permintaan_id: id,
      jenjang_saran: null,
    });
    expect(error).not.toBeNull();
    expect(await statusPermintaan(id)).toBe("mitra_siap");
    expect(await sesiDari(id)).toEqual([]);
  });

  it("anon tidak punya hak EXECUTE atasnya", async () => {
    const baris = await querySql<{ ada: boolean }>(
      `select has_function_privilege('anon',
         'public.konfirmasi_permintaan(uuid, jenjang_transport)', 'execute') as ada`,
    );
    expect(baris[0].ada).toBe(false);
  });

  it("TIDAK menerima jenjang_sumber sebagai argumen — ia tidak bisa dipalsukan", async () => {
    // Pagar STRUKTURAL, bukan perilaku: yang dijaga adalah bentuk tanda tangan
    // fungsinya. Begitu `jenjang_sumber` menjadi parameter, admin bisa mencatat
    // jenjang pilihan tangan sebagai hasil hitungan otomatis — dan rekap
    // transport owner membacanya sebagai angka yang tidak pernah diperiksa.
    // `sessions_alasan_penimpaan` tidak menahannya: ia hanya menuntut alasan
    // ketika sumbernya sudah 'admin'.
    const baris = await querySql<{ args: string }>(
      `select pg_get_function_arguments(p.oid) as args
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'konfirmasi_permintaan'`,
    );
    expect(baris.length).toBe(1);
    expect(baris[0].args).not.toContain("jenjang_sumber");
  });

  it("menuliskan jenjang_sumber='otomatis' sendiri ketika ada saran", async () => {
    const id = await permintaanPada("mitra_siap", MITRA);
    await konfirmasiPermintaan(id);
    const sesi = await sesiDari(id);
    // Bila koordinat fixture menghasilkan saran, sumbernya wajib 'otomatis';
    // bila tidak ada saran, keduanya NULL. Yang dilarang adalah kombinasi
    // "ada jenjang tapi sumbernya bukan otomatis" dari jalur ini.
    if (sesi[0].jenjang !== null) expect(sesi[0].jenjang_sumber).toBe("otomatis");
    else expect(sesi[0].jenjang_sumber).toBeNull();
  });

  it("memulangkan NULL — bukan galat — ketika permintaannya sudah tidak mitra_siap", async () => {
    const id = await permintaanPada("diminta");
    const { data, error } = await sesiAdmin.rpc("konfirmasi_permintaan", {
      permintaan_id: id,
      jenjang_saran: null,
    });
    expect(error).toBeNull();
    expect(data).toBeNull();
  });
});

describe("trigger perpindahan menahan tembakan langsung ke DB", () => {
  it("update diminta -> dikonfirmasi ditolak, bahkan tanpa lewat action", async () => {
    // Pola tests/money-firewall-struktural.test.ts: pagar yang hanya diuji
    // lewat action adalah pagar yang belum dibuktikan ada.
    const id = await permintaanPada("diminta");
    await expect(
      querySql("update public.booking_requests set status = 'dikonfirmasi' where id = $1", [id]),
    ).rejects.toThrow(/perpindahan status permintaan tidak sah/);
    expect(await statusPermintaan(id)).toBe("diminta");
  });

  it("mitra_siap tanpa partner_id ditolak CHECK", async () => {
    const id = await permintaanPada("mencari_mitra");
    await expect(
      querySql("update public.booking_requests set status = 'mitra_siap' where id = $1", [id]),
    ).rejects.toThrow(/booking_requests_mitra_siap_bermitra/);
  });
});
