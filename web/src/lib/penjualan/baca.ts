import { createServerSupabase } from "@/lib/supabase/server";
import { PESANAN_BERUANG, PESANAN_MATI, type StatusPesanan } from "@/lib/pesanan/status";
import type { BarisPenjualan, ItemPenjualan } from "./hitung";

// ============================================================================
// PEMBACA PENJUALAN — nol service role
// ============================================================================
// Seluruhnya dibaca dengan SESI PEMANGGIL. Policy `"pesanan: staf baca"` dan
// predikat `user_role()` di dalam badan `pesanan_item_staf` yang memutuskan,
// jadi admin yang perannya dicabut kehilangan layar ini seketika tanpa satu
// baris kode pun berubah.
//
// Nominal DIPULANGKAN sebagai angka, bukan sebagai teks berformat:
// pemformatan tinggal di komponen, supaya modul ini tetap bisa dipakai
// pemanggil yang MENGHITUNG, bukan yang menampilkan.

/**
 * Batas baris per kueri — DIEKSPOR karena layarnya menyebut angkanya.
 *
 * Batas yang tidak diumumkan adalah batas yang berbohong: 500 baris yang
 * terpotong terlihat persis seperti 500 baris yang memang hanya segitu.
 * `/admin/pesanan` mengekspor `BATAS_BARIS` untuk alasan yang sama.
 */
export const BATAS_BARIS_PENJUALAN = 500;

/**
 * Status yang pernah memikul uang atau pernah menutup sebuah pesanan.
 *
 * DITURUNKAN dari himpunan `@/lib/pesanan/status`, bukan diketik ulang.
 * Alasannya sudah dibayar repo ini sekali: nilai enum baru membuat konstanta
 * tunggal salah DIAM-DIAM. Dengan daftar hard-coded di sini, nilai keenam
 * yang kelak lahir akan hilang dari laporan tanpa satu pun uji memerah.
 */
const STATUS_DIBACA: StatusPesanan[] = [...PESANAN_BERUANG, ...PESANAN_MATI];

/** Nilai `status_midtrans` yang berarti uang KELUAR lagi. */
const STATUS_KEMBALI = ["refund", "partial_refund", "chargeback", "partial_chargeback"];

type BarisOrders = {
  id: string;
  kode: string;
  status: StatusPesanan;
  lunas_pada: string | null;
  ditutup_pada: string | null;
  clients: { padma_id: string; nama: string } | null;
};

const KOLOM_ORDERS =
  "id, kode, status, lunas_pada, ditutup_pada, clients ( padma_id, nama )";

export async function bacaPenjualan(opsi: {
  /** ISO inklusif. Tanpa ini, seluruh riwayat dibaca (dibatasi BATAS_BARIS). */
  mulai?: string;
  /** ISO EKSKLUSIF. */
  sampai?: string;
  clientId?: string;
  /** Hanya untuk uji — produksi memakai sesi pemanggil. */
  klien?: Awaited<ReturnType<typeof createServerSupabase>>;
}): Promise<{ baris: BarisPenjualan[]; terpotong: boolean }> {
  const sb = opsi.klien ?? (await createServerSupabase());

  // --------------------------------------------------------------------
  // PUTARAN 1 — memilih pesanan mana yang masuk rentang
  // --------------------------------------------------------------------
  // DUA kueri, bukan satu `or(...)`. Satu `or` yang memuat `status.in.(…)`
  // menitipkan pemisahan koma-di-dalam-kurung kepada parser PostgREST, dan
  // salah tulis satu kurung di sana tidak menghasilkan galat melainkan
  // saringan yang DIAM-DIAM lebih longgar.
  //
  // Kueri (a) menyaring `ditutup_pada`, BUKAN `lunas_pada`, dan itu
  // disengaja: `lunas_pada` kosong untuk pesanan `ditahan`, sementara
  // `ditutup_pada` terisi untuk SETIAP pesanan tertutup (dijamin CHECK
  // `pesanan_tutup_bercap`). Untuk pesanan `lunas` keduanya IDENTIK — dua
  // kolom itu ditulis `now()` dalam satu pernyataan UPDATE yang sama
  // (`20260927100000_sebab_tinjauan_lestari.sql:506-513`).
  //
  // Kueri (b) menangkap pesanan yang uangnya mendarat di rentang ini padahal
  // pesanannya sudah ditutup lebih dulu — "bayar lewat tenggat". Pesanan itu
  // tidak pernah berpindah status, jadi `ditutup_pada`-nya menunjuk ke bulan
  // yang SALAH dan kueri (a) tidak akan pernah memungutnya ke bulan yang
  // benar.
  // Saringan dipasang SEBELUM order/limit/returns: setelah itu tipenya
  // tinggal pembangun transform yang tidak punya gte/lt/eq.
  let saringTutup = sb
    .from("orders")
    .select(KOLOM_ORDERS)
    .in("status", STATUS_DIBACA);
  if (opsi.mulai) saringTutup = saringTutup.gte("ditutup_pada", opsi.mulai);
  if (opsi.sampai) saringTutup = saringTutup.lt("ditutup_pada", opsi.sampai);
  if (opsi.clientId) saringTutup = saringTutup.eq("client_id", opsi.clientId);
  const kueriTutup = saringTutup
    .order("ditutup_pada", { ascending: false })
    .limit(BATAS_BARIS_PENJUALAN)
    .returns<BarisOrders[]>();

  let kueriNotif = sb
    .from("notifikasi_pesanan")
    .select("pesanan_id, status_midtrans, nominal_diterima, diterima_pada")
    .not("pesanan_id", "is", null)
    .order("diterima_pada", { ascending: false })
    .limit(BATAS_BARIS_PENJUALAN);
  if (opsi.mulai) kueriNotif = kueriNotif.gte("diterima_pada", opsi.mulai);
  if (opsi.sampai) kueriNotif = kueriNotif.lt("diterima_pada", opsi.sampai);

  const [tutup, notifRentang] = await Promise.all([kueriTutup, kueriNotif]);
  // Galat DIBACA, bukan dibuang. Layar penjualan yang kosong karena kuerinya
  // gagal terlihat persis seperti bulan yang memang belum ada penjualannya —
  // dan di layar ini perbedaan itu adalah perkara uang.
  if (tutup.error) throw tutup.error;
  if (notifRentang.error) throw notifRentang.error;

  const perId = new Map<string, BarisOrders>();
  for (const b of tutup.data ?? []) perId.set(b.id, b);

  const idTambahan = [
    ...new Set(
      (notifRentang.data ?? [])
        .map((r) => r.pesanan_id as string)
        .filter((id) => id && !perId.has(id)),
    ),
  ];

  // --------------------------------------------------------------------
  // PUTARAN 2 — melengkapi barisnya
  // --------------------------------------------------------------------
  const idAwal = [...perId.keys()];
  if (idAwal.length === 0 && idTambahan.length === 0) {
    return { baris: [], terpotong: false };
  }

  const semuaId = [...idAwal, ...idTambahan];

  const [susulan, item, notif, jejak] = await Promise.all([
    idTambahan.length === 0
      ? Promise.resolve({ data: [] as BarisOrders[], error: null })
      : sb
          .from("orders")
          .select(KOLOM_ORDERS)
          .in("id", idTambahan)
          .in("status", STATUS_DIBACA)
          .returns<BarisOrders[]>(),
    sb
      .from("pesanan_item_staf")
      .select("pesanan_id, judul_beku, harga_beku, urutan, product_id")
      .in("pesanan_id", semuaId)
      .order("urutan", { ascending: true }),
    sb
      .from("notifikasi_pesanan")
      .select("pesanan_id, status_midtrans, diterima_pada")
      .in("pesanan_id", semuaId)
      .order("diterima_pada", { ascending: false })
      // PEMECAH SERI, tugasnya STABILITAS. `diterima_pada` hanyalah
      // `default now()`; dua baris BOLEH memikul cap yang sama persis.
      .order("id", { ascending: false }),
    sb
      .from("jejak_pesanan")
      .select("pesanan_id, kejadian")
      .in("pesanan_id", semuaId)
      .eq("kejadian", "lunas_setelah_tutup"),
  ]);
  if (susulan.error) throw susulan.error;
  if (item.error) throw item.error;
  if (notif.error) throw notif.error;
  if (jejak.error) throw jejak.error;

  for (const b of susulan.data ?? []) perId.set(b.id, b);

  const itemPer = new Map<string, ItemPenjualan[]>();
  for (const r of item.data ?? []) {
    const kunci = r.pesanan_id as string;
    const daftar = itemPer.get(kunci) ?? [];
    daftar.push({
      productId: (r.product_id as string | null) ?? null,
      judulBeku: r.judul_beku as string,
      hargaBeku: Number(r.harga_beku),
      urutan: Number(r.urutan),
    });
    itemPer.set(kunci, daftar);
  }

  const dikembalikan = new Set<string>();
  const uangPer = new Map<string, string>();
  for (const r of notif.data ?? []) {
    const kunci = r.pesanan_id as string;
    const status = (r.status_midtrans as string | null) ?? "";
    if (STATUS_KEMBALI.includes(status)) dikembalikan.add(kunci);
    // Notifikasi TERBARU yang menang — daftarnya sudah terurut turun.
    if (!uangPer.has(kunci)) uangPer.set(kunci, r.diterima_pada as string);
  }

  const setelahTutup = new Set((jejak.data ?? []).map((r) => r.pesanan_id as string));

  const baris: BarisPenjualan[] = [...perId.values()].map((b) => ({
    pesananId: b.id,
    kode: b.kode,
    status: b.status,
    lunasPada: b.lunas_pada,
    uangPada: uangPer.get(b.id) ?? b.ditutup_pada,
    // Embed yang ditahan RLS memulangkan NULL, bukan galat — pelajaran repo.
    // "" diteruskan apa adanya ke komponen, yang merendernya sebagai
    // kegagalan baca yang TERLIHAT, bukan sebagai sel kosong.
    padmaId: b.clients?.padma_id ?? "",
    namaKlien: b.clients?.nama ?? "",
    pernahDikembalikan: dikembalikan.has(b.id),
    lunasSetelahTutup: setelahTutup.has(b.id),
    // null KETIKA NOL ITEM, bukan larik kosong yang menjumlah jadi nol.
    item: itemPer.get(b.id) ?? null,
  }));

  return {
    baris,
    terpotong:
      (tutup.data ?? []).length >= BATAS_BARIS_PENJUALAN ||
      (notifRentang.data ?? []).length >= BATAS_BARIS_PENJUALAN,
  };
}
