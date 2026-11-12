/**
 * TOMBOL BELI — tiga keadaan, dan peralihan ke halaman bayar DOKU.
 *
 * Urutan keadaan yang ditampilkan layar TIDAK boleh ditebak, dan spec
 * menyebutnya: entitlement DULU (punya -> tampilkan jalan masuknya), baru
 * `punya_pesanan_menunggu` (-> "Pembayaran Anda sedang diproses"), baru tombol
 * beli. Membaliknya berarti orang yang baru mentransfer lewat VA ditawari
 * membeli lagi — dan sebagian akan membayar dua kali.
 *
 * Pembayaran = alihan penuh ke `payment.url` DOKU (spec §5.1). Tidak ada
 * skrip pihak ketiga, tidak ada popup, dan tidak ada callback peramban.
 */
import { describe, it, expect, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

// `tombol-beli.tsx` mengimpor `punyaProdukDiPeramban` dari `tombol-ambil.tsx`,
// yang menarik server action `ambil.ts` (dan lewat itu `next/cache` serta klien
// Supabase sisi server). Di-mock supaya berkas ini benar-benar hanya menguji
// render.
vi.mock("@/app/produk/[slug]/ambil", () => ({
  ambilProdukGratis: async () => ({ ok: true, punya: true }),
}));

const {
  PanelBeli,
  keadaanBeli,
  mintaCheckout,
  mintaLaluAlihkan,
  mintaBatal,
  pesananYangBisaDibatalkan,
  punyaPesananMenungguDiPeramban,
  BATAS_BARIS_PESANAN,
} = await import("@/app/produk/[slug]/tombol-beli");

const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

/** Satu id produk untuk seluruh berkas — nilainya tidak pernah jadi assertion. */
const PRODUK = "99999999-9999-9999-9999-999999999999";

const kosong = {
  slug: "panduan-menyusui",
  pending: false,
  pesan: null,
  bisaDibatalkan: false,
  onBeli: () => {},
  onBatal: () => {},
};

/** `fetch` palsu yang mencatat apa yang dikirim kepadanya. */
function fetchPalsu(
  jawaban: { status: number; isi?: unknown } | "tolak",
): typeof fetch & { panggilan: { url: string; badan: unknown }[] } {
  const panggilan: { url: string; badan: unknown }[] = [];
  const palsu = (async (masukan: unknown, opsi?: RequestInit) => {
    panggilan.push({
      url: String(masukan),
      badan: opsi?.body === undefined ? null : JSON.parse(String(opsi.body)),
    });
    if (jawaban === "tolak") throw new TypeError("Failed to fetch (disengaja oleh uji)");
    return {
      ok: jawaban.status >= 200 && jawaban.status < 300,
      status: jawaban.status,
      json: async () => jawaban.isi,
    } as Response;
  }) as unknown as typeof fetch & { panggilan: { url: string; badan: unknown }[] };
  palsu.panggilan = panggilan;
  return palsu;
}

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

describe("PanelBeli — jalan keluar untuk yang macet", () => {
  it("menunggu + bisa dibatalkan: menawarkan tombol batal", () => {
    // Tanpa tombol ini, orang yang pembayarannya gagal harus menunggu tenggat
    // 24 jam sebelum bisa memesan apa pun lagi — `pesanan_terbuka_satu_per_klien`
    // yang menahannya. Panelnya adalah satu-satunya layar tempat ia berdiri.
    const m = renderToStaticMarkup(<PanelBeli {...kosong} keadaan="menunggu" bisaDibatalkan />);
    expect(m).toContain("Batalkan pesanan ini");
    expect(m).toContain("Sesudah itu Anda bisa memesan lagi.");
  });

  it("menunggu TANPA pesanan yang bisa dipastikan: nol tombol batal", () => {
    // Pasangan negatifnya, dan ia menjaga hal yang mahal: membatalkan pesanan
    // produk LAIN diam-diam.
    const m = renderToStaticMarkup(<PanelBeli {...kosong} keadaan="menunggu" />);
    expect(m).not.toContain("Batalkan pesanan ini");
    // Kalimat penjelasnya tetap ada — yang hilang hanya aksinya.
    expect(m).toContain("sedang diproses");
  });

  it("pesan galat IKUT TERBAWA ke panel menunggu", () => {
    // `onError` menulis pesannya lalu membaca ulang keadaan, dan pembacaan itu
    // memindahkan panel ke "menunggu". Kalau kalimatnya hanya hidup di cabang
    // "belum", ia lenyap tepat pada kejadian yang paling butuh dijelaskan.
    const m = renderToStaticMarkup(
      <PanelBeli {...kosong} keadaan="menunggu" pesan="Pembayaran gagal. Silakan coba lagi." />,
    );
    expect(m).toContain("Pembayaran gagal. Silakan coba lagi.");
  });

  it("sedang membatalkan: tombol batal nonaktif", () => {
    const m = renderToStaticMarkup(
      <PanelBeli {...kosong} keadaan="menunggu" bisaDibatalkan pending />,
    );
    expect(m).toContain("disabled");
    expect(m).toContain("Membatalkan...");
  });

  it("panel 'punya' dan 'belum' tidak pernah menawarkan pembatalan", () => {
    for (const keadaan of ["punya", "belum"] as const) {
      const m = renderToStaticMarkup(
        <PanelBeli {...kosong} keadaan={keadaan} bisaDibatalkan />,
      );
      expect(m).not.toContain("Batalkan pesanan ini");
    }
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

describe("punyaPesananMenungguDiPeramban gagal TERTUTUP", () => {
  /**
   * Versi pertama menulis `const { data } = await sb.rpc(...)` dan membuang
   * `error`. Bentuk kegagalannya: RPC yang gagal memulangkan `data: null`,
   * `data === true` jadi false, keadaan jatuh ke `"belum"`, dan orang yang
   * BARU SAJA mentransfer lewat VA ditawari membeli lagi — persis kalimat yang
   * spec tulis untuk dicegah.
   *
   * Pagar basis data (`pesanan_terbuka_satu_per_klien`) memang menangkapnya di
   * hilir, jadi nol tagih ganda. Yang hilang bukan uangnya melainkan
   * kalimatnya: pembelinya dapat 409/502 alih-alih "Pembayaran Anda sedang
   * diproses", dan galat itu muncul di layar orang yang tidak melakukan
   * kesalahan apa pun.
   */
  /** `sb` palsu seukuran yang dipakai fungsinya: satu `rpc`, nol tabel. */
  function sbPalsu(jawaban: { data: unknown; error: unknown }) {
    const dipanggil: unknown[] = [];
    const sb = {
      rpc: async (nama: string, arg: unknown) => {
        dipanggil.push({ nama, arg });
        return jawaban;
      },
    };
    return { sb: sb as never, dipanggil };
  }

  it("RPC yang GAGAL dibaca sebagai 'menunggu', bukan sebagai 'belum'", async () => {
    const { sb } = sbPalsu({ data: null, error: { message: "PostgREST tumbang" } });
    const mata = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await punyaPesananMenungguDiPeramban(sb, PRODUK)).toBe(true);
      // Dan kegagalannya TIDAK bisu: tebakan konservatif yang tidak
      // meninggalkan jejak berarti "semua orang melihat 'sedang diproses'"
      // terbaca sama persis dengan "semua orang memang sedang memproses".
      expect(mata).toHaveBeenCalled();
    } finally {
      mata.mockRestore();
    }
  });

  it("jawaban true tetap true, dan produknya yang ditanyakan", async () => {
    const { sb, dipanggil } = sbPalsu({ data: true, error: null });
    expect(await punyaPesananMenungguDiPeramban(sb, PRODUK)).toBe(true);
    expect(dipanggil).toEqual([
      { nama: "punya_pesanan_menunggu", arg: { p_product_id: PRODUK } },
    ]);
  });

  it("jawaban false tetap false — gagal-tertutup tidak boleh jadi selalu-tertutup", async () => {
    const { sb } = sbPalsu({ data: false, error: null });
    expect(await punyaPesananMenungguDiPeramban(sb, PRODUK)).toBe(false);
  });
});

describe("mintaLaluAlihkan — redirect menggantikan Snap", () => {
  it("200 dengan url -> fetch ke checkout, lalu ARAHKAN dipanggil dengan url itu", async () => {
    const ambil = fetchPalsu({
      status: 200,
      isi: { url: "https://sandbox.doku.test/bayar/abc", kode: "PSN-260927-A1B2C3", pesananId: "pesanan-abc" },
    });
    const arahkan = vi.fn();
    const r = await mintaLaluAlihkan("produk-1", false, arahkan, ambil);

    expect(ambil.panggilan).toHaveLength(1);
    expect(ambil.panggilan[0].url).toBe("/api/pesanan/checkout");
    expect(arahkan).toHaveBeenCalledTimes(1);
    expect(arahkan).toHaveBeenCalledWith("https://sandbox.doku.test/bayar/abc");
    expect(r.hasil).toEqual({
      jenis: "url",
      url: "https://sandbox.doku.test/bayar/abc",
      pesananId: "pesanan-abc",
    });
  });

  it.each([
    [503, { pesan: "Pembayaran belum aktif. Hubungi tim PADMA." }],
    [502, { pesan: "Pembayaran belum bisa dimulai. Coba lagi." }],
    [409, { pesan: "Selesaikan dulu pesanan terbuka Anda." }],
  ])("status %i -> pesan tampil dan TIDAK ada alihan", async (status, isi) => {
    const arahkan = vi.fn();
    const r = await mintaLaluAlihkan("produk-1", false, arahkan, fetchPalsu({ status, isi }));
    expect(r.hasil).toEqual({ jenis: "pesan", pesan: isi.pesan });
    expect(arahkan).not.toHaveBeenCalled();
  });

  it("200 tanpa url (mis. badan lama bertoken) -> TIDAK ada alihan", async () => {
    const arahkan = vi.fn();
    await mintaLaluAlihkan("produk-1", false, arahkan, fetchPalsu({ status: 200, isi: { token: "tok" } }));
    expect(arahkan).not.toHaveBeenCalled();
  });

  it("jaringan mati -> TIDAK ada alihan", async () => {
    const arahkan = vi.fn();
    await mintaLaluAlihkan("produk-1", false, arahkan, fetchPalsu("tolak"));
    expect(arahkan).not.toHaveBeenCalled();
  });

  it("sisi-peramban beralih lewat window.location.assign dan tidak menyisipkan skrip", () => {
    for (const rel of [
      "src/app/produk/[slug]/tombol-beli.tsx",
      "src/app/passport/keranjang/isi-keranjang.tsx",
    ]) {
      const isi = baca(rel);
      expect(isi).toContain("window.location.assign");
      expect(isi).not.toMatch(/createElement\(\s*["']script/);
      expect(isi).not.toMatch(/snap\.pay|window\.snap|muatSkripSnap|midtrans/i);
      expect(isi).not.toContain("process.env");
    }
    expect(existsSync(path.join(AKAR, "src/lib/midtrans/snap-peramban.ts"))).toBe(false);
  });

  it("kedua page.tsx tidak lagi mengoper produksi/clientKey", () => {
    for (const rel of ["src/app/produk/[slug]/page.tsx", "src/app/passport/keranjang/page.tsx"]) {
      const isi = baca(rel);
      expect(isi).not.toMatch(/midtrans/i);
      expect(isi).not.toContain("clientKey");
      expect(isi).not.toContain("produksi");
    }
  });
});

/**
 * PEMULIHAN SESUDAH DOKU MENOLAK — inilah beda antara "coba lagi" dan
 * "terkunci 24 jam".
 *
 * Midtrans menolak `order_id` kembar SELAMANYA. Percobaan kedua yang mengirim
 * `ulang: false` membuat `buat_pesanan` memulangkan pesanan terbuka yang SAMA
 * berikut `kode` dan `percobaan` yang sama; rute merakit `order_id` yang sama;
 * DOKU menolaknya lagi; 502 berulang selamanya. Pembeli terkunci sampai
 * tenggat 24 jamnya lewat — dan layarnya berkata "Pembayaran Anda sedang
 * diproses", kalimat yang tidak benar untuk orang yang tidak pernah membayar.
 *
 * Jalan keluarnya sudah dibangun mesin (`buat_pesanan(p_ulang := true)`
 * menaikkan `percobaan` dan mengosongkan `tautan_gateway`) dan sampai perbaikan
 * ini NOL pemanggil di `src/` pernah mengirimnya.
 */
describe("mintaCheckout — percobaan berikutnya sesudah order_id terbakar", () => {
  it("percobaan PERTAMA mengirim ulang: false", async () => {
    const ambil = fetchPalsu({ status: 200, isi: { url: "https://sandbox.doku.test/bayar/abc" } });
    await mintaCheckout("produk-1", false, ambil);

    expect(ambil.panggilan).toHaveLength(1);
    expect(ambil.panggilan[0].url).toBe("/api/pesanan/checkout");
    expect(ambil.panggilan[0].badan).toEqual({ productId: "produk-1", ulang: false });
  });

  it("502 menandai order_id TERBAKAR, dan percobaan berikutnya mengirim ulang: true", async () => {
    // Inilah uji yang membedakan pulih dari terkunci. Ia dijalankan dua
    // langkah, persis seperti pembeli mengalaminya.
    const gagal = fetchPalsu({ status: 502, isi: { pesan: "Pembayaran belum bisa dimulai." } });
    const pertama = await mintaCheckout("produk-1", false, gagal);

    expect(pertama.hasil).toEqual({
      jenis: "pesan",
      pesan: "Pembayaran belum bisa dimulai.",
    });
    expect(pertama.orderIdTerbakar).toBe(true);

    // Nilai itulah yang diumpankan balik oleh komponen sebagai `ulang`.
    const lagi = fetchPalsu({ status: 200, isi: { url: "https://sandbox.doku.test/bayar/dua" } });
    const kedua = await mintaCheckout("produk-1", pertama.orderIdTerbakar, lagi);

    expect(lagi.panggilan[0].badan).toEqual({ productId: "produk-1", ulang: true });
    expect(kedua.hasil).toEqual({ jenis: "url", url: "https://sandbox.doku.test/bayar/dua", pesananId: null });
  });

  it("tautan terbit juga membakar order_id — DOKU sudah memegangnya", async () => {
    const ambil = fetchPalsu({ status: 200, isi: { url: "https://sandbox.doku.test/bayar/abc" } });
    expect((await mintaCheckout("produk-1", false, ambil)).orderIdTerbakar).toBe(true);
  });

  it("pesananId dari rute DISIMPAN, bukan dibuang", async () => {
    // Satu-satunya keterangan produk↔pesanan yang pernah sampai ke peramban.
    // Dibuang di putaran 1, dan itu yang membuat pembeli lama kehilangan
    // tombol batalnya.
    const ambil = fetchPalsu({
      status: 200,
      isi: { url: "https://sandbox.doku.test/bayar/abc", kode: "PSN-260927-A1B2C3", pesananId: "pesanan-abc" },
    });
    expect((await mintaCheckout("produk-1", false, ambil)).hasil).toEqual({
      jenis: "url",
      url: "https://sandbox.doku.test/bayar/abc",
      pesananId: "pesanan-abc",
    });
  });

  it("jaringan mati membakar juga: tidak ada jawaban = tidak ada yang bisa disimpulkan", async () => {
    const ambil = fetchPalsu("tolak");
    const hasil = await mintaCheckout("produk-1", false, ambil);

    // Dan ia MEMULANGKAN pesan, bukan melempar: `fetch` yang menolak tanpa
    // try/catch menggagalkan transisi dan klik pembeli tidak melakukan
    // apa-apa yang terlihat.
    expect(hasil.hasil).toEqual({
      jenis: "pesan",
      pesan: "Pembayaran belum bisa dimulai. Coba lagi sebentar lagi.",
    });
    expect(hasil.orderIdTerbakar).toBe(true);
  });

  it.each([[400], [409]])(
    "status %i TIDAK membakar: keduanya berhenti sebelum DOKU disentuh",
    async (status) => {
      const ambil = fetchPalsu({ status, isi: { pesan: "Selesaikan dulu pesanan terbuka Anda." } });
      const hasil = await mintaCheckout("produk-1", false, ambil);

      expect(hasil.orderIdTerbakar).toBe(false);
      expect(hasil.hasil).toEqual({
        jenis: "pesan",
        pesan: "Selesaikan dulu pesanan terbuka Anda.",
      });
    },
  );

  it("403 perlu_persetujuan → jenis persetujuan, TIDAK membakar order_id", async () => {
    const ambil = fetchPalsu({ status: 403, isi: { kode: "perlu_persetujuan", pesan: "Setujui dulu." } });
    const hasil = await mintaCheckout("produk-1", false, ambil);
    expect(hasil).toEqual({ hasil: { jenis: "persetujuan" }, orderIdTerbakar: false });
  });

  it("403 TANPA kode persetujuan tetap jadi pesan biasa", async () => {
    const ambil = fetchPalsu({ status: 403, isi: { pesan: "Ditolak." } });
    const hasil = await mintaCheckout("produk-1", false, ambil);
    expect(hasil).toEqual({ hasil: { jenis: "pesan", pesan: "Ditolak." }, orderIdTerbakar: false });
  });

  it("tombol beli dan keranjang sama-sama membawa pembeli ke /persetujuan", () => {
    const tombol = readFileSync(path.resolve(__dirname, "../src/app/produk/[slug]/tombol-beli.tsx"), "utf8");
    const keranjang = readFileSync(path.resolve(__dirname, "../src/app/passport/keranjang/isi-keranjang.tsx"), "utf8");
    expect(tombol).toMatch(/hasil\.jenis === "persetujuan"[\s\S]{0,400}\/persetujuan\?lanjut=/);
    expect(keranjang).toMatch(/hasil\.jenis === "persetujuan"[\s\S]{0,200}"\/persetujuan"/);
  });

  it("401 memulangkan 'masuk', dan tidak membakar apa pun", async () => {
    const ambil = fetchPalsu({ status: 401, isi: { pesan: "Silakan masuk dulu." } });
    const hasil = await mintaCheckout("produk-1", false, ambil);

    expect(hasil.hasil).toEqual({ jenis: "masuk" });
    expect(hasil.orderIdTerbakar).toBe(false);
  });

  it("200 tanpa url diperlakukan sebagai kegagalan berkalimat", async () => {
    const ambil = fetchPalsu({ status: 200, isi: {} });
    expect((await mintaCheckout("produk-1", false, ambil)).hasil).toEqual({
      jenis: "pesan",
      pesan: "Pembayaran belum bisa dimulai. Coba lagi sebentar lagi.",
    });
  });
});

describe("mintaBatal — jalan keluar pembeli yang macet", () => {
  it("dibatalkan: true -> jenis 'dibatalkan'", async () => {
    const ambil = fetchPalsu({ status: 200, isi: { dibatalkan: true } });
    expect(await mintaBatal("pesanan-1", ambil)).toEqual({ jenis: "dibatalkan" });
    expect(ambil.panggilan[0].url).toBe("/api/pesanan/pesanan-1/batal");
  });

  it("dibatalkan: false DIBERI KALIMAT — tombol yang diam terlihat rusak", async () => {
    // Rutenya benar memulangkan 200: "tidak ada pesanan yang cocok milik Anda"
    // bukan galat. Tapi bagi pembeli yang baru menekan tombolnya, tidak
    // terjadi apa-apa adalah kejadian yang harus dijelaskan.
    const ambil = fetchPalsu({ status: 200, isi: { dibatalkan: false } });
    const hasil = await mintaBatal("pesanan-1", ambil);

    expect(hasil.jenis).toBe("pesan");
    expect((hasil as { jenis: "pesan"; pesan: string }).pesan.length).toBeGreaterThan(10);
  });

  it("401 -> 'masuk'", async () => {
    expect(await mintaBatal("pesanan-1", fetchPalsu({ status: 401, isi: {} }))).toEqual({
      jenis: "masuk",
    });
  });

  it("409 memakai kalimat rutenya", async () => {
    const ambil = fetchPalsu({ status: 409, isi: { pesan: "Pesanan ini tidak bisa dibatalkan." } });
    expect(await mintaBatal("pesanan-1", ambil)).toEqual({
      jenis: "pesan",
      pesan: "Pesanan ini tidak bisa dibatalkan.",
    });
  });

  it("jaringan mati memulangkan pesan, bukan melempar", async () => {
    const hasil = await mintaBatal("pesanan-1", fetchPalsu("tolak"));
    expect(hasil.jenis).toBe("pesan");
  });
});

/**
 * SIAPA yang boleh ditawari tombol batal — dan kenapa jawabannya kadang
 * "tidak tahu".
 *
 * `order_items` lahir dengan nol grant dan nol policy bagi `authenticated`,
 * jadi peramban tidak bisa menautkan pesanan ke produknya sama sekali. Yang
 * bisa dibaca hanyalah `orders` (status + penanda tinjauan).
 */
describe("pesananYangBisaDibatalkan — jalan (2), tebakan konservatif sesudah muat ulang", () => {
  it("satu pesanan terbuka, nol baris tinjauan -> id-nya boleh dipakai", () => {
    // Unique parsial `pesanan_terbuka_satu_per_klien` menjamin pesanan terbuka
    // itu SATU di seluruh basis data, jadi ia pasti pesanan produk ini.
    expect(
      pesananYangBisaDibatalkan(
        [
          { id: "a", status: "menunggu_bayar", sebab_tinjauan: null },
          { id: "b", status: "dibatalkan", sebab_tinjauan: null },
          { id: "c", status: "kedaluwarsa", sebab_tinjauan: null },
        ],
        null,
      ),
    ).toBe("a");
  });

  it("nol pesanan terbuka -> null", () => {
    expect(
      pesananYangBisaDibatalkan([{ id: "a", status: "kedaluwarsa", sebab_tinjauan: null }], null),
    ).toBeNull();
  });

  it.each([
    ["ditahan", null],
    ["lunas", null],
    ["kedaluwarsa", "lunas_setelah_tutup"],
  ])(
    "ada baris tinjauan (%s/%s) -> null, karena pesanan terbukanya mungkin milik produk LAIN",
    (status, sebab) => {
      // Ketiga keadaan itu TERTUTUP, jadi klien yang sama boleh sekaligus
      // punya pesanan terbuka untuk produk lain — dan membatalkannya dari
      // halaman ini akan mematikan pesanan yang salah, diam-diam.
      expect(
        pesananYangBisaDibatalkan(
          [
            { id: "terbuka-produk-lain", status: "menunggu_bayar", sebab_tinjauan: null },
            { id: "tinjauan", status, sebab_tinjauan: sebab },
          ],
          null,
        ),
      ).toBeNull();
    },
  );

  it("daftar kosong -> null", () => {
    expect(pesananYangBisaDibatalkan([], null)).toBeNull();
  });

  it("bacaan yang menyentuh BATAS -> null, karena baris tinjauan bisa tersembunyi", () => {
    // Pagar terhadap `.limit()`: baris yang terpotong bisa saja baris yang
    // seharusnya membungkam tebakan ini. Tidak tahu = tidak boleh.
    const banyak = Array.from({ length: BATAS_BARIS_PESANAN }, (_, i) => ({
      id: `x${i}`,
      status: i === 0 ? "menunggu_bayar" : "kedaluwarsa",
      sebab_tinjauan: null,
    }));
    expect(pesananYangBisaDibatalkan(banyak, null)).toBeNull();
  });
});

/**
 * JALAN (1) — id dari checkout sesi ini, dan kenapa ia harus menang.
 *
 * Gerbang `buat_pesanan` yang tampak menutup keadaan ini sebenarnya SE-PRODUK
 * (`20260926130000:48-53` ber-`join order_items ... and i.product_id =
 * p_product_id`), sementara pembacaan peramban TIDAK PUNYA filter produk dan
 * tidak bisa punya. Akibatnya `tinjauan` menyala sesudah pembelian lunas atas
 * produk APA PUN, dan menyala selamanya.
 *
 * Tanpa jalan (1), pembeli yang pernah belanja — segmen yang paling mungkin
 * membeli lagi — kehilangan tombol batalnya PERMANEN: alihan yang gagal
 * meninggalkan mereka tanpa tombol beli DAN tanpa tombol batal sampai tenggat
 * 24 jam lewat. Itu persis keluhan Temuan 1, bertahan hidup di segmen yang
 * paling sering menemuinya.
 */
describe("pesananYangBisaDibatalkan — jalan (1), id checkout sesi ini", () => {
  it("riwayat `lunas` produk LAIN tidak lagi mengunci pembeli", () => {
    const baris = [
      { id: "terbuka-produk-ini", status: "menunggu_bayar", sebab_tinjauan: null },
      // Pembelian yang sudah selesai, produk lain, bulan lalu.
      { id: "lunas-produk-lain", status: "lunas", sebab_tinjauan: null },
    ];

    // Jalan (2) tetap diam, dan itu memang batas yang dipertahankan.
    expect(pesananYangBisaDibatalkan(baris, null)).toBeNull();

    // Jalan (1) TIDAK: checkout baru saja melahirkan pesanan ini UNTUK produk
    // ini, jadi tidak ada yang perlu ditebak dan riwayat tidak relevan.
    expect(pesananYangBisaDibatalkan(baris, "terbuka-produk-ini")).toBe("terbuka-produk-ini");
  });

  it("id sesi menang juga saat ada `ditahan` DAN `lunas_setelah_tutup`", () => {
    const baris = [
      { id: "terbuka-produk-ini", status: "menunggu_bayar", sebab_tinjauan: null },
      { id: "ditahan-lain", status: "ditahan", sebab_tinjauan: "selisih_nominal" },
      { id: "tutup-lain", status: "kedaluwarsa", sebab_tinjauan: "lunas_setelah_tutup" },
    ];
    expect(pesananYangBisaDibatalkan(baris, "terbuka-produk-ini")).toBe("terbuka-produk-ini");
  });

  it("id sesi yang pesanannya SUDAH TIDAK terbuka tidak ditawarkan", () => {
    // Tombol yang memanggil `batalkan_pesanan_saya` atas pesanan `lunas` hanya
    // memulangkan `dibatalkan: false` — tombol yang tidak melakukan apa-apa.
    const baris = [{ id: "sudah-lunas", status: "lunas", sebab_tinjauan: null }];
    expect(pesananYangBisaDibatalkan(baris, "sudah-lunas")).toBeNull();
  });

  it("id sesi yang barisnya tidak terlihat jatuh ke tebakan konservatif", () => {
    const baris = [{ id: "a", status: "menunggu_bayar", sebab_tinjauan: null }];
    expect(pesananYangBisaDibatalkan(baris, "id-yang-tidak-ada")).toBe("a");
  });
});
