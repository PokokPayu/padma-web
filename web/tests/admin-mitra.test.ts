/**
 * Modul Mitra panel admin — daftar, tambah, ubah, aktif/nonaktif.
 *
 * Mitra adalah DATA, bukan pengguna aplikasi: bidan melapor lewat WhatsApp dan
 * admin yang mencatat. Karena itu modul ini kecil — dan justru karena kecil, ia
 * mudah dibangun dengan empat cacat senyap yang dijaga berkas ini:
 *
 *  1. Penjaga peran hilang dari dalam server action. Server action adalah
 *     ENDPOINT POST TERSENDIRI; penjaga di `src/app/admin/layout.tsx` tidak
 *     pernah dilewati saat action dipanggil langsung. Tanpa
 *     `requireRole(["admin","owner"])` di dalam SETIAP action, seorang klien
 *     yang login bisa menonaktifkan seluruh bidan klinik.
 *
 *  2. Nilai status datang dari luar. Celah "klien menyetujui permintaan
 *     jadwalnya sendiri" tembus persis karena status tujuan menjadi parameter.
 *     Di sini `aktif` ditulis HARDCODED di dalam dua action terpisah; tidak ada
 *     satu pun action yang menerima keadaan tujuan dari pemanggilnya.
 *
 *  3. Menonaktifkan mitra MENGHAPUS namanya dari riwayat sesi seluruh klien.
 *     Ini pernah nyata: `partner_publik` menyaring `aktif = true`, sehingga
 *     satu klik "nonaktifkan" mengubah nama bidan di riwayat lama menjadi
 *     "Tim PADMA" — tanpa error apa pun. Pagar Task 1 memperbaikinya; di sini
 *     dibuktikan lewat jalur yang benar-benar dipakai klien (`ambilSesi`).
 *
 *  4. Mitra nonaktif tetap ditawarkan saat menjadwalkan sesi baru. Kebalikan
 *     dari (3): daftar PILIHAN memang harus menyaring `aktif`, sementara daftar
 *     NAMA tidak boleh. Dua kebutuhan berbeda dari satu tabel yang sama.
 *
 * Catatan data uji: baris fixture memakai prefix `PAD-UJI` pada nama mitra dan
 * dibersihkan di `afterAll`. Mitra seed (Bidan Sri Wahyuni) dipinjam sebentar
 * untuk uji riwayat lalu DIKEMBALIKAN aktif — `passport-beranda.test.ts` dan
 * `passport-sesi.test.ts` meng-assert nama bidan di riwayat Ananda.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";

const admin = createAdminSupabase();
const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

const ANANDA = "44444444-4444-4444-4444-444444444401";
const SRI = "33333333-3333-3333-3333-333333333301";
const NAMA_SRI = "Bidan Sri Wahyuni";
const DEWI = "33333333-3333-3333-3333-333333333302";
const MITRA_EDIT = "33333333-3333-3333-3333-3333333333f1";
const MITRA_STATUS = "33333333-3333-3333-3333-3333333333f2";

// Lapisan data & action memakai sesi pengguna (`createServerSupabase`). Di
// vitest tidak ada cookie, jadi klien ber-SESI SUNGGUHAN disuntikkan: RLS dan
// requireRole tetap berjalan apa adanya, persis seperti di server.
const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.sesi!,
}));

const jejak = vi.hoisted(() => ({ revalidate: [] as string[] }));
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => {
    jejak.revalidate.push(p);
  },
}));

// `redirect()` melempar di dalam request Next. Di test ia dijadikan error yang
// bisa dibaca supaya "penjaga peran hilang" menjadi MERAH, bukan senyap.
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NOTFOUND");
  },
  usePathname: () => "/admin/mitra",
}));

const { simpanMitra, perbaruiMitra, aktifkanMitra, nonaktifkanMitra } =
  await import("@/app/admin/mitra/aksi");
const { ambilDaftarMitra, pilihanMitra } = await import("@/lib/admin/mitra");
const { ambilSesi } = await import("@/lib/passport/data");
const { default: MitraPage } = await import("@/app/admin/mitra/page");

const sumberAksi = baca("src/app/admin/mitra/aksi.ts");
const sumberHalaman = baca("src/app/admin/mitra/page.tsx");
const sumberForm = baca("src/app/admin/mitra/form-mitra.tsx");
const sumberLib = baca("src/lib/admin/mitra.ts");

let sesiAdmin: SupabaseClient;
let sesiKlien: SupabaseClient;

function formulir(isi: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(isi)) fd.set(k, v);
  return fd;
}

async function barisMitra(id: string) {
  const { data } = await admin
    .from("partners")
    .select("id, nama, no_hp, alamat, lat, lon, aktif")
    .eq("id", id)
    .maybeSingle<{
      id: string;
      nama: string;
      no_hp: string;
      alamat: string;
      lat: number | null;
      lon: number | null;
      aktif: boolean;
    }>();
  return data;
}

// `vi.stubGlobal` MENIMPA `globalThis.fetch` sepenuhnya — men-stub PENUH akan
// ikut menjatuhkan panggilan Supabase lokal yang dipakai `simpanMitra`/
// `perbaruiMitra` sendiri, bukan cuma Nominatim. Pola sama dengan
// `tests/transport-geocode.test.ts`: hanya URL yang menyentuh Nominatim yang
// dijawab `palsu`; sisanya diteruskan ke `fetch` asli (pagar
// `tests/setup-fetch-guard.ts`, meloloskan 127.0.0.1 tempat Supabase lokal).
function stubNominatim(jawab: () => Promise<Response> | Response) {
  const asli = globalThis.fetch;
  const palsu = vi.fn(() => jawab());
  vi.stubGlobal("fetch", (...args: Parameters<typeof fetch>) => {
    const url = args[0] instanceof Request ? args[0].url : String(args[0]);
    return url.includes("nominatim") ? palsu() : asli(...args);
  });
  return palsu;
}

async function bersihkan() {
  await admin.from("partners").delete().like("nama", "PAD-UJI%");
  // Mitra seed selalu dikembalikan aktif: riwayat Ananda diuji berkas lain.
  await admin.from("partners").update({ aktif: true }).eq("id", SRI);
}

beforeAll(async () => {
  await bersihkan();
  sesiAdmin = await signInAs("admin@padma.test");
  sesiKlien = await signInAs("ananda@padma.test");
  ref.sesi = sesiAdmin;

  await admin.from("partners").insert([
    { id: MITRA_EDIT, nama: "PAD-UJI Bidan Edit", no_hp: "0811-9000-0001" },
    { id: MITRA_STATUS, nama: "PAD-UJI Bidan Status", no_hp: "0811-9000-0002" },
  ]);
});

afterAll(bersihkan);

beforeEach(() => {
  ref.sesi = sesiAdmin;
  jejak.revalidate.length = 0;
});

afterEach(() => {
  // Bukan di akhir badan tiap `it`: bila sebuah asersi gagal, baris unstub di
  // bawahnya tidak pernah jalan — stub lantas bocor ke test berikutnya.
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Server action: simpanMitra
// ---------------------------------------------------------------------------

describe("simpanMitra — mendaftarkan mitra baru", () => {
  it("membuat baris partners baru yang langsung aktif", async () => {
    const hasil = await simpanMitra(
      formulir({ nama: "PAD-UJI Bidan Baru", no_hp: "0811-9000-0003" }),
    );

    expect(hasil.ok).toBe(true);
    if (!hasil.ok) return; // penyempit tipe; assertion di atas yang menjaga

    const baris = await barisMitra(hasil.id);
    expect(baris).toMatchObject({
      nama: "PAD-UJI Bidan Baru",
      no_hp: "0811-9000-0003",
      aktif: true,
    });
  });

  it("nama dan kontak dirapikan dari spasi berlebih", async () => {
    const hasil = await simpanMitra(
      formulir({ nama: "  PAD-UJI Bidan Spasi  ", no_hp: "  0811-9000-0004 " }),
    );
    expect(hasil.ok).toBe(true);
    if (!hasil.ok) return;
    const baris = await barisMitra(hasil.id);
    expect(baris!.nama).toBe("PAD-UJI Bidan Spasi");
    expect(baris!.no_hp).toBe("0811-9000-0004");
  });

  it("kontak boleh kosong (no_hp not null default '')", async () => {
    const hasil = await simpanMitra(formulir({ nama: "PAD-UJI Bidan Tanpa Kontak" }));
    expect(hasil.ok).toBe(true);
    if (!hasil.ok) return;
    expect((await barisMitra(hasil.id))!.no_hp).toBe("");
  });

  it("menolak nama terlalu pendek tanpa menyentuh basis data", async () => {
    const { count: sebelum } = await admin
      .from("partners")
      .select("*", { count: "exact", head: true });

    const hasil = await simpanMitra(formulir({ nama: "A", no_hp: "0811" }));
    expect(hasil.ok).toBe(false);
    if (hasil.ok) return;
    expect(hasil.pesan).toMatch(/nama/i);

    const { count: sesudah } = await admin
      .from("partners")
      .select("*", { count: "exact", head: true });
    expect(sesudah).toBe(sebelum);
  });

  it("menyegarkan cache daftar mitra setelah berhasil", async () => {
    await simpanMitra(formulir({ nama: "PAD-UJI Bidan Revalidate" }));
    expect(jejak.revalidate).toContain("/admin/mitra");
  });

  it("PENJAGA PERAN: klien yang login tidak bisa memanggil action ini", async () => {
    ref.sesi = sesiKlien;
    await expect(
      simpanMitra(formulir({ nama: "PAD-UJI Bidan Dari Klien" })),
    ).rejects.toThrow(/REDIRECT/);

    const { data } = await admin
      .from("partners")
      .select("id")
      .eq("nama", "PAD-UJI Bidan Dari Klien");
    expect(data ?? []).toHaveLength(0);
  });

  it("domisili BOLEH kosong — mitra tetap lahir tanpa alamat", async () => {
    const hasil = await simpanMitra(formulir({ nama: "PAD-UJI Bidan Tanpa Domisili" }));
    expect(hasil.ok).toBe(true);
    if (!hasil.ok) return;
    const baris = await barisMitra(hasil.id);
    expect(baris!.alamat).toBe("");
    expect(baris!.lat).toBeNull();
    expect(baris!.lon).toBeNull();
  });

  it("menyimpan domisili beserta koordinatnya (spec T6)", async () => {
    await admin
      .from("geocode_cache")
      .delete()
      .eq("alamat_normal", "jl. uji bidan geocode no. 1");
    const palsu = stubNominatim(() =>
      new Response(JSON.stringify([{ lat: "-7.0", lon: "107.7" }]), { status: 200 }),
    );

    const hasil = await simpanMitra(
      formulir({ nama: "PAD-UJI Bidan Geocode", alamat: "Jl. Uji Bidan Geocode No. 1" }),
    );
    expect(hasil.ok).toBe(true);
    if (!hasil.ok) return;
    expect(palsu).toHaveBeenCalled();

    const baris = await barisMitra(hasil.id);
    expect(baris!.alamat).toBe("Jl. Uji Bidan Geocode No. 1");
    expect(baris!.lat).toBe(-7.0);
    expect(baris!.lon).toBe(107.7);
  });

  it("domisili TETAP tersimpan meski geocoding gagal (katup pengaman T6)", async () => {
    // `stubNominatim`, bukan `vi.stubGlobal("fetch", ...)` penuh — lihat
    // komentar di sekitar deklarasinya. Stub penuh akan ikut menjatuhkan
    // panggilan Supabase lokal `simpanMitra` sendiri (insert `partners`).
    stubNominatim(async () => {
      throw new Error("jaringan mati");
    });

    const hasil = await simpanMitra(
      formulir({ nama: "PAD-UJI Bidan Geocode Gagal", alamat: "Jl. Gang Sempit Tanpa Nama Bidan" }),
    );
    expect(hasil.ok).toBe(true);
    if (!hasil.ok) return;

    const baris = await barisMitra(hasil.id);
    expect(baris!.alamat).toBe("Jl. Gang Sempit Tanpa Nama Bidan");
    expect(baris!.lat).toBeNull();
    expect(baris!.lon).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Server action: perbaruiMitra
// ---------------------------------------------------------------------------

describe("perbaruiMitra — mengubah nama & kontak", () => {
  it("mengubah nama dan kontak mitra yang ada", async () => {
    const hasil = await perbaruiMitra(
      MITRA_EDIT,
      formulir({ nama: "PAD-UJI Bidan Edit Baru", no_hp: "0899-9000-0001" }),
    );
    expect(hasil.ok).toBe(true);

    expect(await barisMitra(MITRA_EDIT)).toMatchObject({
      nama: "PAD-UJI Bidan Edit Baru",
      no_hp: "0899-9000-0001",
    });
  });

  it("status aktif TIDAK ikut berubah walau diselundupkan di FormData", async () => {
    // Keadaan aktif punya action tersendiri; ia tidak pernah menumpang formulir
    // data — kalau ikut, satu form yang dipalsukan bisa mematikan mitra diam-diam.
    await perbaruiMitra(
      MITRA_EDIT,
      formulir({
        nama: "PAD-UJI Bidan Edit Baru",
        no_hp: "0899-9000-0001",
        aktif: "false",
      }),
    );
    expect((await barisMitra(MITRA_EDIT))!.aktif).toBe(true);
  });

  it("menolak nama terlalu pendek dan tidak menimpa nama lama", async () => {
    const hasil = await perbaruiMitra(MITRA_EDIT, formulir({ nama: "X" }));
    expect(hasil.ok).toBe(false);
    expect((await barisMitra(MITRA_EDIT))!.nama).toBe("PAD-UJI Bidan Edit Baru");
  });

  it("id yang tidak ada menghasilkan penolakan, bukan 'ok' palsu", async () => {
    // UPDATE yang tidak mengenai baris mana pun dijawab PostgREST dengan
    // 200 + [] — melaporkan "berhasil" di sini adalah kebohongan senyap.
    const hasil = await perbaruiMitra(
      "33333333-3333-3333-3333-3333333333ff",
      formulir({ nama: "PAD-UJI Bidan Hantu" }),
    );
    expect(hasil.ok).toBe(false);
  });

  it("PENJAGA PERAN: klien yang login tidak bisa memanggil action ini", async () => {
    ref.sesi = sesiKlien;
    await expect(
      perbaruiMitra(MITRA_EDIT, formulir({ nama: "PAD-UJI Direbut Klien" })),
    ).rejects.toThrow(/REDIRECT/);
    expect((await barisMitra(MITRA_EDIT))!.nama).toBe("PAD-UJI Bidan Edit Baru");
  });

  it("menyimpan domisili beserta koordinatnya (spec T6)", async () => {
    await admin
      .from("geocode_cache")
      .delete()
      .eq("alamat_normal", "jl. uji bidan edit geocode no. 2");
    const palsu = stubNominatim(() =>
      new Response(JSON.stringify([{ lat: "-6.7", lon: "107.4" }]), { status: 200 }),
    );

    const hasil = await perbaruiMitra(
      MITRA_EDIT,
      formulir({
        nama: "PAD-UJI Bidan Edit Baru",
        no_hp: "0899-9000-0001",
        alamat: "Jl. Uji Bidan Edit Geocode No. 2",
      }),
    );
    expect(hasil.ok).toBe(true);
    expect(palsu).toHaveBeenCalled();

    const baris = await barisMitra(MITRA_EDIT);
    expect(baris!.alamat).toBe("Jl. Uji Bidan Edit Geocode No. 2");
    expect(baris!.lat).toBe(-6.7);
    expect(baris!.lon).toBe(107.4);
  });

  it("domisili TETAP tersimpan meski geocoding gagal (katup pengaman T6)", async () => {
    // `stubNominatim`, bukan `vi.stubGlobal("fetch", ...)` penuh — lihat
    // komentar di sekitar deklarasinya. Stub penuh akan ikut menjatuhkan
    // panggilan Supabase lokal `perbaruiMitra` sendiri (UPDATE `partners`).
    stubNominatim(async () => {
      throw new Error("jaringan mati");
    });

    const hasil = await perbaruiMitra(
      MITRA_EDIT,
      formulir({
        nama: "PAD-UJI Bidan Edit Baru",
        no_hp: "0899-9000-0001",
        alamat: "Jl. Gang Sempit Edit Tanpa Nama Bidan",
      }),
    );
    expect(hasil.ok).toBe(true);

    const baris = await barisMitra(MITRA_EDIT);
    expect(baris!.alamat).toBe("Jl. Gang Sempit Edit Tanpa Nama Bidan");
    expect(baris!.lat).toBeNull();
    expect(baris!.lon).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Server action: aktifkanMitra / nonaktifkanMitra
// ---------------------------------------------------------------------------

describe("aktifkanMitra & nonaktifkanMitra — keadaan tidak pernah datang dari luar", () => {
  it("nonaktifkanMitra menyetel aktif = false", async () => {
    const hasil = await nonaktifkanMitra(MITRA_STATUS);
    expect(hasil.ok).toBe(true);
    expect((await barisMitra(MITRA_STATUS))!.aktif).toBe(false);
    expect(jejak.revalidate).toContain("/admin/mitra");
  });

  it("aktifkanMitra menyetel aktif = true kembali", async () => {
    const hasil = await aktifkanMitra(MITRA_STATUS);
    expect(hasil.ok).toBe(true);
    expect((await barisMitra(MITRA_STATUS))!.aktif).toBe(true);
  });

  it("id yang tidak ada ditolak, bukan 'ok' palsu", async () => {
    const hasil = await nonaktifkanMitra("33333333-3333-3333-3333-3333333333ff");
    expect(hasil.ok).toBe(false);
  });

  it("PENJAGA PERAN: klien yang login tidak bisa menonaktifkan mitra", async () => {
    ref.sesi = sesiKlien;
    await expect(nonaktifkanMitra(MITRA_STATUS)).rejects.toThrow(/REDIRECT/);
    expect((await barisMitra(MITRA_STATUS))!.aktif).toBe(true);
  });

  it("keadaan tujuan HARDCODED di dalam action, tidak pernah jadi parameter", () => {
    // Dua literal berbeda di dua action berbeda. Bila keduanya menyatu menjadi
    // satu action ber-parameter `aktif`, nilai status kembali datang dari luar
    // — cacat yang persis meloloskan "klien menyetujui jadwalnya sendiri".
    expect(sumberAksi).toMatch(/aktif:\s*true/);
    expect(sumberAksi).toMatch(/aktif:\s*false/);
    for (const pola of [
      /function\s+\w+\([^)]*aktif\s*:/, // aktif sebagai parameter action
      /function\s+\w+\([^)]*status\s*:/,
    ]) {
      expect(sumberAksi).not.toMatch(pola);
    }
  });
});

// ---------------------------------------------------------------------------
// PAGAR UTAMA: nonaktif ≠ hilang dari riwayat
// ---------------------------------------------------------------------------

describe("menonaktifkan mitra TIDAK menghapus namanya dari riwayat klien", () => {
  afterAll(async () => {
    await admin.from("partners").update({ aktif: true }).eq("id", SRI);
  });

  it("riwayat sesi klien tetap menyebut nama bidan setelah mitranya dinonaktifkan", async () => {
    ref.sesi = sesiAdmin;
    expect((await nonaktifkanMitra(SRI)).ok).toBe(true);
    expect((await barisMitra(SRI))!.aktif).toBe(false);

    // Jalur yang benar-benar dipakai halaman passport klien.
    ref.sesi = sesiKlien;
    const sesi = await ambilSesi(ANANDA);
    const milikSri = sesi.filter((s) => s.namaMitra === NAMA_SRI);
    expect(milikSri.length).toBeGreaterThan(0);
    // "Tim PADMA" adalah fallback saat nama mitra gagal terbaca — ia tidak
    // boleh muncul hanya karena mitranya sedang cuti.
    expect(sesi.map((s) => s.namaMitra)).not.toContain("Tim PADMA");
  });

  it("klien tetap bisa membaca nama mitra nonaktif lewat partner_publik", async () => {
    const { data } = await sesiKlien
      .from("partner_publik")
      .select("id, nama")
      .eq("id", SRI);
    expect(data).toHaveLength(1);
    expect(data![0].nama).toBe(NAMA_SRI);
  });

  it("mitra nonaktif TIDAK ditawarkan saat menjadwalkan sesi baru", async () => {
    ref.sesi = sesiAdmin;
    const pilihan = await pilihanMitra();
    expect(pilihan.map((m) => m.id)).not.toContain(SRI);
    // Dan mitra yang aktif tetap ada — bukan daftar yang kebetulan kosong.
    expect(pilihan.map((m) => m.id)).toContain(MITRA_EDIT);
  });

  it("setelah diaktifkan lagi, mitra kembali muncul di pilihan", async () => {
    ref.sesi = sesiAdmin;
    expect((await aktifkanMitra(SRI)).ok).toBe(true);
    const pilihan = await pilihanMitra();
    expect(pilihan.map((m) => m.id)).toContain(SRI);
  });
});

// ---------------------------------------------------------------------------
// Sumber data tabel
// ---------------------------------------------------------------------------

describe("ambilDaftarMitra — sumber baris tabel kelola", () => {
  it("memuat mitra nonaktif juga (kelola ≠ pilih)", async () => {
    ref.sesi = sesiAdmin;
    await admin.from("partners").update({ aktif: false }).eq("id", MITRA_STATUS);

    const daftar = await ambilDaftarMitra();
    const nonaktif = daftar.find((m) => m.id === MITRA_STATUS);
    expect(nonaktif, "mitra nonaktif hilang dari halaman kelola").toBeDefined();
    expect(nonaktif!.aktif).toBe(false);

    await admin.from("partners").update({ aktif: true }).eq("id", MITRA_STATUS);
  });

  it("menghitung sesi SELESAI per mitra, bukan seluruh sesi", async () => {
    ref.sesi = sesiAdmin;
    // Bidan Dewi memegang sesi `selesai` MAUPUN `terjadwal` di seed — kolom
    // "kinerja" yang lupa menyaring status akan terlihat lebih besar dari
    // kenyataan, dan tidak ada yang menyadarinya.
    const [{ count: selesai }, { count: semua }] = await Promise.all([
      admin
        .from("sessions")
        .select("id", { count: "exact", head: true })
        .eq("partner_id", DEWI)
        .eq("status", "selesai"),
      admin
        .from("sessions")
        .select("id", { count: "exact", head: true })
        .eq("partner_id", DEWI),
    ]);
    expect(semua).toBeGreaterThan(selesai ?? 0);

    const daftar = await ambilDaftarMitra();
    expect(daftar.find((m) => m.id === DEWI)!.sesiSelesai).toBe(selesai);
  });

  it("mitra tanpa sesi apa pun tercatat nol, bukan hilang dari daftar", async () => {
    ref.sesi = sesiAdmin;
    const daftar = await ambilDaftarMitra();
    expect(daftar.find((m) => m.id === MITRA_EDIT)!.sesiSelesai).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Pagar RLS
// ---------------------------------------------------------------------------

describe("pagar basis data yang menopang modul ini", () => {
  it("klien TIDAK bisa membaca tabel partners sama sekali", async () => {
    const { data } = await sesiKlien.from("partners").select("id, nama, no_hp");
    expect(data ?? []).toHaveLength(0);
  });

  it("klien TIDAK bisa menambah atau mengubah mitra lewat REST", async () => {
    const { error: eTambah } = await sesiKlien
      .from("partners")
      .insert({ nama: "PAD-UJI Dari REST", no_hp: "0" });
    expect(eTambah).not.toBeNull();

    const { data: ubah } = await sesiKlien
      .from("partners")
      .update({ aktif: false })
      .eq("id", MITRA_EDIT)
      .select("id");
    expect(ubah ?? []).toHaveLength(0);
    expect((await barisMitra(MITRA_EDIT))!.aktif).toBe(true);
  });

  it("partner_publik tidak pernah membocorkan nomor kontak mitra", async () => {
    const { data } = await sesiKlien.from("partner_publik").select("*").limit(1);
    expect(Object.keys(data![0])).not.toContain("no_hp");
  });

  /**
   * TITIK BUTA yang ditembus red team: test di atas hanya menembak TABEL
   * `partners`. View `partner_publik` adalah objek TERPISAH dengan haknya
   * sendiri — `authenticated` mewarisi INSERT/UPDATE/DELETE dari default
   * privileges Supabase, view-nya auto-updatable (select sederhana tanpa
   * WHERE), dan `security_invoker = off` membuat pemeriksaan hak & RLS
   * dilakukan sebagai PEMILIK view (postgres). Tiga fakta itu bertemu menjadi
   * pintu tulis ke `partners` yang melewati RLS sepenuhnya: setiap pengguna
   * login — termasuk akun daftar-mandiri tanpa baris `clients` — bisa menulis
   * ulang nama bidan yang dibaca SELURUH klien di riwayat sesi.
   */
  it("klien TIDAK bisa menulis mitra lewat VIEW partner_publik", async () => {
    const sebelum = (await barisMitra(MITRA_EDIT))!.nama;

    const { error: eUbah } = await sesiKlien
      .from("partner_publik")
      .update({ nama: "PAD-UJI Lewat View" })
      .eq("id", MITRA_EDIT)
      .select();
    expect(eUbah?.code).toBe("42501");

    const { error: eTambah } = await sesiKlien
      .from("partner_publik")
      .insert({ nama: "PAD-UJI Hantu Lewat View" })
      .select();
    expect(eTambah?.code).toBe("42501");

    const { error: eHapus } = await sesiKlien
      .from("partner_publik")
      .delete()
      .eq("id", MITRA_EDIT);
    expect(eHapus?.code).toBe("42501");

    // 42501 tanpa pembacaan ulang tidak membuktikan apa pun.
    expect((await barisMitra(MITRA_EDIT))!.nama).toBe(sebelum);
    const { data: hantu } = await admin
      .from("partners")
      .select("id")
      .like("nama", "PAD-UJI Hantu%");
    expect(hantu ?? []).toHaveLength(0);
  });

  it("klien TETAP bisa MEMBACA partner_publik (jalur riwayat passport hidup)", async () => {
    // Pencabutan verba tulis tidak boleh ikut mematikan satu-satunya cara
    // klien mengetahui nama bidannya.
    const { data, error } = await sesiKlien.from("partner_publik").select("id, nama");
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Halaman /admin/mitra
// ---------------------------------------------------------------------------

describe("halaman daftar mitra (/admin/mitra)", () => {
  let markup = "";
  let sesiSelesaiSri = 0;

  beforeAll(async () => {
    ref.sesi = sesiAdmin;
    await admin.from("partners").update({ aktif: false }).eq("id", MITRA_STATUS);

    const { count } = await admin
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .eq("partner_id", SRI)
      .eq("status", "selesai");
    sesiSelesaiSri = count ?? 0;

    markup = renderToStaticMarkup(await MitraPage());
  });

  afterAll(async () => {
    await admin.from("partners").update({ aktif: true }).eq("id", MITRA_STATUS);
  });

  it("menampilkan nama dan kontak tiap mitra", () => {
    expect(markup).toContain("PAD-UJI Bidan Edit Baru");
    expect(markup).toContain("0899-9000-0001");
    expect(markup).toContain(NAMA_SRI);
  });

  it("menampilkan jumlah sesi selesai apa adanya dari basis data", () => {
    expect(sesiSelesaiSri).toBeGreaterThan(0);
    expect(markup).toContain(`${sesiSelesaiSri} sesi selesai`);
  });

  it("membedakan mitra aktif dan nonaktif dengan pill", () => {
    // Keduanya sebagai isi elemen tersendiri: "Nonaktif" yang lolos hanya
    // karena tombol "Nonaktifkan" bukan bukti apa pun.
    expect(markup).toMatch(/>Aktif</);
    expect(markup).toMatch(/>Nonaktif</);
  });

  it("menawarkan jalan MENGAKTIFKAN kembali mitra yang nonaktif", () => {
    // Tanpa ini, satu klik salah menonaktifkan bidan selamanya dari panel.
    expect(markup).toContain("Aktifkan");
  });

  it("menyediakan jalan menambah mitra baru", () => {
    expect(markup).toContain("Mitra baru");
    // Formulirnya dimulai tertutup (sama seperti modul klien), jadi medannya
    // dijaga di sumber — bukan di markup keadaan awal.
    expect(sumberForm).toContain('name="nama"');
    expect(sumberForm).toContain('name="no_hp"');
  });

  it("menyebut bahwa mitra bukan pengguna aplikasi", () => {
    expect(markup).toMatch(/bukan pengguna aplikasi/i);
  });

  it("dijaga requireRole admin+owner di halamannya sendiri", () => {
    expect(sumberHalaman).toMatch(
      /await\s+requireRole\(\s*\[\s*"admin"\s*,\s*"owner"\s*\]\s*\)/,
    );
  });

  it("judul mengandalkan template layout (tanpa menempel PADMA sendiri)", () => {
    expect(sumberHalaman).toMatch(/title:\s*"Mitra"/);
    expect(sumberHalaman).not.toMatch(/title:\s*"[^"]*PADMA/);
  });

  it("TIDAK ada nominal uang di modul mitra (money firewall)", () => {
    // Honor mitra adalah wilayah owner; admin mengelola orangnya, bukan angkanya.
    expect(markup).not.toMatch(/Rp\s?\d/);
    for (const sumber of [sumberHalaman, sumberForm, sumberAksi, sumberLib]) {
      expect(sumber).not.toMatch(/Rp\s?\d/);
      expect(sumber).not.toContain("service_rates");
      expect(sumber).not.toContain("variant_rates");
      expect(sumber).not.toContain("honor_marks");
      expect(sumber).not.toContain("honor_mitra");
    }
  });
});

// ---------------------------------------------------------------------------
// Bentuk berkas server action
// ---------------------------------------------------------------------------

describe("berkas server action mitra", () => {
  it('diawali "use server"', () => {
    expect(sumberAksi.trimStart().startsWith('"use server"')).toBe(true);
  });

  it("hanya mengekspor fungsi async (syarat Next)", () => {
    const ekspor = [...sumberAksi.matchAll(/^export\s+(?!type\b)(\w+)/gm)].map((m) => m[1]);
    expect(ekspor.length).toBeGreaterThan(0);
    expect([...new Set(ekspor)]).toEqual(["async"]);
  });

  it("SETIAP action memanggil requireRole(['admin','owner']) di dalam dirinya", () => {
    const jumlahAction = [...sumberAksi.matchAll(/^export\s+async\s+function\s+\w+/gm)].length;
    const jumlahGuard = [
      ...sumberAksi.matchAll(/await\s+requireRole\(\s*\[\s*"admin"\s*,\s*"owner"\s*\]\s*\)/g),
    ].length;
    // simpanMitra, perbaruiMitra, aktifkanMitra, nonaktifkanMitra. Angkanya
    // sengaja PERSIS: action yang lahir tanpa penjaga peran adalah endpoint
    // POST terbuka.
    expect(jumlahAction).toBe(4);
    expect(jumlahGuard).toBe(jumlahAction);
  });

  it("memakai sesi pengguna, bukan service role", () => {
    for (const sumber of [sumberAksi, sumberHalaman, sumberForm, sumberLib]) {
      expect(sumber).not.toContain("createAdminSupabase");
      expect(sumber).not.toContain("SERVICE_ROLE");
    }
    expect(sumberAksi).toContain("createServerSupabase");
    expect(sumberLib).toContain("createServerSupabase");
  });

  it("pencocokan identitas memakai operator setara, tidak pernah pola", () => {
    for (const sumber of [sumberAksi, sumberHalaman, sumberLib]) {
      expect(sumber).not.toContain(".ilike(");
      expect(sumber).not.toContain(".like(");
    }
  });

  it("tidak menuliskan data mitra ke log", () => {
    for (const sumber of [sumberAksi, sumberHalaman, sumberForm, sumberLib]) {
      expect(sumber).not.toContain("console.");
    }
  });

  it("layout admin TIDAK ikut diubah (matriks peran tetap satu panggilan)", () => {
    const layout = baca("src/app/admin/layout.tsx");
    expect([...layout.matchAll(/requireRole\(/g)]).toHaveLength(1);
    expect(baca("src/app/admin/page.tsx")).toContain('href="/admin/skrining"');
  });
});
