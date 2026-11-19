/**
 * `NEXT_PUBLIC_BASIS_URL` — satu pembaca, dan nilai yang salah bentuk
 * diperlakukan seperti kosong.
 *
 * Diukur 17 Nov 2026 di proyek Vercel dev: nilainya `padma-web-16ot.vercel.app`
 * TANPA `https://`. Tiga pembaca lama hanya memeriksa "kosong atau tidak", jadi
 * nilai itu lolos:
 *   - URL kembali dari DOKU menjadi `padma-web-16ot.vercel.app/passport/...`,
 *     path relatif. Pembeli tidak pulang ke aplikasi sesudah membayar.
 *   - Tautan bayar di email tagihan dan tautan Passport di pesan WhatsApp
 *     admin patah dengan cara yang sama.
 * Kesalahan ketik yang sama di env PRODUKSI baru ketahuan sesudah klien
 * pertama membayar. Karena itu bentuknya diperiksa, bukan sekadar isinya.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { basisUrlSitus } from "@/lib/basis-url";
import { urlKembali } from "@/lib/doku/konfig";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("basisUrlSitus — diterima, dinormalkan ke origin", () => {
  it.each([
    ["https://padmawellnessid.com", "https://padmawellnessid.com"],
    ["https://padmawellnessid.com/", "https://padmawellnessid.com"],
    ["  https://padma-web-16ot.vercel.app///  ", "https://padma-web-16ot.vercel.app"],
    ["http://localhost:3000", "http://localhost:3000"],
    ["http://127.0.0.1:3000/", "http://127.0.0.1:3000"],
  ])("%j → %s", (nilai, harapan) => {
    vi.stubEnv("NEXT_PUBLIC_BASIS_URL", nilai);
    expect(basisUrlSitus()).toBe(harapan);
  });
});

describe("basisUrlSitus — ditolak, sama dengan tidak dipasang", () => {
  it.each([
    ["padma-web-16ot.vercel.app", "tanpa skema (nilai dev sungguhan, 17 Nov)"],
    ["http://padmawellnessid.com", "http publik: tautan bayar tanpa TLS"],
    ["https://padmawellnessid.com/app", "memuat path: rute aplikasi ada di akar"],
    ["https://padmawellnessid.com?x=1", "memuat query"],
    ["ftp://padmawellnessid.com", "skema lain"],
    ["/", "hanya garis miring"],
    ["", "kosong"],
    ["   ", "spasi saja"],
  ])("%j (%s)", (nilai) => {
    vi.stubEnv("NEXT_PUBLIC_BASIS_URL", nilai);
    expect(basisUrlSitus()).toBeNull();
  });

  it("tidak dipasang sama sekali", () => {
    vi.stubEnv("NEXT_PUBLIC_BASIS_URL", undefined as unknown as string);
    expect(basisUrlSitus()).toBeNull();
  });
});

describe("urlKembali DOKU memakai pembaca yang sama", () => {
  it("nilai tanpa skema tidak lagi melahirkan URL kembali relatif", () => {
    vi.stubEnv("NEXT_PUBLIC_BASIS_URL", "padma-web-16ot.vercel.app");
    expect(urlKembali("/passport/produk")).toBeNull();
  });
});

describe("tidak ada pembaca keempat", () => {
  it("NEXT_PUBLIC_BASIS_URL hanya dibaca src/lib/basis-url.ts", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const path = await import("node:path");
    const akar = path.resolve(__dirname, "../src");
    const pembaca: string[] = [];
    const jelajah = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = path.join(dir, n);
        if (statSync(p).isDirectory()) jelajah(p);
        else if (/\.(ts|tsx)$/.test(n) && /process\.env\.NEXT_PUBLIC_BASIS_URL/.test(readFileSync(p, "utf8"))) {
          pembaca.push(path.relative(akar, p));
        }
      }
    };
    jelajah(akar);
    expect(pembaca).toEqual([path.join("lib", "basis-url.ts")]);
  });
});
