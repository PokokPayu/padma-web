/**
 * TOMBOL BAYAR SESUDAH "KEMBALI" DARI DOKU (bfcache).
 *
 * Ketiga tombol bayar (beli produk, keranjang, tagihan sesi) mengunci dirinya
 * sesudah alihan ke DOKU dimulai (`dialihkan = true`), karena
 * `useTransition` sudah kembali tidak sibuk sementara peramban masih memuat
 * halaman bayar. Pembeli yang menekan Back dari DOKU mendapat halaman yang
 * DIPULIHKAN dari back/forward cache — keadaan React-nya beku persis seperti
 * saat ditinggalkan — dan tombolnya macet pada "Menyiapkan pembayaran..."
 * selamanya. Satu-satunya isyarat peramban untuk itu adalah `pageshow` dengan
 * `persisted === true`.
 *
 * Repo ini tidak memakai jsdom; pola uji komponennya fungsi murni + pembacaan
 * sumber. Yang diuji perilaku pemasangnya (EventTarget Node) dan bahwa ketiga
 * komponen memakainya untuk melepas `dialihkan`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pasangPemulihBfcache } from "@/lib/doku/pulih-bfcache";

const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

function pageshow(persisted: boolean): Event {
  const e = new Event("pageshow");
  Object.defineProperty(e, "persisted", { value: persisted });
  return e;
}

describe("pasangPemulihBfcache", () => {
  it("memanggil pemulih HANYA untuk halaman yang dipulihkan dari bfcache", () => {
    const sasaran = new EventTarget();
    let dipanggil = 0;
    pasangPemulihBfcache(sasaran, () => {
      dipanggil += 1;
    });

    // Muat biasa (bukan dari cache): keadaan memang baru, tidak ada yang
    // perlu dilepas.
    sasaran.dispatchEvent(pageshow(false));
    expect(dipanggil).toBe(0);

    sasaran.dispatchEvent(pageshow(true));
    expect(dipanggil).toBe(1);
  });

  it("pelepasnya mencabut pendengar (cleanup useEffect)", () => {
    const sasaran = new EventTarget();
    let dipanggil = 0;
    const lepas = pasangPemulihBfcache(sasaran, () => {
      dipanggil += 1;
    });
    lepas();
    sasaran.dispatchEvent(pageshow(true));
    expect(dipanggil).toBe(0);
  });
});

describe("ketiga tombol bayar memulihkan diri sesudah Back dari DOKU", () => {
  it.each([
    "src/app/produk/[slug]/tombol-beli.tsx",
    "src/app/passport/keranjang/isi-keranjang.tsx",
    "src/app/passport/bayar/[id]/tombol-bayar.tsx",
  ])("%s", (rel) => {
    const sumber = baca(rel);
    expect(sumber).toMatch(/import \{ pasangPemulihBfcache \} from "@\/lib\/doku\/pulih-bfcache"/);
    // Dipasang di efek, dan pemulihnya MELEPAS kunci alihan.
    expect(sumber).toMatch(
      /useEffect\(\s*\(\)\s*=>\s*pasangPemulihBfcache\(window,\s*\(\)\s*=>\s*setDialihkan\(false\)\),\s*\[\],?\s*\)/,
    );
  });
});
