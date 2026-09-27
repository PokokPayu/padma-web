import { describe, it, expect, afterEach, vi } from "vitest";
import { midtransProduksi, basisSnap, basisApiMidtrans, urlSkripSnap } from "@/lib/midtrans/konfig";
import { bacaStatusTransaksi } from "@/lib/midtrans/adapter";

/**
 * `MIDTRANS_PRODUKSI` — HANYA nilai `"true"` PERSIS.
 *
 * Empat fungsi di `konfig.ts` memutuskan ke mana uang sungguhan dikirim, dan
 * sampai berkas ini lahir tidak satu pun punya uji. Spec menaruh aturan ini di
 * daftar env dengan huruf tebal DAN menyebut sendiri bentuk kegagalannya:
 * pratinjau Vercel berjalan dengan `NODE_ENV=production` dan akan menembak
 * Midtrans produksi — uang sungguhan dari lingkungan yang dibuat untuk
 * coba-coba.
 *
 * Skenario konkretnya satu commit jauhnya: seseorang membaca
 * `MIDTRANS_PRODUKSI=false` di `.env.example` lalu menulis
 * `return Boolean(process.env.MIDTRANS_PRODUKSI)` atau `!== "false"` — dua
 * bentuk yang terlihat setara sekilas. `Boolean("false")` adalah `true`. Sejak
 * commit itu SETIAP pratinjau dan setiap mesin dev yang memasang env apa pun
 * menembak `api.midtrans.com` dengan kunci produksi, ke pesanan yang basis
 * datanya basis data coba-coba. Arah kegagalan yang aman di sini hanya satu:
 * apa pun yang tidak persis `"true"` jatuh ke sandbox.
 */
const asli = process.env.MIDTRANS_PRODUKSI;

afterEach(() => {
  if (asli === undefined) delete process.env.MIDTRANS_PRODUKSI;
  else process.env.MIDTRANS_PRODUKSI = asli;
});

function pasang(nilai: string | undefined): void {
  if (nilai === undefined) delete process.env.MIDTRANS_PRODUKSI;
  else process.env.MIDTRANS_PRODUKSI = nilai;
}

describe("MIDTRANS_PRODUKSI memilih lingkungan", () => {
  it('nilai "true" PERSIS — dan hanya itu — memilih produksi', () => {
    pasang("true");
    expect(midtransProduksi()).toBe(true);
    expect(basisSnap()).not.toContain(".sandbox.");
    expect(basisApiMidtrans()).not.toContain(".sandbox.");
    expect(basisSnap()).toBe("https://app.midtrans.com/snap/v1");
    expect(basisApiMidtrans()).toBe("https://api.midtrans.com/v2");
  });

  it.each([["TRUE"], ["True"], ["1"], ["yes"], ["false"], [""], [undefined]])(
    "nilai %p jatuh ke SANDBOX",
    (nilai) => {
      pasang(nilai as string | undefined);
      expect(midtransProduksi()).toBe(false);
      expect(basisSnap()).toContain(".sandbox.");
      expect(basisApiMidtrans()).toContain(".sandbox.");
    },
  );

  it("urlSkripSnap memakai PARAMETERNYA, bukan env", () => {
    // Pasangan dari larangan negatif di tests/produk-tombol-beli.test.tsx:
    // `MIDTRANS_PRODUKSI` tanpa prefiks NEXT_PUBLIC_ berarti komponen klien
    // yang membacanya sendiri SELALU mendapat undefined — sandbox, di
    // produksi, tanpa satu pun galat. Karena itu pilihannya dioper.
    pasang("true");
    expect(urlSkripSnap(false)).toContain("app.sandbox.midtrans.com");
    expect(urlSkripSnap(true)).toBe("https://app.midtrans.com/snap/snap.js");
  });
});

describe("bacaStatusTransaksi membedakan kunci kosong dari jaringan mati", () => {
  const kunciAsli = process.env.MIDTRANS_SERVER_KEY;

  afterEach(() => {
    if (kunciAsli === undefined) delete process.env.MIDTRANS_SERVER_KEY;
    else process.env.MIDTRANS_SERVER_KEY = kunciAsli;
    vi.unstubAllGlobals();
  });

  it("MIDTRANS_SERVER_KEY kosong -> kode -1, NOL fetch dipanggil", async () => {
    delete process.env.MIDTRANS_SERVER_KEY;
    const fetchMataMata = vi.fn();
    vi.stubGlobal("fetch", fetchMataMata);

    const hasil = await bacaStatusTransaksi("PSN-260927-KUNCIKOSONG");

    expect(hasil).toEqual({
      ok: false,
      kode: -1,
      pesan: "Kunci Midtrans belum dipasang.",
    });
    // Baris inilah yang membuat pagar ini berguna: geser pengecekan kunci ke
    // BAWAH pemanggilan fetch, dan baris ini merah walau bentuk pulangannya
    // sendiri masih terlihat benar.
    expect(fetchMataMata).not.toHaveBeenCalled();
  });

  it("kunci TERPASANG tapi Midtrans tidak terjawab -> kode 0, bukan -1", async () => {
    process.env.MIDTRANS_SERVER_KEY = "SB-Mid-server-uji-tidak-pernah-dipakai-sungguhan";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("jaringan mati (disengaja oleh uji)")),
    );

    const hasil = await bacaStatusTransaksi("PSN-260927-JARINGANMATI");

    expect(hasil).toEqual({
      ok: false,
      kode: 0,
      pesan: "Layanan pembayaran tidak bisa dihubungi.",
    });
  });
});
