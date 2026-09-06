/**
 * Modul Materi panel admin — metadata + isi yang tidak pernah terbit setengah
 * jadi, dan gating yang benar-benar menutup di lapisan basis data.
 *
 * Sejak Task 11, `material_chapters` & `materials.service_id` sudah dibongkar:
 * isi e-book adalah gambar halaman (`material_pages`, ditulis lewat RPC
 * `ganti_halaman_materi` dari `<PengunggahPdf/>`), dan satu materi boleh
 * menempel ke NOL ATAU LEBIH layanan lewat `material_services`. Cacat senyap
 * yang dijaga berkas ini, terverifikasi hidup sebelum modul ini lahir dan
 * tidak satu pun menghasilkan error:
 *
 *  1. MATERI SETENGAH JADI TERKUNCI PERMANEN. Materi bertipe `video` tanpa
 *     baris `material_videos` (atau `ebook` tanpa satu pun halaman) terkunci
 *     selamanya untuk SETIAP klien yang sebenarnya berhak — tanpa error — dan
 *     kartunya berbohong: "Terbuka setelah layanan terkait selesai", padahal
 *     layanannya sudah selesai. Karena itu materi LAHIR NONAKTIF, dan tidak
 *     ada jalan di modul ini yang bisa menerbitkan materi kosong. Untuk video
 *     isinya masih bisa disertakan di aksi PENCIPTAAN yang sama; untuk ebook
 *     TIDAK BISA (unggahan PDF butuh `materiId` yang belum ada), jadi materi
 *     ebook baru selalu nonaktif sampai halamannya diunggah lewat panel
 *     "Kelola isi" dan diterbitkan lewat aksi terpisah.
 *
 *  2. POLICY HALAMAN/VIDEO TIDAK MENGEVALUASI `materials.aktif`. Sebelum
 *     migration `gating_materi_hormati_aktif`, admin menonaktifkan materi dan
 *     klien TETAP membaca seluruh halamannya beserta URL videonya lewat
 *     PostgREST langsung — hanya kartunya yang hilang dari UI.
 *
 *  3. RADIUS TAUTAN LAYANAN TERKUNCI `material_id`. `gantiLayananMateri`
 *     menulis ulang `material_services` lewat hapus-lalu-sisip yang
 *     radiusnya terikat parameter WAJIB — bukan filter yang bisa dibuat
 *     tautologis. Repo ini pernah kehilangan SELURUH bab materi lewat satu
 *     filter longgar (`?urutan=gte.0`); describe "radius tautan layanan"
 *     membuktikan materi SAUDARA tidak ikut tersapu saat satu materi diubah.
 *
 *  4. `material_videos` pada embed PostgREST adalah OBJEK atau `null`, BUKAN
 *     array. `video.length === 0` selalu salah dan membuat setiap materi video
 *     tampak terkunci.
 *
 * Data uji berprefiks `PAD-UJI` dan dibersihkan `afterAll`. Materi seed tidak
 * pernah disentuh: `passport-materi.test.ts` menghitung kartunya secara persis.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { querySql } from "./helpers/db";
import { MATERI_VIDEO_TERBUKA, MATERI_VIDEO_TERKUNCI } from "./helpers/materi-video-fixture";

const admin = createAdminSupabase();
const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

// Layanan 1101 Sankalpa Fertility Massage — Ananda punya sesi `selesai`, jadi
// materi di layanan inilah yang membuktikan gating benar-benar menutup.
const SVC_TERBUKA = "11111111-1111-1111-1111-111111111101";
// Layanan 1106 Lactation Hero — Ananda tidak pernah menjalaninya.
const SVC_TERKUNCI = "11111111-1111-1111-1111-111111111106";
// Layanan 1102 PADMA Flow Yoga — dipakai murni sebagai layanan KEDUA pada
// pengujian "materi boleh menempel ke lebih dari satu layanan".
const SVC_KEDUA = "11111111-1111-1111-1111-111111111102";
const TAK_ADA_SVC = "11111111-1111-1111-1111-1111111119ff";

const MATERI_EBOOK = "77777777-7777-7777-7777-7777777779a1";
const MATERI_VIDEO = "77777777-7777-7777-7777-7777777779a2";
const MATERI_KOSONG = "77777777-7777-7777-7777-7777777779a3";
const TAK_ADA_MATERI = "77777777-7777-7777-7777-7777777779ff";

// Bentuk kunci objek R2 sah (Task 6, constraint `material_videos_bentuk_objek`):
// diikat pada MATERI_VIDEO sendiri, bukan URL — nama konstanta ini dulu
// "URL_UJI" sebelum medan URL dibongkar Task 6.
const OBJEK_UJI = `${MATERI_VIDEO}/pad-uji-materi-9a02.mp4`;

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

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NOTFOUND");
  },
  usePathname: () => "/admin/materi",
}));

const {
  simpanMateri,
  perbaruiMateri,
  aktifkanMateri,
  nonaktifkanMateri,
  lepasVideo,
} = await import("@/app/admin/materi/aksi");
const { daftarMateriAdmin, TANPA_LAYANAN_ID } = await import("@/lib/admin/materi-admin");
const { default: MateriPage } = await import("@/app/admin/materi/page");

const sumberAksi = baca("src/app/admin/materi/aksi.ts");
const sumberHalaman = baca("src/app/admin/materi/page.tsx");
const sumberForm = baca("src/app/admin/materi/form-materi.tsx");
const sumberStatus = baca("src/app/admin/materi/status.ts");
const sumberLib = baca("src/lib/admin/materi-admin.ts");
const SEMUA_SUMBER = [sumberAksi, sumberHalaman, sumberForm, sumberStatus, sumberLib];

let sesiAdmin: SupabaseClient;
let sesiKlien: SupabaseClient;

/** `v` boleh string tunggal atau array — array dikirim sebagai medan berulang (checkbox `service_id`). */
function formulir(isi: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(isi)) {
    for (const nilai of Array.isArray(v) ? v : [v]) fd.append(k, nilai);
  }
  return fd;
}

async function barisMateri(id: string) {
  const { data } = await admin
    .from("materials")
    .select("id, judul, tipe, deskripsi, aktif")
    .eq("id", id)
    .maybeSingle<{
      id: string;
      judul: string;
      tipe: string;
      deskripsi: string;
      aktif: boolean;
    }>();
  return data;
}

async function layananMateri(materiId: string): Promise<string[]> {
  const { data } = await admin
    .from("material_services")
    .select("service_id")
    .eq("material_id", materiId);
  return (data ?? []).map((r) => r.service_id as string).sort();
}

async function halamanMateri(materiId: string) {
  const { data } = await admin
    .from("material_pages")
    .select("halaman, objek")
    .eq("material_id", materiId)
    .order("halaman");
  return (data ?? []) as Array<{ halaman: number; objek: string }>;
}

async function videoMateri(materiId: string) {
  const { data } = await admin
    .from("material_videos")
    .select("material_id, objek")
    .eq("material_id", materiId)
    .maybeSingle<{ material_id: string; objek: string }>();
  return data;
}

async function jumlahMateri(): Promise<number> {
  const { count } = await admin
    .from("materials")
    .select("id", { count: "exact", head: true });
  return count ?? 0;
}

/**
 * Materi video baru, lahir lewat `simpanMateri` — TANPA isi, sama seperti
 * materi e-book baru diuji langsung lewat `simpanMateri` di atas. Video kini
 * diunggah terpisah lewat `PengunggahVideo` sesudah materiId ini ada, jadi
 * helper ini tidak (dan tidak bisa) menyertakan isi apa pun.
 */
async function buatMateriVideo(): Promise<string> {
  const hasil = await simpanMateri(
    formulir({
      judul: "PAD-UJI Video Baru Tanpa Isi",
      tipe: "video",
      deskripsi: "",
      service_id: [SVC_TERKUNCI],
    }),
  );
  if (!hasil.ok) throw new Error(`buatMateriVideo gagal: ${hasil.pesan}`);
  return hasil.id;
}

async function bersihkan() {
  // Urutan ditulis eksplisit walau `on delete cascade` sudah menanganinya:
  // pembersihan yang mengandalkan cascade diam-diam berhenti bekerja begitu
  // sebuah FK diubah, dan sisanya baru terlihat beberapa run kemudian.
  const semua = [MATERI_EBOOK, MATERI_VIDEO, MATERI_KOSONG];
  await admin.from("material_videos").delete().in("material_id", semua);
  await admin.from("material_pages").delete().in("material_id", semua);
  await admin.from("material_services").delete().in("material_id", semua);
  await admin.from("materials").delete().in("id", semua);
  // Materi yang lahir dari action di berkas ini (id-nya digenerate basis data).
  const { data: sisa } = await admin
    .from("materials")
    .select("id")
    .like("judul", "PAD-UJI%");
  const idSisa = (sisa ?? []).map((m) => m.id as string);
  if (idSisa.length > 0) {
    await admin.from("material_videos").delete().in("material_id", idSisa);
    await admin.from("material_pages").delete().in("material_id", idSisa);
    await admin.from("material_services").delete().in("material_id", idSisa);
    await admin.from("materials").delete().in("id", idSisa);
  }
}

async function pasangFixture() {
  await admin.from("materials").insert([
    {
      id: MATERI_EBOOK,
      judul: "PAD-UJI E-Book Materi",
      tipe: "ebook",
      deskripsi: "fixture e-book",
      aktif: true,
    },
    {
      id: MATERI_VIDEO,
      judul: "PAD-UJI Video Materi",
      tipe: "video",
      deskripsi: "fixture video",
      aktif: true,
    },
    {
      // Materi setengah jadi yang SENGAJA dibuat lewat service role: modul ini
      // tidak boleh punya satu pun jalan untuk melahirkannya.
      id: MATERI_KOSONG,
      judul: "PAD-UJI Materi Tanpa Isi",
      tipe: "ebook",
      deskripsi: "fixture tanpa isi",
      aktif: false,
    },
  ]);
  // migration 20260831100000: material_services join table diperlukan untuk RLS gating
  await admin.from("material_services").insert([
    { material_id: MATERI_EBOOK, service_id: SVC_TERBUKA },
    { material_id: MATERI_VIDEO, service_id: SVC_TERBUKA },
    { material_id: MATERI_KOSONG, service_id: SVC_TERBUKA },
  ]);
  await admin.rpc("ganti_halaman_materi", {
    p_material_id: MATERI_EBOOK,
    p_halaman: [
      { halaman: 1, objek: `${MATERI_EBOOK}/0001.webp`, lebar: 10, tinggi: 10 },
      { halaman: 2, objek: `${MATERI_EBOOK}/0002.webp`, lebar: 10, tinggi: 10 },
      { halaman: 3, objek: `${MATERI_EBOOK}/0003.webp`, lebar: 10, tinggi: 10 },
    ],
  });
  await admin.from("material_videos").insert({ material_id: MATERI_VIDEO, objek: OBJEK_UJI });
}

beforeAll(async () => {
  await bersihkan();
  sesiAdmin = await signInAs("admin@padma.test");
  sesiKlien = await signInAs("ananda@padma.test");
  ref.sesi = sesiAdmin;
  await pasangFixture();
});

afterAll(bersihkan);

beforeEach(() => {
  ref.sesi = sesiAdmin;
  jejak.revalidate.length = 0;
});

// ---------------------------------------------------------------------------
// Lapisan data
// ---------------------------------------------------------------------------

describe("daftarMateriAdmin — materi dikelompokkan di bawah layanannya", () => {
  it("memuat materi aktif MAUPUN nonaktif (kelola ≠ daftar klien)", async () => {
    const daftar = await daftarMateriAdmin();
    const semua = daftar.flatMap((l) => l.materi);
    expect(semua.map((m) => m.id)).toContain(MATERI_EBOOK);
    // Tanpa ini, satu klik salah menonaktifkan materi selamanya dari panel:
    // tidak ada satu pun layar yang bisa menghidupkannya kembali.
    expect(semua.map((m) => m.id)).toContain(MATERI_KOSONG);
    expect(semua.find((m) => m.id === MATERI_KOSONG)!.aktif).toBe(false);
  });

  it("materi menempel pada layanan asalnya, lengkap dengan namanya", async () => {
    const daftar = await daftarMateriAdmin();
    const layanan = daftar.find((l) => l.id === SVC_TERBUKA)!;
    expect(layanan.nama).toBe("Sankalpa Fertility Massage");
    expect(layanan.materi.map((m) => m.id)).toContain(MATERI_EBOOK);
  });

  it("membawa jumlah halaman e-book dan URL video sebagai OBJEK, bukan array", async () => {
    const daftar = await daftarMateriAdmin();
    const semua = daftar.flatMap((l) => l.materi);
    const ebook = semua.find((m) => m.id === MATERI_EBOOK)!;
    expect(ebook.jumlahHalaman).toBe(3);
    expect(ebook.objekVideo).toBeNull();

    const video = semua.find((m) => m.id === MATERI_VIDEO)!;
    // `material_videos` berelasi 1:1 — `video.length === 0` selalu salah dan
    // akan membuat setiap materi video tampak belum punya isi.
    expect(video.objekVideo).toBe(OBJEK_UJI);
    expect(Array.isArray(video.objekVideo)).toBe(false);
    expect(video.jumlahHalaman).toBe(0);
  });

  it("menandai materi yang isinya BELUM lengkap — kartu tidak boleh berbohong", async () => {
    const daftar = await daftarMateriAdmin();
    const semua = daftar.flatMap((l) => l.materi);
    expect(semua.find((m) => m.id === MATERI_EBOOK)!.lengkap).toBe(true);
    expect(semua.find((m) => m.id === MATERI_VIDEO)!.lengkap).toBe(true);
    expect(semua.find((m) => m.id === MATERI_KOSONG)!.lengkap).toBe(false);
  });

  it("satu materi boleh muncul di bawah LEBIH dari satu kelompok layanan", async () => {
    // Headline perubahan Task 11: materials.service_id (satu materi, satu
    // layanan) sudah diganti material_services (banyak-ke-banyak).
    const { error } = await admin
      .from("material_services")
      .insert({ material_id: MATERI_EBOOK, service_id: SVC_KEDUA });
    expect(error).toBeNull();
    try {
      const daftar = await daftarMateriAdmin();
      const terbuka = daftar.find((l) => l.id === SVC_TERBUKA)!;
      const kedua = daftar.find((l) => l.id === SVC_KEDUA)!;
      expect(terbuka.materi.map((m) => m.id)).toContain(MATERI_EBOOK);
      expect(kedua.materi.map((m) => m.id)).toContain(MATERI_EBOOK);
      const ebookDiKedua = kedua.materi.find((m) => m.id === MATERI_EBOOK)!;
      expect(ebookDiKedua.layananId.slice().sort()).toEqual(
        [SVC_TERBUKA, SVC_KEDUA].sort(),
      );
    } finally {
      await admin
        .from("material_services")
        .delete()
        .eq("material_id", MATERI_EBOOK)
        .eq("service_id", SVC_KEDUA);
    }
  });

  it("materi TANPA layanan sama sekali muncul di kelompok sentinel 'Tanpa layanan'", async () => {
    const { data: yatim } = await admin
      .from("materials")
      .insert({ judul: "PAD-UJI Materi Yatim Layanan", tipe: "ebook", deskripsi: "", aktif: false })
      .select("id")
      .single();
    try {
      const daftar = await daftarMateriAdmin();
      const sentinel = daftar.find((l) => l.id === TANPA_LAYANAN_ID)!;
      expect(sentinel.nama).toBe("Tanpa layanan");
      expect(sentinel.materi.map((m) => m.id)).toContain(yatim!.id);
      expect(sentinel.materi.find((m) => m.id === yatim!.id)!.layananId).toEqual([]);
      // Dan TIDAK muncul di kelompok layanan sungguhan mana pun.
      for (const l of daftar) {
        if (l.id === TANPA_LAYANAN_ID) continue;
        expect(l.materi.map((m) => m.id)).not.toContain(yatim!.id);
      }
      // Arah sebaliknya: materi yang MEMANG bertaut (MATERI_EBOOK -> SVC_TERBUKA
      // dari fixture) tidak boleh IKUT nyasar ke sentinel ini. Tanpa baris ini,
      // filter sentinel yang salah (mis. "panjang >= 0" alih-alih "=== 0") tetap
      // lolos: bucket sentinel akan diam-diam memuat SETIAP materi, bukan hanya
      // yang yatim, dan tidak satu assertion di atas yang menangkapnya.
      expect(sentinel.materi.map((m) => m.id)).not.toContain(MATERI_EBOOK);
    } finally {
      await admin.from("materials").delete().eq("id", yatim!.id);
    }
  });

  it("dibaca lewat sesi pengguna: klien tidak melihat isi materi terkunci", async () => {
    // Bila lapisan ini memakai service role, seluruh halaman & URL tetap
    // keluar untuk siapa pun dan RLS tidak pernah ikut diperiksa.
    ref.sesi = sesiKlien;
    const daftar = await daftarMateriAdmin();
    const semua = daftar.flatMap((l) => l.materi);
    const terkunci = semua.find(
      (m) => m.id === "77777777-7777-7777-7777-777777777703",
    );
    expect(terkunci?.objekVideo ?? null).toBeNull();
    expect(JSON.stringify(daftar)).not.toContain("RAHASIA-123");
  });
});

// ---------------------------------------------------------------------------
// PAGAR UTAMA 1: materi tidak pernah terbit setengah jadi
// ---------------------------------------------------------------------------

describe("simpanMateri — materi tidak pernah terbit setengah jadi", () => {
  it("e-book baru lahir NONAKTIF tanpa isi — unggahannya menyusul lewat panel", async () => {
    // Ini bentuk baru dari pagar lama: dulu (bab teks) e-book TANPA isi
    // ditolak SEKETIKA di aksi ini. Sejak isi e-book adalah unggahan PDF yang
    // butuh materiId (belum ada pada langkah "materi baru"), aksinya TIDAK
    // BISA lagi menuntut isi di permintaan yang sama — jadi pagarnya bergeser
    // ke fail-closed di sisi lain: materi tetap lahir, tapi SELALU nonaktif,
    // dan aktifkanMateri (diuji terpisah di bawah) menolak menerbitkannya.
    const hasil = await simpanMateri(
      formulir({
        judul: "PAD-UJI E-Book Baru Tanpa Isi",
        tipe: "ebook",
        deskripsi: "",
        service_id: [SVC_TERKUNCI],
      }),
    );
    expect(hasil.ok).toBe(true);
    if (!hasil.ok) return;

    expect(await barisMateri(hasil.id)).toMatchObject({
      judul: "PAD-UJI E-Book Baru Tanpa Isi",
      tipe: "ebook",
      aktif: false,
    });
    expect(await halamanMateri(hasil.id)).toHaveLength(0);

    const tolak = await aktifkanMateri(hasil.id);
    expect(tolak.ok).toBe(false);
  });

  it("materi boleh lahir TANPA layanan sama sekali", async () => {
    const hasil = await simpanMateri(
      formulir({ judul: "PAD-UJI Tanpa Layanan Sekali", tipe: "ebook", deskripsi: "" }),
    );
    expect(hasil.ok).toBe(true);
    if (!hasil.ok) return;
    expect(await layananMateri(hasil.id)).toEqual([]);
  });

  it("materi boleh lahir menempel ke LEBIH dari satu layanan sekaligus", async () => {
    const hasil = await simpanMateri(
      formulir({
        judul: "PAD-UJI Video Dua Layanan",
        tipe: "video",
        deskripsi: "",
        service_id: [SVC_TERKUNCI, SVC_KEDUA],
      }),
    );
    expect(hasil.ok).toBe(true);
    if (!hasil.ok) return;
    expect(await layananMateri(hasil.id)).toEqual([SVC_KEDUA, SVC_TERKUNCI].sort());
  });

  it("materi video baru lahir TANPA isi dan karena itu nonaktif", async () => {
    // Video kini diunggah terpisah ke R2 sesudah materinya ada, jadi tidak ada
    // lagi jalur "materi video langsung berisi" saat pendaftaran.
    const id = await buatMateriVideo();          // helper yang sudah ada di berkas ini
    const isi = await querySql<{ n: number }>(
      `select count(*)::int as n from public.material_videos where material_id = '${id}'`,
    );
    expect(isi[0].n).toBe(0);
    expect((await barisMateri(id))!.aktif).toBe(false);

    const tolak = await aktifkanMateri(id);
    expect(tolak.ok).toBe(false);
  });

  it("menolak layanan yang tidak ada tanpa menyentuh basis data", async () => {
    const sebelum = await jumlahMateri();
    const hasil = await simpanMateri(
      formulir({
        service_id: TAK_ADA_SVC,
        judul: "PAD-UJI Materi Yatim",
        tipe: "ebook",
        deskripsi: "",
      }),
    );
    expect(hasil.ok).toBe(false);
    if (hasil.ok) return;
    expect(hasil.pesan).toMatch(/layanan/i);
    expect(await jumlahMateri()).toBe(sebelum);
  });

  it("menolak tipe di luar daftar putih", async () => {
    const hasil = await simpanMateri(
      formulir({
        service_id: SVC_TERBUKA,
        judul: "PAD-UJI Tipe Karangan",
        tipe: "podcast",
        deskripsi: "",
      }),
    );
    expect(hasil.ok).toBe(false);
  });

  it("menyegarkan daftar materi klien, bukan hanya halaman admin", async () => {
    await simpanMateri(
      formulir({
        service_id: SVC_TERKUNCI,
        judul: "PAD-UJI Materi Revalidate",
        tipe: "ebook",
        deskripsi: "",
      }),
    );
    for (const p of ["/admin/materi", "/passport/materi"]) {
      expect(jejak.revalidate, `lupa merevalidasi ${p}`).toContain(p);
    }
  });

  it("PENJAGA PERAN: klien yang login tidak bisa memanggil action ini", async () => {
    ref.sesi = sesiKlien;
    await expect(
      simpanMateri(
        formulir({
          service_id: SVC_TERBUKA,
          judul: "PAD-UJI Dari Klien",
          tipe: "ebook",
          deskripsi: "",
        }),
      ),
    ).rejects.toThrow(/REDIRECT/);

    const { data } = await admin
      .from("materials")
      .select("id")
      .eq("judul", "PAD-UJI Dari Klien");
    expect(data ?? []).toHaveLength(0);
  });
});

describe("perbaruiMateri — mengubah tipe wajib disertai isinya", () => {
  it("mengubah judul & deskripsi tanpa menyentuh keadaan aktif ataupun layanannya", async () => {
    const hasil = await perbaruiMateri(
      MATERI_EBOOK,
      formulir({
        service_id: SVC_TERBUKA, // TIDAK berubah — beberapa test di berkas ini bergantung padanya
        judul: "PAD-UJI E-Book Materi Baru",
        tipe: "ebook",
        deskripsi: "deskripsi baru",
        aktif: "false", // diselundupkan lewat FormData — wajib diabaikan
      }),
    );
    expect(hasil.ok).toBe(true);
    expect(await barisMateri(MATERI_EBOOK)).toMatchObject({
      judul: "PAD-UJI E-Book Materi Baru",
      deskripsi: "deskripsi baru",
      aktif: true,
    });
    expect(await layananMateri(MATERI_EBOOK)).toEqual([SVC_TERBUKA]);
  });

  it("ebook → video TANPA isi ditolak, dan tipenya TIDAK berubah", async () => {
    // Inilah bentuk paling halus dari materi setengah jadi: tipe berpindah,
    // isinya tidak ikut, dan seluruh klien melihat kartu terkunci selamanya.
    // MATERI_EBOOK tidak punya baris material_videos sama sekali, jadi
    // `punyaIsi(id, "video")` menjawab false persis seperti arah sebaliknya.
    const hasil = await perbaruiMateri(
      MATERI_EBOOK,
      formulir({
        service_id: SVC_TERBUKA,
        judul: "PAD-UJI E-Book Materi Baru",
        tipe: "video",
        deskripsi: "deskripsi baru",
      }),
    );
    expect(hasil.ok).toBe(false);
    expect((await barisMateri(MATERI_EBOOK))!.tipe).toBe("ebook");
    expect(await videoMateri(MATERI_EBOOK)).toBeNull();
  });

  it("video → ebook TANPA halaman ditolak, dan tipenya TIDAK berubah", async () => {
    const hasil = await perbaruiMateri(
      MATERI_VIDEO,
      formulir({
        service_id: SVC_TERBUKA,
        judul: "PAD-UJI Video Materi",
        tipe: "ebook",
        deskripsi: "",
      }),
    );
    expect(hasil.ok).toBe(false);
    if (!hasil.ok) expect(hasil.pesan).toMatch(/e-book|pdf/i);
    expect((await barisMateri(MATERI_VIDEO))!.tipe).toBe("video");
  });

  it("video → ebook DITERIMA ketika materi itu SENDIRI sudah punya halaman tersisa", async () => {
    // Isi e-book tidak bisa disertakan di aksi ini (butuh materiId untuk
    // mengunggah), jadi perpindahan TIDAK menuntut isi baru — ia menuntut
    // BUKTI bahwa materiId ini sendiri sudah punya halaman, entah dari
    // unggahan lewat panel "Kelola isi" SEBELUM formulir ini disimpan, atau
    // sisa dari saat tipenya dulu ebook.
    const { data: m } = await admin
      .from("materials")
      .insert({ judul: "PAD-UJI Video Jadi Ebook", tipe: "video", deskripsi: "", aktif: false })
      .select("id")
      .single();
    const id = m!.id as string;
    try {
      await admin.rpc("ganti_halaman_materi", {
        p_material_id: id,
        p_halaman: [{ halaman: 1, objek: `${id}/0001.webp`, lebar: 5, tinggi: 5 }],
      });
      const hasil = await perbaruiMateri(
        id,
        formulir({ judul: "PAD-UJI Video Jadi Ebook", tipe: "ebook", deskripsi: "" }),
      );
      expect(hasil.ok).toBe(true);
      expect((await barisMateri(id))!.tipe).toBe("ebook");
    } finally {
      await admin.from("materials").delete().eq("id", id);
    }
  });

  it("ebook → video DITERIMA ketika materi itu SENDIRI sudah punya video tersisa", async () => {
    // Video kini isinya berkas R2 yang diunggah lewat PengunggahVideo — tidak
    // bisa disertakan LANGSUNG di aksi ini (sama seperti ebook, lihat test
    // "video → ebook DITERIMA" di atas untuk pola yang sama pada arah
    // sebaliknya). Baris `material_videos` disiapkan LANGSUNG di sini untuk
    // mensimulasikan "sudah diunggah admin lewat panel Kelola isi SEBELUM
    // formulir ini disimpan".
    await admin.from("material_videos").insert({
      material_id: MATERI_KOSONG,
      objek: `${MATERI_KOSONG}/pad-uji-sisa.mp4`,
      mime: "video/mp4",
    });
    const hasil = await perbaruiMateri(
      MATERI_KOSONG,
      formulir({
        service_id: SVC_TERBUKA,
        judul: "PAD-UJI Materi Tanpa Isi",
        tipe: "video",
        deskripsi: "",
      }),
    );
    expect(hasil.ok).toBe(true);
    expect((await barisMateri(MATERI_KOSONG))!.tipe).toBe("video");
    expect(await videoMateri(MATERI_KOSONG)).not.toBeNull();

    // Dikembalikan supaya blok berikutnya tetap berangkat dari materi kosong.
    await admin.from("material_videos").delete().eq("material_id", MATERI_KOSONG);
    await admin.from("materials").update({ tipe: "ebook" }).eq("id", MATERI_KOSONG);
  });

  it("id yang tidak ada ditolak, bukan 'ok' palsu", async () => {
    const hasil = await perbaruiMateri(
      TAK_ADA_MATERI,
      formulir({
        service_id: SVC_TERBUKA,
        judul: "PAD-UJI Hantu",
        tipe: "ebook",
        deskripsi: "",
      }),
    );
    expect(hasil.ok).toBe(false);
  });

  it("menolak layanan yang tidak ada, tautan lama materinya TIDAK berubah", async () => {
    const sebelum = await layananMateri(MATERI_EBOOK);
    const hasil = await perbaruiMateri(
      MATERI_EBOOK,
      formulir({
        service_id: [SVC_TERBUKA, TAK_ADA_SVC],
        judul: "PAD-UJI E-Book Materi Baru",
        tipe: "ebook",
        deskripsi: "deskripsi baru",
      }),
    );
    expect(hasil.ok).toBe(false);
    if (hasil.ok) return;
    expect(hasil.pesan).toMatch(/layanan/i);
    expect(await layananMateri(MATERI_EBOOK)).toEqual(sebelum);
  });

  it("PENJAGA PERAN: klien yang login tidak bisa memanggil action ini", async () => {
    ref.sesi = sesiKlien;
    await expect(
      perbaruiMateri(
        MATERI_EBOOK,
        formulir({
          service_id: SVC_TERBUKA,
          judul: "PAD-UJI Direbut Klien",
          tipe: "ebook",
          deskripsi: "",
        }),
      ),
    ).rejects.toThrow(/REDIRECT/);
    expect((await barisMateri(MATERI_EBOOK))!.judul).toBe("PAD-UJI E-Book Materi Baru");
  });
});

// ---------------------------------------------------------------------------
// PAGAR UTAMA 3: radius tautan layanan terkunci material_id
// ---------------------------------------------------------------------------

describe("radius tautan layanan: mengubah satu materi tidak menyapu materi saudara", () => {
  let materiA = "";
  let materiB = "";

  beforeAll(async () => {
    const [{ data: a }, { data: b }] = await Promise.all([
      admin
        .from("materials")
        .insert({ judul: "PAD-UJI Radius A", tipe: "ebook", deskripsi: "", aktif: false })
        .select("id")
        .single(),
      admin
        .from("materials")
        .insert({ judul: "PAD-UJI Radius B", tipe: "ebook", deskripsi: "", aktif: false })
        .select("id")
        .single(),
    ]);
    materiA = a!.id as string;
    materiB = b!.id as string;
    await admin.from("material_services").insert([
      { material_id: materiA, service_id: SVC_TERBUKA },
      { material_id: materiB, service_id: SVC_TERKUNCI },
    ]);
  });

  afterAll(async () => {
    await admin.from("materials").delete().in("id", [materiA, materiB]);
  });

  it("gantiLayananMateri (lewat perbaruiMateri) hanya menyentuh materiId yang diminta", async () => {
    const hasil = await perbaruiMateri(
      materiA,
      formulir({
        service_id: [SVC_KEDUA],
        judul: "PAD-UJI Radius A",
        tipe: "ebook",
        deskripsi: "",
      }),
    );
    expect(hasil.ok).toBe(true);
    expect(await layananMateri(materiA)).toEqual([SVC_KEDUA]);
    // Materi SAUDARA (tautan layanan lain, dibuat pada permintaan yang
    // berbeda) tidak boleh ikut tersapu — kelas bug persis `?urutan=gte.0`
    // yang menjadi alasan pola hapus-lalu-sisip ini terikat parameter.
    expect(await layananMateri(materiB)).toEqual([SVC_TERKUNCI]);
  });
});

describe("aktifkanMateri menolak menerbitkan materi kosong", () => {
  it("materi tanpa isi TIDAK bisa diaktifkan — kartunya akan berbohong", async () => {
    expect((await barisMateri(MATERI_KOSONG))!.aktif).toBe(false);
    const hasil = await aktifkanMateri(MATERI_KOSONG);
    expect(hasil.ok).toBe(false);
    if (hasil.ok) return;
    expect(hasil.pesan).toMatch(/isi/i);
    expect((await barisMateri(MATERI_KOSONG))!.aktif).toBe(false);
  });

  it("materi yang isinya lengkap bisa dinonaktifkan lalu diaktifkan kembali", async () => {
    expect((await nonaktifkanMateri(MATERI_VIDEO)).ok).toBe(true);
    expect((await barisMateri(MATERI_VIDEO))!.aktif).toBe(false);
    expect((await aktifkanMateri(MATERI_VIDEO)).ok).toBe(true);
    expect((await barisMateri(MATERI_VIDEO))!.aktif).toBe(true);
  });

  it("id yang tidak ada ditolak, bukan 'ok' palsu", async () => {
    expect((await nonaktifkanMateri(TAK_ADA_MATERI)).ok).toBe(false);
    expect((await aktifkanMateri(TAK_ADA_MATERI)).ok).toBe(false);
  });

  it("PENJAGA PERAN: klien yang login tidak bisa menonaktifkan materi", async () => {
    ref.sesi = sesiKlien;
    await expect(nonaktifkanMateri(MATERI_EBOOK)).rejects.toThrow(/REDIRECT/);
    expect((await barisMateri(MATERI_EBOOK))!.aktif).toBe(true);
  });

  it("keadaan tujuan HARDCODED di dalam action, tidak pernah jadi parameter", () => {
    expect(sumberAksi).toMatch(/aktif:\s*true/);
    expect(sumberAksi).toMatch(/aktif:\s*false/);
    for (const pola of [
      /function\s+\w+\([^)]*aktif\s*:\s*boolean/,
      /function\s+\w+\([^)]*status\s*:/,
    ]) {
      expect(sumberAksi).not.toMatch(pola);
    }
  });
});

// ---------------------------------------------------------------------------
// PAGAR UTAMA 2: nonaktif benar-benar menutup isinya di lapisan basis data
// ---------------------------------------------------------------------------

describe("menonaktifkan materi MENUTUP isinya untuk klien, bukan menyembunyikannya", () => {
  afterAll(async () => {
    await admin.from("materials").update({ aktif: true }).in("id", [MATERI_EBOOK, MATERI_VIDEO]);
  });

  it("klien membaca halaman & URL selama materi masih aktif (alur sah tidak rusak)", async () => {
    const halaman = await sesiKlien
      .from("material_pages")
      .select("halaman")
      .eq("material_id", MATERI_EBOOK);
    expect(halaman.error).toBeNull();
    expect(halaman.data ?? []).toHaveLength(3);

    const video = await sesiKlien
      .from("material_videos")
      .select("objek")
      .eq("material_id", MATERI_VIDEO);
    expect(video.data ?? []).toHaveLength(1);
  });

  it("sesudah dinonaktifkan, klien TIDAK bisa lagi membaca halamannya lewat REST langsung", async () => {
    ref.sesi = sesiAdmin;
    expect((await nonaktifkanMateri(MATERI_EBOOK)).ok).toBe(true);

    // Bukan "hilang dari UI" — hilang dari jawaban PostgREST itu sendiri.
    const { data, error } = await sesiKlien
      .from("material_pages")
      .select("halaman, objek")
      .eq("material_id", MATERI_EBOOK);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
    expect(JSON.stringify(data)).not.toContain(`${MATERI_EBOOK}/0001.webp`);
  });

  it("sesudah dinonaktifkan, URL videonya pun tidak lagi terbaca klien", async () => {
    ref.sesi = sesiAdmin;
    expect((await nonaktifkanMateri(MATERI_VIDEO)).ok).toBe(true);

    const { data, error } = await sesiKlien
      .from("material_videos")
      .select("objek")
      .eq("material_id", MATERI_VIDEO);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
    expect(JSON.stringify(data)).not.toContain(OBJEK_UJI);

    // Embed pun ikut tertutup — jalur yang dipakai halaman daftar materi.
    const embed = await sesiKlien
      .from("materials")
      .select("id, material_videos(objek)")
      .eq("id", MATERI_VIDEO);
    expect(JSON.stringify(embed.data)).not.toContain(OBJEK_UJI);
  });

  it("metadata materi TETAP terbaca klien — yang ditutup isinya, bukan barisnya", async () => {
    // Pagar arah sebaliknya: menutup baris `materials` akan mengulangi bug
    // `partner_publik` (nama hilang dari layar lain tanpa satu pun error).
    const { data, error } = await sesiKlien
      .from("materials")
      .select("id, judul")
      .eq("id", MATERI_EBOOK);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("admin TETAP bisa membaca isi materi nonaktif — kalau tidak, ia tak bisa memperbaikinya", async () => {
    const { data } = await sesiAdmin
      .from("material_pages")
      .select("halaman")
      .eq("material_id", MATERI_EBOOK);
    expect(data ?? []).toHaveLength(3);
  });

  it("diaktifkan kembali, isinya terbaca klien lagi", async () => {
    ref.sesi = sesiAdmin;
    expect((await aktifkanMateri(MATERI_EBOOK)).ok).toBe(true);
    const { data } = await sesiKlien
      .from("material_pages")
      .select("halaman")
      .eq("material_id", MATERI_EBOOK);
    expect(data ?? []).toHaveLength(3);
  });
});

describe("mengelola video materi", () => {
  // gantiVideo (Task 6: mengganti URL video lewat aksi ini) sudah dibongkar —
  // menggantikan video kini lewat `PengunggahVideo`/`catatVideoMateri`
  // (`./unggah-video.ts`), diuji terpisah di `tests/materi-video-aksi.test.ts`.
  // Yang tersisa di sini adalah `lepasVideo`, yang tidak pernah bergantung
  // pada URL.

  it("lepasVideo DITOLAK selama materinya masih aktif", async () => {
    expect((await barisMateri(MATERI_VIDEO))!.aktif).toBe(true);
    const hasil = await lepasVideo(MATERI_VIDEO);
    expect(hasil.ok).toBe(false);
    if (hasil.ok) return;
    expect(hasil.pesan).toMatch(/nonaktif/i);
    expect(await videoMateri(MATERI_VIDEO)).not.toBeNull();
  });

  it("lepasVideo lewat RPC berhasil sesudah materinya dinonaktifkan", async () => {
    expect((await nonaktifkanMateri(MATERI_VIDEO)).ok).toBe(true);
    const hasil = await lepasVideo(MATERI_VIDEO);
    expect(hasil.ok).toBe(true);
    expect(await videoMateri(MATERI_VIDEO)).toBeNull();

    // Dan materinya kini tidak bisa diterbitkan kembali tanpa isi.
    expect((await aktifkanMateri(MATERI_VIDEO)).ok).toBe(false);

    // Dikembalikan untuk blok berikutnya.
    await admin.from("material_videos").insert({ material_id: MATERI_VIDEO, objek: OBJEK_UJI });
    await admin.from("materials").update({ aktif: true }).eq("id", MATERI_VIDEO);
  });

  it("PENJAGA PERAN: klien yang login tidak bisa melepas video materi", async () => {
    ref.sesi = sesiKlien;
    await expect(lepasVideo(MATERI_VIDEO)).rejects.toThrow(/REDIRECT/);
    expect((await videoMateri(MATERI_VIDEO))!.objek).toBe(OBJEK_UJI);
  });
});

// ---------------------------------------------------------------------------
// Invarian menyeluruh
// ---------------------------------------------------------------------------

describe("invarian: tidak ada satu pun materi AKTIF tanpa isi", () => {
  it("setiap materi aktif punya halaman (ebook) atau URL video (video)", async () => {
    const { data: materi } = await admin
      .from("materials")
      .select("id, judul, tipe")
      .eq("aktif", true);
    const { data: halaman } = await admin.from("material_pages").select("material_id");
    const { data: video } = await admin.from("material_videos").select("material_id");

    const punyaHalaman = new Set((halaman ?? []).map((h) => h.material_id as string));
    const punyaVideo = new Set((video ?? []).map((v) => v.material_id as string));

    // Materi video demo (…701 terbuka, …703 terkunci) HANYA lengkap di sini
    // karena tests/global-setup.ts menyemai baris material_videos-nya SEKALI
    // sebelum berkas test mana pun berjalan — `supabase/seed.sql` sendiri
    // SENGAJA mengosongkan baris ini sejak migrasi objek-R2 (spec §13b A-6).
    //
    // `supabase/seed.sql` juga menyemai KEDUANYA `aktif = false` (fix F4,
    // video-r2 fix wave) — sebelum fix ini, seed membiarkan `aktif` di nilai
    // bawaan (`true`) tanpa isi, dan `npx supabase db reset && npm run dev`
    // TANPA vitest membuat Ananda (berhak atas …701 lewat sesi `selesai`-nya)
    // adalah pasien pertama yang mendapati pemutar rusak — persis pelanggaran
    // yang invarian ini ada untuk mencegah. `tests/global-setup.ts` membalik
    // `aktif` ke `true` untuk keduanya, tapi HANYA sesudah baris
    // `material_videos`-nya ada (lihat komentar di sana) — urutan yang sama
    // yang `aktifkanMateri` tuntut dari admin sungguhan. Asersi di bawah
    // membuat kelengkapannya terlihat DI SINI (bukan hanya di dalam
    // global-setup.ts) dan membuktikan pasangan ini yang bergantung pada
    // fixture test: loop UTAMA di bawahnya tetap memeriksa SEMUA materi aktif
    // tanpa pengecualian apa pun, termasuk kedua id ini, jadi materi lain
    // yang diam-diam mulai bergantung pada fixture test masih tertangkap.
    const idFixtureVideo = new Set([MATERI_VIDEO_TERBUKA, MATERI_VIDEO_TERKUNCI]);
    for (const id of idFixtureVideo) {
      expect(
        punyaVideo.has(id),
        `materi demo "${id}" seharusnya lengkap HANYA lewat fixture tests/global-setup.ts`,
      ).toBe(true);
    }

    for (const m of materi ?? []) {
      const lengkap =
        m.tipe === "ebook" ? punyaHalaman.has(m.id as string) : punyaVideo.has(m.id as string);
      expect(lengkap, `materi aktif "${m.judul}" tidak punya isi`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Halaman /admin/materi
// ---------------------------------------------------------------------------

describe("halaman materi (/admin/materi)", () => {
  let markup = "";
  let materiTanpaLayananId = "";

  beforeAll(async () => {
    ref.sesi = sesiAdmin;
    // Materi tanpa layanan sungguhan, dirender bersama sisanya, supaya
    // markup halaman ini bisa diperiksa terhadap pill "Tanpa layanan".
    const { data } = await admin
      .from("materials")
      .insert({ judul: "PAD-UJI Tanpa Layanan Markup", tipe: "ebook", deskripsi: "", aktif: false })
      .select("id")
      .single();
    materiTanpaLayananId = data!.id as string;
    markup = renderToStaticMarkup(await MateriPage());
  });

  afterAll(async () => {
    await admin.from("materials").delete().eq("id", materiTanpaLayananId);
  });

  it("mengelompokkan materi di bawah nama layanannya", () => {
    expect(markup).toContain("Sankalpa Fertility Massage");
    expect(markup).toContain("PAD-UJI E-Book Materi Baru");
  });

  it("menampilkan materi aktif maupun nonaktif dengan penandanya", () => {
    expect(markup).toMatch(/>Aktif</);
    expect(markup).toMatch(/>Nonaktif</);
    expect(markup).toContain("Aktifkan");
  });

  it("menandai materi tanpa layanan sama sekali — bukan tersembunyi diam-diam", () => {
    expect(markup).toContain("PAD-UJI Tanpa Layanan Markup");
    expect(markup).toContain("Tanpa layanan · hanya lewat assign");
  });

  it("menandai materi yang isinya belum lengkap, bukan mendiamkannya", () => {
    expect(markup).toContain("PAD-UJI Materi Tanpa Isi");
    // Diikat pada PIL "Belum ada isi" (`>Belum ada isi<`, huruf besar/kecil
    // dan tanpa embel-embel), BUKAN pada kata "isi" secara longgar: pesan
    // penjelas AksiMateri di baris yang sama juga memuat frasa "belum ada
    // isinya" (huruf kecil), dan regex longgar tanpa jangkar akan lolos
    // hanya karena kalimat itu ada — terlepas pil-nya sungguh dirender atau
    // tidak. Menghapus PillBelumAdaIsi dari page.tsx (dan hanya itu) MEMBUAT
    // baris ini merah; regex lama tidak.
    expect(markup).toContain(">Belum ada isi<");
  });

  it("menyebut jumlah halaman e-book dan keberadaan video", () => {
    expect(markup).toMatch(/\d+ halaman/);
    expect(markup).toMatch(/video/i);
  });

  it("menyediakan jalan menambah materi, isinya diunggah lewat PengunggahPdf/PengunggahVideo", () => {
    expect(markup).toContain("Materi baru");
    expect(sumberForm).toContain('name="judul"');
    expect(sumberForm).toContain('name="tipe"');
    expect(sumberForm).toContain("PengunggahPdf");
    expect(sumberForm).toContain("PengunggahVideo");
    // Medan URL video (Task 6) sudah dibongkar — video kini berkas, bukan URL.
    expect(sumberForm).not.toContain('name="video_url"');
    expect(sumberForm).not.toContain('name="bab_isi"');
    expect(sumberForm).not.toContain('name="bab_judul"');
  });

  it("menyediakan panel penugasan manual per materi", () => {
    expect(markup).toContain("Kelola penugasan");
    expect(sumberHalaman).toContain("daftarPenugasan");
  });

  it("menjelaskan bahwa materi tidak dihapus, hanya dinonaktifkan", () => {
    expect(markup).toMatch(/nonaktif/i);
  });

  it("dijaga requireRole admin+owner di halamannya sendiri", () => {
    expect(sumberHalaman).toMatch(
      /await\s+requireRole\(\s*\[\s*"admin"\s*,\s*"owner"\s*\]\s*\)/,
    );
  });

  it("judul mengandalkan template layout (tanpa menempel PADMA sendiri)", () => {
    expect(sumberHalaman).toMatch(/title:\s*"Materi/);
    expect(sumberHalaman).not.toMatch(/title:\s*"[^"]*PADMA/);
  });

  it("TIDAK ada nominal uang di modul materi (money firewall)", () => {
    expect(markup).not.toMatch(/Rp\s?\d/);
    for (const sumber of SEMUA_SUMBER) {
      expect(sumber).not.toMatch(/Rp\s?\d/);
      expect(sumber).not.toContain("service_rates");
      expect(sumber).not.toContain("variant_rates");
      expect(sumber).not.toContain("honor_marks");
    }
  });
});

// ---------------------------------------------------------------------------
// Bentuk berkas server action
// ---------------------------------------------------------------------------

describe("berkas server action materi", () => {
  it('diawali "use server"', () => {
    expect(sumberAksi.trimStart().startsWith('"use server"')).toBe(true);
  });

  it("hanya mengekspor fungsi async (syarat Next)", () => {
    const ekspor = [...sumberAksi.matchAll(/^export\s+(?!type\b)(\w+)/gm)].map((m) => m[1]);
    expect(ekspor.length).toBeGreaterThan(0);
    expect([...new Set(ekspor)]).toEqual(["async"]);
  });

  it("SETIAP action memanggil requireRole(['admin','owner']) di dalam dirinya", () => {
    const jumlahAction = [
      ...sumberAksi.matchAll(/^export\s+async\s+function\s+\w+/gm),
    ].length;
    const jumlahGuard = [
      ...sumberAksi.matchAll(/await\s+requireRole\(\s*\[\s*"admin"\s*,\s*"owner"\s*\]\s*\)/g),
    ].length;
    // simpanMateri, perbaruiMateri, aktifkanMateri, nonaktifkanMateri,
    // lepasVideo — tambahBab/perbaruiBab/hapusBab sudah dibongkar bersama
    // material_chapters di Task 11, dan gantiVideo sudah dibongkar bersama
    // medan URL video di Task 6 (diganti PengunggahVideo/catatVideoMateri).
    expect(jumlahAction).toBe(5);
    expect(jumlahGuard).toBe(jumlahAction);
  });

  it("memakai sesi pengguna, bukan service role", () => {
    for (const sumber of SEMUA_SUMBER) {
      expect(sumber).not.toContain("createAdminSupabase");
      expect(sumber).not.toContain("SERVICE_ROLE");
    }
    expect(sumberAksi).toContain("createServerSupabase");
    expect(sumberLib).toContain("createServerSupabase");
  });

  it("penghapusan ISI (halaman/video) tidak lewat verba DELETE — hanya RPC atau tabel penghubung berlingkup", () => {
    // `material_services` (tautan materi<->layanan) BEDA KELAS dari isi
    // materi: policy "materi-layanan: staf kelola" memang memberi staf hak
    // DELETE di tabel itu, dan `gantiLayananMateri` memakainya lewat radius
    // yang terkunci `.eq("material_id", materiId)` — bukan filter yang bisa
    // dibuat tautologis (lihat describe "radius tautan layanan" di atas).
    // Yang TETAP dilarang adalah DELETE pada
    // `materials`/`material_pages`/`material_videos`: hak tabelnya sudah
    // dicabut total dari peran API, dan `.delete()` di sana PASTI gagal
    // 42501 di layar admin.
    for (const sumber of SEMUA_SUMBER) {
      expect(sumber).not.toMatch(/\.from\(\s*["']materials["']\s*\)[\s\S]{0,60}\.delete\(/);
      expect(sumber).not.toMatch(/\.from\(\s*["']material_pages["']\s*\)[\s\S]{0,60}\.delete\(/);
      expect(sumber).not.toMatch(/\.from\(\s*["']material_videos["']\s*\)[\s\S]{0,60}\.delete\(/);
    }
  });

  it("TIDAK menawarkan penghapusan materi (hak DELETE-nya sudah dicabut)", () => {
    for (const sumber of [sumberHalaman, sumberForm]) {
      expect(sumber).not.toMatch(/>\s*Hapus materi/i);
    }
    expect(sumberAksi).not.toMatch(/from\(["']materials["']\)\s*\n?\s*\.delete/);
  });

  it("pencocokan identitas memakai operator setara, tidak pernah pola", () => {
    for (const sumber of [sumberAksi, sumberHalaman, sumberLib]) {
      expect(sumber).not.toContain(".ilike(");
      expect(sumber).not.toContain(".like(");
    }
  });

  it("tidak menuliskan isi materi ke log", () => {
    for (const sumber of SEMUA_SUMBER) {
      expect(sumber).not.toContain("console.");
    }
  });

  it("daftar putih & validator tinggal di status.ts, bukan di berkas action", () => {
    expect(sumberStatus).not.toContain('"use server"');
    expect(sumberAksi).toMatch(/from\s+["']\.\/status["']/);
  });

  it("layout admin TIDAK ikut diubah (matriks peran tetap satu panggilan)", () => {
    const layout = baca("src/app/admin/layout.tsx");
    expect([...layout.matchAll(/requireRole\(/g)]).toHaveLength(1);
    expect(baca("src/app/admin/page.tsx")).toContain('href="/admin/skrining"');
  });

  it("navigasi admin menautkan modul ini", () => {
    expect(baca("src/app/admin/_shell/nav-admin.tsx")).toContain('href: "/admin/materi"');
  });
});

describe("medan URL video (Task 6) benar-benar dibongkar, bukan cuma tak terpakai", () => {
  // `periksaUrlVideo` tidak lagi ada untuk diuji langsung — video kini berkas
  // R2, bukan URL, jadi validasi bentuknya (`periksaBerkasVideo`, Task 2) diuji
  // di `tests/materi-video-lib.test.ts`. Yang dijaga di sini adalah bahwa
  // validator lama BENAR-BENAR hilang dari status.ts, bukan diam-diam
  // ditinggalkan sebagai kode mati yang bisa diimpor ulang.
  it("status.ts tidak lagi mengekspor periksaUrlVideo/PENYEDIA_VIDEO/POLA_URL_VIDEO", () => {
    expect(sumberStatus).not.toContain("periksaUrlVideo");
    expect(sumberStatus).not.toContain("PENYEDIA_VIDEO");
    expect(sumberStatus).not.toContain("POLA_URL_VIDEO");
  });
});
