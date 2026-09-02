// tests/materi-unggah-lib.test.ts
//
// Bukti PERILAKU untuk Fix 1 (final review branch materi-ebook-pdf):
// unggah ulang e-book >100 halaman dulu gagal PERMANEN dan mengosongkan
// materi. Dua cacat bertumpuk:
//   1. `admin.storage.from(BUCKET).list(materiId)` tanpa opsi hanya
//      menjawab 100 objek pertama (default storage-js). Objek 101+ selamat
//      dari `.remove()` sebagai sampah yatim.
//   2. `createSignedUploadUrl(objek)` tanpa `{ upsert: true }` mengirim
//      `x-upsert: false`, jadi PUT ke objek yatim itu (halaman >100 pada
//      PDF pengganti) ditolak, seluruh unggahan throw di tengah, dan
//      `catatHalamanMateri` tidak pernah sempat jalan — materi berakhir
//      NOL halaman, tanpa jalan pulih lewat UI admin.
//
// `materi-unggah-aksi.test.ts` sudah menjaga BENTUK kode (urutan panggilan,
// dsb) lewat pembacaan sumber. Berkas ini menjalankan `terbitkanUrlUnggahHalaman`
// dan `catatHalamanMateri` SUNGGUHAN melawan objek storage sungguhan, supaya
// pagar Fix 1 diuji sebagai PERILAKU, bukan hanya bentuk teksnya.
import { describe, it, expect, vi, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { namaObjekHalaman } from "@/lib/materi/rasterisasi";
import { signInAs } from "./helpers/as-user";

const admin = createAdminSupabase();
const BUCKET = "materi-halaman";

const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.sesi!,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { terbitkanUrlUnggahHalaman, catatHalamanMateri } = await import(
  "@/app/admin/materi/unggah"
);

async function gambarKecil(): Promise<Buffer> {
  // 2x2 cukup — hanya byte WebP SAH yang dibutuhkan, isinya tidak diperiksa.
  return sharp({ create: { width: 2, height: 2, channels: 3, background: "#ffffff" } })
    .webp()
    .toBuffer();
}

// 130 dipilih: melewati 100 (default `.list()` storage-js — akar Fix 1),
// jauh di bawah MAKS_HALAMAN (300, e-book sungguhan) supaya test tetap
// selesai dalam hitungan detik, bukan menit. Angka SPESIFIK tidak penting;
// yang penting ia > 100 dan objeknya SUNGGUHAN, bukan hanya baris DB.
const JUMLAH_LAMA = 130;

describe("terbitkanUrlUnggahHalaman/catatHalamanMateri — unggah ulang e-book >100 halaman (Fix 1)", () => {
  let materiId = "";

  afterAll(async () => {
    if (!materiId) return;
    await admin.from("materials").delete().eq("id", materiId);
    // Sapu sisa objek storage kalau test gagal di tengah (cascade Postgres
    // tidak menyentuh bucket — bukan baris).
    const { data: sisa } = await admin.storage.from(BUCKET).list(materiId, { limit: 1000 });
    if (sisa && sisa.length > 0) {
      await admin.storage.from(BUCKET).remove(sisa.map((o) => `${materiId}/${o.name}`));
    }
  });

  it("SELURUH objek lama tersapu (bukan hanya 100 pertama), dan halaman pengganti tercatat benar", async () => {
    const { data: m } = await admin
      .from("materials")
      .insert({ judul: "UJI-UNGGAH-ULANG-130HAL", tipe: "ebook", deskripsi: "", aktif: true })
      .select("id")
      .single();
    materiId = m!.id as string;

    const gambar = await gambarKecil();

    // Objek storage SUNGGUHAN (bukan cuma baris `material_pages`) — inilah
    // yang membuat test ini menguji `.list()`/`.remove()` sungguhan, bukan
    // hanya RPC pengosongan baris.
    await Promise.all(
      Array.from({ length: JUMLAH_LAMA }, (_, i) =>
        admin.storage
          .from(BUCKET)
          .upload(namaObjekHalaman(materiId, i + 1), gambar, {
            contentType: "image/webp",
            upsert: true,
          }),
      ),
    );
    const { data: n0 } = await admin.rpc("ganti_halaman_materi", {
      p_material_id: materiId,
      p_halaman: Array.from({ length: JUMLAH_LAMA }, (_, i) => ({
        halaman: i + 1,
        objek: namaObjekHalaman(materiId, i + 1),
        lebar: 2,
        tinggi: 2,
      })),
    });
    expect(n0).toBe(JUMLAH_LAMA);

    // Jalur admin SUNGGUHAN (bukan service role) — requireRole() di dalam
    // aksi harus lolos lewat sesi ini, persis seperti panel admin sungguhan.
    ref.sesi = await signInAs("admin@padma.test");

    const JUMLAH_BARU = 3;
    const izin = await terbitkanUrlUnggahHalaman(materiId, JUMLAH_BARU);
    expect(izin.ok, !izin.ok ? izin.pesan : "").toBe(true);
    if (!izin.ok) return;
    expect(izin.unggahan).toHaveLength(JUMLAH_BARU);

    // ASERSI INTI Fix 1: sebelum perbaikan, `.list()` tanpa opsi hanya
    // menjawab 100 objek PERTAMA (urutan nama menaik dari storage-js), jadi
    // hanya 0001..0100 yang tersapu — 0101..0130 selamat sebagai sampah
    // yatim. Membaca ulang dengan paginasi kita SENDIRI (limit besar)
    // membuktikan TIDAK ADA objek tersisa sama sekali, bukan cuma bahwa 100
    // pertama sudah hilang.
    const { data: sisaObjek } = await admin.storage
      .from(BUCKET)
      .list(materiId, { limit: 1000 });
    expect(sisaObjek ?? []).toHaveLength(0);

    // Rantai penuh: unggah 3 halaman baru lewat signed URL yang baru
    // diterbitkan (dengan upsert — lihat test empiris terpisah di bawah
    // untuk pembuktian upsert-nya sendiri), lalu catat barisnya — membuktikan
    // jalur GANTI berakhir benar, bukan cuma jalur KOSONGKAN.
    for (const u of izin.unggahan) {
      const { error } = await admin.storage
        .from(BUCKET)
        .uploadToSignedUrl(u.objek, u.token, gambar, { contentType: "image/webp" });
      expect(error, `unggah halaman ${u.halaman} gagal: ${error?.message}`).toBeNull();
    }
    const catat = await catatHalamanMateri(
      materiId,
      izin.unggahan.map((u) => ({ halaman: u.halaman, objek: u.objek, lebar: 2, tinggi: 2 })),
    );
    expect(catat.ok, !catat.ok ? catat.pesan : "").toBe(true);
    if (!catat.ok) return;
    expect(catat.jumlah).toBe(JUMLAH_BARU);

    const { data: sesudahRows } = await admin
      .from("material_pages")
      .select("halaman, objek")
      .eq("material_id", materiId)
      .order("halaman");
    expect((sesudahRows ?? []).map((r) => r.halaman)).toEqual([1, 2, 3]);
    // Materi tidak pernah singgah di keadaan "nol halaman" yang dulu jadi
    // hasil akhir kegagalan di tengah unggahan >100 halaman.
    expect((sesudahRows ?? []).length).toBeGreaterThan(0);
  }, 60_000);
});

/**
 * Pembuktian EMPIRIS terpisah dari alur di atas: `{ upsert: true }` pada
 * `createSignedUploadUrl` sungguh mengizinkan PUT menimpa objek yang SUDAH
 * ADA — bukan diklaim dari membaca dokumentasi storage-js. Test di atas
 * tidak pernah membuktikan ini sendirian karena, dengan `.list()` sudah
 * diperbaiki, tidak ada lagi objek yatim yang bisa ditabrak di sana (seluruh
 * objek lama sudah tersapu sebelum signed URL baru diterbitkan).
 */
describe("createSignedUploadUrl({ upsert: true }) — PUT ke path yang sudah berisi objek (Fix 1)", () => {
  const materiId = "00000000-0000-4000-8000-00000000fee1";
  const objek = namaObjekHalaman(materiId, 1);

  afterAll(async () => {
    await admin.storage.from(BUCKET).remove([objek]);
  });

  it("upsert:false (bawaan) DITOLAK, upsert:true DITERIMA — untuk path yang sama", async () => {
    const gambarA = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "#ffffff" },
    })
      .webp()
      .toBuffer();
    const { error: eAwal } = await admin.storage
      .from(BUCKET)
      .upload(objek, gambarA, { contentType: "image/webp" });
    expect(eAwal).toBeNull();

    const gambarB = await sharp({
      create: { width: 3, height: 3, channels: 3, background: "#000000" },
    })
      .webp()
      .toBuffer();

    // TANPA upsert (bawaan storage-js: upsert: false / x-upsert: false) —
    // PUT ke path yang sudah berisi objek WAJIB ditolak. Ini membuktikan sisi
    // "sebelum" dari Fix 1: tanpa `{ upsert: true }`, unggahan ulang ke
    // objek lama pasti gagal.
    //
    // TEMUAN EMPIRIS (bukan diasumsikan dari dokumentasi storage-js):
    // penolakannya terjadi SESAAT `createSignedUploadUrl()` sendiri
    // dipanggil ("The resource already exists", 400/KeyAlreadyExists) —
    // BUKAN belakangan saat PUT ke signedUrl-nya. Storage backend menolak
    // MENERBITKAN token untuk path yang sudah berisi objek ketika upsert
    // tidak diminta; ia tidak menunggu sampai byte-nya benar-benar dikirim.
    // Konsekuensinya bagi `terbitkanUrlUnggahHalaman` (unggah.ts) sebelum
    // Fix 1: begitu loop-nya sampai pada halaman bernomor yang objek
    // lamanya belum tersapu (>100, akibat bug `.list()` di describe di
    // atas), `createSignedUploadUrl` pada halaman itu SENDIRI gagal, dan
    // seluruh fungsi mengembalikan `{ ok:false }` SEBELUM satu token pun
    // diserahkan ke peramban — bukan menunggu upload paralel di tengah
    // jalan yang throw. Efek akhirnya identik: `catatHalamanMateri` tidak
    // pernah terpanggil dan materi berakhir nol halaman.
    const { data: tanpaUpsert, error: eTanpaUpsert } = await admin.storage
      .from(BUCKET)
      .createSignedUploadUrl(objek);
    expect(
      eTanpaUpsert,
      "createSignedUploadUrl TANPA upsert seharusnya DITOLAK untuk path yang sudah berisi objek",
    ).not.toBeNull();
    expect(tanpaUpsert).toBeNull();

    // DENGAN `{ upsert: true }` — inilah baris yang unggah.ts sekarang
    // panggil. PUT ke path yang SAMA, yang masih berisi objek dari upload
    // pertama di atas, harus SUKSES.
    const { data: denganUpsert, error: eDenganUpsert } = await admin.storage
      .from(BUCKET)
      .createSignedUploadUrl(objek, { upsert: true });
    expect(eDenganUpsert).toBeNull();
    const resDenganUpsert = await fetch(denganUpsert!.signedUrl, {
      method: "PUT",
      headers: { "Content-Type": "image/webp" },
      body: gambarB,
    });
    expect(
      resDenganUpsert.ok,
      `PUT dengan upsert:true seharusnya DITERIMA — status ${resDenganUpsert.status}`,
    ).toBe(true);

    // Dan isinya SUNGGUH tertimpa (bukan sekadar "diterima tanpa efek").
    const { data: unduhan } = await admin.storage.from(BUCKET).download(objek);
    const bytesAkhir = Buffer.from(await unduhan!.arrayBuffer());
    const meta = await sharp(bytesAkhir).metadata();
    expect(meta.width).toBe(3);
    expect(meta.height).toBe(3);
  });
});
