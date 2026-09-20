import { createServerSupabase } from "@/lib/supabase/server";
import { hitungRentang, type ParamDaftar, type SaringSah } from "@/app/_shell/panel/daftar";
import type { JenisProduk } from "@/lib/produk/status";

// ============================================================================
// LAPISAN DATA — harga produk digital, panel OWNER
// ============================================================================
// Sejajar `src/lib/owner/data.ts` (`ambilRateCard`/`ambilTarif`): SELURUH
// pembacaan di berkas ini memakai `createServerSupabase()` — sesi PENGGUNA,
// bukan service role. Di bawah service role `user_role()` mengembalikan
// 'klien' dan policy "harga produk: owner baca"/"owner sisip" tidak pernah
// ikut diperiksa — bacaannya akan "berhasil" untuk siapa pun yang memanggil,
// dan money firewall berhenti menjadi pertahanan.
//
// GRANT `select, insert` atas `digital_product_prices` baru diberikan Task 7
// (migration `20260921140000_produk_harga_grant.sql`) — sebelumnya SELURUH
// hak tabel tercabut dari `authenticated`. RLS-nya sudah berdiri sejak Task 2;
// yang baru dibuka di sini hanya hak tabelnya.

export type HargaRiwayat = {
  id: string;
  harga: number;
  /** Harga PEMASARAN sebelum diskon, dipajang tercoret. Diisi MANUAL. */
  hargaCoret: number | null;
  berlakuSejak: string;
  /** Baris inilah yang menghargai pembelian pada `hariIni`. */
  berlakuSekarang: boolean;
  /** Sudah ditetapkan, tetapi `berlaku_sejak`-nya masih di depan. */
  belumBerlaku: boolean;
};

export type BarisProdukHarga = {
  productId: string;
  judul: string;
  slug: string;
  jenis: JenisProduk;
  aktif: boolean;
  /** Harga yang berlaku pada `hariIni`; `null` bila produk belum bertarif. */
  berlaku: HargaRiwayat | null;
  /** SELURUH baris harga produk ini, terbaru di atas. */
  riwayat: HargaRiwayat[];
};

export const SARING_PRODUK_HARGA = {
  harga: ["bertarif", "belum"],
  aktif: ["ya", "tidak"],
} as const satisfies SaringSah;

export type HalamanProdukHarga = { baris: BarisProdukHarga[]; total: number };

type BarisProduk = { id: string; judul: string; slug: string; jenis: JenisProduk; aktif: boolean };
type BarisHarga = {
  id: string;
  product_id: string;
  harga: number;
  harga_coret: number | null;
  berlaku_sejak: string;
};

/**
 * "Harga yang berlaku pada tanggal X" — aturan yang sama dengan
 * `tarifPadaTanggal()` di `owner/rekap.ts`: `berlaku_sejak` terbesar yang
 * tidak melebihi `hariIni`, seri dipecah dengan `id` supaya hasilnya tidak
 * bergantung pada urutan baris yang dipulangkan PostgREST.
 */
function hargaPadaTanggal(riwayat: readonly HargaRiwayat[], hariIni: string): HargaRiwayat | null {
  let terpilih: HargaRiwayat | null = null;
  for (const h of riwayat) {
    if (h.berlakuSejak > hariIni) continue;
    if (terpilih === null || h.berlakuSejak > terpilih.berlakuSejak) {
      terpilih = h;
      continue;
    }
    if (h.berlakuSejak === terpilih.berlakuSejak && h.id < terpilih.id) {
      terpilih = h;
    }
  }
  return terpilih;
}

/**
 * SELURUH produk beserta harga berlaku pada `hariIni` dan seluruh riwayatnya.
 *
 * `hariIni` WAJIB diberikan pemanggil (halaman meneruskan `hariIniJakarta()`),
 * sama alasannya dengan `ambilRateCard`: fungsi yang membaca jam sistem
 * sendiri mustahil diuji pada tanggal tertentu.
 *
 * Produk yang BELUM bertarif tetap muncul dengan `berlaku: null` — bukan
 * disaring keluar, supaya "belum ditetapkan" terbaca sebagai PEKERJAAN, bukan
 * hilang dari daftar.
 */
export async function ambilDaftarHargaProduk(
  param: ParamDaftar,
  hariIni: string,
): Promise<HalamanProdukHarga> {
  const supabase = await createServerSupabase();

  const [{ data: produk, error: produkError }, { data: harga, error: hargaError }] = await Promise.all([
    supabase
      .from("digital_products")
      .select("id, judul, slug, jenis, aktif")
      .order("judul")
      .returns<BarisProduk[]>(),
    // SELURUH riwayat, bukan hanya yang berlaku hari ini: halaman ini
    // menampilkan riwayat penetapan lengkap, sejajar `ambilTarif()`.
    supabase
      .from("digital_product_prices")
      .select("id, product_id, harga, harga_coret, berlaku_sejak")
      .order("berlaku_sejak", { ascending: false })
      .order("id", { ascending: false })
      .returns<BarisHarga[]>(),
  ]);
  // GALAT DIBACA, BUKAN DIBUANG.
  if (produkError) throw new Error(`Gagal membaca daftar produk: ${produkError.message}`);
  if (hargaError) throw new Error(`Gagal membaca riwayat harga: ${hargaError.message}`);

  const riwayatPer = new Map<string, HargaRiwayat[]>();
  for (const h of harga ?? []) {
    const daftar = riwayatPer.get(h.product_id) ?? [];
    daftar.push({
      id: h.id,
      harga: h.harga,
      hargaCoret: h.harga_coret,
      berlakuSejak: h.berlaku_sejak,
      berlakuSekarang: false,
      belumBerlaku: h.berlaku_sejak > hariIni,
    });
    riwayatPer.set(h.product_id, daftar);
  }

  let baris: BarisProdukHarga[] = (produk ?? []).map((p) => {
    const riwayatMentah = riwayatPer.get(p.id) ?? [];
    const berlakuMentah = hargaPadaTanggal(riwayatMentah, hariIni);
    const riwayat = riwayatMentah.map((h) => ({
      ...h,
      berlakuSekarang: h.id === berlakuMentah?.id,
    }));
    return {
      productId: p.id,
      judul: p.judul,
      slug: p.slug,
      jenis: p.jenis,
      aktif: p.aktif,
      berlaku: riwayat.find((h) => h.berlakuSekarang) ?? null,
      riwayat,
    };
  });

  const cari = param.cari.toLowerCase();
  baris = baris.filter((b) => {
    if (cari !== "" && !b.judul.toLowerCase().includes(cari)) return false;
    // "belum bertarif" adalah PEKERJAAN, bukan kabar — sejajar saringan yang
    // sama di `saringRateCard()`.
    if (param.saring.harga === "belum" && b.berlaku !== null) return false;
    if (param.saring.harga === "bertarif" && b.berlaku === null) return false;
    if (param.saring.aktif === "ya" && !b.aktif) return false;
    if (param.saring.aktif === "tidak" && b.aktif) return false;
    return true;
  });

  // `sampai` inklusif, sama seperti `.range()` PostgREST yang ditirunya.
  const { dari, sampai } = hitungRentang(param.hal);
  return { baris: baris.slice(dari, sampai + 1), total: baris.length };
}
