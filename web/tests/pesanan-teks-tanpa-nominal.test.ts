import { describe, it, expect, afterEach } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { querySql } from "./helpers/db";

/**
 * NOMINAL YANG MENYELINAP SEBAGAI TEKS.
 *
 * Money firewall struktural menjaga NAMA KOLOM. Ia buta sepenuhnya terhadap
 * angka rupiah yang dituliskan ke dalam kolom TEKS — dan dua kolom teks tabel
 * pesanan adalah tempat paling wajar bagi kebocoran itu: `orders.sebab_tinjauan`
 * ("selisih 50.000") dan `order_items.judul_beku` ("Kelas Prakonsepsi
 * Rp 150.000"). Keduanya terbaca staf, dan `judul_beku` juga diproyeksikan view
 * `pesanan_item_staf`.
 *
 * ===== KENAPA YANG DIPINDAI SUMBERNYA, BUKAN ISI TABELNYA =====
 * Versi pertama berkas ini meng-assert "nol baris" atas `orders.sebab_tinjauan`
 * dan `order_items.judul_beku`. Keduanya KOSONG di setiap jalan bersih, jadi
 * assertion itu hijau karena tidak ada yang dipindai — pagar yang tidak bisa
 * merah, yaitu pagar yang membeli rasa aman tanpa menjual apa pun. Lebih buruk
 * di mesin ini: Supabase lokal dipakai bersama sesi lain, jadi hasil pindaian
 * atas tabel yang "kebetulan" berisi fixture orang lain tidak deterministik.
 *
 * Yang diganti bukan polanya melainkan ARAHNYA. `judul_beku` diisi
 * `buat_pesanan` dengan MENYALIN `digital_products.judul`; nominal hanya bisa
 * masuk lewat judul produk, dan tabel itu SELALU berisi (seed + fixture).
 * Karena itu kasus pertama memindai `digital_products.judul` dan menolak jalan
 * bila tabelnya kosong. `sebab_tinjauan` dijaga dari sisi kosakata (kasus
 * terakhir): nilainya tujuh kata tetap, nol digit seluruhnya.
 *
 * Keputusan yang diambil sadar: `buat_pesanan` TIDAK membersihkan judul. Nota
 * yang judulnya berbeda dari judul produk adalah nota yang berbohong; yang
 * dijaga karena itu judul produknya, di hulu.
 *
 * ===== KENAPA POLANYA BERBEDA DARI tests/helpers/nominal.ts =====
 * Perbedaannya SADAR, dan ini tempatnya ditulis. `nominalDalam()` memindai
 * MARKUP React yang penuh kelas Tailwind (`opacity-[0.075]`) dan id numerik,
 * jadi ia menuntut DUA kelompok ribuan supaya tidak menuduh yang tidak
 * bersalah. Yang dipindai DI SINI adalah teks basis data yang tidak pernah
 * punya alasan memuat angka berpemisah sama sekali, jadi ambangnya dipersempit
 * ke SATU kelompok — "50.000" tertangkap di sini dan memang harus.
 */
const POLA_NOMINAL_TEKS = /(\b\d{1,3}(?:\.\d{3})+\b)|(rp\.?\s*\d)/i;

/**
 * PERBAIKAN REVIEW AKHIR P1-A, TEMUAN 2 — `jejak_pesanan.keterangan`.
 *
 * `POLA_NOMINAL_TEKS` di atas TIDAK menangkap "150000": ia menuntut pemisah
 * ribuan, dan baris audit uang di `terapkan_notifikasi_midtrans`
 * (`20260926140000_pesanan_webhook_rpc.sql:548`,
 * `format('ditagih %s, diterima %s', v_total, p_gross_amount)`) menulis angka
 * MENTAH, tanpa titik. Pola kedua ini karena itu lebih lebar SENGAJA: deretan
 * digit TELANJANG, empat atau lebih, tanpa syarat pemisah sama sekali.
 *
 * Pelebaran ini TIDAK aman dipasang di `POLA_NOMINAL_TEKS` yang sudah ada:
 * `sebab_tinjauan` & `judul_beku` tidak pernah punya alasan sah memuat angka
 * sama sekali, tapi `jejak_pesanan.keterangan` PENUH angka sah yang bukan
 * nominal — uuid produk (`format('produk %s', v_product_id)`), timestamp
 * pencabutan (`format('... dicabut pada %s ...', v_dicabut)`), nomor
 * percobaan. Yang membedakan baris SAH dari baris BOCOR karena itu bukan
 * "ada angka atau tidak", melainkan KEJADIAN yang menulisnya.
 *
 * Tapi daftar putih kejadian saja TIDAK cukup, dan itu terbukti empiris:
 * `lunas` bukan anggota daftar putih, jadi ia dipindai — padahal
 * keterangannya sah berbunyi `midtrans settlement, transaksi <uuid>`, dan
 * `akses_tertahan` berbunyi `... dicabut pada 2026-09-27 ...` yang tahunnya
 * saja sudah empat digit. `\d{4,}` telanjang menuduh keduanya. Uji yang
 * memerah dengan diagnosis "nominal bocor" pada baris yang tidak memuat
 * nominal lebih buruk daripada uji yang tidak ada: ia mengirim orang
 * memburu kebocoran yang tak pernah terjadi. Lebih buruk lagi, ia hijau
 * hari ini HANYA karena tabelnya kebetulan kosong saat dipindai — satu
 * baris sisa dari sesi paralel di Supabase lokal yang dipakai bersama
 * sudah cukup menyalakannya.
 *
 * Lookaround-nya karena itu menuntut deretan digit yang BERDIRI SENDIRI:
 * tidak didahului huruf, titik, titik dua, atau tanda hubung, dan tidak
 * disusul huruf atau tanda hubung. Titik di depan membuang mikrodetik
 * (`11:20:33.123456+00` — `123456` lolos tanpa itu); tanda hubung di kedua
 * sisi membuang setiap segmen uuid dan setiap tanggal. `150000`,
 * `ditagih 120000, diterima 90000`, dan `ditagih 150000.` di akhir kalimat
 * tetap tertangkap.
 *
 * TITIK BUTA yang diketahui: nominal negatif (`-250000`) ikut terbuang,
 * karena "digit yang didahului tanda hubung" adalah bentuk yang sama persis
 * dengan segmen uuid — tidak ada cara leksikal membedakannya. Dipilih
 * begitu dengan sadar: uuid ditulis mesin ini pada SETIAP settlement,
 * nominal negatif belum pernah ditulis sama sekali, dan kebocoran nyata
 * selalu datang berpasangan (`ditagih X, diterima -Y`) sehingga pasangannya
 * yang positif tetap memerahkan barisnya.
 */
const POLA_DIGIT_TELANJANG = /(?<![\w.:-])\d{4,}(?![\w-])/;

/**
 * Daftar putih `kejadian` yang BOLEH memuat angka nominal di
 * `keterangan` — DITURUNKAN DARI KODE, bukan dari ingatan (Ruling Temuan 2).
 *
 * Satu-satunya pemanggil `format('ditagih %s, diterima %s', ...)` di seluruh
 * repo ada di `20260926140000_pesanan_webhook_rpc.sql:548`, dan ia menulis
 * `v_sebab::public.order_event` sebagai `kejadian`-nya. `v_sebab` hanya
 * pernah diisi DUA nilai yang bisa mencapai baris itu: `'selisih_nominal'`
 * (`:449`, verifikasi jumlah meleset) dan `'selisih_status'` (`:455`, capture
 * kartu yang dicurigai). Assignment KETIGA (`:414`, di dalam cabang
 * refund/chargeback/asing) sudah `return` di `:426` sebelum baris `:548`
 * tercapai — tidak pernah ikut. Kedua nilai inilah, dan HANYA itu.
 */
const KEJADIAN_BOLEH_ANGKA = new Set(["selisih_nominal", "selisih_status"]);

const svc = createAdminSupabase();

/** Klien seed kedua; dipakai supaya fixture di sini tidak bertabrakan dengan
 *  `pesanan_terbuka_satu_per_klien` milik berkas uji lain (peta §13.2). */
const RINA_CLIENT_ID = "44444444-4444-4444-4444-444444444402";

const pesananSampah: string[] = [];
const produkSampah: string[] = [];
// `jejak_pesanan` TANPA foreign key (disengaja, lihat dokblok Tugas 5) — baris
// yang disemai langsung di sini TIDAK ikut lenyap lewat cascade `orders`, dan
// harus dibongkar sendiri lewat `id`-nya.
const jejakSampah: string[] = [];
let nomorSlug = 0;

afterEach(async () => {
  while (jejakSampah.length) {
    await svc.from("jejak_pesanan").delete().eq("id", jejakSampah.pop()!);
  }
  // Urutan MENGIKAT: pesanan dulu (cascade menyapu `order_items`), baru produk
  // — `order_items.product_id` tanpa cascade menahan penghapusan produk.
  while (pesananSampah.length) {
    await svc.from("orders").delete().eq("id", pesananSampah.pop()!);
  }
  while (produkSampah.length) {
    await svc.from("digital_products").delete().eq("id", produkSampah.pop()!);
  }
});

function kodeUji(): string {
  return `PSN-260926-${Math.random().toString(16).slice(2, 8).toUpperCase().padEnd(6, "0")}`;
}

async function semaiProduk(judul: string): Promise<string> {
  nomorSlug += 1;
  const { data, error } = await svc
    .from("digital_products")
    .insert({
      judul,
      slug: `uji-teks-nominal-${Date.now()}-${nomorSlug}`,
      jenis: "pdf",
      aktif: true,
    })
    .select("id")
    .single();
  if (error) throw error;
  produkSampah.push(data!.id);
  return data!.id;
}

/** SATU-SATUNYA sumber `order_items.judul_beku`. */
async function judulProduk(): Promise<string[]> {
  const baris = await querySql<{ judul: string }>(`select p.judul from public.digital_products p`);
  return baris.map((b) => b.judul);
}

type Teks = { sumber: string; isi: string };

async function teksNota(): Promise<Teks[]> {
  return querySql<Teks>(
    `select 'orders.sebab_tinjauan' as sumber, o.sebab_tinjauan as isi
       from public.orders o
      where o.sebab_tinjauan is not null
     union all
     select 'order_items.judul_beku', i.judul_beku
       from public.order_items i`,
  );
}

function bocor(baris: Teks[]): string[] {
  return baris
    .filter((b) => POLA_NOMINAL_TEKS.test(b.isi))
    .map((b) => `${b.sumber}: ${JSON.stringify(b.isi)}`);
}

type Jejak = { kejadian: string; keterangan: string };

/**
 * SELURUH `jejak_pesanan.keterangan` yang terisi — bukan hanya baris berkas
 * ini. Sama seperti `teksNota()`: yang dipindai sumbernya, bukan fixture kita
 * sendiri, supaya kebocoran dari jalur mana pun tetap tertangkap.
 */
async function jejakKeterangan(): Promise<Jejak[]> {
  return querySql<Jejak>(
    `select kejadian::text as kejadian, keterangan
       from public.jejak_pesanan
      where keterangan is not null`,
  );
}

function bocorJejak(baris: Jejak[]): string[] {
  return baris
    .filter((b) => !KEJADIAN_BOLEH_ANGKA.has(b.kejadian))
    .filter((b) => POLA_DIGIT_TELANJANG.test(b.keterangan))
    .map((b) => `jejak_pesanan.keterangan[${b.kejadian}]: ${JSON.stringify(b.keterangan)}`);
}

describe("judul produk — hulu satu-satunya judul_beku", () => {
  it("nol judul produk digital memuat nominal", async () => {
    // digital_products TIDAK punya baris seed baku — repo ini tidak mengisi
    // katalog produk dari supabase/seed.sql, dan setiap berkas uji lain yang
    // memakainya menyemai barisnya sendiri lalu membongkarnya lagi. Pada
    // `db reset` yang bersih, dijalankan SENDIRIAN, tabelnya karena itu
    // benar-benar kosong — dan itulah persis kondisi yang guard ANTI-HAMPA di
    // bawah dirancang menolak, bukan lubang di dalamnya. Baris ini menjamin
    // anti-hampa-nya SENDIRI dengan menyemai satu produk berjudul bersih,
    // sambil tetap memindai SELURUH tabel (bukan cuma baris ini) — produk
    // lain yang kebetulan hidup bersamaan (fixture berkas uji lain yang
    // berjalan paralel di Supabase lokal yang sama) tetap ikut terpindai.
    await semaiProduk("Kelas Prakonsepsi");

    const judul = await judulProduk();
    // ANTI-HAMPA, dan inilah bedanya dengan versi pertama berkas ini: kalau
    // tabelnya kosong, assertion di bawah hijau tanpa memindai apa pun.
    expect(
      judul.length,
      "nol produk digital di basis data — pemindai ini tidak memindai apa pun, " +
        "jadi hijaunya tidak berarti apa-apa. Jalankan seed lebih dulu.",
    ).toBeGreaterThan(0);

    const tertuduh = judul.filter((j) => POLA_NOMINAL_TEKS.test(j));
    expect(
      tertuduh,
      "Judul produk memuat nominal, dan `buat_pesanan` MENYALINNYA apa adanya ke " +
        "`order_items.judul_beku` — yang lalu diproyeksikan view `pesanan_item_staf`. " +
        "Harga hidup di `digital_product_prices`; buang angkanya dari judul.\n" +
        tertuduh.join("\n"),
    ).toEqual([]);
  });

  it("pemindai judul benar-benar bisa merah (kontrol positif)", async () => {
    await semaiProduk("Panduan Menyusui Rp 150.000");
    const tertuduh = (await judulProduk()).filter((j) => POLA_NOMINAL_TEKS.test(j));
    expect(tertuduh).toContain("Panduan Menyusui Rp 150.000");
  });
});

describe("kolom teks tabel pesanan tidak memuat nominal", () => {
  it("baris nota yang BENAR-BENAR ada ikut terpindai, dan bersih", async () => {
    // Pemindai nota tetap ada — tapi ia hanya berarti bila ada barisnya. Kasus
    // ini yang menyediakan barisnya, dan yang menolak jalan bila pemindainya
    // ternyata tidak melihat apa pun.
    const produk = await semaiProduk("Kelas Prakonsepsi");
    const { data, error } = await svc
      .from("orders")
      .insert({ kode: kodeUji(), client_id: RINA_CLIENT_ID, jumlah_item: 1 })
      .select("id")
      .single();
    expect(error).toBeNull();
    pesananSampah.push(data!.id);

    const { error: eItem } = await svc.from("order_items").insert({
      pesanan_id: data!.id,
      jenis: "produk_digital",
      product_id: produk,
      judul_beku: "Kelas Prakonsepsi",
      harga_beku: 150_000,
      urutan: 1,
    });
    expect(eItem).toBeNull();

    const baris = await teksNota();
    expect(baris.length, "pemindai nota tidak melihat satu baris pun").toBeGreaterThan(0);
    expect(bocor(baris)).toEqual([]);
  });

  it("pemindai sebab_tinjauan benar-benar bisa merah (kontrol positif)", async () => {
    // Pagar yang tidak pernah bisa memerah terbaca persis seperti pagar yang
    // bekerja. Kasus ini menyisipkan pelanggaran SUNGGUHAN, membuktikan
    // pemindai di atas menemukannya, lalu membongkarnya lagi.
    const { data, error } = await svc
      .from("orders")
      .insert({
        kode: kodeUji(),
        client_id: RINA_CLIENT_ID,
        jumlah_item: 1,
        sebab_tinjauan: "selisih 50.000",
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    pesananSampah.push(data!.id);

    expect(bocor(await teksNota()).some((b) => b.includes("50.000"))).toBe(true);
  });

  it("kosakata sebab_tinjauan yang sah TIDAK dituduh", () => {
    // Arah kedua, sama pentingnya: pola yang terlalu lebar akan memerahkan
    // setiap baris ditahan yang sah, dan pagar yang selalu merah adalah pagar
    // yang berhenti dibaca.
    for (const sah of [
      "selisih_nominal",
      "selisih_status",
      "lunas_setelah_tutup",
      "akses_tertahan",
      "penangan_belum_ada",
      "refund",
      "chargeback",
    ]) {
      expect(POLA_NOMINAL_TEKS.test(sah), `kosakata sah dituduh: ${sah}`).toBe(false);
    }
  });
});

describe("jejak_pesanan.keterangan tidak memuat nominal DI LUAR daftar putih (Temuan 2)", () => {
  it("baris jejak yang BENAR-BENAR ada ikut terpindai, dan bersih", async () => {
    // `jejak_pesanan` tidak berpolicy FK — baris disemai LANGSUNG, tanpa
    // pesanan sungguhan, persis pola `orders`/`order_items` di atas.
    const { data, error } = await svc
      .from("jejak_pesanan")
      .insert({
        pesanan_id: null,
        kejadian: "dibuat",
        keterangan: "checkout produk digital",
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    jejakSampah.push(data!.id);

    const baris = await jejakKeterangan();
    expect(baris.length, "pemindai jejak tidak melihat satu baris pun").toBeGreaterThan(0);
    expect(bocorJejak(baris)).toEqual([]);
  });

  it("pemindai jejak_pesanan.keterangan benar-benar bisa merah (kontrol positif)", async () => {
    // Pelanggaran SUNGGUHAN: kejadian di LUAR daftar putih, nominal TELANJANG
    // (tanpa pemisah ribuan) di keterangan — persis bentuk yang lolos dari
    // `POLA_NOMINAL_TEKS` lama.
    const { data, error } = await svc
      .from("jejak_pesanan")
      .insert({
        pesanan_id: null,
        kejadian: "dibuat",
        keterangan: "checkout dengan harga 150000 disebut di sini",
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    jejakSampah.push(data!.id);

    expect(bocorJejak(await jejakKeterangan()).some((b) => b.includes("150000"))).toBe(true);
  });

  it("kejadian dalam daftar putih (keputusan uang Tugas 5) TIDAK dituduh walau memuat nominal", async () => {
    // Arah kedua: `selisih_nominal`/`selisih_status` ADALAH baris yang
    // sengaja menulis kedua angka (Ruling 4b, Temuan 2) — pagar yang
    // menuduh keduanya adalah pagar yang menghukum keputusan yang benar.
    const baris = await Promise.all(
      [...KEJADIAN_BOLEH_ANGKA].map(async (kejadian) => {
        const { data, error } = await svc
          .from("jejak_pesanan")
          .insert({
            pesanan_id: null,
            kejadian,
            keterangan: "ditagih 120000, diterima 120000",
          })
          .select("id")
          .single();
        expect(error).toBeNull();
        jejakSampah.push(data!.id);
        return kejadian;
      }),
    );

    const bocoran = bocorJejak(await jejakKeterangan());
    for (const kejadian of baris) {
      expect(
        bocoran.some((b) => b.startsWith(`jejak_pesanan.keterangan[${kejadian}]`)),
        `kejadian daftar putih dituduh: ${kejadian}`,
      ).toBe(false);
    }
  });

  it("keterangan sah buatan mesin ini TIDAK dituduh", () => {
    // Arah ketiga, dan yang paling mudah hilang: baris DI LUAR daftar putih
    // pun penuh angka sah. `lunas` menulis uuid transaksi, `akses_tertahan`
    // menulis timestamp pencabutan — keduanya bukan nominal, keduanya empat
    // digit atau lebih.
    //
    // Uji tabel-penuh di atas hijau hari ini sebagian karena tabelnya
    // kebetulan kosong saat dipindai. Supabase lokal dipakai bersama sesi
    // lain; satu baris sisa sudah cukup menyalakannya dengan diagnosis yang
    // SALAH — "nominal bocor" pada baris yang tidak memuat nominal. Kontrol
    // ini mengunci polanya sendiri, lepas dari isi tabel, jadi pelebaran
    // yang menuduh terlalu banyak memerah di sini lebih dulu.
    for (const sah of [
      "midtrans settlement, transaksi b3ac369e-1234-4f8a-9c21-123456789012",
      "entitlement produk ce2f1234-0000-4aaa-8bbb-000012345678 dicabut pada 2026-09-27 11:20:33+00",
      "entitlement dicabut pada 2026-09-27 11:20:33.123456+00",
      "item 2026-09-27T11:20:33.123456+00:00",
      "percobaan 2",
    ]) {
      expect(
        POLA_DIGIT_TELANJANG.test(sah),
        `keterangan sah dituduh memuat nominal: ${sah}`,
      ).toBe(false);
    }

    // Dan arah sebaliknya, di berkas yang sama supaya keduanya bergerak
    // bersama: mempersempit pola sampai berhenti menggigit memerahkan ini.
    for (const bocor of [
      "ditagih 150000, diterima 100000",
      "ditagih 150000.",
      "150000",
    ]) {
      expect(
        POLA_DIGIT_TELANJANG.test(bocor),
        `nominal telanjang LOLOS dari pemindai: ${bocor}`,
      ).toBe(true);
    }
  });
});
