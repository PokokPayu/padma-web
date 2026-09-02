import { describe, it, expect, beforeAll } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs, anonClient } from "./helpers/as-user";

// Regression test untuk kebocoran materi (spec keputusan #13 + bagian 6 alur
// materi: "materi tidak bocor sebelum layanan berjalan").
//
// Akar masalah: policy "materials: baca meta" berbunyi
// `using (auth.uid() is not null)` sehingga berlaku untuk SEMUA KOLOM,
// termasuk `video_url`. Isi halaman e-book sudah tergating benar lewat
// `material_pages`, tetapi URL video bocor ke klien mana pun — proteksinya
// asimetris.
//
// Invarian yang dijaga di sini:
//   (a) klien TETAP melihat daftar materi (judul/tipe/deskripsi) walau terkunci
//       — UI menampilkan kartu materi berstatus locked;
//   (b) klien TIDAK mendapat URL video maupun isi bab untuk layanan yang belum
//       punya sesi berstatus `selesai` miliknya;
//   (c) klien BISA mendapat URL video & isi bab untuk layanan yang sudah selesai;
//   (d) admin & owner tetap bisa mengelola seluruh materi;
//   (e) anon tidak mendapat apa pun;
//   (f) query daftar materi (`select *`) tidak error karena hak kolom.

const svc = createAdminSupabase();

// Materi layanan 1101 Sankalpa Fertility Massage — Ananda punya sesi `selesai`.
const MATERI_TERBUKA_VIDEO = "77777777-7777-7777-7777-777777777701";
const MATERI_TERBUKA_EBOOK = "77777777-7777-7777-7777-777777777702";
const URL_TERBUKA = "https://vimeo.com/padma-sankalpa-001";

// Materi layanan 1106 Lactation Hero — Ananda TIDAK pernah menjalaninya.
const MATERI_TERKUNCI_VIDEO = "77777777-7777-7777-7777-777777777703";
const MATERI_TERKUNCI_EBOOK = "77777777-7777-7777-7777-777777777704";
const URL_RAHASIA = "https://vimeo.com/RAHASIA-123";

/** Apakah `URL_RAHASIA` muncul di mana pun dalam payload yang diterima klien? */
function membocorkan(payload: unknown, rahasia: string): boolean {
  return JSON.stringify(payload ?? null).includes(rahasia);
}

beforeAll(async () => {
  // Prasyarat data: seed materi harus ada (npx supabase db reset).
  const { data, error } = await svc
    .from("materials")
    .select("id")
    .in("id", [
      MATERI_TERBUKA_VIDEO,
      MATERI_TERBUKA_EBOOK,
      MATERI_TERKUNCI_VIDEO,
      MATERI_TERKUNCI_EBOOK,
    ]);
  if (error) throw error;
  if ((data ?? []).length !== 4) {
    throw new Error(
      "Seed materi belum lengkap — jalankan `npx supabase db reset && npm run seed:users`",
    );
  }
});

describe("MATERI — klien tetap melihat DAFTAR materi (kartu terkunci)", () => {
  it("klien melihat judul/tipe/deskripsi materi layanan yang belum ia jalani", async () => {
    const klien = await signInAs("ananda@padma.test");
    const { data, error } = await klien
      .from("materials")
      .select("id, judul, tipe, deskripsi")
      .eq("id", MATERI_TERKUNCI_VIDEO);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].judul).toBe("Teknik Pelekatan Menyusui");
    expect(data![0].tipe).toBe("video");
    expect(data![0].deskripsi).not.toBe("");
  });

  it("`select *` daftar materi TIDAK error karena hak kolom (bukan 42501)", async () => {
    const klien = await signInAs("ananda@padma.test");
    const { data, error } = await klien.from("materials").select("*");

    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(4);
  });
});

describe("MATERI — URL video TIDAK bocor sebelum layanan berjalan", () => {
  it("klien TIDAK mendapat URL video materi layanan yang belum ia jalani (select kolom)", async () => {
    const klien = await signInAs("ananda@padma.test");
    const { data, error } = await klien
      .from("material_videos")
      .select("url")
      .eq("material_id", MATERI_TERKUNCI_VIDEO);

    // error null: tabelnya ada & boleh di-query — yang kosong adalah HASILNYA,
    // bukan "aman karena tabelnya tidak ada".
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("klien TIDAK mendapat URL video lewat `select *` pada materials", async () => {
    const klien = await signInAs("ananda@padma.test");
    const { data, error } = await klien.from("materials").select("*");

    expect(error).toBeNull();
    expect(membocorkan(data, URL_RAHASIA)).toBe(false);
  });

  it("klien TIDAK mendapat URL video lewat embedding materials(material_videos)", async () => {
    const klien = await signInAs("ananda@padma.test");
    const { data, error } = await klien
      .from("materials")
      .select("id, judul, material_videos(url)");

    expect(error).toBeNull();
    expect(membocorkan(data, URL_RAHASIA)).toBe(false);
  });

  it("klien TIDAK bisa membaca halaman e-book layanan yang belum ia jalani", async () => {
    const klien = await signInAs("ananda@padma.test");
    const { data } = await klien
      .from("material_pages")
      .select("halaman, objek")
      .eq("material_id", MATERI_TERKUNCI_EBOOK);

    // Seed MEMANG menaruh satu baris material_pages untuk materi ini (lihat
    // supabase/seed.sql) supaya pemeriksaan ini membuktikan RLS benar-benar
    // menutup, bukan lolos kebetulan karena tidak ada apa pun untuk dibocorkan.
    expect(data ?? []).toHaveLength(0);
  });

  it("anon tidak mendapat URL video sama sekali", async () => {
    const anon = anonClient();
    const materials = await anon.from("materials").select("*");
    const videos = await anon.from("material_videos").select("*");

    expect(materials.data ?? []).toHaveLength(0);
    expect(videos.data ?? []).toHaveLength(0);
    expect(membocorkan(materials.data, URL_RAHASIA)).toBe(false);
  });

  it("klien TIDAK bisa menyisipkan/mengubah URL video", async () => {
    const klien = await signInAs("ananda@padma.test");
    const ins = await klien
      .from("material_videos")
      .insert({ material_id: MATERI_TERKUNCI_VIDEO, url: "https://vimeo.com/curian" })
      .select();
    expect(ins.error).not.toBeNull();

    const upd = await klien
      .from("material_videos")
      .update({ url: "https://vimeo.com/curian" })
      .eq("material_id", MATERI_TERBUKA_VIDEO)
      .select();
    expect(upd.data ?? []).toHaveLength(0);
  });
});

describe("MATERI — layanan yang SUDAH selesai tetap terbuka untuk klien", () => {
  it("klien BISA mendapat URL video materi layanan yang sudah ia selesaikan", async () => {
    const klien = await signInAs("ananda@padma.test");
    const { data, error } = await klien
      .from("material_videos")
      .select("material_id, url")
      .eq("material_id", MATERI_TERBUKA_VIDEO);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].url).toBe(URL_TERBUKA);
  });

  it("klien BISA mendapat URL video lewat embedding materials(material_videos)", async () => {
    const klien = await signInAs("ananda@padma.test");
    const { data, error } = await klien
      .from("materials")
      .select("id, judul, material_videos(url)")
      .eq("id", MATERI_TERBUKA_VIDEO);

    expect(error).toBeNull();
    expect(JSON.stringify(data)).toContain(URL_TERBUKA);
  });

  it("klien BISA membaca halaman e-book layanan yang sudah ia selesaikan", async () => {
    const klien = await signInAs("ananda@padma.test");
    const { data, error } = await klien
      .from("material_pages")
      .select("halaman, objek, lebar, tinggi")
      .eq("material_id", MATERI_TERBUKA_EBOOK);

    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(1);
  });
});

describe("MATERI — staf tetap bisa mengelola semuanya", () => {
  it("admin BISA membaca semua URL video (termasuk yang terkunci bagi klien)", async () => {
    const admin = await signInAs("admin@padma.test");
    const { data, error } = await admin.from("material_videos").select("material_id, url");

    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(data)).toContain(URL_RAHASIA);
  });

  it("owner BISA membaca semua URL video (tidak kehilangan akses)", async () => {
    const owner = await signInAs("owner@padma.test");
    const { data, error } = await owner.from("material_videos").select("material_id, url");

    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(data)).toContain(URL_RAHASIA);
  });

  it("admin BISA menambah & menghapus materi video beserta URL-nya", async () => {
    const admin = await signInAs("admin@padma.test");
    const materialId = "77777777-7777-7777-7777-7777777777f1";
    try {
      const m = await admin
        .from("materials")
        .insert({
          id: materialId,
          judul: "Materi Uji Admin",
          tipe: "video",
          deskripsi: "dibuat oleh test",
        })
        .select();
      expect(m.error).toBeNull();
      expect(m.data).toHaveLength(1);

      const v = await admin
        .from("material_videos")
        .insert({ material_id: materialId, url: "https://vimeo.com/uji-admin" })
        .select();
      expect(v.error).toBeNull();
      expect(v.data).toHaveLength(1);

      const upd = await admin
        .from("material_videos")
        .update({ url: "https://vimeo.com/uji-admin-2" })
        .eq("material_id", materialId)
        .select();
      expect(upd.data).toHaveLength(1);
      expect(upd.data![0].url).toBe("https://vimeo.com/uji-admin-2");
    } finally {
      await svc.from("material_videos").delete().eq("material_id", materialId);
      await svc.from("materials").delete().eq("id", materialId);
    }
  });
});
