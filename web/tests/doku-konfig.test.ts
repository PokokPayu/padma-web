import { describe, it, expect, afterEach, vi } from "vitest";
import {
  dokuProduksi,
  clientIdDoku,
  secretKeyDoku,
  basisApiDoku,
  pathStatusDoku,
  urlKembali,
  PATH_WEBHOOK_DOKU,
  PATH_BUAT_PEMBAYARAN,
} from "@/lib/doku/konfig";

/**
 * vitest memuat `.env.local`, yang berisi kredensial sandbox sungguhan. Setiap
 * uji di sini memasang SENDIRI semua yang dibacanya (nilai palsu), dan
 * `unstubAllEnvs` mengembalikannya.
 */
afterEach(() => vi.unstubAllEnvs());

describe("dokuProduksi / basisApiDoku", () => {
  it('"true" persis memilih produksi', () => {
    vi.stubEnv("DOKU_PRODUKSI", "true");
    expect(dokuProduksi()).toBe(true);
    expect(basisApiDoku()).toBe("https://api.doku.com");
  });

  it.each(["TRUE", "1", "false", ""])("%j jatuh ke sandbox", (nilai) => {
    vi.stubEnv("DOKU_PRODUKSI", nilai);
    expect(dokuProduksi()).toBe(false);
    expect(basisApiDoku()).toBe("https://api-sandbox.doku.com");
  });

  it("tidak dipasang jatuh ke sandbox", () => {
    vi.stubEnv("DOKU_PRODUKSI", undefined);
    expect(dokuProduksi()).toBe(false);
    expect(basisApiDoku()).toBe("https://api-sandbox.doku.com");
  });

  it("NODE_ENV=production tidak memilih produksi", () => {
    vi.stubEnv("DOKU_PRODUKSI", undefined);
    vi.stubEnv("NODE_ENV", "production");
    expect(dokuProduksi()).toBe(false);
  });
});

describe("kunci", () => {
  it("dibaca dari env", () => {
    vi.stubEnv("DOKU_CLIENT_ID", "klien-uji-doku");
    vi.stubEnv("DOKU_SECRET_KEY", "kunci-uji-doku");
    expect(clientIdDoku()).toBe("klien-uji-doku");
    expect(secretKeyDoku()).toBe("kunci-uji-doku");
  });

  it('"" bila tidak dipasang', () => {
    vi.stubEnv("DOKU_CLIENT_ID", undefined);
    vi.stubEnv("DOKU_SECRET_KEY", undefined);
    expect(clientIdDoku()).toBe("");
    expect(secretKeyDoku()).toBe("");
  });
});

describe("path", () => {
  it("konstanta", () => {
    expect(PATH_WEBHOOK_DOKU).toBe("/api/pembayaran/doku");
    expect(PATH_BUAT_PEMBAYARAN).toBe("/checkout/v1/payment");
  });
  it("pathStatusDoku meng-encode invoice", () => {
    expect(pathStatusDoku("PSN261112A1B2C31")).toBe("/orders/v1/status/PSN261112A1B2C31");
    expect(pathStatusDoku("a/b?c")).toBe("/orders/v1/status/a%2Fb%3Fc");
  });
});

describe("urlKembali", () => {
  it("basis spasi saja memulangkan null", () => {
    vi.stubEnv("NEXT_PUBLIC_BASIS_URL", "  ");
    expect(urlKembali("/passport/produk")).toBeNull();
  });
  it("basis kosong / tak dipasang memulangkan null", () => {
    vi.stubEnv("NEXT_PUBLIC_BASIS_URL", "");
    expect(urlKembali("/x")).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_BASIS_URL", undefined);
    expect(urlKembali("/x")).toBeNull();
  });
  it("basis di-trim lalu disambung path", () => {
    vi.stubEnv("NEXT_PUBLIC_BASIS_URL", " https://uji.padma.test ");
    expect(urlKembali("/passport/produk")).toBe("https://uji.padma.test/passport/produk");
  });
  it("garis miring akhir pada basis tidak melahirkan // di callback", () => {
    // Bentuk yang paling mudah diketik di panel env Vercel. `//passport/...`
    // adalah URL lain bagi sebagian server, dan pembeli yang kembali dari
    // DOKU bisa mendarat di 404 sesudah membayar.
    // https: sejak `basisUrlSitus()` (tests/basis-url.test.ts), http publik
    // ditolak; yang diuji di sini garis miring akhirnya, bukan skemanya.
    vi.stubEnv("NEXT_PUBLIC_BASIS_URL", "https://x.test/");
    expect(urlKembali("/passport/produk")).toBe("https://x.test/passport/produk");
    vi.stubEnv("NEXT_PUBLIC_BASIS_URL", " https://uji.padma.test/// ");
    expect(urlKembali("/passport/bayar/abc")).toBe("https://uji.padma.test/passport/bayar/abc");
  });
  it("basis yang hanya garis miring memulangkan null", () => {
    vi.stubEnv("NEXT_PUBLIC_BASIS_URL", "/");
    expect(urlKembali("/x")).toBeNull();
  });
});
