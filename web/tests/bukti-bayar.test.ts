/**
 * BUKTI BAYAR — BUCKET PRIVAT & RUTE BERTANDA (spec C2 P3).
 *
 * Bukti transfer memuat data yang PADMA tidak minta: nama pemilik rekening,
 * nomor rekening, dan sering kali saldo. Yang dijaga berkas ini adalah bahwa
 * data itu tidak bisa disentuh siapa pun kecuali staf, lewat satu pintu.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { anonClient, signInAs } from "./helpers/as-user";
import { querySql } from "./helpers/db";
import { kunciBukti, jenisBuktiSah, MAKS_BYTE_BUKTI } from "@/lib/bukti/kunci";

const admin = createAdminSupabase();
const PERMINTAAN_PALSU = "11111111-2222-3333-4444-555555555555";

describe("bucket bukti-bayar tertutup rapat", () => {
  it("ada, PRIVAT, berbatas ukuran, dan hanya menerima gambar", async () => {
    const baris = await querySql<{
      public: boolean;
      file_size_limit: number;
      allowed_mime_types: string[];
    }>(
      `select public, file_size_limit, allowed_mime_types
         from storage.buckets where id = 'bukti-bayar'`,
    );
    expect(baris.length).toBe(1);
    expect(baris[0].public).toBe(false);
    expect(Number(baris[0].file_size_limit)).toBe(MAKS_BYTE_BUKTI);
    expect([...baris[0].allowed_mime_types].sort()).toEqual(
      ["image/jpeg", "image/png", "image/webp"].sort(),
    );
  });

  it("TIDAK ADA satu pun policy untuk bucket ini", async () => {
    // Tanpa policy, `anon` dan `authenticated` tidak bisa menyentuh objeknya
    // sama sekali — hanya service role dari route handler kita. Ini pagar
    // pertama dan paling murah: path yang bocor tetap tidak bisa ditukar jadi
    // byte. Pola yang sama dengan bucket `materi-halaman`.
    const baris = await querySql<{ policyname: string; qual: string | null }>(
      `select policyname, qual::text
         from pg_policies
        where schemaname = 'storage' and tablename = 'objects'`,
    );
    const menyebutBukti = baris.filter((b) => (b.qual ?? "").includes("bukti-bayar"));
    expect(menyebutBukti).toEqual([]);
  });

  it("anon tidak bisa mengunduh objek walau tahu persis kuncinya", async () => {
    // Kunci objek bukan rahasia — ia lahir dari id pengajuan yang bisa saja
    // pernah muncul di layar. Yang menjaga adalah hak, bukan ketidaktahuan.
    const kunci = kunciBukti(PERMINTAAN_PALSU, "image/jpeg");
    await admin.storage
      .from("bukti-bayar")
      .upload(kunci, new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }), {
        contentType: "image/jpeg",
        upsert: true,
      });

    const { data, error } = await anonClient().storage.from("bukti-bayar").download(kunci);
    expect(data === null || error !== null).toBe(true);

    await admin.storage.from("bukti-bayar").remove([kunci]);
  });

  it("klien yang LOGIN pun tidak bisa mengunduh langsung", async () => {
    const kunci = kunciBukti(PERMINTAAN_PALSU, "image/jpeg");
    await admin.storage
      .from("bukti-bayar")
      .upload(kunci, new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }), {
        contentType: "image/jpeg",
        upsert: true,
      });

    const sesi = await signInAs("ananda@padma.test");
    const { data, error } = await sesi.storage.from("bukti-bayar").download(kunci);
    expect(data === null || error !== null).toBe(true);

    await admin.storage.from("bukti-bayar").remove([kunci]);
  });
});

describe("kunci objek tidak bisa dikarang pemanggil", () => {
  it("diturunkan dari id pengajuan, bukan dari nama berkas kiriman", () => {
    // Nama berkas datang dari peramban dan bisa memuat `../` atau nama orang
    // lain. Id pengajuan sudah unik dan sudah dimiliki satu klien — path
    // traversal karena itu tidak punya pintu masuk sama sekali.
    expect(kunciBukti("abc-123", "image/jpeg")).toBe("abc-123/bukti.jpg");
    expect(kunciBukti("abc-123", "image/png")).toBe("abc-123/bukti.png");
    expect(kunciBukti("abc-123", "image/webp")).toBe("abc-123/bukti.webp");
  });

  it("ekstensi diturunkan dari JENIS yang sudah divalidasi", () => {
    // Jenis yang tidak dikenal tidak pernah sampai ke sini (rute menolaknya
    // lebih dulu), dan bila toh sampai, ia jatuh ke .jpg — bukan ke ekstensi
    // karangan yang ikut nama berkas.
    expect(kunciBukti("x", "text/html")).toBe("x/bukti.jpg");
  });

  it("hanya tiga jenis gambar yang sah", () => {
    expect(jenisBuktiSah("image/jpeg")).toBe(true);
    expect(jenisBuktiSah("image/png")).toBe(true);
    expect(jenisBuktiSah("image/webp")).toBe(true);
    for (const buruk of ["application/pdf", "text/html", "image/svg+xml", ""]) {
      expect(jenisBuktiSah(buruk), buruk).toBe(false);
    }
  });

  it("SVG ditolak — ia dokumen yang bisa menjalankan skrip, bukan sekadar gambar", () => {
    expect(jenisBuktiSah("image/svg+xml")).toBe(false);
  });
});

describe("rute baca bukti hanya untuk staf", () => {
  it("sumbernya memanggil requireRole sebelum menyentuh storage", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const sumber = readFileSync(
      path.resolve(__dirname, "..", "src/app/api/bukti/[permintaan]/route.ts"),
      "utf8",
    );
    const posisiRole = sumber.indexOf("requireRole");
    const posisiStorage = sumber.indexOf(".storage");
    expect(posisiRole).toBeGreaterThan(-1);
    expect(posisiRole).toBeLessThan(posisiStorage);
  });

  it("responsnya bertanda private & no-store", () => {
    // Bukti bayar milik satu staf pada satu permintaan; CDN yang menyimpannya
    // lalu menyajikannya ke orang lain adalah kebocoran yang tidak akan pernah
    // terlihat di log mana pun.
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const sumber = readFileSync(
      path.resolve(__dirname, "..", "src/app/api/bukti/[permintaan]/route.ts"),
      "utf8",
    );
    expect(sumber).toContain("private, no-store");
  });
});
