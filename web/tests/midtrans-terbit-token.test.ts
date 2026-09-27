/**
 * `terbitkanTokenSnap` — utang uji yang ditinggalkan Tugas 8, dibayar di sini.
 *
 * Laporan T8 mencatatnya sendiri: "satu-satunya berkas PADMA yang mengirim uang
 * ke Midtrans kini punya satu fungsi tanpa uji, dan T9 yang akan membayarnya".
 * T9 adalah pemakai pertamanya — rute checkout — jadi di sinilah fungsi itu
 * berhenti menjadi kode yang hanya dibaca.
 *
 * `tests/midtrans-konfig.test.ts` sudah menjaga PEMILIHAN lingkungan dan
 * `bacaStatusTransaksi`. Yang tinggal, dan yang dijaga berkas ini, adalah
 * PERMINTAAN yang benar-benar dikirim ke Snap:
 *
 *   1. kunci server kosong -> menolak TANPA satu pun permintaan keluar. Ini
 *      bukan kerapian: permintaan tanpa kunci dijawab 401 oleh Midtrans, dan
 *      pembeli melihat "coba lagi" untuk keadaan yang tidak akan pernah
 *      berubah sampai seseorang memasang env.
 *   2. isi payload — `order_id`, `gross_amount`, dan `expiry` adalah tiga
 *      medan yang salahnya tidak melahirkan galat apa pun, hanya tagihan yang
 *      keliru atau VA yang hidup lebih lama dari `kedaluwarsa_pada` kita.
 *   3. `item_details.name` dipotong 50 karakter — Midtrans menolak yang lebih
 *      panjang, dan judul produk PADMA tidak dibatasi apa pun.
 *   4. tidak pernah melempar. Kegagalan pihak ketiga dipulangkan sebagai nilai
 *      karena rute checkout punya jawaban yang lebih baik daripada 500.
 *   5. pesan galat Midtrans TIDAK bocor ke pembeli.
 *
 * `fetch` DI-STUB di setiap kasus. Bukan sekadar kepatuhan pada
 * `tests/setup-fetch-guard.ts`: `api.midtrans.com` maupun Snap produksi tidak
 * boleh pernah muncul di daftar putih berkas itu, karena satu permintaan yang
 * lolos ke sana adalah peristiwa uang sungguhan.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { terbitkanTokenSnap } from "@/lib/midtrans/adapter";
import { JAM_TENGGAT_PESANAN } from "@/lib/pesanan/status";

const KUNCI = "SB-Mid-server-uji-tidak-pernah-dipakai-sungguhan";
const kunciAsli = process.env.MIDTRANS_SERVER_KEY;
const produksiAsli = process.env.MIDTRANS_PRODUKSI;

afterEach(() => {
  if (kunciAsli === undefined) delete process.env.MIDTRANS_SERVER_KEY;
  else process.env.MIDTRANS_SERVER_KEY = kunciAsli;
  if (produksiAsli === undefined) delete process.env.MIDTRANS_PRODUKSI;
  else process.env.MIDTRANS_PRODUKSI = produksiAsli;
  vi.unstubAllGlobals();
});

/** Satu permintaan yang bentuknya sah, supaya tiap kasus hanya mengubah satu hal. */
const permintaan = {
  orderId: "PSN-260927-A1B2C3.1",
  nominal: 150_000,
  judul: "Panduan Menyusui",
  kedaluwarsaJam: JAM_TENGGAT_PESANAN,
};

function stubJawaban(status: number, isi: unknown) {
  const mata = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => isi,
  } as unknown as Response);
  vi.stubGlobal("fetch", mata);
  return mata;
}

describe("terbitkanTokenSnap — kunci server", () => {
  it("MIDTRANS_SERVER_KEY kosong -> menolak, dan NOL permintaan keluar", async () => {
    delete process.env.MIDTRANS_SERVER_KEY;
    const mata = vi.fn();
    vi.stubGlobal("fetch", mata);

    expect(await terbitkanTokenSnap(permintaan)).toEqual({
      ok: false,
      pesan: "Pembayaran belum aktif. Hubungi tim PADMA.",
    });
    // Geser pemeriksaan kunci ke BAWAH `fetch` dan baris ini merah walau
    // bentuk pulangannya masih terlihat benar: Midtrans menjawab 401, dan
    // pembeli diberi tahu "coba lagi" untuk keadaan yang tidak akan berubah.
    expect(mata).not.toHaveBeenCalled();
  });
});

describe("terbitkanTokenSnap — permintaan yang benar-benar dikirim", () => {
  it("menembak Snap SANDBOX, dengan Basic auth berkata sandi kosong", async () => {
    process.env.MIDTRANS_SERVER_KEY = KUNCI;
    delete process.env.MIDTRANS_PRODUKSI;
    const mata = stubJawaban(201, { token: "token-snap-uji" });

    await terbitkanTokenSnap(permintaan);

    const [url, opsi] = mata.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://app.sandbox.midtrans.com/snap/v1/transactions");
    // Pagar uang sungguhan: host produksi tidak boleh pernah tersentuh dari
    // dalam suite, dan ia juga tidak ada di daftar putih setup-fetch-guard.
    expect(url).not.toContain("app.midtrans.com");
    expect(url).not.toContain("api.midtrans.com");
    expect(opsi.method).toBe("POST");

    // Basic auth Midtrans: server key sebagai username, password KOSONG.
    // Titik dua di ujung bukan salah ketik — tanpanya Midtrans menjawab 401.
    const otorisasi = (opsi.headers as Record<string, string>).authorization;
    expect(otorisasi).toBe(`Basic ${Buffer.from(`${KUNCI}:`).toString("base64")}`);
  });

  it("payload memuat order_id, gross_amount, dan expiry dalam JAM", async () => {
    process.env.MIDTRANS_SERVER_KEY = KUNCI;
    const mata = stubJawaban(201, { token: "token-snap-uji" });

    await terbitkanTokenSnap(permintaan);

    const [, opsi] = mata.mock.calls[0] as [string, RequestInit];
    const badan = JSON.parse(String(opsi.body)) as {
      transaction_details: { order_id: string; gross_amount: number };
      item_details: { id: string; price: number; quantity: number; name: string }[];
      expiry: { unit: string; duration: number };
    };

    expect(badan.transaction_details).toEqual({
      order_id: "PSN-260927-A1B2C3.1",
      gross_amount: 150_000,
    });
    expect(badan.item_details).toEqual([
      { id: "PSN-260927-A1B2C3.1", price: 150_000, quantity: 1, name: "Panduan Menyusui" },
    ]);
    // Satuannya JAM, dan angkanya konstanta yang sama dengan kolom
    // `kedaluwarsa_pada`. `unit: "hour"` yang tertulis "hours" atau "minute"
    // membuat VA hidup jauh lebih lama atau jauh lebih pendek dari tenggat
    // kita — dua kegagalan simetris yang tidak melahirkan galat apa pun.
    expect(badan.expiry).toEqual({ unit: "hour", duration: JAM_TENGGAT_PESANAN });
  });

  it("judul lebih dari 50 karakter DIPOTONG — Midtrans menolak yang lebih panjang", async () => {
    process.env.MIDTRANS_SERVER_KEY = KUNCI;
    const mata = stubJawaban(201, { token: "token-snap-uji" });

    const panjang = "Panduan Lengkap Menyusui untuk Ibu Baru Sejak Hari Pertama";
    expect(panjang.length).toBeGreaterThan(50);
    await terbitkanTokenSnap({ ...permintaan, judul: panjang });

    const [, opsi] = mata.mock.calls[0] as [string, RequestInit];
    const badan = JSON.parse(String(opsi.body)) as { item_details: { name: string }[] };
    expect(badan.item_details[0].name).toHaveLength(50);
    expect(badan.item_details[0].name.startsWith("Panduan Lengkap Menyusui")).toBe(true);
  });

  it("judul 50 karakter atau kurang dibiarkan UTUH", async () => {
    // Pasangan dari kasus di atas: pemotong yang terlalu rajin memenggal judul
    // yang sah, dan pembeli melihat nama produk yang terpangkas di layar Snap.
    process.env.MIDTRANS_SERVER_KEY = KUNCI;
    const mata = stubJawaban(201, { token: "token-snap-uji" });

    const pas = "x".repeat(50);
    await terbitkanTokenSnap({ ...permintaan, judul: pas });

    const [, opsi] = mata.mock.calls[0] as [string, RequestInit];
    const badan = JSON.parse(String(opsi.body)) as { item_details: { name: string }[] };
    expect(badan.item_details[0].name).toBe(pas);
  });
});

describe("terbitkanTokenSnap — kegagalan dipulangkan sebagai nilai, tidak pernah dilempar", () => {
  it("jaringan mati -> ok:false berkalimat, bukan exception", async () => {
    // Rute checkout menjawab 502 dan MEMBIARKAN pesanannya hidup untuk diulang.
    // Exception yang lolos dari sini akan menjadi 500 dan pesanan yatim.
    process.env.MIDTRANS_SERVER_KEY = KUNCI;
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("jaringan mati (disengaja oleh uji)")));

    expect(await terbitkanTokenSnap(permintaan)).toEqual({
      ok: false,
      pesan: "Layanan pembayaran tidak bisa dihubungi.",
    });
  });

  it("Snap menolak 400 -> ok:false, dan error_messages TIDAK bocor ke pembeli", async () => {
    process.env.MIDTRANS_SERVER_KEY = KUNCI;
    stubJawaban(400, {
      error_messages: ["transaction_details.gross_amount is not equal to the sum of item_details"],
    });

    const hasil = await terbitkanTokenSnap(permintaan);
    expect(hasil.ok).toBe(false);
    const pesan = (hasil as { ok: false; pesan: string }).pesan;
    expect(pesan).toBe("Pembayaran belum bisa dimulai. Coba lagi sebentar lagi.");
    // Pesan Midtrans berguna di LOG SERVER dan tidak berarti apa-apa bagi
    // pembeli — ia menyebut nama medan API kita.
    expect(pesan).not.toContain("gross_amount");
    expect(pesan).not.toContain("item_details");
  });

  it("HTTP 200 TANPA token -> ok:false, bukan ok:true bertoken undefined", async () => {
    // Bentuk kegagalan tanpa pagar ini: rute checkout memulangkan
    // `{ token: undefined }` dengan status 200, `snap.pay(undefined)` dipanggil
    // di peramban, dan pembeli melihat popup kosong tanpa satu pun pesan.
    process.env.MIDTRANS_SERVER_KEY = KUNCI;
    stubJawaban(200, { redirect_url: "https://app.sandbox.midtrans.com/snap/v4/redirection/x" });

    expect(await terbitkanTokenSnap(permintaan)).toEqual({
      ok: false,
      pesan: "Pembayaran belum bisa dimulai. Coba lagi sebentar lagi.",
    });
  });

  it("jawaban yang bukan JSON -> ok:false, bukan exception", async () => {
    process.env.MIDTRANS_SERVER_KEY = KUNCI;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("bukan JSON (disengaja oleh uji)");
        },
      } as unknown as Response),
    );

    expect(await terbitkanTokenSnap(permintaan)).toEqual({
      ok: false,
      pesan: "Pembayaran belum bisa dimulai. Coba lagi sebentar lagi.",
    });
  });

  it("token terbit -> ok:true dengan tokennya", async () => {
    process.env.MIDTRANS_SERVER_KEY = KUNCI;
    stubJawaban(201, { token: "token-snap-uji", redirect_url: "https://app.sandbox.midtrans.com/x" });

    expect(await terbitkanTokenSnap(permintaan)).toEqual({ ok: true, token: "token-snap-uji" });
  });
});
