import { createServerSupabase } from "@/lib/supabase/server";
import {
  PESANAN_BERUANG,
  PESANAN_MATI,
  type KejadianPesanan,
  type StatusPesanan,
} from "@/lib/pesanan/status";
import { tanggalUang, type BarisPenjualan, type ItemPenjualan } from "./hitung";

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

/** Kejadian yang menandai uang mendarat sesudah pesanan ditutup. Bertipe, bukan literal: rename enum jadi galat kompilasi. */
const KEJADIAN_SETELAH_TUTUP: KejadianPesanan[] = ["lunas_setelah_tutup"];

/**
 * Id per kueri putaran 2. 100 x 9 item = 900, di bawah `max_rows` 1000
 * (`supabase/config.toml:18`). Menaikkan `.limit()` TIDAK menolong: max_rows
 * adalah batas server, bukan batas klien.
 */
const UKURAN_BONGKAH = 100;
const BATAS_BONGKAH = 900;

type HasilBongkah<T> = { data: T[] | null; error: { message: string } | null };

/**
 * Menjalankan satu kueri per bongkah id (bersamaan), menyatukan barisnya, dan
 * melaporkan apakah ada bongkah yang menyentuh batasnya — artinya terpotong.
 * Galat dilempar, tidak dibuang.
 */
async function bacaBerbongkah<T>(
  ids: string[],
  kueri: (bongkah: string[], batas: number) => PromiseLike<HasilBongkah<T>>,
): Promise<{ data: T[]; terpotong: boolean }> {
  const bongkah: string[][] = [];
  for (let i = 0; i < ids.length; i += UKURAN_BONGKAH) {
    bongkah.push(ids.slice(i, i + UKURAN_BONGKAH));
  }
  const hasil = await Promise.all(bongkah.map((b) => kueri(b, BATAS_BONGKAH)));
  const data: T[] = [];
  let terpotong = false;
  for (const h of hasil) {
    if (h.error) throw h.error;
    const baris = h.data ?? [];
    if (baris.length >= BATAS_BONGKAH) terpotong = true;
    data.push(...baris);
  }
  return { data, terpotong };
}

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
      : (() => {
          let q = sb
            .from("orders")
            .select(KOLOM_ORDERS)
            .in("id", idTambahan)
            .in("status", STATUS_DIBACA);
          // Putaran 1(b) tidak bisa menyaring klien (notifikasi tak punya
          // client_id), jadi saringan ini WAJIB dipasang lagi di sini.
          if (opsi.clientId) q = q.eq("client_id", opsi.clientId);
          return q.returns<BarisOrders[]>();
        })(),
    bacaBerbongkah(semuaId, (ids, batas) =>
      sb
        .from("pesanan_item_staf")
        .select("pesanan_id, judul_beku, harga_beku, urutan, product_id")
        .in("pesanan_id", ids)
        .order("urutan", { ascending: true })
        .limit(batas),
    ),
    bacaBerbongkah(semuaId, (ids, batas) =>
      sb
        .from("notifikasi_pesanan")
        .select("pesanan_id, status_midtrans, nominal_diterima, diterima_pada")
        .in("pesanan_id", ids)
        .order("diterima_pada", { ascending: false })
        // PEMECAH SERI, tugasnya STABILITAS. `diterima_pada` hanyalah
        // `default now()`; dua baris BOLEH memikul cap yang sama persis.
        .order("id", { ascending: false })
        .limit(batas),
    ),
    bacaBerbongkah(semuaId, (ids, batas) =>
      sb
        .from("jejak_pesanan")
        .select("pesanan_id, kejadian")
        .in("pesanan_id", ids)
        .in("kejadian", KEJADIAN_SETELAH_TUTUP)
        .limit(batas),
    ),
  ]);
  if (susulan.error) throw susulan.error;

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
    // Hanya notifikasi yang MEMBAWA uang (`nominal_diterima` terisi) yang
    // menentukan tanggal uang: expire/deny/refund susulan tidak boleh
    // memindahkan uangnya ke bulan lain. Terbaru menang — sudah terurut turun.
    if (r.nominal_diterima != null && !uangPer.has(kunci)) uangPer.set(kunci, r.diterima_pada as string);
  }

  const setelahTutup = new Set((jejak.data ?? []).map((r) => r.pesanan_id as string));

  const semua: BarisPenjualan[] = [...perId.values()].map((b) => ({
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

  // Fungsi ini menjanjikan baris untuk SEBUAH rentang, maka harus
  // menyerahkan baris untuk rentang itu. Notifikasi yang mendarat di rentang
  // pada pesanan yang uangnya bulan tetangga menyeret pesanan itu masuk;
  // bucket parsial dari bulan tetangga lebih buruk daripada tidak ada, sebab
  // tampak seperti total sungguhan.
  const baris =
    opsi.mulai && opsi.sampai
      ? semua.filter((b) => {
          const t = tanggalUang(b);
          if (t === null) return true;
          const ms = Date.parse(t);
          return ms >= Date.parse(opsi.mulai!) && ms < Date.parse(opsi.sampai!);
        })
      : semua;

  return {
    baris,
    terpotong:
      (tutup.data ?? []).length >= BATAS_BARIS_PENJUALAN ||
      (notifRentang.data ?? []).length >= BATAS_BARIS_PENJUALAN ||
      item.terpotong ||
      notif.terpotong ||
      jejak.terpotong,
  };
}
