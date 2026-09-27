/**
 * TOMBOL BELI — tiga keadaan, dan satu jebakan env yang senyap.
 *
 * Urutan keadaan yang ditampilkan layar TIDAK boleh ditebak, dan spec
 * menyebutnya: entitlement DULU (punya -> tampilkan jalan masuknya), baru
 * `punya_pesanan_menunggu` (-> "Pembayaran Anda sedang diproses"), baru tombol
 * beli. Membaliknya berarti orang yang baru mentransfer lewat VA ditawari
 * membeli lagi — dan sebagian akan membayar dua kali.
 *
 * ===== JEBAKAN ENV, DIUJI SEBAGAI PERILAKU =====
 * `MIDTRANS_PRODUKSI` TIDAK berprefix `NEXT_PUBLIC_`, jadi di peramban ia
 * `undefined`. Komponen klien yang memanggil `midtransProduksi()` karena itu
 * akan SELALU memuat skrip Snap sandbox, di produksi, tanpa satu pun galat —
 * pembayaran yang "berhasil" dengan uang mainan. Dua pagar di bawah:
 *   (a) perilaku — `urlSkripSnap(false)` tetap sandbox WALAU env produksi
 *       terpasang; ia memakai parameternya, bukan env;
 *   (b) sumber — larangan NEGATIF: kedua berkas sisi-peramban tidak boleh
 *       menyebut `midtransProduksi` maupun `process.env` sama sekali. Larangan
 *       negatif tidak bisa dipuaskan oleh sebuah baris impor.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

// `tombol-beli.tsx` mengimpor `punyaProdukDiPeramban` dari `tombol-ambil.tsx`,
// yang menarik server action `ambil.ts` (dan lewat itu `next/cache` serta klien
// Supabase sisi server). Di-mock supaya berkas ini benar-benar hanya menguji
// render.
vi.mock("@/app/produk/[slug]/ambil", () => ({
  ambilProdukGratis: async () => ({ ok: true, punya: true }),
}));

const { PanelBeli, keadaanBeli } = await import("@/app/produk/[slug]/tombol-beli");
const { urlSkripSnap } = await import("@/lib/midtrans/konfig");
const { muatSkripSnap } = await import("@/lib/midtrans/snap-peramban");

const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

const kosong = { slug: "panduan-menyusui", pending: false, pesan: null, onBeli: () => {} };

describe("PanelBeli — tiga keadaan", () => {
  it('belum punya: menawarkan "Beli sekarang"', () => {
    const m = renderToStaticMarkup(<PanelBeli {...kosong} keadaan="belum" />);
    expect(m).toContain("Beli sekarang");
    expect(m).not.toContain("/passport/produk/panduan-menyusui");
    expect(m).not.toContain("sedang diproses");
  });

  it('pembayaran menggantung: "sedang diproses", BUKAN tombol beli', () => {
    // Inilah pagar terhadap pembayaran ganda. Orang yang baru mentransfer lewat
    // VA kembali ke halaman ini sebelum notifikasi mendarat; menawarinya tombol
    // beli berarti sebagian dari mereka membayar dua kali.
    const m = renderToStaticMarkup(<PanelBeli {...kosong} keadaan="menunggu" />);
    expect(m).toContain("sedang diproses");
    expect(m).not.toContain("Beli sekarang");
    // Dan jalan menuju tempat produknya akan muncul.
    expect(m).toContain('href="/passport/produk"');
  });

  it('sudah punya: menawarkan "Buka", bukan "Beli sekarang" lagi', () => {
    const m = renderToStaticMarkup(<PanelBeli {...kosong} keadaan="punya" />);
    expect(m).toContain('href="/passport/produk/panduan-menyusui"');
    expect(m).toContain("Buka");
    expect(m).not.toContain("Beli sekarang");
  });

  it("sedang menyiapkan: tombolnya nonaktif, bukan bisa diklik dua kali", () => {
    const m = renderToStaticMarkup(<PanelBeli {...kosong} keadaan="belum" pending />);
    expect(m).toContain("disabled");
    expect(m).not.toContain("Beli sekarang");
  });

  it("pesan galat dirender apa adanya", () => {
    const m = renderToStaticMarkup(
      <PanelBeli {...kosong} keadaan="belum" pesan="Pembayaran belum bisa dimulai." />,
    );
    expect(m).toContain("Pembayaran belum bisa dimulai.");
  });
});

describe("urutan keadaan — DIJALANKAN, bukan dibaca dari teks sumber", () => {
  /**
   * Spec menuliskan urutannya secara eksplisit justru karena membaliknya
   * memakan uang: "orang yang baru mentransfer lewat VA melihat 'Pembayaran
   * Anda sedang diproses' alih-alih tombol beli, dan tidak membayar dua kali".
   *
   * Kelima uji `PanelBeli` di atas MENERIMA `keadaan` sebagai prop — mereka
   * menguji bahwa tampilan untuk "menunggu" benar, bukan bahwa keadaan
   * "menunggu" pernah dihitung. Tanpa ketiga kasus di bawah, seseorang boleh
   * menukar dua blok keputusannya (klien yang SUDAH punya produknya tapi
   * kebetulan punya pesanan `ditahan` akan melihat "sedang diproses" alih-alih
   * "Buka"), atau menghapus cabang `punya_pesanan_menunggu` sama sekali
   * (setiap orang yang baru mentransfer VA ditawari membeli lagi) — dan tidak
   * ada satu pun yang merah.
   */
  it("entitlement DULU: punya = true menang atas pesanan menunggu", async () => {
    let pesananDitanya = 0;
    const hasil = await keadaanBeli(
      async () => true,
      async () => {
        pesananDitanya += 1;
        return true;
      },
    );
    expect(hasil).toBe("punya");
    // Dan `punya_pesanan_menunggu` TIDAK ditanyakan sama sekali. Inilah
    // assertion yang membongkar pembalikan urutan: kalau blok pesanan
    // dipindahkan ke atas, angka ini jadi 1 dan hasilnya "menunggu".
    expect(pesananDitanya).toBe(0);
  });

  it("belum punya tapi ada pesanan menunggu -> 'menunggu', bukan tombol beli", async () => {
    expect(await keadaanBeli(async () => false, async () => true)).toBe("menunggu");
  });

  it("belum punya dan tidak ada pesanan -> 'belum'", async () => {
    expect(await keadaanBeli(async () => false, async () => false)).toBe("belum");
  });
});

describe("pemilihan sandbox/produksi tidak boleh senyap", () => {
  // Bentuk env-nya sendiri ("HANYA nilai true") dijaga berkas TERSENDIRI milik
  // Tugas 8: `tests/midtrans-konfig.test.ts`, tujuh nilai, nol basis data.
  // Yang tinggal di sini adalah dua hal yang memang milik sisi peramban:
  // bahwa `urlSkripSnap` memakai parameternya, dan larangan negatif atas kedua
  // berkas sisi-klien.
  it("urlSkripSnap memakai PARAMETERNYA, bukan env", () => {
    const sebelum = process.env.MIDTRANS_PRODUKSI;
    process.env.MIDTRANS_PRODUKSI = "true";
    try {
      // Kalau fungsi ini diam-diam membaca env, baris ini merah — dan itulah
      // satu-satunya cara jebakan ini bisa tertangkap sebelum produksi.
      expect(urlSkripSnap(false)).toContain("app.sandbox.midtrans.com");
      expect(urlSkripSnap(true)).toBe("https://app.midtrans.com/snap/snap.js");
    } finally {
      if (sebelum === undefined) delete process.env.MIDTRANS_PRODUKSI;
      else process.env.MIDTRANS_PRODUKSI = sebelum;
    }
  });

  it.each([
    "src/app/produk/[slug]/tombol-beli.tsx",
    "src/lib/midtrans/snap-peramban.ts",
  ])("%s tidak menyebut midtransProduksi maupun process.env", (rel) => {
    const isi = baca(rel);
    expect(isi).not.toContain("midtransProduksi");
    expect(isi).not.toContain("process.env");
  });

  it("page.tsx membaca keduanya di SERVER dan mengopernya sebagai prop", () => {
    const isi = baca("src/app/produk/[slug]/page.tsx");
    expect(isi).toContain("midtransProduksi");
    expect(isi).toContain("NEXT_PUBLIC_MIDTRANS_CLIENT_KEY");
    expect(isi).toContain("produksi={");
    expect(isi).toContain("clientKey={");
  });
});

describe("muatSkripSnap", () => {
  it("MELEMPAR di luar peramban", async () => {
    // Pagar terhadap impor yang salah: dipanggil dari server component ia harus
    // gagal keras, bukan memulangkan promise yang tidak pernah selesai.
    await expect(muatSkripSnap("kunci", false)).rejects.toThrow();
  });
});
