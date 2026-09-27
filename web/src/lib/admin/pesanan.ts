import { createServerSupabase } from "@/lib/supabase/server";
import {
  PESANAN_BERUANG,
  PESANAN_TERBUKA,
  type StatusPesanan,
  type SumberItemPesanan,
} from "@/lib/pesanan/status";

/**
 * PEMBACA LAYAR PESANAN STAF (Lapis 2, spec "Rekonsiliasi — empat lapis").
 *
 * Seluruhnya dibaca dengan SESI PEMANGGIL — nol service role. Policy
 * `"pesanan: staf baca"`, `"jejak pesanan: staf baca"` dan
 * `"notifikasi pesanan: staf baca"` yang memutuskan, jadi admin yang perannya
 * dicabut kehilangan layar ini seketika tanpa satu baris kode pun berubah.
 *
 * Nominal DIPULANGKAN sebagai angka, bukan sebagai teks berformat: pemformatan
 * tinggal di komponen (`tabel-pesanan.tsx`), supaya modul ini tetap bisa
 * dipakai pemanggil yang menghitung, bukan yang menampilkan. Kenapa nominalnya
 * ada sama sekali di layar admin — lihat dokblok `tests/admin-pesanan.test.tsx`.
 */

export type ItemPesanan = {
  pesananId: string;
  kode: string;
  jenis: SumberItemPesanan;
  judulBeku: string;
  hargaBeku: number;
  urutan: number;
};

export type BarisPesanan = {
  id: string;
  kode: string;
  status: StatusPesanan;
  percobaan: number;
  /** "" berarti embed-nya TIDAK terbaca, bukan "klien tanpa PADMA ID". */
  padmaId: string;
  jumlahItem: number;
  dibuatPada: string;
  kedaluwarsaPada: string;
  lunasPada: string | null;
  diperiksaPada: string | null;
  butuhTinjauanPada: string | null;
  sebabTinjauan: string | null;
  kanal: string | null;
  transaksiId: string | null;
  statusMidtrans: string | null;
  items: ItemPesanan[];
  nominalTagih: number;
  /** null = belum ada notifikasi bernominal. BUKAN nol. */
  nominalDiterima: number | null;
};

type BarisOrders = {
  id: string;
  kode: string;
  status: StatusPesanan;
  percobaan: number;
  jumlah_item: number;
  dibuat_pada: string;
  kedaluwarsa_pada: string;
  lunas_pada: string | null;
  diperiksa_pada: string | null;
  butuh_tinjauan_pada: string | null;
  sebab_tinjauan: string | null;
  kanal: string | null;
  transaksi_id: string | null;
  status_midtrans: string | null;
  clients: { padma_id: string } | null;
};

const KOLOM =
  "id, kode, status, percobaan, jumlah_item, dibuat_pada, kedaluwarsa_pada, lunas_pada, " +
  "diperiksa_pada, butuh_tinjauan_pada, sebab_tinjauan, kanal, transaksi_id, status_midtrans, " +
  "clients ( padma_id )";

/**
 * Status yang selalu ikut dibaca, apa pun penanda tinjauannya — DITURUNKAN
 * dari himpunan Tugas 1, bukan diketik ulang.
 *
 * Ini bukan kerapian. Keempat himpunan itu lahir untuk mencegah satu pelajaran
 * yang repo ini sudah bayar sekali: nilai enum baru membuat konstanta tunggal
 * salah DIAM-DIAM. Dengan daftar hard-coded di sini, P3 yang menambah nilai
 * keenam `order_status` (mis. `sebagian_lunas`) akan memerahkan uji partisi
 * Tugas 1 — bagus — lalu orang menambahkannya ke `PESANAN_TIDAK_AKTIF` dan
 * suite hijau lagi, sementara layar ini tidak pernah menampilkannya di blok
 * mana pun. Pesanan beruang menghilang dari layar: persis kegagalan yang
 * himpunan itu katakan sedang dicegahnya.
 *
 * Diturunkan, BUKAN diberi nama sendiri sebagai himpunan kelima: himpunan
 * turunan yang punya namanya sendiri adalah tempat kedua yang bisa basi.
 */
const STATUS_DIPANTAU: StatusPesanan[] = [...PESANAN_TERBUKA, ...PESANAN_BERUANG];

/** Dua kejadian yang berarti "akses sudah diurus"; sisanya berarti belum. */
const KEJADIAN_AKSES = ["akses_terbit", "akses_sudah_ada"];

const BATAS_BARIS = 200;

export async function bacaPesananStaf(): Promise<{
  butuhPerhatian: BarisPesanan[];
  terbuka: BarisPesanan[];
}> {
  const sb = await createServerSupabase();

  // DUA kueri, bukan satu `or(...)`. Satu `or` yang memuat `status.in.(…)`
  // menitipkan pemisahan koma-di-dalam-kurung kepada parser PostgREST, dan
  // salah tulis satu kurung di sana tidak menghasilkan galat melainkan
  // saringan yang DIAM-DIAM lebih longgar. Dua kueri yang masing-masing
  // sederhana lebih murah dibaca daripada satu yang harus dipercaya.
  const [ditandai, dipantau] = await Promise.all([
    sb
      .from("orders")
      .select(KOLOM)
      .not("butuh_tinjauan_pada", "is", null)
      .order("butuh_tinjauan_pada", { ascending: true })
      .limit(BATAS_BARIS)
      .returns<BarisOrders[]>(),
    sb
      .from("orders")
      .select(KOLOM)
      .in("status", STATUS_DIPANTAU)
      .order("dibuat_pada", { ascending: false })
      .limit(BATAS_BARIS)
      .returns<BarisOrders[]>(),
  ]);
  // Galat DIBACA, bukan dibuang (pola `lib/admin/tagihan-pengajuan.ts:103-123`).
  // Layar yang kosong karena PostgREST gagal terlihat persis seperti layar yang
  // kosong karena memang tidak ada masalah — dan di layar ini "tidak ada
  // masalah" adalah kalimat tentang uang orang.
  if (ditandai.error) throw ditandai.error;
  if (dipantau.error) throw dipantau.error;

  const perId = new Map<string, BarisOrders>();
  for (const b of [...(ditandai.data ?? []), ...(dipantau.data ?? [])]) perId.set(b.id, b);
  const ids = [...perId.keys()];
  if (ids.length === 0) return { butuhPerhatian: [], terbuka: [] };

  const [item, notifikasi, jejak] = await Promise.all([
    sb
      .from("pesanan_item_staf")
      .select("pesanan_id, kode, jenis, judul_beku, harga_beku, urutan")
      .in("pesanan_id", ids)
      .order("urutan", { ascending: true }),
    sb
      .from("notifikasi_pesanan")
      .select("pesanan_id, nominal_diterima, diterima_pada")
      .in("pesanan_id", ids)
      .not("nominal_diterima", "is", null)
      .order("diterima_pada", { ascending: false }),
    sb
      .from("jejak_pesanan")
      .select("pesanan_id, kejadian")
      .in("pesanan_id", ids)
      .in("kejadian", KEJADIAN_AKSES),
  ]);
  if (item.error) throw item.error;
  if (notifikasi.error) throw notifikasi.error;
  if (jejak.error) throw jejak.error;

  const itemPer = new Map<string, ItemPesanan[]>();
  for (const r of item.data ?? []) {
    const daftar = itemPer.get(r.pesanan_id as string) ?? [];
    daftar.push({
      pesananId: r.pesanan_id as string,
      kode: r.kode as string,
      jenis: r.jenis as SumberItemPesanan,
      judulBeku: r.judul_beku as string,
      hargaBeku: Number(r.harga_beku),
      urutan: Number(r.urutan),
    });
    itemPer.set(r.pesanan_id as string, daftar);
  }

  // Notifikasi TERAKHIR yang bernominal, bukan penjumlahan: satu pesanan bisa
  // menerima `pending` lalu `settlement`, dan yang jadi keputusan manusia
  // adalah angka terakhir yang benar-benar masuk.
  const diterimaPer = new Map<string, number>();
  for (const r of notifikasi.data ?? []) {
    const kunci = r.pesanan_id as string;
    if (!diterimaPer.has(kunci)) diterimaPer.set(kunci, Number(r.nominal_diterima));
  }

  const punyaAkses = new Set((jejak.data ?? []).map((r) => r.pesanan_id as string));

  const semua: BarisPesanan[] = [...perId.values()].map((b) => {
    const items = itemPer.get(b.id) ?? [];
    return {
      id: b.id,
      kode: b.kode,
      status: b.status,
      percobaan: b.percobaan,
      // Embed yang ditolak RLS memulangkan NULL, bukan galat — pelajaran repo.
      // "" diteruskan apa adanya ke komponen, yang merendernya sebagai
      // kegagalan baca yang TERLIHAT, bukan sebagai sel kosong.
      padmaId: b.clients?.padma_id ?? "",
      jumlahItem: b.jumlah_item,
      dibuatPada: b.dibuat_pada,
      kedaluwarsaPada: b.kedaluwarsa_pada,
      lunasPada: b.lunas_pada,
      diperiksaPada: b.diperiksa_pada,
      butuhTinjauanPada: b.butuh_tinjauan_pada,
      sebabTinjauan: b.sebab_tinjauan,
      kanal: b.kanal,
      transaksiId: b.transaksi_id,
      statusMidtrans: b.status_midtrans,
      items,
      // Dijumlahkan dari `harga_beku`, karena `orders` memang lahir NOL kolom
      // nominal (spec "Bentuk data / orders").
      nominalTagih: items.reduce((n, i) => n + i.hargaBeku, 0),
      nominalDiterima: diterimaPer.has(b.id) ? diterimaPer.get(b.id)! : null,
    };
  });

  /**
   * DUA klausa, dan yang kedua tidak bergantung pada siapa pun mengingat:
   * uang sudah masuk (`PESANAN_BERUANG`) dan aksesnya belum tercatat terbit
   * (`akses_terbit`/`akses_sudah_ada`). Ia tetap terlihat walau penanda
   * tinjauannya sudah dikosongkan — dua pagar untuk satu lubang, karena
   * lubang ini memakan uang orang.
   *
   * Keduanya ditulis lewat himpunan Tugas 1, nol literal status: nilai enum
   * keenam yang kelak diklasifikasikan "beruang" ikut terlihat tanpa satu
   * baris pun disunting, dan itulah seluruh alasan himpunan itu ada.
   */
  const butuhPerhatian = semua.filter(
    (p) =>
      p.butuhTinjauanPada !== null ||
      // `PESANAN_BERUANG`, bukan literal "ditahan" + literal "lunas".
      // Himpunan itu berarti UANG SUDAH MASUK, dan aturannya satu kalimat:
      // uang masuk yang aksesnya belum tercatat terbit selalu terlihat.
      //
      // Ia menggantikan DUA klausa lama (`status === "ditahan"` tanpa syarat,
      // dan `status === "lunas" && belum ada akses`) dengan hasil yang sama
      // untuk data hari ini — `ditahan` tidak pernah punya jejak
      // `akses_terbit`/`akses_sudah_ada`, karena penyalur hanya berjalan pada
      // transisi ke `lunas` dan keadaan (3) menulis `akses_tertahan` yang
      // bukan anggota KEJADIAN_AKSES. Bedanya ada di masa depan: nilai enum
      // keenam yang kelak diklasifikasikan "beruang" ikut terlihat di sini
      // tanpa satu baris pun disunting, sementara dua literal akan
      // menghilangkannya dari layar diam-diam.
      (PESANAN_BERUANG.includes(p.status) && !punyaAkses.has(p.id)),
  );

  // Satu pesanan boleh muncul di KEDUA blok (mis. `menunggu_bayar` yang
  // bertanda tinjauan). Menyembunyikannya dari "Terbuka" akan membuat blok itu
  // berbohong soal berapa pesanan yang sedang menunggu pembayaran.
  const terbuka = semua
    .filter((p) => PESANAN_TERBUKA.includes(p.status))
    .sort((a, b) => {
      // `diperiksa_pada nulls first`: yang belum pernah diperiksa sama sekali
      // adalah yang paling mungkin menggantung tanpa ada yang tahu.
      if (a.diperiksaPada === null && b.diperiksaPada === null) {
        return a.dibuatPada.localeCompare(b.dibuatPada);
      }
      if (a.diperiksaPada === null) return -1;
      if (b.diperiksaPada === null) return 1;
      return a.diperiksaPada.localeCompare(b.diperiksaPada);
    });

  return { butuhPerhatian, terbuka };
}
