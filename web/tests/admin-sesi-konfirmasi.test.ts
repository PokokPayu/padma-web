/**
 * Modul Sesi — antrean permintaan jadwal & konfirmasinya.
 *
 * Ini titik tempat DUA tulisan harus berlaku sebagai satu keputusan:
 * `booking_requests.status` menjadi 'dikonfirmasi', dan satu baris `sessions`
 * lahir. Empat cara keputusan itu pernah — atau gampang sekali — pecah:
 *
 *  1. KONFIRMASI GANDA. Dua admin menekan tombol yang sama dalam detik yang
 *     sama: tanpa klaim status yang menyerialkan dan tanpa index unik pada
 *     `sessions.booking_request_id`, lahir DUA sesi untuk satu permintaan.
 *     Klien kedatangan bidan dua kali dan tidak ada error apa pun. Test
 *     balapan di bawah adalah alasan utama berkas ini ada.
 *
 *  2. IDENTITAS KLIEN DATANG DARI FORM. `client_id`/`service_id` sesi HARUS
 *     dibaca dari baris permintaan, bukan dari payload pemanggil — server
 *     action adalah endpoint POST tersendiri yang bisa dipanggil tanpa UI.
 *
 *  3. STATUS TUJUAN MENJADI PARAMETER. Bentuk celah "klien menyetujui
 *     permintaan jadwalnya sendiri" tembus persis karena itu. Karena itu ada
 *     DUA action terpisah dengan status tertulis mati di dalamnya, dan tanda
 *     tangannya diuji.
 *
 *  4. SESI YATIM. Bila sesi dibuat lebih dulu lalu klaim gagal, tertinggal sesi
 *     yang tidak berasal dari permintaan mana pun — dan permintaannya tetap di
 *     antrean, menunggu dikonfirmasi untuk kedua kalinya.
 *
 * Data uji memakai tanggal khusus (2026-12-26) + mitra ber-prefix `PAD-UJI` dan
 * dibersihkan di `afterAll`: `passport-beranda.test.ts` meng-assert jumlah
 * stempel Ananda PERSIS, jadi tidak boleh ada sesi sisa yang menempel padanya.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { varianBaku } from "./helpers/varian";

const admin = createAdminSupabase();
const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

const KLIEN = "44444444-4444-4444-4444-444444444401"; // Ananda
const SVC = "11111111-1111-1111-1111-111111111101"; // Fertility Massage
const MITRA = "33333333-3333-3333-3333-333333333301"; // Bidan Sri Wahyuni
const MITRA_NONAKTIF = "33333333-3333-3333-3333-3333333333e1";
const TGL = "2026-12-26";
const HANTU = "00000000-0000-0000-0000-000000000000";

let permintaanId = "";

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
  usePathname: () => "/admin/sesi",
}));

const { konfirmasiPermintaan, tolakPermintaan } = await import("@/app/admin/sesi/aksi");
const { LABEL_WAKTU, LABEL_STATUS_PERMINTAAN } = await import("@/app/admin/sesi/status");
const { default: SesiPage } = await import("@/app/admin/sesi/page");

const sumberAksi = baca("src/app/admin/sesi/aksi.ts");
const sumberStatus = baca("src/app/admin/sesi/status.ts");
const sumberHalaman = baca("src/app/admin/sesi/page.tsx");
const sumberAntrean = baca("src/app/admin/sesi/antrean-permintaan.tsx");
const migrasi = baca("supabase/migrations/20260829170000_sesi_dari_permintaan.sql");

/**
 * Badan SATU server action, dipotong dari sumbernya.
 *
 * Berkas `aksi.ts` menampung lebih dari satu action, dan aturannya berbeda per
 * action: `konfirmasiPermintaan` tidak boleh membaca identitas klien dari
 * payload (sumber kebenarannya adalah baris permintaan), sedangkan
 * `jadwalkanSesi` justru harus — di jalur itu memang admin yang memilih klien
 * dan tidak ada baris lain untuk dibaca. Pemeriksaan berbasis seluruh isi
 * berkas akan mencampur keduanya, jadi ia dipersempit ke fungsi yang dimaksud.
 */
function badanAction(nama: string): string {
  const mulai = sumberAksi.indexOf(`export async function ${nama}(`);
  expect(mulai).toBeGreaterThanOrEqual(0);
  const sisa = sumberAksi.slice(mulai + 1);
  const akhir = sisa.indexOf("\nexport async function ");
  return akhir === -1 ? sisa : sisa.slice(0, akhir);
}

let sesiAdmin: SupabaseClient;
let sesiKlien: SupabaseClient;

async function bersihkan() {
  // Sesi DULU, baru permintaannya: `sessions.booking_request_id` menahan
  // penghapusan permintaan yang sudah menjadi sesi (FK tanpa on delete).
  await admin.from("sessions").delete().eq("tanggal", TGL);
  await admin.from("booking_requests").delete().eq("tanggal", TGL);
}

async function baris(id: string) {
  const { data } = await admin
    .from("booking_requests")
    .select("id, status")
    .eq("id", id)
    .maybeSingle<{ id: string; status: string }>();
  return data;
}

async function sesiPadaTanggal() {
  const { data } = await admin
    .from("sessions")
    .select("id, client_id, service_id, variant_id, partner_id, status, booking_request_id")
    .eq("tanggal", TGL);
  return data ?? [];
}

let VARIAN_SVC: string;

beforeAll(async () => {
  sesiAdmin = await signInAs("admin@padma.test");
  sesiKlien = await signInAs("ananda@padma.test");
  ref.sesi = sesiAdmin;
  // Sejak Task 9 `booking_requests.variant_id`/`sessions.variant_id` NOT
  // NULL: id-nya lahir `gen_random_uuid()` saat migrasi/trigger berjalan,
  // jadi dibaca dari basis data sekali di sini alih-alih ditulis literal.
  VARIAN_SVC = await varianBaku(admin, SVC);

  await admin.from("partners").upsert(
    {
      id: MITRA_NONAKTIF,
      nama: "PAD-UJI Bidan Pensiun",
      no_hp: "0811-9100-0001",
      aktif: false,
    },
    { onConflict: "id" },
  );
});

afterAll(async () => {
  await bersihkan();
  await admin.from("partners").delete().eq("id", MITRA_NONAKTIF);
});

beforeEach(async () => {
  ref.sesi = sesiAdmin;
  jejak.revalidate.length = 0;

  await bersihkan();
  const { data, error } = await admin
    .from("booking_requests")
    .insert({
      client_id: KLIEN,
      service_id: SVC,
      variant_id: VARIAN_SVC,
      tanggal: TGL,
      preferensi_waktu: "pagi",
      catatan: "Kalau bisa sebelum pukul 9.",
      status: "menunggu",
    })
    .select("id")
    .single();
  if (error) throw error;
  permintaanId = data!.id as string;
});

// ---------------------------------------------------------------------------
// konfirmasiPermintaan
// ---------------------------------------------------------------------------

describe("konfirmasi permintaan jadwal", () => {
  it("mengubah permintaan menjadi dikonfirmasi DAN membuat satu sesi terjadwal", async () => {
    const r = await konfirmasiPermintaan(permintaanId, MITRA);
    expect(r.ok).toBe(true);

    expect((await baris(permintaanId))!.status).toBe("dikonfirmasi");

    const sesi = await sesiPadaTanggal();
    expect(sesi).toHaveLength(1);
    expect(sesi[0]).toMatchObject({
      client_id: KLIEN,
      service_id: SVC,
      variant_id: VARIAN_SVC, // varian ikut dari permintaan asalnya (Task 9)
      partner_id: MITRA,
      status: "terjadwal",
      booking_request_id: permintaanId,
    });
  });

  it("identitas klien & layanan diambil dari baris permintaan, bukan dari pemanggil", async () => {
    // Hanya dua nilai yang boleh datang dari luar: permintaan mana, dan mitra
    // siapa. Sisanya dibaca dari barisnya sendiri — kalau tidak, satu request
    // POST yang dikarang bisa membuat sesi atas nama klien lain.
    const badan = badanAction("konfirmasiPermintaan");
    // Tidak ada FormData sama sekali di jalur ini — bukan sekadar tidak ada
    // medan `client_id`. Yang masuk hanyalah dua argumen fungsi.
    expect(badan).not.toContain("formData");
    expect(badan).toMatch(/client_id:\s*\w+\.client_id/);
    expect(badan).toMatch(/service_id:\s*\w+\.service_id/);
    // Varian sejak Task 9: harga menempel di varian, bukan hanya layanan —
    // membacanya dari payload membuka celah yang sama seperti client_id.
    expect(badan).toMatch(/variant_id:\s*\w+\.variant_id/);
  });

  it("menyegarkan cache antrean admin dan passport klien", async () => {
    await konfirmasiPermintaan(permintaanId, MITRA);
    expect(jejak.revalidate).toContain("/admin/sesi");
    expect(jejak.revalidate).toContain("/passport");
  });

  it("konfirmasi KEDUA pada permintaan yang sama tidak melahirkan sesi kedua", async () => {
    const pertama = await konfirmasiPermintaan(permintaanId, MITRA);
    expect(pertama.ok).toBe(true);

    const kedua = await konfirmasiPermintaan(permintaanId, MITRA);
    expect(kedua.ok).toBe(false);

    expect(await sesiPadaTanggal()).toHaveLength(1); // tetap satu
  });

  it("dua konfirmasi PARALEL hanya menghasilkan satu sesi (balapan)", async () => {
    const [a, b] = await Promise.all([
      konfirmasiPermintaan(permintaanId, MITRA),
      konfirmasiPermintaan(permintaanId, MITRA),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1); // tepat satu pemenang

    expect(await sesiPadaTanggal()).toHaveLength(1);
    expect((await baris(permintaanId))!.status).toBe("dikonfirmasi");
  });

  it("basis data ikut menjaga: dua sesi tidak bisa menaut satu permintaan", async () => {
    // Jaring kedua, tidak bergantung pada urutan pernyataan di TypeScript.
    // Bahkan service role — yang menembus seluruh RLS — tertahan di sini.
    await konfirmasiPermintaan(permintaanId, MITRA);
    const { error } = await admin.from("sessions").insert({
      client_id: KLIEN,
      service_id: SVC,
      variant_id: VARIAN_SVC,
      partner_id: MITRA,
      tanggal: TGL,
      status: "terjadwal",
      booking_request_id: permintaanId,
    });
    expect(error?.code).toBe("23505");
    expect(await sesiPadaTanggal()).toHaveLength(1);
  });

  it("permintaan yang sudah dikonfirmasi tidak bisa dikonfirmasi ulang", async () => {
    await admin
      .from("booking_requests")
      .update({ status: "dikonfirmasi" })
      .eq("id", permintaanId);

    const r = await konfirmasiPermintaan(permintaanId, MITRA);
    expect(r.ok).toBe(false);
    expect(await sesiPadaTanggal()).toHaveLength(0);
  });

  it("permintaan yang sudah ditolak tidak bisa dihidupkan lewat konfirmasi", async () => {
    await admin
      .from("booking_requests")
      .update({ status: "ditolak" })
      .eq("id", permintaanId);

    const r = await konfirmasiPermintaan(permintaanId, MITRA);
    expect(r.ok).toBe(false);
    expect((await baris(permintaanId))!.status).toBe("ditolak");
    expect(await sesiPadaTanggal()).toHaveLength(0);
  });

  it("permintaan yang tidak ada ditolak tanpa membuat sesi yatim", async () => {
    const r = await konfirmasiPermintaan(HANTU, MITRA);
    expect(r.ok).toBe(false);
    expect(await sesiPadaTanggal()).toHaveLength(0);
  });

  it("mitra yang tidak ada ditolak, dan permintaan KEMBALI ke antrean", async () => {
    // Sesi yatim adalah satu bahaya; permintaan yang hilang diam-diam dari
    // antrean karena konfirmasinya gagal separuh jalan adalah bahaya lain.
    const r = await konfirmasiPermintaan(permintaanId, HANTU);
    expect(r.ok).toBe(false);
    expect(await sesiPadaTanggal()).toHaveLength(0);
    expect((await baris(permintaanId))!.status).toBe("menunggu");
  });

  it("mitra NONAKTIF tidak bisa ditugaskan lewat action, walau UI menyaringnya", async () => {
    // Daftar pilihan di UI memang sudah menyaring `aktif`, tetapi server action
    // adalah endpoint POST tersendiri yang tidak pernah melewati UI itu.
    const r = await konfirmasiPermintaan(permintaanId, MITRA_NONAKTIF);
    expect(r.ok).toBe(false);
    expect(await sesiPadaTanggal()).toHaveLength(0);
    expect((await baris(permintaanId))!.status).toBe("menunggu");
  });

  it("tanda tangan action TIDAK menerima status dari pemanggil", () => {
    // Bentuk celah "klien menyetujui permintaannya sendiri" pernah tembus di
    // proyek ini justru karena nilai status datang dari luar. Dua parameter
    // saja: id permintaan & id mitra.
    expect(konfirmasiPermintaan.length).toBe(2);
    expect(tolakPermintaan.length).toBe(1);
    for (const pola of [
      /function\s+\w+\([^)]*status\s*:/,
      /function\s+\w+\([^)]*statusBaru\s*:/,
    ]) {
      expect(sumberAksi).not.toMatch(pola);
    }
    // Keduanya tertulis mati di dalam action, masing-masing sekali.
    expect(sumberAksi).toMatch(/status:\s*"dikonfirmasi"/);
    expect(sumberAksi).toMatch(/status:\s*"ditolak"/);
    expect(sumberAksi).toMatch(/status:\s*"terjadwal"/);
  });

  it("PENJAGA PERAN: klien yang login tidak bisa mengonfirmasi permintaannya sendiri", async () => {
    ref.sesi = sesiKlien;
    await expect(konfirmasiPermintaan(permintaanId, MITRA)).rejects.toThrow(/REDIRECT/);

    expect((await baris(permintaanId))!.status).toBe("menunggu");
    expect(await sesiPadaTanggal()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// tolakPermintaan
// ---------------------------------------------------------------------------

describe("menolak permintaan jadwal", () => {
  it("menandai permintaan ditolak tanpa membuat sesi apa pun", async () => {
    const r = await tolakPermintaan(permintaanId);
    expect(r.ok).toBe(true);
    expect((await baris(permintaanId))!.status).toBe("ditolak");
    expect(await sesiPadaTanggal()).toHaveLength(0);
    expect(jejak.revalidate).toContain("/admin/sesi");
  });

  it("permintaan yang sudah dikonfirmasi TIDAK bisa dibatalkan lewat tolak", async () => {
    // Sesi sudah lahir; memutar status permintaan kembali ke 'ditolak' hanya
    // membuat sesi itu kehilangan asal-usulnya tanpa membatalkan apa pun.
    await konfirmasiPermintaan(permintaanId, MITRA);
    const r = await tolakPermintaan(permintaanId);
    expect(r.ok).toBe(false);
    expect((await baris(permintaanId))!.status).toBe("dikonfirmasi");
    expect(await sesiPadaTanggal()).toHaveLength(1);
  });

  it("permintaan yang tidak ada ditolak, bukan 'ok' palsu", async () => {
    // UPDATE yang tidak mengenai baris mana pun dijawab PostgREST 200 + [].
    const r = await tolakPermintaan(HANTU);
    expect(r.ok).toBe(false);
  });

  it("PENJAGA PERAN: klien yang login tidak bisa menolak permintaan", async () => {
    ref.sesi = sesiKlien;
    await expect(tolakPermintaan(permintaanId)).rejects.toThrow(/REDIRECT/);
    expect((await baris(permintaanId))!.status).toBe("menunggu");
  });
});

// ---------------------------------------------------------------------------
// Pagar basis data
// ---------------------------------------------------------------------------

describe("pagar basis data yang menopang modul ini", () => {
  it("klien TIDAK bisa mengubah status permintaannya sendiri lewat REST", async () => {
    // Tidak ada policy UPDATE untuk klien: PostgREST menjawab 200 + [] tanpa
    // error, jadi nilainya WAJIB dibaca ulang — bukan disimpulkan dari error.
    const { data: ubah } = await sesiKlien
      .from("booking_requests")
      .update({ status: "dikonfirmasi" })
      .eq("id", permintaanId)
      .select("id");
    expect(ubah ?? []).toHaveLength(0);
    expect((await baris(permintaanId))!.status).toBe("menunggu");
  });

  it("klien TIDAK bisa menyisipkan sesi untuk dirinya sendiri", async () => {
    const { error } = await sesiKlien.from("sessions").insert({
      client_id: KLIEN,
      service_id: SVC,
      variant_id: VARIAN_SVC,
      partner_id: MITRA,
      tanggal: TGL,
      status: "terjadwal",
    });
    expect(error).not.toBeNull();
    expect(await sesiPadaTanggal()).toHaveLength(0);
  });

  it("permintaan yang sudah menjadi sesi tidak bisa dihapus begitu saja", async () => {
    // Asal-usul sesi tidak boleh lenyap tanpa sesinya ikut dibereskan lebih
    // dulu — sekaligus yang membuat index unik di atas tidak bisa dilepas
    // dengan satu DELETE.
    await konfirmasiPermintaan(permintaanId, MITRA);
    const { error } = await admin
      .from("booking_requests")
      .delete()
      .eq("id", permintaanId);
    expect(error?.code).toBe("23503");
  });

  it("kolom penaut & index uniknya benar-benar ada di migration", () => {
    expect(migrasi).toMatch(/add column booking_request_id uuid references public\.booking_requests\(id\)/);
    expect(migrasi).toMatch(/create unique index sessions_booking_request_unik/);
    // Nama kolom sengaja tidak menyentuh regex money firewall.
    expect(migrasi).not.toMatch(/(^|_)(bayar|harga|tarif|biaya|nominal|total)(_|$)/m);
  });
});

// ---------------------------------------------------------------------------
// Halaman /admin/sesi
// ---------------------------------------------------------------------------

describe("halaman antrean permintaan (/admin/sesi)", () => {
  it("menampilkan permintaan yang menunggu beserta konteksnya", async () => {
    const markup = renderToStaticMarkup(await SesiPage());

    expect(markup).toContain("Ananda"); // nama klien, bukan sekadar UUID
    expect(markup).not.toContain(KLIEN);
    expect(markup).toContain("Fertility Massage"); // nama layanan
    expect(markup).toContain("26 Desember 2026"); // tanggal terbaca manusia
    expect(markup).toContain(LABEL_WAKTU.pagi);
    expect(markup).toContain("Kalau bisa sebelum pukul 9."); // catatan klien
  });

  it("menawarkan mitra AKTIF untuk ditugaskan, bukan yang sudah pensiun", async () => {
    const markup = renderToStaticMarkup(await SesiPage());
    expect(markup).toContain("Bidan Sri Wahyuni");
    expect(markup).not.toContain("PAD-UJI Bidan Pensiun");
  });

  it("menyediakan tombol Konfirmasi dan Tolak", async () => {
    const markup = renderToStaticMarkup(await SesiPage());
    expect(markup).toContain("Konfirmasi");
    expect(markup).toContain("Tolak");
  });

  it("menjelaskan akibat konfirmasi kepada admin", async () => {
    const markup = renderToStaticMarkup(await SesiPage());
    expect(markup).toMatch(/sesi\s+Terjadwal/i);
    expect(markup).toMatch(/whatsapp/i);
  });

  it("permintaan yang sudah ditangani TIDAK muncul lagi di antrean", async () => {
    await konfirmasiPermintaan(permintaanId, MITRA);
    const markup = renderToStaticMarkup(await SesiPage());
    expect(markup).not.toContain("Kalau bisa sebelum pukul 9.");
    expect(markup).toMatch(/tidak ada permintaan/i);
  });

  it("dijaga requireRole admin+owner di halamannya sendiri", () => {
    expect(sumberHalaman).toMatch(
      /await\s+requireRole\(\s*\[\s*"admin"\s*,\s*"owner"\s*\]\s*\)/,
    );
  });

  it("judul mengandalkan template layout (tanpa menempel PADMA sendiri)", () => {
    expect(sumberHalaman).toMatch(/title:\s*"Sesi"/);
    expect(sumberHalaman).not.toMatch(/title:\s*"[^"]*PADMA/);
  });

  it("TIDAK ada nominal uang di modul sesi (money firewall)", async () => {
    const markup = renderToStaticMarkup(await SesiPage());
    expect(markup).not.toMatch(/Rp\s?\d/);
    for (const sumber of [sumberHalaman, sumberAntrean, sumberAksi, sumberStatus]) {
      expect(sumber).not.toMatch(/Rp\s?\d/);
      expect(sumber).not.toContain("service_rates");
      expect(sumber).not.toContain("variant_rates");
      expect(sumber).not.toContain("honor_marks");
    }
  });
});

// ---------------------------------------------------------------------------
// Bentuk berkas
// ---------------------------------------------------------------------------

describe("berkas server action sesi", () => {
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
    // konfirmasiPermintaan, tolakPermintaan, jadwalkanSesi, selesaikanSesi.
    // Angkanya sengaja tepat, bukan `toBeGreaterThan`: action baru yang lupa
    // memasang penjaganya harus memerahkan berkas ini, bukan lewat diam-diam.
    expect(jumlahAction).toBe(4);
    expect(jumlahGuard).toBe(jumlahAction);
  });

  it("label & daftar putih hidup di status.ts, bukan di berkas 'use server'", () => {
    // Modul "use server" yang mengekspor konstanta menggagalkan `next build`.
    expect(sumberStatus.trimStart().startsWith('"use server"')).toBe(false);
    expect(LABEL_WAKTU).toMatchObject({ pagi: expect.any(String) });
    expect(Object.keys(LABEL_WAKTU).sort()).toEqual(["pagi", "siang", "sore"]);
    expect(Object.keys(LABEL_STATUS_PERMINTAAN).sort()).toEqual([
      "dikonfirmasi",
      "ditolak",
      "menunggu",
    ]);
  });

  it("memakai sesi pengguna, bukan service role", () => {
    for (const sumber of [sumberAksi, sumberHalaman, sumberAntrean, sumberStatus]) {
      expect(sumber).not.toContain("createAdminSupabase");
      expect(sumber).not.toContain("SERVICE_ROLE");
    }
    expect(sumberAksi).toContain("createServerSupabase");
  });

  it("tanggal tidak pernah dihitung dengan aritmatika Date", () => {
    for (const sumber of [sumberAksi, sumberHalaman, sumberAntrean, sumberStatus]) {
      expect(sumber).not.toContain("toISOString");
      expect(sumber).not.toContain("setDate(");
      expect(sumber).not.toContain("getDay(");
    }
  });

  it("tidak menuliskan data klien ke log", () => {
    for (const sumber of [sumberAksi, sumberHalaman, sumberAntrean, sumberStatus]) {
      expect(sumber).not.toContain("console.");
    }
  });

  it("layout admin TIDAK ikut diubah (matriks peran tetap satu panggilan)", () => {
    const layout = baca("src/app/admin/layout.tsx");
    expect([...layout.matchAll(/requireRole\(/g)]).toHaveLength(1);
    expect(layout).toMatch(/requireRole\(\s*\[\s*"admin"\s*,\s*"owner"\s*\]\s*\)/);
    expect(baca("src/app/admin/page.tsx")).toContain('href="/admin/skrining"');
  });
});
