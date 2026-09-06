import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { varianBaku } from "./helpers/varian";
import { OBJEK_VIDEO_TERBUKA } from "./helpers/materi-video-fixture";

// `createServerSupabase()` membaca `cookies()` dari next/headers, yang hanya
// bermakna di dalam request scope. Agar lapisan data BENAR-BENAR dieksekusi di
// test (bukan sekadar dibaca sebagai teks), modulnya diganti dengan klien
// Supabase ber-SESI NYATA hasil `signInAs`. Konsekuensinya penting: seluruh
// query di bawah tetap melewati RLS sebagai Ananda — persis seperti di server.
const ref = vi.hoisted(() => ({ klien: null as SupabaseClient | null }));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.klien!,
}));

// Lapisan data memakai createServerSupabase (cookies), yang tidak tersedia di
// vitest. Yang diuji di sini adalah INVARIAN QUERY-nya lewat klien ber-sesi:
// bentuk data, gating, dan tidak bocornya isi materi.
describe("invarian query passport (lewat RLS sesi klien)", () => {
  it("klien hanya melihat sesinya sendiri", async () => {
    const k = await signInAs("ananda@padma.test");
    const { data, error } = await k
      .from("sessions")
      .select("id, tanggal, status, catatan, rekomendasi, status_bayar, client_package_id, partner_id, services(id, nama)")
      .order("tanggal", { ascending: false });
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    expect(data![0].services).not.toBeNull();
  });

  it("nama mitra terbaca lewat partner_publik sebagai query terpisah", async () => {
    // Sengaja BUKAN embed: embed ke view bergantung inferensi relasi dan
    // kegagalannya senyap. Query terpisah selalu bekerja.
    const k = await signInAs("ananda@padma.test");
    const { data, error } = await k.from("partner_publik").select("id, nama");
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(2);
    expect(data![0].nama).toBeTruthy();
  });

  it("daftar materi TIDAK memuat URL video (embed material_videos hanya material_id)", async () => {
    // `material_pages(halaman)` — BUKAN `objek` — sengaja dipilih di sini,
    // persis seperti query sungguhan `ambilDaftarMateri()`: `halaman` cuma
    // penghitung, dan `objek` (kunci storage) memang TIDAK diminta sama
    // sekali. Materi TERBUKA (mis. …702) LEGITIM boleh membawa `halaman`-nya
    // sendiri di sini — Ananda berhak melihatnya; yang tidak boleh bocor
    // adalah `objek`/`url`, dan itulah yang diperiksa di bawah.
    const k = await signInAs("ananda@padma.test");
    const { data, error } = await k
      .from("materials")
      .select("id, judul, tipe, deskripsi, material_pages(halaman), material_videos(material_id)")
      .eq("aktif", true);
    expect(error).toBeNull();
    const json = JSON.stringify(data);
    expect(json).not.toContain("vimeo.com");
    expect(json.toLowerCase()).not.toContain("\"objek\"");
    expect(json.toLowerCase()).not.toContain("\"url\"");
  });

  it("materi terkunci: judul terlihat, halaman kosong", async () => {
    const k = await signInAs("ananda@padma.test");
    const { data } = await k
      .from("materials")
      .select("judul, material_pages(halaman), material_videos(material_id)")
      .eq("aktif", true);
    const adaTerkunci = data!.some(
      (m) => (m.material_pages as unknown[]).length === 0 && m.material_videos === null,
    );
    // Seed MEMANG menaruh satu baris material_pages untuk materi ebook
    // terkunci ini (lihat supabase/seed.sql) — RLS-lah yang mengosongkan
    // embed di atas untuk Ananda, bukan ketiadaan baris di basis data.
    expect(adaTerkunci).toBe(true);
  });

  it("embed material_videos berbentuk OBJEK/null, bukan array", async () => {
    const k = await signInAs("ananda@padma.test");
    const { data } = await k.from("materials").select("material_videos(material_id)").eq("aktif", true);
    const nilai = data!.map((m) => m.material_videos);
    expect(nilai.every((v) => v === null || (typeof v === "object" && !Array.isArray(v)))).toBe(true);
  });
});

// ===========================================================================
// Lapisan data itu sendiri — dieksekusi sungguhan lewat sesi Ananda.
// ===========================================================================
const svc = createAdminSupabase();

const ANANDA = "44444444-4444-4444-4444-444444444401";
const RINA = "44444444-4444-4444-4444-444444444402";
const PAKET_ANANDA = "55555555-5555-5555-5555-555555555501";

// 1101 Sankalpa Fertility Massage — Ananda punya sesi `selesai` (TERBUKA).
const MATERI_TERBUKA_VIDEO = "77777777-7777-7777-7777-777777777701";
const MATERI_TERBUKA_EBOOK = "77777777-7777-7777-7777-777777777702";
// 1106 Lactation Hero — Ananda tidak pernah menjalaninya (TERKUNCI).
const MATERI_TERKUNCI_VIDEO = "77777777-7777-7777-7777-777777777703";
const MATERI_TERKUNCI_EBOOK = "77777777-7777-7777-7777-777777777704";
// Baris `material_videos` demo (id 701/703) TIDAK datang dari
// `supabase/seed.sql` (spec §13b A-6: demo dev dibiarkan kosong).
// `ambilDaftarMateri`/`ambilMateriDetail` di bawah butuh baris sungguhan
// untuk materi terbuka/terkunci di atas, jadi `tests/global-setup.ts`
// menyemainya SEKALI sebelum berkas test mana pun berjalan — lihat komentar
// di sana untuk alasan lengkapnya.

const SVC_YOGA = "11111111-1111-1111-1111-111111111102";

async function pakaiSesi(email: string) {
  ref.klien = await signInAs(email);
}

describe("ambilKlien", () => {
  beforeAll(async () => { await pakaiSesi("ananda@padma.test"); });

  it("mengembalikan identitas klien beserta fase yang sudah dipetakan", async () => {
    const { ambilKlien } = await import("@/lib/passport/data");
    const k = await ambilKlien();
    expect(k).not.toBeNull();
    expect(k).toMatchObject({
      id: ANANDA,
      padmaId: "PAD-2607-0012",
      nama: "Ananda Putri",
      email: "ananda@padma.test",
      faseId: "prekonsepsi",
      faseNama: "Prekonsepsi / Promil",
      faseSanskrit: "Sankalpa",
    });
    expect(k!.noHp).toBeTruthy();
  });

  it("user tanpa baris clients mengembalikan null, BUKAN melempar PGRST116", async () => {
    // Keputusan G: klien belum tertaut diarahkan, bukan meledak. `maybeSingle`
    // adalah yang membedakannya dari `single`.
    await pakaiSesi("admin@padma.test");
    const { ambilKlien } = await import("@/lib/passport/data");
    await expect(ambilKlien()).resolves.toBeNull();
    await pakaiSesi("ananda@padma.test");
  });
});

describe("ambilSesi", () => {
  beforeAll(async () => { await pakaiSesi("ananda@padma.test"); });

  it("memetakan sesi lengkap dengan NAMA BIDAN dari query terpisah", async () => {
    const { ambilSesi } = await import("@/lib/passport/data");
    const sesi = await ambilSesi(ANANDA);
    expect(sesi.length).toBeGreaterThan(0);

    // "Tim PADMA" adalah nilai jatuh-tempo saat pemetaan nama mitra gagal.
    // Kalau ia muncul, penggabungan partner_publik di JS sedang rusak — dan
    // kegagalan itu memang senyap, karena itu diuji eksplisit.
    expect(sesi.every((s) => s.namaMitra !== "Tim PADMA")).toBe(true);
    expect(sesi.map((s) => s.namaMitra)).toContain("Bidan Sri Wahyuni");

    // Nama layanan ikut termuat, catatan/rekomendasi tidak pernah null.
    expect(sesi.every((s) => s.namaLayanan !== "Layanan")).toBe(true);
    expect(sesi.every((s) => typeof s.catatan === "string")).toBe(true);
    expect(sesi.every((s) => typeof s.rekomendasi === "string")).toBe(true);
  });

  it("memetakan client_package_id menjadi clientPackageId (snake -> camel)", async () => {
    const { ambilSesi } = await import("@/lib/passport/data");
    const sesi = await ambilSesi(ANANDA);
    const berpaket = sesi.filter((s) => s.clientPackageId !== null);
    expect(berpaket.length).toBeGreaterThan(0);
    expect(berpaket.every((s) => s.clientPackageId === PAKET_ANANDA)).toBe(true);
  });

  it("terurut menurun menurut tanggal (perbandingan string, bukan Date)", async () => {
    const { ambilSesi } = await import("@/lib/passport/data");
    const tgl = (await ambilSesi(ANANDA)).map((s) => s.tanggal);
    expect(tgl.every((t) => /^\d{4}-\d{2}-\d{2}$/.test(t))).toBe(true);
    expect([...tgl].sort().reverse()).toEqual(tgl);
  });

  it("sesi klien LAIN tidak pernah terbawa (RLS yang menjaga, bukan UI)", async () => {
    const { ambilSesi } = await import("@/lib/passport/data");
    await expect(ambilSesi(RINA)).resolves.toEqual([]);
  });

  it("membawa medan varian (Ruling 13) — dibutuhkan susunTagihan() untuk label", async () => {
    const { ambilSesi } = await import("@/lib/passport/data");
    const sesi = await ambilSesi(ANANDA);
    // Seluruh sesi seed lahir dengan variant_id BAKU (label kosong, durasi
    // & format NULL) — bentuknya harus tetap berupa objek, bukan hilang.
    for (const s of sesi) {
      expect(s.varian).toBeDefined();
      expect(typeof s.varian.label).toBe("string");
    }
  });
});

describe("ambilPaket", () => {
  beforeAll(async () => { await pakaiSesi("ananda@padma.test"); });

  it("memetakan paket aktif beserta nama & jumlah sesi dari packages", async () => {
    const { ambilPaket } = await import("@/lib/passport/data");
    const paket = await ambilPaket(ANANDA);
    expect(paket).toHaveLength(1);
    expect(paket[0]).toEqual({
      id: PAKET_ANANDA,
      nama: "Sankalpa Prima",
      jumlahSesi: 8,
      statusBayar: "lunas",
    });
  });

  it("paket klien lain tidak terbawa", async () => {
    const { ambilPaket } = await import("@/lib/passport/data");
    await expect(ambilPaket(RINA)).resolves.toEqual([]);
  });
});

describe("ambilDaftarMateri", () => {
  beforeAll(async () => { await pakaiSesi("ananda@padma.test"); });

  it("menandai terbuka/terkunci dari hasil RLS, bukan dari kolom apa pun", async () => {
    const { ambilDaftarMateri } = await import("@/lib/passport/data");
    const daftar = await ambilDaftarMateri();
    const per = new Map(daftar.map((m) => [m.id, m]));

    expect(per.get(MATERI_TERBUKA_VIDEO)!.terbuka).toBe(true);
    expect(per.get(MATERI_TERBUKA_EBOOK)!.terbuka).toBe(true);
    // Seed menaruh 3 baris material_pages untuk materi ini (lihat seed.sql).
    expect(per.get(MATERI_TERBUKA_EBOOK)!.jumlahHalaman).toBe(3);

    // Terkunci: kartunya TETAP tampil (judul & deskripsi terbaca) — hanya
    // isinya yang tidak ada.
    expect(per.get(MATERI_TERKUNCI_VIDEO)!.terbuka).toBe(false);
    expect(per.get(MATERI_TERKUNCI_EBOOK)!.terbuka).toBe(false);
    expect(per.get(MATERI_TERKUNCI_EBOOK)!.jumlahHalaman).toBe(0);
    expect(per.get(MATERI_TERKUNCI_EBOOK)!.judul).toBe("Panduan ASI Perah");
    expect(per.get(MATERI_TERKUNCI_VIDEO)!.namaLayanan).toBe("Lactation Hero");

    // Keempat materi seed sudah dimigrasikan ke `material_services` sejak
    // migration `materi_banyak_layanan` (satu baris per materi lama) — jadi
    // seluruhnya `punyaLayanan: true`, terbuka maupun terkunci. Aturan M10
    // ("materi tanpa layanan disembunyikan bila belum terbuka") diuji murni
    // di tests/materi-daftar-klien.test.ts; di sini yang dibuktikan adalah
    // bendera itu terisi BENAR dari query sungguhan, bukan sekadar ada.
    expect(per.get(MATERI_TERBUKA_EBOOK)!.punyaLayanan).toBe(true);
    expect(per.get(MATERI_TERKUNCI_EBOOK)!.punyaLayanan).toBe(true);
  });

  it("hasilnya TIDAK memuat isi bab, URL video, maupun kunci objek halaman", async () => {
    const { ambilDaftarMateri } = await import("@/lib/passport/data");
    const json = JSON.stringify(await ambilDaftarMateri());
    expect(json).not.toContain("vimeo.com");
    expect(json).not.toContain("Isi bab");
    expect(json.toLowerCase()).not.toContain("\"isi\"");
    expect(json.toLowerCase()).not.toContain("\"url\"");
    // Daftar hanya boleh membawa metadata & hitungan — tidak pernah kunci
    // objek gambar halaman (mis. "<uuid>/0001.webp"), yang cukup untuk
    // mengunduh gambarnya sendiri lewat storage bila bocor.
    expect(json).not.toContain(".webp");
    expect(json.toLowerCase()).not.toContain("\"objek\"");
  });

  it("materi non-aktif tidak muncul (baris materials sendiri tetap terbaca RLS)", async () => {
    const { ambilDaftarMateri } = await import("@/lib/passport/data");
    await svc.from("materials").update({ aktif: false }).eq("id", MATERI_TERBUKA_EBOOK);
    try {
      const daftar = await ambilDaftarMateri();
      expect(daftar.map((m) => m.id)).not.toContain(MATERI_TERBUKA_EBOOK);
    } finally {
      await svc.from("materials").update({ aktif: true }).eq("id", MATERI_TERBUKA_EBOOK);
    }
  });
});

describe("ambilMateriDetail", () => {
  beforeAll(async () => { await pakaiSesi("ananda@padma.test"); });

  it("materi terbuka: halaman terurut menurut `halaman` dan dimensinya terbaca", async () => {
    const { ambilMateriDetail } = await import("@/lib/passport/data");
    const d = await ambilMateriDetail(MATERI_TERBUKA_EBOOK);
    expect(d).not.toBeNull();
    expect(d!.tipe).toBe("ebook");
    expect(d!.berhak).toBe(true);
    expect(d!.halaman).toHaveLength(3); // seed: 3 baris material_pages
    expect(d!.halaman.map((h) => h.halaman)).toEqual(
      [...d!.halaman.map((h) => h.halaman)].sort((a, b) => a - b),
    );
    expect(d!.halaman.every((h) => h.lebar > 0 && h.tinggi > 0)).toBe(true);
    expect(d!.objekVideo).toBeNull();
  });

  it("materi video terbuka: objekVideo terisi dari embed OBJEK (bukan array)", async () => {
    const { ambilMateriDetail } = await import("@/lib/passport/data");
    const d = await ambilMateriDetail(MATERI_TERBUKA_VIDEO);
    // Nilai disemai tests/global-setup.ts (bukan seed.sql — spec §13b A-6).
    expect(d!.objekVideo).toBe(OBJEK_VIDEO_TERBUKA);
    expect(d!.berhak).toBe(true);
  });

  it("materi TERKUNCI: metadata tampil, halaman kosong, berhak=false & objekVideo null walau URL-nya diakses langsung", async () => {
    const { ambilMateriDetail } = await import("@/lib/passport/data");
    const ebook = await ambilMateriDetail(MATERI_TERKUNCI_EBOOK);
    expect(ebook!.judul).toBe("Panduan ASI Perah");
    expect(ebook!.halaman).toEqual([]);
    expect(ebook!.objekVideo).toBeNull();
    expect(ebook!.berhak).toBe(false);

    const video = await ambilMateriDetail(MATERI_TERKUNCI_VIDEO);
    expect(video!.objekVideo).toBeNull();
    expect(video!.berhak).toBe(false);
    expect(JSON.stringify(video)).not.toContain("RAHASIA");
  });

  it("materi non-aktif atau tidak dikenal mengembalikan null", async () => {
    const { ambilMateriDetail } = await import("@/lib/passport/data");
    await expect(
      ambilMateriDetail("77777777-7777-7777-7777-7777777770ff"),
    ).resolves.toBeNull();

    await svc.from("materials").update({ aktif: false }).eq("id", MATERI_TERBUKA_EBOOK);
    try {
      await expect(ambilMateriDetail(MATERI_TERBUKA_EBOOK)).resolves.toBeNull();
    } finally {
      await svc.from("materials").update({ aktif: true }).eq("id", MATERI_TERBUKA_EBOOK);
    }
  });
});

describe("ambilPermintaanJadwal", () => {
  const bersihkan: string[] = [];

  beforeAll(async () => { await pakaiSesi("ananda@padma.test"); });
  afterAll(async () => {
    if (bersihkan.length) await svc.from("booking_requests").delete().in("id", bersihkan);
  });

  it("hanya permintaan berstatus menunggu milik klien yang ditampilkan", async () => {
    const varianYoga = await varianBaku(svc, SVC_YOGA);
    const { data: baris } = await svc.from("booking_requests").insert([
      { client_id: ANANDA, service_id: SVC_YOGA, variant_id: varianYoga, tanggal: "2026-12-18", preferensi_waktu: "pagi", status: "menunggu" },
      { client_id: ANANDA, service_id: SVC_YOGA, variant_id: varianYoga, tanggal: "2026-12-19", preferensi_waktu: "sore", status: "dikonfirmasi" },
      { client_id: RINA, service_id: SVC_YOGA, variant_id: varianYoga, tanggal: "2026-12-17", preferensi_waktu: "siang", status: "menunggu" },
    ]).select("id, tanggal, status");
    for (const b of baris ?? []) bersihkan.push(b.id);

    const { ambilPermintaanJadwal } = await import("@/lib/passport/data");
    const hasil = await ambilPermintaanJadwal(ANANDA);
    const tanggal = hasil.map((p) => p.tanggal);

    expect(tanggal).toContain("2026-12-18");
    expect(tanggal).not.toContain("2026-12-19"); // sudah dikonfirmasi
    expect(tanggal).not.toContain("2026-12-17"); // milik klien lain
    expect(hasil.every((p) => p.status === "menunggu")).toBe(true);

    const punya = hasil.find((p) => p.tanggal === "2026-12-18")!;
    expect(punya.namaLayanan).toBe("PADMA Flow Yoga - Prekonsepsi");
    expect(punya.preferensiWaktu).toBe("pagi");
  });
});

describe("pagar struktural lapisan data", () => {
  const sumber = readFileSync(
    resolve(__dirname, "../src/lib/passport/data.ts"),
    "utf8",
  );

  it("TIDAK memakai service role — RLS yang menjadi penjaga, bukan UI", () => {
    expect(sumber).not.toContain("createAdminSupabase");
    expect(sumber).not.toContain("SERVICE_ROLE");
  });

  it("TIDAK memakai cache lintas-permintaan (bisa membagikan data antar klien)", () => {
    expect(sumber).not.toContain("unstable_cache");
    expect(sumber).not.toMatch(/export\s+const\s+revalidate/);
  });

  it("query DAFTAR materi tidak pernah menyebut kolom isi atau url", () => {
    const daftar = sumber.slice(
      sumber.indexOf("export async function ambilDaftarMateri"),
      sumber.indexOf("export type MateriDetail"),
    );
    expect(daftar.length).toBeGreaterThan(0);
    expect(daftar).toContain("material_pages(halaman)");
    expect(daftar).not.toMatch(/material_pages\([^)]*objek/);
    expect(daftar).not.toMatch(/material_videos\([^)]*url/);
  });

  it("nama layanan TIDAK dibaca lagi lewat hint FK materials.service_id", () => {
    // Task 11 menghapus kolom `materials.service_id` beserta constraint FK
    // `materials_service_id_fkey`. Hint yang menyebut nama constraint itu
    // akan mematahkan query begitu kolomnya hilang — jadi baik daftar maupun
    // detail WAJIB membaca nama layanan lewat `material_services`, tidak
    // pernah lewat hint itu.
    //
    // Diperiksa pada STRING LITERAL (argumen `.select(...)` yang sungguhan
    // dikirim ke PostgREST), bukan pada seluruh berkas — komentar di atas
    // (dan di dalam sumbernya) SENGAJA menyebut nama hint lama itu memakai
    // backtick untuk menjelaskan alasannya, dan pemindaian seluruh berkas
    // akan salah menganggap komentar itu sendiri sebagai pelanggaran.
    const literal = [...sumber.matchAll(/"([^"\n]*)"/g)].map((m) => m[1]);
    expect(literal.some((s) => s.includes("services!"))).toBe(false);
    expect(literal.filter((s) => s.includes("material_services(service_id)")).length).toBe(2);
  });

  it("halaman detail diurutkan EKSPLISIT di JS, tidak mengandalkan urutan DB", () => {
    // Diikat pada SUMBER, bukan pada hasil query sungguhan: material_pages
    // punya primary key (material_id, halaman), jadi Postgres KEBETULAN sudah
    // mengembalikan barisnya menaik lewat scan indeks — menghapus `.sort(...)`
    // di `ambilMateriDetail` tidak akan mengubah urutan yang teramati test
    // integrasi mana pun selama planner tetap memilih index scan itu. Baris
    // ini yang membuktikan sortnya benar ADA, terlepas dari kebetulan itu
    // (pola sama seperti "urutan mengikat" di
    // tests/materi-route-halaman.test.ts, yang juga tidak bisa mengandalkan
    // observasi perilaku semata).
    expect(sumber).toMatch(
      /\[\.\.\.\(data\.material_pages\s*\?\?\s*\[\]\)\]\.sort\(\(a,\s*b\)\s*=>\s*a\.halaman\s*-\s*b\.halaman\)/,
    );
  });

  it("nama mitra digabung di JS, tidak lewat embed PostgREST ke view", () => {
    // Embed ke sebuah VIEW bergantung inferensi relasi yang tidak dijamin, dan
    // kegagalannya senyap (nama bidan jadi null, atau riwayat kosong tanpa error).
    expect(sumber).toContain('from("partner_publik")');
    expect(sumber).not.toMatch(/partner_publik\s*\(/);
  });
});
