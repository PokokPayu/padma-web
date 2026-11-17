import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { normalisasiNominal } from "@/lib/doku/nominal";
import { buatPembayaranDoku, bacaStatusDoku } from "@/lib/doku/adapter";
import { hitungDigest, hitungTandaTangan, rakitKomponenTandaTangan } from "@/lib/doku/tanda-tangan";
import { PATH_BUAT_PEMBAYARAN, pathStatusDoku } from "@/lib/doku/konfig";

const KUNCI = "kunci-uji-doku";
const KLIEN = "klien-uji-doku";
const INVOICE = "PSN261112A1B2C31";

type Tangkapan = { url: string; init: RequestInit };
let tangkap: Tangkapan[] = [];

function stubFetch(jawab: () => Response | Promise<Response>) {
  tangkap = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    tangkap.push({ url: String(url), init });
    return jawab();
  });
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const hdr = (t: Tangkapan, k: string) => (t.init.headers as Record<string, string>)[k];

const permintaan = {
  invoice: INVOICE,
  nominal: 150_000,
  items: [
    { nama: "Sesi kunjungan PADMA", harga: 100_000 },
    { nama: "Biaya transport", harga: 50_000 },
  ],
  menitBerlaku: 90,
  callbackUrl: "https://padma.test/passport/pesanan",
};

beforeEach(() => {
  vi.stubEnv("DOKU_CLIENT_ID", KLIEN);
  vi.stubEnv("DOKU_SECRET_KEY", KUNCI);
  vi.stubEnv("DOKU_PRODUKSI", "false");
  vi.stubEnv("NEXT_PUBLIC_BASIS_URL", "https://padma.test");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("normalisasiNominal", () => {
  it("menerima bilangan bulat dan string bulat/berpecahan nol", () => {
    expect(normalisasiNominal(150000)).toBe(150000);
    expect(normalisasiNominal("150000")).toBe(150000);
    expect(normalisasiNominal("150000.00")).toBe(150000);
    expect(normalisasiNominal(0)).toBe(0);
  });
  it("menolak pecahan bukan nol dan bentuk asing", () => {
    for (const v of [150000.5, "150000.50", "1e5", "-1", "", null, {}, undefined, -5, "15.0.0"]) {
      expect(normalisasiNominal(v)).toBeNull();
    }
  });
});

describe("buatPembayaranDoku", () => {
  it("mengirim POST bertanda tangan sah atas header dan badan yang tertangkap", async () => {
    stubFetch(() =>
      json({ response: { payment: { url: "https://sandbox.doku.test/bayar/x", token_id: "tok-1" } } }),
    );
    const r = await buatPembayaranDoku(permintaan);
    expect(r).toEqual({ ok: true, url: "https://sandbox.doku.test/bayar/x", tokenId: "tok-1" });

    expect(tangkap).toHaveLength(1);
    const t = tangkap[0];
    expect(t.url).toBe(`https://api-sandbox.doku.com${PATH_BUAT_PEMBAYARAN}`);
    expect(t.init.method).toBe("POST");
    expect(hdr(t, "Client-Id")).toBe(KLIEN);
    expect(hdr(t, "Request-Id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(hdr(t, "Request-Timestamp")).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    const dugaan = hitungTandaTangan(
      rakitKomponenTandaTangan({
        clientId: hdr(t, "Client-Id"),
        requestId: hdr(t, "Request-Id"),
        requestTimestamp: hdr(t, "Request-Timestamp"),
        requestTarget: PATH_BUAT_PEMBAYARAN,
        digest: hitungDigest(t.init.body as string),
      }),
      KUNCI,
    );
    expect(hdr(t, "Signature")).toBe(dugaan);
  });

  it("badan: nominal, invoice, line_items, callback, tanpa customer", async () => {
    stubFetch(() => json({ response: { payment: { url: "https://x.test/b", token_id: "t" } } }));
    await buatPembayaranDoku(permintaan);
    const b = JSON.parse(tangkap[0].init.body as string);
    expect(b.order.amount).toBe(150_000);
    expect(b.order.invoice_number).toBe(INVOICE);
    expect(b.order.line_items).toEqual([
      { name: "Sesi kunjungan PADMA", price: 100_000, quantity: 1 },
      { name: "Biaya transport", price: 50_000, quantity: 1 },
    ]);
    expect(b.order.callback_url).toBe(permintaan.callbackUrl);
    expect(b.order.auto_redirect).toBe(true);
    expect(b.order.recover_abandoned_cart).toBe(false);
    expect(b.payment.payment_due_date).toBe(90);
    // Dicek di dua tingkat: DOKU menaruh `customer` di puncak badan, tetapi
    // penyelipan di dalam `order` sama-sama membocorkan data pribadi.
    expect("customer" in b).toBe(false);
    expect("customer" in b.order).toBe(false);
  });

  it("400 -> ok:false tanpa membocorkan error_messages ke pesan", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetch(() => json({ error_messages: ["RAHASIA-FIELD-DITOLAK"] }, 400));
    const r = await buatPembayaranDoku(permintaan);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("RAHASIA-FIELD-DITOLAK");
  });

  it("200 TANPA response.payment.url -> ok:false dan tidak melempar (gagal tertutup)", async () => {
    // Tautan bayar yang hilang tidak boleh lolos sebagai `ok:true` dengan url
    // kosong: pembeli akan dialihkan ke halaman kosong dan merasa sudah bayar.
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const badan of [{}, { response: {} }, { response: { payment: {} } }, { response: { payment: { url: "" } } }]) {
      stubFetch(() => json(badan));
      await expect(buatPembayaranDoku(permintaan)).resolves.toMatchObject({ ok: false });
    }
  });

  it("200 dengan badan BUKAN JSON -> ok:false dan tidak melempar", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetch(() => new Response("<html>bukan json</html>", { status: 200 }));
    await expect(buatPembayaranDoku(permintaan)).resolves.toMatchObject({ ok: false });
  });

  it("lempar jaringan -> ok:false", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetch(() => {
      throw new Error("ECONNRESET");
    });
    expect((await buatPembayaranDoku(permintaan)).ok).toBe(false);
  });

  it("kunci kosong -> ok:false, nol panggilan", async () => {
    vi.stubEnv("DOKU_SECRET_KEY", "");
    stubFetch(() => json({}));
    expect((await buatPembayaranDoku(permintaan)).ok).toBe(false);
    expect(tangkap).toHaveLength(0);
  });

  it("Σ item != nominal -> ok:false, nol panggilan", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetch(() => json({}));
    const r = await buatPembayaranDoku({ ...permintaan, nominal: 150_001 });
    expect(r.ok).toBe(false);
    expect(tangkap).toHaveLength(0);
  });
});

describe("bacaStatusDoku", () => {
  it("GET ditandatangani tanpa baris Digest; nominal dinormalkan", async () => {
    stubFetch(() =>
      json({
        order: { invoice_number: INVOICE, amount: "150000.00" },
        transaction: { status: "SUCCESS" },
      }),
    );
    const r = await bacaStatusDoku(INVOICE);
    expect(r).toMatchObject({
      ok: true,
      status: { invoice: INVOICE, status: "SUCCESS", nominal: 150000 },
    });
    const t = tangkap[0];
    expect(t.url).toBe(`https://api-sandbox.doku.com${pathStatusDoku(INVOICE)}`);
    expect(t.init.method).toBe("GET");
    const komponen = rakitKomponenTandaTangan({
      clientId: hdr(t, "Client-Id"),
      requestId: hdr(t, "Request-Id"),
      requestTimestamp: hdr(t, "Request-Timestamp"),
      requestTarget: pathStatusDoku(INVOICE),
      digest: null,
    });
    expect(komponen).not.toContain("Digest");
    expect(hdr(t, "Signature")).toBe(hitungTandaTangan(komponen, KUNCI));
  });

  it("404 -> kode 404; 503 -> kode 503", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetch(() => json({}, 404));
    expect(await bacaStatusDoku(INVOICE)).toMatchObject({ ok: false, kode: 404 });
    stubFetch(() => json({}, 503));
    expect(await bacaStatusDoku(INVOICE)).toMatchObject({ ok: false, kode: 503 });
  });

  it("lempar -> kode 0; 200 tanpa transaction.status -> kode 0", async () => {
    stubFetch(() => {
      throw new Error("timeout");
    });
    expect(await bacaStatusDoku(INVOICE)).toMatchObject({ ok: false, kode: 0 });
    stubFetch(() => json({ order: { invoice_number: INVOICE, amount: "1" } }));
    expect(await bacaStatusDoku(INVOICE)).toMatchObject({ ok: false, kode: 0 });
  });

  it("kunci kosong -> kode -1, nol panggilan", async () => {
    vi.stubEnv("DOKU_CLIENT_ID", "");
    stubFetch(() => json({}));
    expect(await bacaStatusDoku(INVOICE)).toMatchObject({ ok: false, kode: -1 });
    expect(tangkap).toHaveLength(0);
  });
});
