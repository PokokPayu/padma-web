/**
 * LAPIS 1b — PEMERIKSAAN SAAT HALAMAN DIBUKA (spec "Rekonsiliasi — empat lapis").
 *
 * Inilah jaring pengaman utama P1, dan ia menjaga dua hal yang gagal ke arah
 * berlawanan, jadi keduanya diuji terpisah:
 *
 *  1. TERLALU JARANG. Pesanan yang menggantung karena webhook tidak pernah
 *     mendarat akan tinggal `menunggu_bayar` selamanya bila tidak ada yang
 *     bertanya ke Midtrans. Pembeli sudah mentransfer dan tidak mendapat
 *     apa-apa — kegagalan termahal di seluruh P1.
 *  2. TERLALU SERING. Satu halaman yang di-refresh berkali-kali tidak boleh
 *     berubah jadi banjir permintaan ke Midtrans. Pagarnya `orders.diperiksa_pada`,
 *     dan ia HARUS tercap walaupun jawabannya tidak mengubah apa pun — kalau
 *     tidak, justru pesanan yang jawabannya "belum apa-apa" (kasus paling umum)
 *     yang ditanyakan ulang tanpa batas.
 *
 * Ditambah dua sifat yang tidak boleh ditawar:
 *
 *  3. KEGAGALAN DISEMBUNYIKAN. Midtrans tidak terhubung -> halaman tetap
 *     terender dengan keadaan yang ia tahu. Orang yang sedang mencari produknya
 *     tidak boleh melihat layar galat karena pemeriksaan latar gagal.
 *  4. HANYA MILIK PEMANGGIL. Pemilihan barisnya memakai SESI pemanggil, bukan
 *     service role — kalau tidak, membuka satu halaman menembakkan permintaan
 *     Midtrans atas pesanan orang lain.
 *
 * Midtrans TIDAK PERNAH ditembak dari suite: `tests/setup-fetch-guard.ts`
 * adalah daftar izin dan `.midtrans.com` sengaja TIDAK ada di sana. Yang
 * dipalsukan di berkas ini adalah modul adapternya, bukan jaringannya.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
// Klien KEDUA ber-akun auth, lahir di Tugas 4 dan sudah ada di `main`. Dipakai
// di sini HANYA untuk menampung baris yang `kode`-nya sengaja dirusak — lihat
// `bersihkan()` dan §0.11.
import { KLIEN_KEDUA_ID, siapkanKlienKedua, bongkarKlienKedua } from "./helpers/klien-kedua";

const admin = createAdminSupabase();
const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

// `createServerSupabase()` membaca cookies() dan hanya bermakna di dalam
// request scope. Modulnya diganti klien Supabase ber-SESI NYATA: RLS tetap
// berjalan apa adanya, persis seperti di server.
const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.sesi!,
}));

// Adapter Midtrans dipalsukan SELURUHNYA. `panggilan` mencatat setiap order_id
// yang ditanyakan — itulah yang membuat pagar "sekali per lima menit" bisa
// diuji sebagai KETIADAAN permintaan, bukan sebagai komentar.
const midtrans = vi.hoisted(() => ({
  jawaban: null as unknown,
  panggilan: [] as string[],
  lempar: false,
}));
vi.mock("@/lib/midtrans/adapter", () => ({
  bacaStatusTransaksi: async (orderId: string) => {
    midtrans.panggilan.push(orderId);
    if (midtrans.lempar) throw new Error("Midtrans tidak terhubung");
    return midtrans.jawaban;
  },
  terbitkanTokenSnap: async () => ({ ok: false, pesan: "tidak dipakai di berkas ini" }),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NOTFOUND");
  },
}));

const { periksaPesananMenggantung, terapkanJawabanMidtrans } = await import(
  "@/lib/pesanan/periksa-menggantung"
);
const { picuPeriksaSekali } = await import("@/lib/pesanan/picu-periksa");
const { default: HalamanProdukSaya } = await import("@/app/passport/produk/page");

const KLIEN_ANANDA = "44444444-4444-4444-4444-444444444401";
const KLIEN_RINA = "44444444-4444-4444-4444-444444444402"; // sengaja tanpa akun auth
const SLUG = "uji-lapis-1b";
const JUDUL = "Uji Lapis Satu B";
const HARGA = 120_000;
const AWALAN_KODE = "PSN-260926-1B";

let produkId: string;

/**
 * Kunci primer setiap baris `orders` yang berkas ini semai, dikumpulkan saat
 * menyemai. `bersihkan()` menghapus lewat DAFTAR INI, bukan lewat `kode`
 * — aturan §0.11 nomor 2, dan berkas inilah yang membayarnya: uji
 * "bentuk_order_id" MENGGANTI `orders.kode` jadi "bukan-kode-pesanan", jadi
 * pembersih yang mencari lewat `kode` tidak akan pernah menemukan barisnya lagi.
 */
const idDisemai: string[] = [];

// ---------------------------------------------------------------------------
// Perkakas
// ---------------------------------------------------------------------------

/**
 * Satu pesanan `menunggu_bayar` berikut satu itemnya, ditulis SERVICE ROLE.
 * Bahan uji tidak lewat jalur yang diuji: `orders` tidak punya satu pun grant
 * INSERT untuk peran API, dan itu memang pagar yang dipertahankan.
 */
async function semaiPesanan(o: {
  kode: string;
  clientId?: string;
  menitLalu?: number;
  diperiksaMenitLalu?: number | null;
  kedaluwarsaJam?: number; // positif = masa depan, negatif = sudah lewat
}): Promise<string> {
  const dibuat = new Date(Date.now() - (o.menitLalu ?? 30) * 60_000).toISOString();
  const { data, error } = await admin
    .from("orders")
    .insert({
      kode: o.kode,
      percobaan: 1,
      client_id: o.clientId ?? KLIEN_ANANDA,
      status: "menunggu_bayar",
      jumlah_item: 1,
      dibuat_pada: dibuat,
      kedaluwarsa_pada: new Date(
        Date.now() + (o.kedaluwarsaJam ?? 24) * 3_600_000,
      ).toISOString(),
      diperiksa_pada:
        o.diperiksaMenitLalu == null
          ? null
          : new Date(Date.now() - o.diperiksaMenitLalu * 60_000).toISOString(),
    })
    .select("id")
    .single();
  if (error) throw error;

  const { error: galatItem } = await admin.from("order_items").insert({
    pesanan_id: data!.id,
    jenis: "produk_digital",
    product_id: produkId,
    judul_beku: JUDUL,
    harga_beku: HARGA,
    urutan: 1,
  });
  if (galatItem) throw galatItem;
  idDisemai.push(data!.id as string);
  return data!.id as string;
}

function jawabanSukses(orderId: string, status: string) {
  return {
    ok: true as const,
    status: {
      order_id: orderId,
      status_code: "200",
      transaction_status: status,
      transaction_id: `trx-${orderId}`,
      gross_amount: `${HARGA}.00`,
      fraud_status: null,
      payment_type: "bank_transfer",
    },
  };
}

async function statusPesanan(id: string): Promise<string> {
  const { data } = await admin.from("orders").select("status").eq("id", id).single();
  return data!.status as string;
}

/**
 * Menghapus lewat KUNCI PRIMER yang sudah dipegang — tidak pernah lewat `kode`.
 *
 * Versi pertama rencana ini mencari barisnya dengan
 * `.like("kode", "PSN-260926-1B%")`, dan uji "bentuk_order_id" di bawah
 * mengganti `orders.kode` jadi `"bukan-kode-pesanan"` beberapa baris sebelum
 * pembersih itu jalan. Akibatnya bukan uji merah melainkan basis data yang
 * teracuni PERMANEN: barisnya `menunggu_bayar`, `pesanan_terbuka_satu_per_klien`
 * berlaku per KLIEN, dan sesudah berkas ini berjalan SEKALI setiap
 * `buat_pesanan` untuk klien itu gagal — di Tugas 8, 11, dan 12, dan di sesi
 * orang lain yang memakai Supabase lokal yang sama.
 *
 * Aturan umumnya §0.11 nomor 2: pembersih fixture tidak pernah mencari lewat
 * kolom yang bisa disunting ujinya sendiri.
 */
async function bersihkan() {
  // Entitlement DULU: `digital_entitlements.pesanan_id` menunjuk `orders`
  // dengan `on delete restrict` (migrasi 5 — kolomnya dipindah ke sana, lihat
  // §0.2), jadi pesanan tidak bisa dihapus selama entitlementnya masih ada.
  // `product_id` aman dipakai di sini: tidak ada satu pun uji yang menyuntingnya.
  await admin.from("digital_entitlements").delete().eq("product_id", produkId);

  const ids = idDisemai.splice(0);
  if (ids.length === 0) return;
  // Jejak & notifikasi SENGAJA tanpa FK (pola `jejak_status_bayar`), jadi
  // keduanya tidak ikut tersapu dan harus dihapus sendiri — lihat
  // tests/pesanan-jejak-yatim.test.ts.
  await admin.from("jejak_pesanan").delete().in("pesanan_id", ids);
  await admin.from("notifikasi_pesanan").delete().in("pesanan_id", ids);
  await admin.from("order_items").delete().in("pesanan_id", ids);
  await admin.from("orders").delete().in("id", ids);
}

beforeAll(async () => {
  ref.sesi = await signInAs("ananda@padma.test");
  // Klien KETIGA yang dipakai berkas ini, dan satu-satunya yang menampung
  // baris ber-`kode` sengaja cacat. `siapkanKlienKedua()` MENYAPU sisa run
  // sebelumnya lebih dulu, dan sapuannya berkunci `client_id` — bukan `kode`
  // — sehingga baris cacat dari run yang mati di tengah jalan tetap terhapus.
  // Itulah pagar kedua di bawah `bersihkan()`: poin 1 memperbaiki sebabnya,
  // poin ini membuat kegagalannya tidak fatal (§0.11).
  await siapkanKlienKedua();

  // Sisa run SEBELUMNYA yang `kode`-nya masih utuh. Pembersih dalam-run
  // memakai kunci primer (lihat `bersihkan()`); sapuan berkunci awalan hanya
  // dipakai SEKALI di sini, untuk baris yatim yang id-nya sudah tidak dipegang
  // siapa pun. Baris yang `kode`-nya sudah dirusak tidak tertangkap di sini —
  // ia milik `KLIEN_KEDUA_ID`, dan `siapkanKlienKedua()` di atas yang
  // menyapunya.
  const { data: yatim } = await admin
    .from("orders").select("id").like("kode", `${AWALAN_KODE}%`);
  for (const b of yatim ?? []) idDisemai.push(b.id as string);

  await admin.from("digital_products").delete().eq("slug", SLUG);
  const { data, error } = await admin
    .from("digital_products")
    .insert({ judul: JUDUL, slug: SLUG, jenis: "pdf", aktif: true })
    .select("id")
    .single();
  if (error) throw error;
  produkId = data!.id as string;
  await admin.from("digital_product_prices").insert({ product_id: produkId, harga: HARGA });
  await admin.from("digital_product_files").insert({
    product_id: produkId,
    objek: `${produkId}/isi.pdf`,
    mime: "application/pdf",
    byte: 1024,
  });
});

beforeEach(async () => {
  midtrans.panggilan.length = 0;
  midtrans.lempar = false;
  midtrans.jawaban = null;
  await bersihkan();
});

afterAll(async () => {
  await bersihkan();
  await admin.from("digital_products").delete().eq("id", produkId);
  // Membongkar klien kedua BESERTA akun auth-nya — fixture yang dibuat sendiri
  // dibongkar sendiri, dan urutannya sudah dikunci di helper itu.
  await bongkarKlienKedua();
});

// ---------------------------------------------------------------------------
// 1. Penyembuhan
// ---------------------------------------------------------------------------

describe("pesanan menggantung disembuhkan saat halaman dibuka", () => {
  it("settlement yang ditemukan Status API membuat pesanan lunas DAN menerbitkan akses", async () => {
    const kode = `${AWALAN_KODE}0001`;
    const id = await semaiPesanan({ kode });
    midtrans.jawaban = jawabanSukses(`${kode}.1`, "settlement");

    const hasil = await periksaPesananMenggantung();

    expect(midtrans.panggilan).toEqual([`${kode}.1`]);
    expect(hasil.diperiksa).toBe(1);
    expect(await statusPesanan(id)).toBe("lunas");

    const { data: hak } = await admin
      .from("digital_entitlements")
      .select("sumber, pesanan_id")
      .eq("product_id", produkId)
      .eq("client_id", KLIEN_ANANDA);
    expect((hak ?? []).length).toBe(1);
    expect(hak![0].sumber).toBe("beli");
    expect(hak![0].pesanan_id).toBe(id);
  });

  it("membuka /passport/produk menyembuhkan pesanan lalu menampilkan produknya", async () => {
    // Bukti bahwa kabelnya benar-benar terpasang di halaman, bukan hanya bahwa
    // fungsinya bisa dipanggil. Urutannya mengikat: pemeriksaan SEBELUM
    // produkSaya(), atau produk yang baru saja terbit tidak ikut terender.
    const kode = `${AWALAN_KODE}0002`;
    const id = await semaiPesanan({ kode });
    midtrans.jawaban = jawabanSukses(`${kode}.1`, "settlement");

    const markup = renderToStaticMarkup(await HalamanProdukSaya());

    expect(await statusPesanan(id)).toBe("lunas");
    expect(markup).toContain(JUDUL);
  });
});

// ---------------------------------------------------------------------------
// 2. Pagar laju — sekali per pesanan per lima menit
// ---------------------------------------------------------------------------

describe("pagar laju", () => {
  it("pesanan yang baru diperiksa satu menit lalu TIDAK ditanyakan lagi", async () => {
    const kode = `${AWALAN_KODE}0003`;
    await semaiPesanan({ kode, diperiksaMenitLalu: 1 });
    midtrans.jawaban = jawabanSukses(`${kode}.1`, "settlement");

    const hasil = await periksaPesananMenggantung();

    expect(midtrans.panggilan).toEqual([]);
    expect(hasil.diperiksa).toBe(0);
  });

  it("pesanan yang baru lahir dua menit lalu TIDAK ditanyakan", async () => {
    // Menanyakan pesanan yang baru dibuat berarti menanyai Midtrans tentang
    // transaksi yang kliennya belum sempat bayar.
    const kode = `${AWALAN_KODE}0004`;
    await semaiPesanan({ kode, menitLalu: 2 });
    midtrans.jawaban = jawabanSukses(`${kode}.1`, "settlement");

    await periksaPesananMenggantung();

    expect(midtrans.panggilan).toEqual([]);
  });

  it("jawaban yang TIDAK mengubah apa pun tetap mencap diperiksa_pada", async () => {
    // Kasus paling umum di produksi: Midtrans menjawab 404 sementara tenggang
    // satu jam belum lewat, jadi tidak ada yang bisa diputuskan. Tanpa cap,
    // PERSIS pesanan inilah yang ditanyakan ulang setiap kali halamannya
    // dibuka — banjir permintaan yang lahir dari kasus paling sering.
    const kode = `${AWALAN_KODE}0005`;
    const id = await semaiPesanan({ kode, kedaluwarsaJam: 5 });
    midtrans.jawaban = { ok: false as const, kode: 404, pesan: "Transaction doesn't exist" };

    await periksaPesananMenggantung();
    expect(midtrans.panggilan).toEqual([`${kode}.1`]);
    expect(await statusPesanan(id)).toBe("menunggu_bayar");

    await periksaPesananMenggantung();
    expect(midtrans.panggilan).toEqual([`${kode}.1`]);
  });
});

// ---------------------------------------------------------------------------
// 3. 404 dan tenggang satu jam
// ---------------------------------------------------------------------------

describe("404 Transaction doesn't exist", () => {
  it("TIDAK mengedaluwarsakan selama tenggang satu jam belum lewat", async () => {
    const kode = `${AWALAN_KODE}0006`;
    const id = await semaiPesanan({ kode, kedaluwarsaJam: 5 });
    midtrans.jawaban = { ok: false as const, kode: 404, pesan: "Transaction doesn't exist" };

    await periksaPesananMenggantung();

    expect(await statusPesanan(id)).toBe("menunggu_bayar");
  });

  it("mengedaluwarsakan sesudah kedaluwarsa_pada + satu jam lewat", async () => {
    // Yang memutuskan tetap Midtrans: ia menyatakan transaksinya tidak pernah
    // ada. Jam lokal hanya memutuskan kapan berhenti bertanya.
    const kode = `${AWALAN_KODE}0007`;
    const id = await semaiPesanan({ kode, kedaluwarsaJam: -2 });
    midtrans.jawaban = { ok: false as const, kode: 404, pesan: "Transaction doesn't exist" };

    await periksaPesananMenggantung();

    expect(await statusPesanan(id)).toBe("kedaluwarsa");
  });
});

// ---------------------------------------------------------------------------
// 4. Kegagalan disembunyikan
// ---------------------------------------------------------------------------

describe("kegagalan disembunyikan", () => {
  it("kode pesanan yang CACAT tidak melempar, dan tidak menghentikan sapuan", async () => {
    // `rakitOrderId` MELEMPAR untuk kode cacat — keputusan yang benar di
    // checkout, tapi fungsi ini seluruh nilainya adalah tidak pernah melempar,
    // dan Tugas 11 membangun peta kode HTTP-nya di atas janji itu. Baris cacat
    // bisa lahir dari fixture service role atau perbaikan SQL manual: keduanya
    // melewati CHECK karena `kode` memang tidak punya CHECK bentuk.
    //
    // ===== KENAPA `KLIEN_KEDUA_ID`, BUKAN ANANDA =====
    // Ini SATU-SATUNYA baris di seluruh P1-B yang namanya sengaja dirusak, dan
    // baris yang namanya dirusak adalah baris yang paling mungkin lolos dari
    // pembersih mana pun. Ia karena itu tidak pernah menyentuh klien yang
    // dipakai tiga tugas lain: kalau ia toh tertinggal,
    // `pesanan_terbuka_satu_per_klien` (unik per KLIEN) hanya mengunci klien
    // fixture yang dibongkar `bongkarKlienKedua()` di `afterAll` — bukan
    // Ananda, yang setiap `buat_pesanan`-nya di Tugas 8, 11, dan 12 akan gagal
    // selamanya. Lihat §0.11.
    //
    // SATU pesanan saja per klien: `pesanan_terbuka_satu_per_klien` adalah
    // indeks unik GLOBAL per klien. Yang diuji di sini memang
    // `terapkanJawabanMidtrans` langsung, bukan pemilihnya.
    const id = await semaiPesanan({ kode: `${AWALAN_KODE}0011`, clientId: KLIEN_KEDUA_ID });
    await admin.from("orders").update({ kode: "bukan-kode-pesanan" }).eq("id", id);

    const hasil = await terapkanJawabanMidtrans({
      id,
      kode: "bukan-kode-pesanan",
      percobaan: 1,
      kedaluwarsaPada: new Date(Date.now() + 3_600_000).toISOString(),
    });
    // TIDAK melempar, dan Midtrans tidak pernah ditanyakan: bentuk yang cacat
    // berhenti sebelum satu permintaan pun keluar.
    expect(hasil).toBe("bentuk_order_id");
    expect(midtrans.panggilan).toEqual([]);
    expect(await statusPesanan(id)).toBe("menunggu_bayar");
  });

  it("jawaban Status API TANPA gross_amount tidak menggeser apa pun", async () => {
    // Adapter memulangkan `{ok:false, kode:0}` untuk jawaban yang
    // `gross_amount`-nya hilang atau bukan angka, dan `kode: 0` BUKAN vonis.
    // Bila ia dipalsukan jadi "0", pesanan yang SUDAH DIBAYAR PENUH digeser ke
    // `ditahan` ber-`nominal_diterima = 0` — dan `putuskan_pesanan_ditahan`
    // meloloskannya karena 0 bukan null, sehingga staf memutuskan pembayaran
    // yang sebenarnya sempurna.
    const kode = `${AWALAN_KODE}0013`;
    const id = await semaiPesanan({ kode });
    midtrans.jawaban = { ok: false as const, kode: 0, pesan: "tanpa gross_amount" };

    const hasil = await periksaPesananMenggantung();
    expect(midtrans.panggilan).toEqual([`${kode}.1`]);
    // Ditanyakan, tapi tidak dihitung: dua kegagalan infrastruktur
    // (`midtrans_tak_terjawab`, `galat_basis_data`) sengaja tidak masuk angka
    // laporan, supaya penjadwal yang gagal tidak terbaca seperti penjadwal
    // yang bersih.
    expect(hasil.diperiksa).toBe(0);
    expect(await statusPesanan(id)).toBe("menunggu_bayar");

    const { data: notif } = await admin
      .from("notifikasi_pesanan").select("id").eq("pesanan_id", id);
    expect(notif ?? []).toEqual([]);
  });

  it('kunci server yang belum terpasang BUKAN "Midtrans tak terjawab"', async () => {
    // Adapter sudah memisahkan keduanya di sumbernya, dan pemisahan itu tidak
    // punya satu pun uji sampai hari ini — cabang yang tidak bisa merah adalah
    // cabang yang belum terbukti ada.
    //
    // `kode: 0` berarti kita SUDAH bertanya dan tidak mendapat jawaban;
    // `kode: -1` berarti NOL permintaan pernah keluar karena
    // `MIDTRANS_SERVER_KEY` kosong. Satu nilai bedanya, dua tindakan manusia
    // yang berbeda: yang pertama sembuh dengan dicoba lagi, yang kedua tidak
    // akan pernah sembuh sampai seseorang memasang env. Dilebur jadi
    // `midtrans_tak_terjawab`, Tugas 11 menjawab 502 "Coba lagi beberapa saat
    // lagi." untuk keadaan yang tidak bisa berubah — dan staf mencoba lagi
    // selamanya alih-alih menghubungi orang yang memegang envnya.
    const kode = `${AWALAN_KODE}0014`;
    const id = await semaiPesanan({ kode });
    midtrans.jawaban = {
      ok: false as const,
      kode: -1,
      pesan: "Kunci Midtrans belum dipasang.",
    };

    const hasil = await terapkanJawabanMidtrans({
      id,
      kode,
      percobaan: 1,
      kedaluwarsaPada: new Date(Date.now() + 3_600_000).toISOString(),
    });

    expect(hasil).toBe("kunci_belum_terpasang");
    // `panggilan` memaku bahwa order_id-nya memang dirakit dan diajukan ke
    // adapter: nilai balik saja tidak menyatakan permintaan mana yang dibentuk
    // — atau apakah ada yang dibentuk sama sekali.
    expect(midtrans.panggilan).toEqual([`${kode}.1`]);
    expect(await statusPesanan(id)).toBe("menunggu_bayar");
  });

  it("kunci yang belum terpasang TIDAK ikut dihitung sebagai sudah diperiksa", async () => {
    // Pasangan SAPUAN untuk uji di atas, dan ia ada karena uji di atas TIDAK
    // memakunya: uji itu memanggil `terapkanJawabanMidtrans` langsung, yang
    // tidak pernah menyentuh penghitung di `sapuPesananMenggantung`. Dibuktikan
    // dengan mencabut `hasil !== "kunci_belum_terpasang"` dari penghitung itu —
    // ketujuh belas uji lain tetap HIJAU, jadi cabang yang seluruh alasan
    // keberadaannya adalah angka laporan tidak punya satu pun uji yang bisa
    // memerah karenanya.
    //
    // Yang dijaga bukan kerapian tipe melainkan satu kalimat yang dibaca
    // manusia: server yang `MIDTRANS_SERVER_KEY`-nya belum terpasang akan
    // melaporkan "diperiksa: 20" setiap lima belas menit tanpa satu permintaan
    // pun pernah keluar. Penjadwal yang MATI terbaca persis seperti penjadwal
    // yang bersih, dan nol adalah satu-satunya angka yang jujur di sini.
    const kode = `${AWALAN_KODE}0015`;
    const id = await semaiPesanan({ kode });
    midtrans.jawaban = {
      ok: false as const,
      kode: -1,
      pesan: "Kunci Midtrans belum dipasang.",
    };

    const hasil = await periksaPesananMenggantung();

    expect(midtrans.panggilan).toEqual([`${kode}.1`]);
    expect(hasil.diperiksa).toBe(0);
    expect(await statusPesanan(id)).toBe("menunggu_bayar");
  });

  it("adapter yang melempar TIDAK melempar keluar, dan halaman tetap terender", async () => {
    const kode = `${AWALAN_KODE}0008`;
    const id = await semaiPesanan({ kode });
    midtrans.lempar = true;

    const hasil = await periksaPesananMenggantung();
    expect(hasil).toEqual({ diperiksa: 0 });
    expect(await statusPesanan(id)).toBe("menunggu_bayar");

    const markup = renderToStaticMarkup(await HalamanProdukSaya());
    expect(markup).toContain("Pembelian Saya");
  });
});

// ---------------------------------------------------------------------------
// 5. Radius: hanya pesanan pemanggil
// ---------------------------------------------------------------------------

describe("radius pemeriksaan", () => {
  it("SESI STAF tidak memicu pemeriksaan apa pun, walau RLS memulangkan semua baris", async () => {
    // Uji radius yang lain memakai sesi `ananda@padma.test` — satu-satunya
    // peran yang klaimnya BENAR, jadi ia tidak bisa merah untuk kasus ini.
    // `orders` punya DUA policy SELECT, dan `"pesanan: staf baca"`
    // memulangkan pesanan SELURUH klien: untuk sesi admin, RLS bukan pagar
    // sama sekali. `/produk/[slug]` halaman publik yang bisa dibuka staf mana
    // pun, dan efek mount TombolBeli memicunya tanpa syarat.
    //
    // Ongkosnya dua, dan yang kedua lebih halus: kuota Midtrans dipakai untuk
    // orang yang tidak memintanya, DAN `diperiksa_pada` mereka tercap,
    // sehingga penyapu Lapis 3 melewatinya selama lima menit berikutnya.
    //
    // Uji ini hanya memaku yang diklaimnya bila gerbangnya benar-benar
    // menggerbang: `periksaPesananMenggantung` membaca `clients` dengan
    // `.eq("user_id", user.id)`. Tanpa klausa itu ia tetap HIJAU hari ini —
    // bukan karena gerbangnya bekerja, melainkan karena `admin@padma.test`
    // kebetulan tidak punya baris `clients` di seed. Satu baris klien untuk
    // akun staf, kapan pun kelak ditambahkan, langsung membalik kelulusan itu
    // menjadi kebocoran senyap.
    const kode = `${AWALAN_KODE}0010`;
    const id = await semaiPesanan({ kode });
    midtrans.jawaban = jawabanSukses(`${kode}.1`, "settlement");

    const sesiSemula = ref.sesi;
    ref.sesi = await signInAs("admin@padma.test");
    try {
      const hasil = await periksaPesananMenggantung();
      expect(midtrans.panggilan).toEqual([]);
      expect(hasil).toEqual({ diperiksa: 0 });
      expect(await statusPesanan(id)).toBe("menunggu_bayar");

      // Dan capnya TIDAK ikut tertulis — inilah bagian yang memperdaya
      // penyapu Lapis 3 bila gerbangnya hilang.
      const { data } = await admin
        .from("orders").select("diperiksa_pada").eq("id", id).single();
      expect(data!.diperiksa_pada).toBeNull();
    } finally {
      ref.sesi = sesiSemula;
    }
  });

  it("pesanan milik klien LAIN tidak pernah ditanyakan", async () => {
    // Bila pemilihan barisnya memakai service role, membuka satu halaman
    // menembakkan permintaan Midtrans atas pesanan orang lain — dan mencapnya
    // sudah diperiksa padahal pemiliknya tidak pernah melihat layar itu.
    const kode = `${AWALAN_KODE}0009`;
    const id = await semaiPesanan({ kode, clientId: KLIEN_RINA });
    midtrans.jawaban = jawabanSukses(`${kode}.1`, "settlement");

    const hasil = await periksaPesananMenggantung();

    expect(midtrans.panggilan).toEqual([]);
    expect(hasil.diperiksa).toBe(0);
    expect(await statusPesanan(id)).toBe("menunggu_bayar");
  });
});

// ---------------------------------------------------------------------------
// 6. Pemicu sisi peramban
// ---------------------------------------------------------------------------

describe("picuPeriksaSekali", () => {
  it("menyegarkan HANYA bila ada yang benar-benar diperiksa", async () => {
    let disegarkan = 0;
    const n = await picuPeriksaSekali(async () => ({ diperiksa: 2 }), () => {
      disegarkan += 1;
    });
    expect(n).toBe(2);
    expect(disegarkan).toBe(1);
  });

  it("TIDAK menyegarkan ketika tidak ada yang diperiksa", async () => {
    // Refresh tanpa sebab adalah satu perjalanan server penuh per pembukaan
    // halaman, pada halaman etalase yang justru dirancang supaya murah.
    let disegarkan = 0;
    const n = await picuPeriksaSekali(async () => ({ diperiksa: 0 }), () => {
      disegarkan += 1;
    });
    expect(n).toBe(0);
    expect(disegarkan).toBe(0);
  });

  it("server action yang melempar tidak merusak halaman", async () => {
    let disegarkan = 0;
    const n = await picuPeriksaSekali(
      async () => {
        throw new Error("jaringan putus");
      },
      () => {
        disegarkan += 1;
      },
    );
    expect(n).toBe(0);
    expect(disegarkan).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 7. Kabel di halaman publik — PELENGKAP, bukan pagarnya
// ---------------------------------------------------------------------------

describe("kabel Lapis 1b di /produk/[slug]", () => {
  it("TombolBeli memicu pemeriksaan lewat picuPeriksaSekali", () => {
    // Pemindaian teks sumber, dan ia memang lemah: repo ini sudah beberapa kali
    // tertipu uji yang puas oleh baris impor. Karena itu ia DIPASANGKAN dengan
    // tiga uji `picuPeriksaSekali` di atas (perilakunya) dan uji
    // "/passport/produk menyembuhkan lalu menampilkan" (kabel halaman kedua
    // yang benar-benar dirender). Yang dijaga di sini hanya satu hal yang
    // memang mustahil dirender: efek mount komponen klien — `renderToStaticMarkup`
    // tidak menjalankan useEffect, dan repo ini tidak punya jsdom.
    const sumber = baca("src/app/produk/[slug]/tombol-beli.tsx");
    expect(sumber).toMatch(/useEffect\(/);
    expect(sumber).toContain("picuPeriksaSekali(");
    expect(sumber).toContain("periksaPesananSaya");
  });
});
