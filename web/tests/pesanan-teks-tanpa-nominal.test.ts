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

const svc = createAdminSupabase();

/** Klien seed kedua; dipakai supaya fixture di sini tidak bertabrakan dengan
 *  `pesanan_terbuka_satu_per_klien` milik berkas uji lain (peta §13.2). */
const RINA_CLIENT_ID = "44444444-4444-4444-4444-444444444402";

const pesananSampah: string[] = [];
const produkSampah: string[] = [];
let nomorSlug = 0;

afterEach(async () => {
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
