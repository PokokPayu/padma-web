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

const {
  PanelBeli,
  keadaanBeli,
  mintaCheckout,
  mintaBatal,
  pesananYangBisaDibatalkan,
  BATAS_BARIS_PESANAN,
} = await import("@/app/produk/[slug]/tombol-beli");
const { urlSkripSnap } = await import("@/lib/midtrans/konfig");
const { muatSkripSnap, PESAN_PEMBAYARAN_BELUM_AKTIF } = await import(
  "@/lib/midtrans/snap-peramban"
);

const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

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

  it.each([[""], ["   "]])(
    "kunci klien %p ditolak — fail closed, kalimat yang sama dengan adapter server",
    async (kunci) => {
      // `page.tsx` mengoper `?? ""`, jadi env yang belum dipasang tiba di sini
      // sebagai string kosong. Tanpa pagar ini skripnya dimuat dengan
      // `data-client-key=""` dan pembayarannya gagal tanpa menyebut sebabnya —
      // satu-satunya env Midtrans di repo ini yang tidak fail-closed.
      await expect(muatSkripSnap(kunci, false)).rejects.toThrow(
        PESAN_PEMBAYARAN_BELUM_AKTIF,
      );
    },
  );

  it("kalimatnya PERSIS sama dengan yang dipakai terbitkanTokenSnap", () => {
    // Satu keadaan, satu kalimat. Kalau yang satu diubah tanpa yang lain,
    // pembeli mendapat dua penjelasan berbeda untuk sebab yang sama.
    expect(PESAN_PEMBAYARAN_BELUM_AKTIF).toBe("Pembayaran belum aktif. Hubungi tim PADMA.");
    expect(baca("src/lib/midtrans/adapter.ts")).toContain(PESAN_PEMBAYARAN_BELUM_AKTIF);
  });
});

/**
 * PEMULIHAN SESUDAH SNAP MENOLAK — inilah beda antara "coba lagi" dan
 * "terkunci 24 jam".
 *
 * Midtrans menolak `order_id` kembar SELAMANYA. Percobaan kedua yang mengirim
 * `ulang: false` membuat `buat_pesanan` memulangkan pesanan terbuka yang SAMA
 * berikut `kode` dan `percobaan` yang sama; rute merakit `order_id` yang sama;
 * Snap menolaknya lagi; 502 berulang selamanya. Pembeli terkunci sampai
 * tenggat 24 jamnya lewat — dan layarnya berkata "Pembayaran Anda sedang
 * diproses", kalimat yang tidak benar untuk orang yang tidak pernah membayar.
 *
 * Jalan keluarnya sudah dibangun mesin (`buat_pesanan(p_ulang := true)`
 * menaikkan `percobaan` dan mengosongkan `snap_token`) dan sampai perbaikan
 * ini NOL pemanggil di `src/` pernah mengirimnya.
 */
describe("mintaCheckout — percobaan berikutnya sesudah order_id terbakar", () => {
  it("percobaan PERTAMA mengirim ulang: false", async () => {
    const ambil = fetchPalsu({ status: 200, isi: { token: "tok" } });
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
    const lagi = fetchPalsu({ status: 200, isi: { token: "tok-2" } });
    const kedua = await mintaCheckout("produk-1", pertama.orderIdTerbakar, lagi);

    expect(lagi.panggilan[0].badan).toEqual({ productId: "produk-1", ulang: true });
    expect(kedua.hasil).toEqual({ jenis: "token", token: "tok-2", pesananId: null });
  });

  it("token terbit juga membakar order_id — Snap sudah memegangnya", async () => {
    const ambil = fetchPalsu({ status: 200, isi: { token: "tok" } });
    expect((await mintaCheckout("produk-1", false, ambil)).orderIdTerbakar).toBe(true);
  });

  it("pesananId dari rute DISIMPAN, bukan dibuang", async () => {
    // Satu-satunya keterangan produk↔pesanan yang pernah sampai ke peramban.
    // Dibuang di putaran 1, dan itu yang membuat pembeli lama kehilangan
    // tombol batalnya.
    const ambil = fetchPalsu({
      status: 200,
      isi: { token: "tok", kode: "PSN-260927-A1B2C3", pesananId: "pesanan-abc", produksi: false },
    });
    expect((await mintaCheckout("produk-1", false, ambil)).hasil).toEqual({
      jenis: "token",
      token: "tok",
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
    "status %i TIDAK membakar: keduanya berhenti sebelum Snap disentuh",
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

  it("401 memulangkan 'masuk', dan tidak membakar apa pun", async () => {
    const ambil = fetchPalsu({ status: 401, isi: { pesan: "Silakan masuk dulu." } });
    const hasil = await mintaCheckout("produk-1", false, ambil);

    expect(hasil.hasil).toEqual({ jenis: "masuk" });
    expect(hasil.orderIdTerbakar).toBe(false);
  });

  it("200 tanpa token diperlakukan sebagai kegagalan berkalimat", async () => {
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
 * membeli lagi — kehilangan tombol batalnya PERMANEN: popup Snap yang gagal
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
