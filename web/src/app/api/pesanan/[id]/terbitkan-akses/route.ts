import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type { KejadianPesanan, StatusPesanan, SumberItemPesanan } from "@/lib/pesanan/status";

export const runtime = "nodejs";

/**
 * SATU nilai, bukan himpunan — dan itu keputusan, bukan kelalaian.
 *
 * Keempat himpunan Tugas 1 tidak ada yang cocok: `PESANAN_BERUANG` memuat
 * `ditahan`, dan pesanan `ditahan` adalah persis yang aksesnya TIDAK boleh
 * terbit sebelum manusia memutuskannya. §0.6 melarang melahirkan himpunan
 * kelima untuk satu pemakai, jadi yang tersisa adalah satu nilai — tapi satu
 * nilai yang DIPERIKSA KOMPILATOR.
 *
 * `satisfies StatusPesanan` adalah mekanisme yang sama dengan
 * `Record<StatusPesanan, ...>` di `tombol-pesanan.tsx` dan
 * `KejadianPesanan[]` di `lib/admin/pesanan.ts`, dan tanpanya berkas ini
 * adalah satu-satunya literal status pesanan yang tersisa di kode keputusan
 * permukaan — di sebelah dokblok tombol yang mengaku "NOL LITERAL STATUS".
 * Mengganti nama nilai enum `lunas` kelak akan memerahkan `tsc` di sini,
 * alih-alih membuat gerbang ini menolak SETIAP pesanan tanpa satu pun galat.
 */
const STATUS_BOLEH_TERBIT = "lunas" satisfies StatusPesanan;

/**
 * Ketiga nilai balik `terbitkan_akses_item`, sebagai kalimat operator.
 *
 * ===== KENAPA RUTE INI HARUS BICARA =====
 * Sebelumnya ia memulangkan `{terbit, belumAdaPenangan}` yang tombolnya tidak
 * pernah render — `TombolPesanan` hanya menampilkan `pesan`, dan hanya saat
 * `!res.ok`. Akibatnya ketiga hasil di bawah terlihat IDENTIK bagi staf yang
 * menekan tombolnya: halaman menyegarkan diri, titik. Dan ketiganya menuntut
 * tindakan yang berbeda — `akses_tertahan` khususnya berarti entitlementnya
 * DICABUT dan aksesnya sengaja tidak dihidupkan, keadaan yang tidak akan
 * membaik dengan menekan tombol yang sama sekali lagi.
 *
 * Kuncinya BERTIPE, bukan string bebas. Ketiganya juga anggota enum
 * `order_event`, dan `Partial<Record<KejadianPesanan, string>>` memaksa
 * setiap kunci di bawah tetap menjadi nama kejadian yang sah — mengganti nama
 * salah satunya memerahkan `tsc` di sini, alih-alih diam-diam menjatuhkannya
 * ke cabang "tidak dikenal". `Partial`, karena ketiga belas kejadian lain
 * memang bukan urusan rute ini; `Record` penuh akan menuntut kalimat untuk
 * `dibuat` dan `kedaluwarsa` juga.
 */
const KALIMAT_HASIL = {
  akses_terbit: "akses terbit",
  akses_sudah_ada:
    "akses sudah ada sebelumnya, atau durasi pesanan ini sudah pernah diserahkan — tidak ada yang diterbitkan ulang",
  akses_tertahan:
    "akses DITAHAN — entitlementnya sudah dicabut, jadi aksesnya sengaja tidak dihidupkan dan pesanan ini ditandai butuh tinjauan",
} satisfies Partial<Record<KejadianPesanan, string>>;

/**
 * Jenis item, sebagai nilai yang DIPERIKSA KOMPILATOR — alasan yang sama
 * dengan `STATUS_BOLEH_TERBIT` di atas.
 */
const JENIS_PRODUK = "produk_digital" satisfies SumberItemPesanan;
const JENIS_SESI = "sesi" satisfies SumberItemPesanan;

/**
 * Ketiga nilai balik `salurkan_sesi` (B3), sebagai kalimat operator.
 *
 * `tertahan` bukan galat rute: penyalur tidak pernah melempar, jadi syarat
 * yang gagal (bidan nonaktif, jam kunjungan lewat, pengajuan berubah) pulang
 * sebagai jawaban 200 yang harus DIBACA staf, bukan sebagai kotak merah.
 * Alasan rincinya ada di jejak pesanan.
 */
const KALIMAT_SESI: Record<string, string | undefined> = {
  terkonfirmasi: "sesi lahir dan pengajuannya dikonfirmasi — kabari bidannya",
  sudah_ada: "sesi untuk pengajuan ini sudah ada — tidak ada yang dibuat ulang",
  tertahan:
    "sesi DITAHAN — syaratnya belum terpenuhi (mis. bidan nonaktif atau jam kunjungan lewat); alasannya di jejak pesanan, dan pesanan ini ditandai butuh tinjauan",
};

/**
 * TERBITKAN ULANG AKSES / BUAT SESI (Lapis 2).
 *
 * ===== ITEM SESI (B3) =====
 * Pesanan sesi tidak punya akses untuk diterbitkan; yang diserahkan adalah
 * SESI-nya. Untuk item sesi rute ini menjalankan ulang penyalur sesi
 * (`salurkan_sesi`) SEKALI per pesanan, bukan sekali per item: pesanan sesi
 * membawa dua item (layanan + transport) untuk satu pengajuan, dan penyalurnya
 * bekerja per pengajuan. Kalimat "di-key pada transisi" di bawah tetap benar:
 * yang dipanggil di sini penyalur SESI yang idempoten (`sudah_ada`), bukan
 * `salurkan_pesanan`.
 *
 * ===== KENAPA terbitkan_akses_item, BUKAN salurkan_pesanan =====
 * Penyalur di-key pada TRANSISI, bukan pada niat: ia hanya dipanggil dari
 * cabang `terapkan_notifikasi_gateway` yang benar-benar memindahkan baris
 * (spec, "Kejadian dan penyaluran"). Memanggilnya dari sini akan membuat
 * kalimat itu tidak lagi benar, dan kalimat itulah yang membuat "lunas tanpa
 * akses" mustahil alih-alih sekadar jarang. Jadi tombol ini memanggil
 * `terbitkan_akses_item` LANGSUNG, satu per item.
 *
 * `order_items` lahir NOL GRANT dan NOL POLICY, jadi id itemnya hanya bisa
 * dibaca service role — dan view `pesanan_item_staf` sengaja tidak
 * memproyeksikan kolom id. Urutannya karena itu mengikat: peran diputuskan
 * `requireRole`, kepemilikan barisnya diputuskan RLS lewat sesi pemanggil,
 * BARU service role menyentuh `order_items`.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireRole(["admin", "owner"]);
  const { id } = await params;

  const sb = await createServerSupabase();
  const { data: pesanan, error: galatPesanan } = await sb
    .from("orders")
    .select("id, status")
    .eq("id", id)
    .maybeSingle<{ id: string; status: StatusPesanan }>();

  // `error` DIBACA, tidak dibuang. PostgREST yang gagal memulangkan
  // `data: null` — bentuk yang SAMA PERSIS dengan "barisnya memang tidak
  // ada". Dilaporkan 404, staf pergi mencari pesanan yang dikiranya terhapus
  // sementara yang rusak adalah basis datanya; di jalur pembayaran, kegagalan
  // yang melapor sebagai hal lain lebih mahal daripada kegagalan yang melapor
  // sebagai dirinya sendiri. `bacaPesananStaf` sudah berargumen begitu lalu
  // MELEMPAR; rute tidak bisa melempar tanpa kehilangan `pesan`-nya, jadi ia
  // menjawab 500 dengan kalimat yang berbeda dari 404 di bawahnya.
  if (galatPesanan) {
    return NextResponse.json({ pesan: "Baris pesanan tidak terbaca." }, { status: 500 });
  }
  if (!pesanan) {
    return NextResponse.json({ pesan: "Pesanan tidak ditemukan." }, { status: 404 });
  }

  // Tombolnya memang hanya dirender untuk baris `lunas`, tetapi rute adalah
  // endpoint MANDIRI: tanpa gerbang ini, satu curl sudah cukup memberikan
  // barang yang belum dibayar.
  if (pesanan.status !== STATUS_BOLEH_TERBIT) {
    return NextResponse.json(
      { pesan: "Akses hanya bisa diterbitkan untuk pesanan yang sudah lunas." },
      { status: 409 },
    );
  }

  const admin = createAdminSupabase();
  const { data: item, error: galatItem } = await admin
    .from("order_items")
    .select("id, jenis, urutan")
    .eq("pesanan_id", id)
    .order("urutan", { ascending: true })
    .returns<{ id: string; jenis: string; urutan: number }[]>();
  if (galatItem) {
    return NextResponse.json({ pesan: "Item pesanan tidak terbaca." }, { status: 500 });
  }
  if (!item || item.length === 0) {
    return NextResponse.json({ pesan: "Pesanan ini tidak punya item." }, { status: 404 });
  }

  const terbit: string[] = [];
  const belumAdaPenangan: number[] = [];
  let adaItemSesi = false;
  for (const b of item) {
    if (b.jenis === JENIS_SESI) {
      // Dicatat saja; penyalurnya dipanggil SEKALI sesudah loop.
      adaItemSesi = true;
      continue;
    }
    // Jenis ketiga yang kelak lahir belum punya penangan. Dilaporkan, bukan
    // ditebak — menebaknya berarti menerbitkan akses produk untuk item yang
    // bukan produk.
    if (b.jenis !== JENIS_PRODUK) {
      belumAdaPenangan.push(b.urutan);
      continue;
    }
    const { data, error } = await admin.rpc("terbitkan_akses_item", { p_item_id: b.id });
    if (error) {
      return NextResponse.json({ pesan: "Penerbitan akses gagal." }, { status: 500 });
    }
    terbit.push(String(data));
  }

  // `null` = pesanan ini tidak membawa item sesi. Selalu ADA di jawaban,
  // supaya pembacanya tidak perlu membedakan "tidak ada" dari "lupa dikirim".
  let sesi: string | null = null;
  if (adaItemSesi) {
    const { data, error } = await admin.rpc("salurkan_sesi", { p_pesanan_id: id });
    if (error) {
      return NextResponse.json({ pesan: "Pembuatan sesi gagal." }, { status: 500 });
    }
    sesi = String(data);
  }

  return NextResponse.json({
    terbit,
    belumAdaPenangan,
    sesi,
    pesan: rangkum(terbit, belumAdaPenangan, sesi),
  });
}

/**
 * Satu kalimat Indonesia dari hasil mentah, untuk dibaca operator.
 *
 * Nilai yang TIDAK dikenal diteruskan apa adanya alih-alih disembunyikan di
 * balik "berhasil": nilai balik keempat yang lahir kelak akan terlihat sebagai
 * kata asing di layar — canggung, dan jauh lebih murah daripada tindakan yang
 * melaporkan keberhasilan untuk sesuatu yang belum pernah ditafsirkan siapa
 * pun.
 */
function rangkum(terbit: string[], belumAdaPenangan: number[], sesi: string | null): string {
  const hitung = new Map<string, number>();
  for (const h of terbit) hitung.set(h, (hitung.get(h) ?? 0) + 1);

  const kamus: Record<string, string | undefined> = KALIMAT_HASIL;
  const bagian = [...hitung].map(([hasil, n]) => `${n} item: ${kamus[hasil] ?? hasil}`);
  if (sesi !== null) bagian.push(KALIMAT_SESI[sesi] ?? `sesi: ${sesi}`);
  if (belumAdaPenangan.length > 0) {
    bagian.push(
      `item urutan ${belumAdaPenangan.join(", ")} dilewati — jenisnya belum punya penangan`,
    );
  }
  return `${bagian.join("; ")}.`;
}
