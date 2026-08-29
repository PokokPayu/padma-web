/**
 * Modul Materi panel admin — metadata + ISI dalam satu aksi, dan gating yang
 * benar-benar menutup di lapisan basis data.
 *
 * Empat cacat senyap yang dijaga berkas ini. Semuanya sudah terverifikasi hidup
 * sebelum modul ini lahir, dan tidak satu pun menghasilkan error:
 *
 *  1. MATERI SETENGAH JADI TERKUNCI PERMANEN. Materi bertipe `video` tanpa baris
 *     `material_videos` (atau `ebook` tanpa satu pun bab) terkunci selamanya
 *     untuk SETIAP klien yang sebenarnya berhak — tanpa error — dan kartunya
 *     berbohong: "Terbuka setelah layanan terkait selesai", padahal layanannya
 *     sudah selesai. Hal yang sama terjadi bila `tipe` diubah `ebook`→`video`
 *     tanpa isinya. Karena itu metadata & isi disimpan dalam SATU aksi, materi
 *     LAHIR NONAKTIF sampai isinya benar-benar mendarat, dan tidak ada jalan di
 *     modul ini yang bisa menerbitkan materi kosong.
 *
 *  2. POLICY CHAPTERS/VIDEOS TIDAK MENGEVALUASI `materials.aktif`. Sebelum
 *     migration `gating_materi_hormati_aktif`, admin menonaktifkan materi dan
 *     klien TETAP membaca seluruh babnya beserta URL videonya lewat PostgREST
 *     langsung — hanya kartunya yang hilang dari UI. Tombol "Nonaktifkan"
 *     lahir di modul ini, jadi ia wajib benar sejak hari pertama.
 *
 *  3. PENGHAPUSAN ISI HANYA LEWAT RPC BERPARAMETER TUNGGAL. Verba DELETE atas
 *     `material_chapters`/`material_videos` sudah dicabut dari peran API
 *     (filter PostgREST adalah pilihan pemanggil, bukan pembatas baris). Nama
 *     argumennya MENGIKAT — salah nama menghasilkan 404 PGRST202, bukan 400 —
 *     dan `data === null` berarti "tidak ada yang cocok", yaitu SUKSES.
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

const admin = createAdminSupabase();
const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

// Layanan 1101 Sankalpa Fertility Massage — Ananda punya sesi `selesai`, jadi
// materi di layanan inilah yang membuktikan gating benar-benar menutup.
const SVC_TERBUKA = "11111111-1111-1111-1111-111111111101";
// Layanan 1106 Lactation Hero — Ananda tidak pernah menjalaninya.
const SVC_TERKUNCI = "11111111-1111-1111-1111-111111111106";
const TAK_ADA_SVC = "11111111-1111-1111-1111-1111111119ff";

const MATERI_EBOOK = "77777777-7777-7777-7777-7777777779a1";
const MATERI_VIDEO = "77777777-7777-7777-7777-7777777779a2";
const MATERI_KOSONG = "77777777-7777-7777-7777-7777777779a3";
const TAK_ADA_MATERI = "77777777-7777-7777-7777-7777777779ff";

const BAB_1 = "88888888-8888-8888-8888-8888888889a1";
const BAB_2 = "88888888-8888-8888-8888-8888888889a2";
const BAB_3 = "88888888-8888-8888-8888-8888888889a3";
const TAK_ADA_BAB = "88888888-8888-8888-8888-8888888889ff";

const URL_UJI = "https://vimeo.com/pad-uji-materi-9a02";

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
  tambahBab,
  perbaruiBab,
  hapusBab,
  gantiVideo,
  lepasVideo,
} = await import("@/app/admin/materi/aksi");
const { daftarMateriAdmin } = await import("@/lib/admin/materi-admin");
const { periksaUrlVideo } = await import("@/app/admin/materi/status");
const { default: MateriPage } = await import("@/app/admin/materi/page");

const sumberAksi = baca("src/app/admin/materi/aksi.ts");
const sumberHalaman = baca("src/app/admin/materi/page.tsx");
const sumberForm = baca("src/app/admin/materi/form-materi.tsx");
const sumberStatus = baca("src/app/admin/materi/status.ts");
const sumberLib = baca("src/lib/admin/materi-admin.ts");
const SEMUA_SUMBER = [sumberAksi, sumberHalaman, sumberForm, sumberStatus, sumberLib];

let sesiAdmin: SupabaseClient;
let sesiKlien: SupabaseClient;

function formulir(isi: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(isi)) fd.set(k, v);
  return fd;
}

async function barisMateri(id: string) {
  const { data } = await admin
    .from("materials")
    .select("id, service_id, judul, tipe, deskripsi, aktif")
    .eq("id", id)
    .maybeSingle<{
      id: string;
      service_id: string;
      judul: string;
      tipe: string;
      deskripsi: string;
      aktif: boolean;
    }>();
  return data;
}

async function babMateri(materiId: string) {
  const { data } = await admin
    .from("material_chapters")
    .select("id, urutan, judul, isi")
    .eq("material_id", materiId)
    .order("urutan");
  return (data ?? []) as Array<{ id: string; urutan: number; judul: string; isi: string }>;
}

async function videoMateri(materiId: string) {
  const { data } = await admin
    .from("material_videos")
    .select("material_id, url")
    .eq("material_id", materiId)
    .maybeSingle<{ material_id: string; url: string }>();
  return data;
}

async function jumlahMateri(): Promise<number> {
  const { count } = await admin
    .from("materials")
    .select("id", { count: "exact", head: true });
  return count ?? 0;
}

async function bersihkan() {
  // Urutan ditulis eksplisit walau `on delete cascade` sudah menanganinya:
  // pembersihan yang mengandalkan cascade diam-diam berhenti bekerja begitu
  // sebuah FK diubah, dan sisanya baru terlihat beberapa run kemudian.
  const semua = [MATERI_EBOOK, MATERI_VIDEO, MATERI_KOSONG];
  await admin.from("material_videos").delete().in("material_id", semua);
  await admin.from("material_chapters").delete().in("material_id", semua);
  await admin.from("materials").delete().in("id", semua);
  // Materi yang lahir dari action di berkas ini (id-nya digenerate basis data).
  const { data: sisa } = await admin
    .from("materials")
    .select("id")
    .like("judul", "PAD-UJI%");
  const idSisa = (sisa ?? []).map((m) => m.id as string);
  if (idSisa.length > 0) {
    await admin.from("material_videos").delete().in("material_id", idSisa);
    await admin.from("material_chapters").delete().in("material_id", idSisa);
    await admin.from("materials").delete().in("id", idSisa);
  }
}

async function pasangFixture() {
  await admin.from("materials").insert([
    {
      id: MATERI_EBOOK,
      service_id: SVC_TERBUKA,
      judul: "PAD-UJI E-Book Materi",
      tipe: "ebook",
      deskripsi: "fixture e-book",
      aktif: true,
    },
    {
      id: MATERI_VIDEO,
      service_id: SVC_TERBUKA,
      judul: "PAD-UJI Video Materi",
      tipe: "video",
      deskripsi: "fixture video",
      aktif: true,
    },
    {
      // Materi setengah jadi yang SENGAJA dibuat lewat service role: modul ini
      // tidak boleh punya satu pun jalan untuk melahirkannya.
      id: MATERI_KOSONG,
      service_id: SVC_TERBUKA,
      judul: "PAD-UJI Materi Tanpa Isi",
      tipe: "ebook",
      deskripsi: "fixture tanpa isi",
      aktif: false,
    },
  ]);
  await admin.from("material_chapters").insert([
    { id: BAB_1, material_id: MATERI_EBOOK, urutan: 1, judul: "PAD-UJI Bab Satu", isi: "Isi bab satu." },
    { id: BAB_2, material_id: MATERI_EBOOK, urutan: 2, judul: "PAD-UJI Bab Dua", isi: "Isi bab dua." },
    { id: BAB_3, material_id: MATERI_EBOOK, urutan: 3, judul: "PAD-UJI Bab Tiga", isi: "Isi bab tiga." },
  ]);
  await admin.from("material_videos").insert({ material_id: MATERI_VIDEO, url: URL_UJI });
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

  it("membawa bab e-book terurut dan URL video sebagai OBJEK, bukan array", async () => {
    const daftar = await daftarMateriAdmin();
    const semua = daftar.flatMap((l) => l.materi);
    const ebook = semua.find((m) => m.id === MATERI_EBOOK)!;
    expect(ebook.bab.map((b) => b.urutan)).toEqual([1, 2, 3]);
    expect(ebook.videoUrl).toBeNull();

    const video = semua.find((m) => m.id === MATERI_VIDEO)!;
    // `material_videos` berelasi 1:1 — `video.length === 0` selalu salah dan
    // akan membuat setiap materi video tampak belum punya isi.
    expect(video.videoUrl).toBe(URL_UJI);
    expect(Array.isArray(video.videoUrl)).toBe(false);
    expect(video.bab).toEqual([]);
  });

  it("menandai materi yang isinya BELUM lengkap — kartu tidak boleh berbohong", async () => {
    const daftar = await daftarMateriAdmin();
    const semua = daftar.flatMap((l) => l.materi);
    expect(semua.find((m) => m.id === MATERI_EBOOK)!.lengkap).toBe(true);
    expect(semua.find((m) => m.id === MATERI_VIDEO)!.lengkap).toBe(true);
    expect(semua.find((m) => m.id === MATERI_KOSONG)!.lengkap).toBe(false);
  });

  it("dibaca lewat sesi pengguna: klien tidak melihat isi materi terkunci", async () => {
    // Bila lapisan ini memakai service role, seluruh bab & URL tetap keluar
    // untuk siapa pun dan RLS tidak pernah ikut diperiksa.
    ref.sesi = sesiKlien;
    const daftar = await daftarMateriAdmin();
    const semua = daftar.flatMap((l) => l.materi);
    const terkunci = semua.find(
      (m) => m.id === "77777777-7777-7777-7777-777777777703",
    );
    expect(terkunci?.videoUrl ?? null).toBeNull();
    expect(JSON.stringify(daftar)).not.toContain("RAHASIA-123");
  });
});

// ---------------------------------------------------------------------------
// PAGAR UTAMA 1: metadata + isi dalam SATU aksi
// ---------------------------------------------------------------------------

describe("simpanMateri — tidak ada materi yang lahir setengah jadi", () => {
  it("e-book TIDAK bisa disimpan tanpa satu pun bab", async () => {
    const sebelum = await jumlahMateri();
    const hasil = await simpanMateri(
      formulir({
        service_id: SVC_TERBUKA,
        judul: "PAD-UJI E-Book Tanpa Bab",
        tipe: "ebook",
        deskripsi: "seharusnya ditolak",
        bab_judul: "",
        bab_isi: "",
      }),
    );
    expect(hasil.ok).toBe(false);
    if (hasil.ok) return;
    expect(hasil.pesan).toMatch(/bab/i);
    // Ditolak SEBELUM menyentuh basis data — bukan "disimpan lalu dibatalkan":
    // hak DELETE atas `materials` sudah dicabut, jadi tidak ada jalan mundur.
    expect(await jumlahMateri()).toBe(sebelum);
  });

  it("video TIDAK bisa disimpan tanpa URL", async () => {
    const sebelum = await jumlahMateri();
    const hasil = await simpanMateri(
      formulir({
        service_id: SVC_TERBUKA,
        judul: "PAD-UJI Video Tanpa URL",
        tipe: "video",
        deskripsi: "seharusnya ditolak",
        video_url: "",
      }),
    );
    expect(hasil.ok).toBe(false);
    if (hasil.ok) return;
    expect(hasil.pesan).toMatch(/url|video/i);
    expect(await jumlahMateri()).toBe(sebelum);
  });

  it("URL di luar daftar penyedia ditolak dengan KALIMAT, bukan kode Postgres", async () => {
    // Constraint `material_videos_host_terproteksi` memang menolaknya, tetapi
    // yang sampai ke layar admin klinik adalah 23514 — bukan kalimat.
    for (const url of [
      "https://youtube.com/watch?v=abc",
      "http://vimeo.com/123",
      "https://vimeo.com.jahat.id/123",
      "javascript:alert(1)",
    ]) {
      const hasil = await simpanMateri(
        formulir({
          service_id: SVC_TERBUKA,
          judul: "PAD-UJI Video Host Asing",
          tipe: "video",
          deskripsi: "",
          video_url: url,
        }),
      );
      expect(hasil.ok, `URL "${url}" seharusnya ditolak`).toBe(false);
      if (hasil.ok) continue;
      expect(hasil.pesan).toMatch(/vimeo|cloudflare/i);
      expect(hasil.pesan).not.toMatch(/23514|violates|check constraint/i);
    }
    const { data } = await admin
      .from("materials")
      .select("id")
      .eq("judul", "PAD-UJI Video Host Asing");
    expect(data ?? []).toHaveLength(0);
  });

  it("e-book tersimpan bersama bab pertamanya dalam satu aksi, dan langsung aktif", async () => {
    const hasil = await simpanMateri(
      formulir({
        service_id: SVC_TERKUNCI,
        judul: "PAD-UJI E-Book Baru",
        tipe: "ebook",
        deskripsi: "Deskripsi uji",
        bab_judul: "Bab Pembuka",
        bab_isi: "Isi bab pembuka yang cukup panjang untuk dibaca.",
      }),
    );
    expect(hasil.ok).toBe(true);
    if (!hasil.ok) return;

    expect(await barisMateri(hasil.id)).toMatchObject({
      service_id: SVC_TERKUNCI,
      judul: "PAD-UJI E-Book Baru",
      tipe: "ebook",
      aktif: true,
    });
    const bab = await babMateri(hasil.id);
    expect(bab).toHaveLength(1);
    expect(bab[0].judul).toBe("Bab Pembuka");
  });

  it("video tersimpan bersama URL-nya dalam satu aksi, dan langsung aktif", async () => {
    const hasil = await simpanMateri(
      formulir({
        service_id: SVC_TERKUNCI,
        judul: "PAD-UJI Video Baru",
        tipe: "video",
        deskripsi: "",
        video_url: "https://player.vimeo.com/video/998877",
      }),
    );
    expect(hasil.ok).toBe(true);
    if (!hasil.ok) return;

    expect((await barisMateri(hasil.id))!.aktif).toBe(true);
    expect((await videoMateri(hasil.id))!.url).toBe(
      "https://player.vimeo.com/video/998877",
    );
  });

  it("menolak layanan yang tidak ada tanpa menyentuh basis data", async () => {
    const sebelum = await jumlahMateri();
    const hasil = await simpanMateri(
      formulir({
        service_id: TAK_ADA_SVC,
        judul: "PAD-UJI Materi Yatim",
        tipe: "ebook",
        deskripsi: "",
        bab_judul: "Bab",
        bab_isi: "isi",
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
        bab_judul: "Bab",
        bab_isi: "isi",
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
        bab_judul: "Bab",
        bab_isi: "isi bab",
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
          bab_judul: "Bab",
          bab_isi: "isi",
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
  it("mengubah judul, deskripsi, dan layanan tanpa menyentuh keadaan aktif", async () => {
    const hasil = await perbaruiMateri(
      MATERI_EBOOK,
      formulir({
        service_id: SVC_TERBUKA,
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
  });

  it("ebook → video TANPA URL ditolak, dan tipenya TIDAK berubah", async () => {
    // Inilah bentuk paling halus dari materi setengah jadi: tipe berpindah,
    // isinya tidak ikut, dan seluruh klien melihat kartu terkunci selamanya.
    const hasil = await perbaruiMateri(
      MATERI_EBOOK,
      formulir({
        service_id: SVC_TERBUKA,
        judul: "PAD-UJI E-Book Materi Baru",
        tipe: "video",
        deskripsi: "deskripsi baru",
        video_url: "",
      }),
    );
    expect(hasil.ok).toBe(false);
    expect((await barisMateri(MATERI_EBOOK))!.tipe).toBe("ebook");
    expect(await videoMateri(MATERI_EBOOK)).toBeNull();
  });

  it("video → ebook TANPA bab ditolak, dan tipenya TIDAK berubah", async () => {
    const hasil = await perbaruiMateri(
      MATERI_VIDEO,
      formulir({
        service_id: SVC_TERBUKA,
        judul: "PAD-UJI Video Materi",
        tipe: "ebook",
        deskripsi: "",
        bab_judul: "",
        bab_isi: "",
      }),
    );
    expect(hasil.ok).toBe(false);
    expect((await barisMateri(MATERI_VIDEO))!.tipe).toBe("video");
  });

  it("ebook → video DENGAN URL berpindah lengkap dengan isinya", async () => {
    const hasil = await perbaruiMateri(
      MATERI_KOSONG,
      formulir({
        service_id: SVC_TERBUKA,
        judul: "PAD-UJI Materi Tanpa Isi",
        tipe: "video",
        deskripsi: "",
        video_url: "https://customer-abc123.cloudflarestream.com/xyz/manifest",
      }),
    );
    expect(hasil.ok).toBe(true);
    expect((await barisMateri(MATERI_KOSONG))!.tipe).toBe("video");
    expect((await videoMateri(MATERI_KOSONG))!.url).toBe(
      "https://customer-abc123.cloudflarestream.com/xyz/manifest",
    );

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

describe("aktifkanMateri menolak menerbitkan materi kosong", () => {
  it("materi tanpa isi TIDAK bisa diaktifkan — kartunya akan berbohong", async () => {
    expect((await barisMateri(MATERI_KOSONG))!.aktif).toBe(false);
    const hasil = await aktifkanMateri(MATERI_KOSONG);
    expect(hasil.ok).toBe(false);
    if (hasil.ok) return;
    expect(hasil.pesan).toMatch(/isi|bab/i);
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

  it("klien membaca bab & URL selama materi masih aktif (alur sah tidak rusak)", async () => {
    const bab = await sesiKlien
      .from("material_chapters")
      .select("id")
      .eq("material_id", MATERI_EBOOK);
    expect(bab.error).toBeNull();
    expect(bab.data ?? []).toHaveLength(3);

    const video = await sesiKlien
      .from("material_videos")
      .select("url")
      .eq("material_id", MATERI_VIDEO);
    expect(video.data ?? []).toHaveLength(1);
  });

  it("sesudah dinonaktifkan, klien TIDAK bisa lagi membaca babnya lewat REST langsung", async () => {
    ref.sesi = sesiAdmin;
    expect((await nonaktifkanMateri(MATERI_EBOOK)).ok).toBe(true);

    // Bukan "hilang dari UI" — hilang dari jawaban PostgREST itu sendiri.
    const { data, error } = await sesiKlien
      .from("material_chapters")
      .select("id, judul, isi")
      .eq("material_id", MATERI_EBOOK);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
    expect(JSON.stringify(data)).not.toContain("Isi bab satu.");
  });

  it("sesudah dinonaktifkan, URL videonya pun tidak lagi terbaca klien", async () => {
    ref.sesi = sesiAdmin;
    expect((await nonaktifkanMateri(MATERI_VIDEO)).ok).toBe(true);

    const { data, error } = await sesiKlien
      .from("material_videos")
      .select("url")
      .eq("material_id", MATERI_VIDEO);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
    expect(JSON.stringify(data)).not.toContain(URL_UJI);

    // Embed pun ikut tertutup — jalur yang dipakai halaman daftar materi.
    const embed = await sesiKlien
      .from("materials")
      .select("id, material_videos(url)")
      .eq("id", MATERI_VIDEO);
    expect(JSON.stringify(embed.data)).not.toContain(URL_UJI);
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
      .from("material_chapters")
      .select("id")
      .eq("material_id", MATERI_EBOOK);
    expect(data ?? []).toHaveLength(3);
  });

  it("diaktifkan kembali, isinya terbaca klien lagi", async () => {
    ref.sesi = sesiAdmin;
    expect((await aktifkanMateri(MATERI_EBOOK)).ok).toBe(true);
    const { data } = await sesiKlien
      .from("material_chapters")
      .select("id")
      .eq("material_id", MATERI_EBOOK);
    expect(data ?? []).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// PAGAR UTAMA 3: penghapusan isi hanya lewat RPC berparameter tunggal
// ---------------------------------------------------------------------------

describe("mengelola bab e-book", () => {
  it("tambahBab menambahkan bab pada urutan berikutnya", async () => {
    const hasil = await tambahBab(
      MATERI_EBOOK,
      formulir({ judul: "PAD-UJI Bab Empat", isi: "Isi bab empat." }),
    );
    expect(hasil.ok).toBe(true);
    const bab = await babMateri(MATERI_EBOOK);
    expect(bab).toHaveLength(4);
    expect(bab[3].urutan).toBe(4);
    expect(bab[3].judul).toBe("PAD-UJI Bab Empat");
  });

  it("perbaruiBab mengubah judul, isi, dan urutan", async () => {
    const hasil = await perbaruiBab(
      BAB_2,
      formulir({ judul: "PAD-UJI Bab Dua Baru", isi: "Isi bab dua yang baru.", urutan: "2" }),
    );
    expect(hasil.ok).toBe(true);
    const bab = (await babMateri(MATERI_EBOOK)).find((b) => b.id === BAB_2)!;
    expect(bab.judul).toBe("PAD-UJI Bab Dua Baru");
    expect(bab.isi).toBe("Isi bab dua yang baru.");
  });

  it("bab kosong ditolak — bab tanpa isi adalah halaman kosong di reader klien", async () => {
    const hasil = await tambahBab(MATERI_EBOOK, formulir({ judul: "PAD-UJI Bab Hampa", isi: "" }));
    expect(hasil.ok).toBe(false);
    expect((await babMateri(MATERI_EBOOK)).map((b) => b.judul)).not.toContain(
      "PAD-UJI Bab Hampa",
    );
  });

  it("hapusBab lewat RPC menghapus TEPAT SATU baris", async () => {
    const sebelum = await babMateri(MATERI_EBOOK);
    expect(sebelum.length).toBeGreaterThan(1);

    const hasil = await hapusBab(BAB_3);
    expect(hasil.ok).toBe(true);

    const sesudah = await babMateri(MATERI_EBOOK);
    expect(sesudah).toHaveLength(sebelum.length - 1);
    expect(sesudah.map((b) => b.id)).not.toContain(BAB_3);
    // Bab lain di materi yang sama TIDAK ikut tersapu — inilah yang membedakan
    // RPC berparameter tunggal dari DELETE berfilter.
    expect(sesudah.map((b) => b.id)).toContain(BAB_1);
    expect(sesudah.map((b) => b.id)).toContain(BAB_2);
  });

  it("bab yang sudah lebih dulu hilang bukan kegagalan (data === null berarti sukses)", async () => {
    const hasil = await hapusBab(TAK_ADA_BAB);
    expect(hasil.ok).toBe(true);
  });

  it("bab TERAKHIR sebuah e-book aktif TIDAK bisa dihapus", async () => {
    // Menghapusnya membuat materi aktif tanpa isi: terkunci permanen bagi
    // seluruh klien yang berhak, tanpa error, dengan kartu yang berbohong.
    const { data: baru } = await admin
      .from("material_chapters")
      .insert({
        material_id: MATERI_KOSONG,
        urutan: 1,
        judul: "PAD-UJI Bab Tunggal",
        isi: "satu-satunya",
      })
      .select("id")
      .single();
    await admin.from("materials").update({ aktif: true }).eq("id", MATERI_KOSONG);
    try {
      const hasil = await hapusBab(baru!.id as string);
      expect(hasil.ok).toBe(false);
      if (hasil.ok) return;
      expect(hasil.pesan).toMatch(/nonaktif|terakhir|satu/i);
      expect(await babMateri(MATERI_KOSONG)).toHaveLength(1);
    } finally {
      await admin.from("materials").update({ aktif: false }).eq("id", MATERI_KOSONG);
      await admin.from("material_chapters").delete().eq("material_id", MATERI_KOSONG);
    }
  });

  it("PENJAGA PERAN: klien yang login tidak bisa menghapus bab", async () => {
    ref.sesi = sesiKlien;
    await expect(hapusBab(BAB_1)).rejects.toThrow(/REDIRECT/);
    expect((await babMateri(MATERI_EBOOK)).map((b) => b.id)).toContain(BAB_1);
  });

  it("memanggil RPC dengan nama argumen yang MENGIKAT", () => {
    // Salah nama argumen menghasilkan 404 PGRST202 — bukan 400 — dan pesannya
    // tidak menyebut argumen mana yang salah.
    expect(sumberAksi).toContain('rpc("hapus_bab_materi"');
    expect(sumberAksi).toMatch(/bab_id:/);
    expect(sumberAksi).toContain('rpc("lepas_video_materi"');
    expect(sumberAksi).toMatch(/materi_id:/);
  });
});

describe("mengelola video materi", () => {
  it("gantiVideo memasang URL baru pada materi video", async () => {
    const hasil = await gantiVideo(
      MATERI_VIDEO,
      formulir({ video_url: "https://vimeo.com/pad-uji-baru" }),
    );
    expect(hasil.ok).toBe(true);
    expect((await videoMateri(MATERI_VIDEO))!.url).toBe("https://vimeo.com/pad-uji-baru");
  });

  it("gantiVideo menolak host di luar daftar penyedia terproteksi", async () => {
    const hasil = await gantiVideo(
      MATERI_VIDEO,
      formulir({ video_url: "https://drive.google.com/file/d/rahasia" }),
    );
    expect(hasil.ok).toBe(false);
    if (hasil.ok) return;
    expect(hasil.pesan).toMatch(/vimeo|cloudflare/i);
    expect((await videoMateri(MATERI_VIDEO))!.url).toBe("https://vimeo.com/pad-uji-baru");
  });

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
    await admin.from("material_videos").insert({ material_id: MATERI_VIDEO, url: URL_UJI });
    await admin.from("materials").update({ aktif: true }).eq("id", MATERI_VIDEO);
  });

  it("PENJAGA PERAN: klien yang login tidak bisa mengganti URL video", async () => {
    ref.sesi = sesiKlien;
    await expect(
      gantiVideo(MATERI_VIDEO, formulir({ video_url: "https://vimeo.com/curian" })),
    ).rejects.toThrow(/REDIRECT/);
    expect((await videoMateri(MATERI_VIDEO))!.url).toBe(URL_UJI);
  });
});

// ---------------------------------------------------------------------------
// Invarian menyeluruh
// ---------------------------------------------------------------------------

describe("invarian: tidak ada satu pun materi AKTIF tanpa isi", () => {
  it("setiap materi aktif punya bab (ebook) atau URL video (video)", async () => {
    const { data: materi } = await admin
      .from("materials")
      .select("id, judul, tipe")
      .eq("aktif", true);
    const { data: bab } = await admin.from("material_chapters").select("material_id");
    const { data: video } = await admin.from("material_videos").select("material_id");

    const punyaBab = new Set((bab ?? []).map((b) => b.material_id as string));
    const punyaVideo = new Set((video ?? []).map((v) => v.material_id as string));

    for (const m of materi ?? []) {
      const lengkap =
        m.tipe === "ebook" ? punyaBab.has(m.id as string) : punyaVideo.has(m.id as string);
      expect(lengkap, `materi aktif "${m.judul}" tidak punya isi`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Halaman /admin/materi
// ---------------------------------------------------------------------------

describe("halaman materi (/admin/materi)", () => {
  let markup = "";

  beforeAll(async () => {
    ref.sesi = sesiAdmin;
    markup = renderToStaticMarkup(await MateriPage());
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

  it("menandai materi yang isinya belum lengkap, bukan mendiamkannya", () => {
    expect(markup).toContain("PAD-UJI Materi Tanpa Isi");
    expect(markup).toMatch(/belum ada isi|belum punya isi/i);
  });

  it("menyebut jumlah bab e-book dan keberadaan video", () => {
    expect(markup).toMatch(/\d+ bab/);
    expect(markup).toMatch(/video/i);
  });

  it("menyediakan jalan menambah materi beserta isinya dalam satu formulir", () => {
    expect(markup).toContain("Materi baru");
    expect(sumberForm).toContain('name="judul"');
    expect(sumberForm).toContain('name="tipe"');
    expect(sumberForm).toContain('name="bab_isi"');
    expect(sumberForm).toContain('name="video_url"');
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
    expect(jumlahAction).toBe(9);
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

  it("TIDAK ada satu pun .delete() — penghapusan isi hanya lewat RPC", () => {
    // Verba DELETE atas tabel isi sudah dicabut dari peran API: `.delete()` di
    // sini bukan sekadar berbahaya, ia PASTI gagal 42501 di layar admin.
    for (const sumber of SEMUA_SUMBER) {
      expect(sumber).not.toContain(".delete(");
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

describe("periksaUrlVideo — daftar penyedia terproteksi ditegakkan dua lapis", () => {
  it("menerima Vimeo & Cloudflare Stream", () => {
    for (const url of [
      "https://vimeo.com/123456789",
      "https://player.vimeo.com/video/123456789",
      "https://customer-abc.cloudflarestream.com/xyz/manifest/video.m3u8",
      "https://videodelivery.cloudflarestream.com/xyz/manifest",
    ]) {
      expect(periksaUrlVideo(url).ok, `${url} seharusnya diterima`).toBe(true);
    }
  });

  it("menolak host lain, skema lain, dan host yang hanya menyerupai", () => {
    for (const url of [
      "",
      "   ",
      "http://vimeo.com/123",
      "https://vimeo.com.jahat.id/123",
      "https://youtube.com/watch?v=1",
      "javascript:alert(1)",
      "data:text/html,<script>",
    ]) {
      expect(periksaUrlVideo(url).ok, `${url} seharusnya ditolak`).toBe(false);
    }
  });
});
