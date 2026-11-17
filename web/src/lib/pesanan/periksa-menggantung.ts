import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { bacaStatusDoku, type StatusDoku } from "@/lib/doku/adapter";
import { hitungSidikDoku } from "@/lib/doku/tanda-tangan";
import {
  STATUS_DOKU_KEDALUWARSA,
  STATUS_DOKU_LUNAS,
  STATUS_DOKU_MENUNGGU,
  STATUS_TIDAK_DITEMUKAN,
} from "@/lib/doku/status";
import {
  MENIT_JEDA_PERIKSA,
  JAM_TENGGANG_TANPA_VONIS,
  PESANAN_TERBUKA,
  PESANAN_TUTUP_DISAPU,
} from "./status";
import { rakitInvoice } from "./order-id";

/**
 * LAPIS 1b — PEMERIKSAAN SAAT HALAMAN DIBUKA (spec "Rekonsiliasi — empat lapis").
 *
 * Jaring pengaman UTAMA P1. Bukan cron — cron (Lapis 3) hanya menyapu pesanan
 * milik orang yang tidak pernah kembali membuka halamannya.
 *
 * Jalur penerapannya SATU untuk tiga pemanggil: halaman klien (di sini),
 * tombol "Periksa ulang" staf (`/api/pesanan/[id]/periksa-ulang`), dan penyapu
 * terjadwal (`/api/cron/pesanan`). Tiga jalur berbeda untuk satu keputusan
 * adalah tiga peluang untuk berbeda — dan yang berbeda di sini adalah vonis
 * atas uang orang.
 *
 * ===== PERCOBAAN LAMA DAN PESANAN TERTUTUP (perbaikan akhir 17 Nov) =====
 * Setiap percobaan (`orders.percobaan`) punya invoice dan tautan DOKU
 * sendiri, dan tautan lama tetap bisa dibayar sampai tenggatnya. Webhook bisa
 * hilang (K3 kelompok channel tanpa Notification URL, K9 channel berformat
 * SNAP, Request-Target meleset, DOKU hanya mengulang 3x/12 jam, deploy
 * mati). Dua tempat yang dulu tidak pernah ditanyakan:
 *   - F2a: percobaan LAMA pesanan yang hendak ditutup `kedaluwarsa` —
 *     `terapkanJawabanGateway` menanyakannya dulu (`tutupSesudahPercobaanLama`);
 *   - F2b: pesanan yang KITA tutup (`PESANAN_TUTUP_DISAPU`) sementara
 *     tautannya masih hidup — `sapuPesananTertutup`, HANYA dari Lapis 3.
 * Semua Check Status untuk satu pesanan berjalan SERIAL.
 */

/**
 * Berapa pesanan yang boleh ditanyakan dalam SATU pembukaan halaman.
 *
 * Tiga, bukan "semua". Seorang klien punya paling banyak SATU pesanan produk
 * terbuka (`pesanan_produk_terbuka_satu_per_klien`) ditambah satu pesanan sesi
 * terbuka per pengajuan (`pesanan_sesi_terbuka_satu_per_pengajuan`, P3).
 * Klien dengan beberapa tagihan sesi terbuka sekaligus bisa punya lebih dari
 * tiga; sisanya tertanya pada pembukaan berikutnya (pagar lima menit menggeser
 * giliran) atau oleh Lapis 3. Batas ini yang menahan berapa lama render
 * halaman bisa tertahan.
 */
export const BATAS_PERIKSA_SEKALI = 3;

/**
 * Anggaran waktu Lapis 1b, dalam ms: BATAS_PERIKSA_SEKALI x batas waktu adapter
 * (10 s) — kasus terburuk SEBELUM percobaan lama ikut ditanyakan (F2a).
 * Pesanan produk bisa sampai percobaan 9; tanpa anggaran, satu halaman bisa
 * tertahan delapan Check Status tambahan. Anggarannya menahan dimulainya
 * permintaan BARU, jadi terburuknya kini ≈ 40 s (satu permintaan yang sedang
 * terbang saat anggaran habis), bukan 30 s + 8 x 10 s. Yang tidak sempat
 * ditanyakan memulangkan `waktu_habis` TANPA vonis, dan Lapis 3
 * menyelesaikannya.
 */
const ANGGARAN_LAPIS_1B_MS = BATAS_PERIKSA_SEKALI * 10_000;

/**
 * Batas waktu pemanggil. `tenggatMs` (epoch ms): sesudahnya TIDAK ADA Check
 * Status baru yang dimulai; yang sedang berjalan tetap ditunggu (paling lama
 * batas waktu adapter). Tanpa nilai = tanpa batas — rute staf memeriksa satu
 * pesanan per tombol.
 */
export type OpsiPeriksa = { tenggatMs?: number };

function waktuHabis(opsi: OpsiPeriksa): boolean {
  return opsi.tenggatMs !== undefined && Date.now() >= opsi.tenggatMs;
}

export type PesananDiperiksa = {
  id: string;
  kode: string;
  percobaan: number;
  /** ISO. Dipakai memutuskan kapan 404 DOKU boleh dibaca sebagai kedaluwarsa. */
  kedaluwarsaPada: string;
};

/**
 * Empat nilai pertama datang APA ADANYA dari `terapkan_notifikasi_gateway`;
 * lima sisanya lahir di sini karena RPC-nya tidak pernah dipanggil untuk kasus
 * itu. Dibedakan supaya pemanggil (rute staf) bisa mengatakan "DOKU tidak
 * menjawab" alih-alih "tidak ada yang berubah" — dua kalimat yang menuntut dua
 * tindakan berbeda dari manusia yang menekan tombolnya.
 *
 * Union, bukan komentar: `Record<HasilPeriksaPesanan, string>` di Tugas 11
 * memerah di kompilator sampai setiap nilai punya kalimatnya. Inilah
 * satu-satunya mekanisme di repo ini yang mengubah "lupa menangani satu kasus"
 * dari kalimat salah di layar staf menjadi galat kompilasi.
 */
export type HasilPeriksaPesanan =
  | "diterapkan"
  | "duplikat"
  | "tanpa_efek"
  | "pesanan_tidak_ada"
  // `orders.kode` / `percobaan` yang cacat: `rakitInvoice` MELEMPAR untuk
  // keduanya, dan fungsi ini tidak boleh melempar. Lihat dokblok di bawah.
  | "bentuk_invoice"
  | "belum_kedaluwarsa"
  | "gateway_tak_terjawab"
  // TERPISAH dari `gateway_tak_terjawab`, dan pemisahan itu seluruh gunanya:
  // jaringan yang mati sembuh dengan dicoba lagi, `DOKU_SECRET_KEY` yang
  // belum terpasang TIDAK PERNAH. Dilebur, staf membaca "Coba lagi beberapa
  // saat lagi." untuk keadaan yang tidak akan berubah sampai seseorang
  // memasang env — dan mencoba lagi selamanya. Adapter sudah memisahkannya di
  // sumbernya (`kode: -1`), dan dua permukaan Tugas 8 yang lain sudah lama
  // mengatakan kalimat yang benar (webhook 503 `kunci_kosong`,
  // `terbitkanTautanBayar` "Pembayaran belum aktif. Hubungi tim PADMA.").
  | "kunci_belum_terpasang"
  | "galat_basis_data"
  // Anggaran waktu pemanggil (`OpsiPeriksa.tenggatMs`) habis sebelum SETIAP
  // percobaan yang dibutuhkan sempat ditanyakan. Tidak ada vonis yang diambil
  // dari pengetahuan separuh; baris itu tertanya lagi pada putaran berikutnya.
  // Hanya Lapis 1b dan Lapis 3 yang memasang anggaran.
  | "waktu_habis";

type BarisMenggantung = {
  id: string;
  kode: string;
  percobaan: number;
  kedaluwarsa_pada: string;
};

/**
 * Teks sebab untuk log, dari nilai `catch` yang bertipe `unknown`.
 *
 * JavaScript membolehkan melempar apa saja, dan `${galat}` atas objek biasa
 * menghasilkan `[object Object]` — baris log yang ada tapi tidak memberi tahu
 * apa pun adalah bentuk paling meyakinkan dari kegagalan yang tersembunyi.
 */
function sebab(galat: unknown): string {
  return galat instanceof Error ? galat.message : String(galat);
}

/**
 * Menanyakan Check Status DOKU untuk SATU pesanan lalu menjalankan jawabannya
 * lewat jalur yang sama dengan webhook.
 *
 * Tidak pernah melempar: setiap kegagalan menjadi salah satu nilai
 * `HasilPeriksaPesanan`. Pemanggilnya adalah halaman yang sedang dibuka orang.
 *
 * Vonisnya tetap dari DOKU (spec §5.5 baris 9-10). Waktu lokal hanya memutuskan
 * KAPAN BERHENTI BERTANYA: sesudah `kedaluwarsa_pada` + `JAM_TENGGANG_TANPA_VONIS`,
 * jawaban "belum final" (404, PENDING, REDIRECT, TIMEOUT, FAILED) dikirim ke
 * mesin sebagai `EXPIRED`. Aman karena `recover_abandoned_cart = false`, dan
 * SUCCESS yang mendarat kemudian tertangkap mesin sebagai `lunas_setelah_tutup`.
 *
 * ===== F2a: PERCOBAAN LAMA DITANYAKAN SEBELUM PESANAN DITUTUP =====
 * Jawaban yang akan menutup pesanan sebagai `kedaluwarsa` — vonis waktu lokal,
 * ATAU `EXPIRED` asli dari DOKU — hanya berbicara tentang invoice percobaan
 * KINI. Tautan percobaan 1..n-1 bisa sudah dibayar dan webhook-nya hilang;
 * menutup pesanan tanpa bertanya membuat uang itu senyap selamanya, karena
 * pesanan `kedaluwarsa` tidak pernah disapu lagi. Lihat
 * `tutupSesudahPercobaanLama`. `EXPIRED` asli ikut karena premis "kedaluwarsa
 * tidak perlu disapu" hanya benar bila SETIAP jalan ke sana melewati ini.
 */
export async function terapkanJawabanGateway(
  p: PesananDiperiksa,
  opsi: OpsiPeriksa = {},
): Promise<HasilPeriksaPesanan> {
  const kini = await tanyaPercobaan(p.id, p.kode, p.percobaan, opsi);
  if (kini.jenis === "gagal") return kini.hasil;

  // Satu jam itu MARGIN terhadap jam DOKU, bukan perpanjangan tenggat:
  // menutup pesanan lebih cepat daripada DOKU berarti pembayaran mendarat pada
  // pesanan yang sudah kita tutup. `Number.isFinite` menjaga cap waktu yang
  // tidak bisa diurai — kalau tidak, `NaN` membuat perbandingannya false dan
  // pesanan itu tak pernah bisa kedaluwarsa.
  const tenggang = Date.parse(p.kedaluwarsaPada) + JAM_TENGGANG_TANPA_VONIS * 3_600_000;
  const lewat = Number.isFinite(tenggang) && Date.now() >= tenggang;

  if (kini.jenis === "tak_dikenal") {
    // 404 "invoice tidak dikenal" adalah SATU-SATUNYA kegagalan yang boleh
    // dibaca sebagai petunjuk; sisanya sudah pulang sebagai `gagal` di atas.
    if (!lewat) return "belum_kedaluwarsa";
    return tutupSesudahPercobaanLama(p, vonisWaktu(kini.invoice, STATUS_TIDAK_DITEMUKAN), opsi);
  }

  const s = kini.status;
  // Non-final (baris 3-4) sesudah tenggang = baris 10. Himpunan bernama dari
  // `doku/status.ts`, bukan daftar baru di sini. SUCCESS dan status lain
  // TIDAK pernah ditimpa waktu lokal: uang yang sudah masuk menang.
  if (lewat && (STATUS_DOKU_MENUNGGU as readonly string[]).includes(s.status)) {
    return tutupSesudahPercobaanLama(p, vonisWaktu(kini.invoice, s.status), opsi);
  }
  if ((STATUS_DOKU_KEDALUWARSA as readonly string[]).includes(s.status)) {
    return tutupSesudahPercobaanLama(p, argumenJawaban(kini.invoice, s), opsi);
  }
  return kirimKeMesin(argumenJawaban(kini.invoice, s));
}

/**
 * Jawaban DOKU untuk SATU percobaan, sebelum diputuskan apa pun.
 *
 * `gagal` memuat nilai `HasilPeriksaPesanan` yang pulang apa adanya ke
 * pemanggil: kita tidak tahu apa-apa tentang invoice itu.
 */
type JawabanPercobaan =
  | { jenis: "jawab"; invoice: string; status: StatusDoku }
  | { jenis: "tak_dikenal"; invoice: string }
  | { jenis: "gagal"; hasil: HasilPeriksaPesanan };

/** SATU Check Status. Tidak pernah melempar. */
async function tanyaPercobaan(
  pesananId: string,
  kode: string,
  percobaan: number,
  opsi: OpsiPeriksa,
): Promise<JawabanPercobaan> {
  // `rakitInvoice` MELEMPAR untuk `kode` cacat atau `percobaan` di luar 1..9 —
  // keputusan yang benar untuk checkout (kegagalan yang dilempar di sana
  // berhenti di checkout; yang diloloskan berhenti di uang), tapi fungsi INI
  // seluruh nilainya adalah tidak pernah melempar, dan rute staf membangun peta
  // kode HTTP-nya di atas janji itu. Karena itu ia berada DI DALAM try.
  //
  // Bentuk kegagalannya bila ia di luar: satu baris `orders` ber-`kode` cacat
  // (fixture service role, atau perbaikan SQL manual) membuat
  // `/api/pesanan/[id]/periksa-ulang` menjawab 500 telanjang alih-alih
  // `{hasil}` yang dikontrakkan — dan lebih mahal di Lapis 3, di mana satu
  // baris cacat menghentikan SELURUH sapuan sementara
  // `periksaPesananMenggantung` menelan lemparannya jadi `{diperiksa: 0}`:
  // penyapu yang MATI terbaca sebagai penyapu yang tidak menemukan apa-apa.
  let invoice: string;
  try {
    invoice = rakitInvoice(kode, percobaan);
  } catch {
    console.error(`[pesanan] bentuk kode/percobaan cacat pada pesanan ${pesananId}`);
    return { jenis: "gagal", hasil: "bentuk_invoice" };
  }

  // Diperiksa SEBELUM setiap permintaan, bukan sekali per pesanan: satu
  // pesanan bisa butuh sembilan permintaan (F2a, F2b).
  if (waktuHabis(opsi)) return { jenis: "gagal", hasil: "waktu_habis" };

  let jawaban: Awaited<ReturnType<typeof bacaStatusDoku>>;
  try {
    jawaban = await bacaStatusDoku(invoice);
  } catch (galat) {
    // SEBABNYA DICATAT. `bacaStatusDoku` sudah menangkap jaringan mati dan
    // batas waktu sendiri (`{ok:false, kode:0}`), jadi lemparan yang sampai ke
    // sini adalah yang TIDAK diramalkan adapter — dan justru itu yang tidak
    // boleh hilang. Tanpa baris ini jalurnya bisu sempurna: nilai baliknya
    // ditelan jadi `diperiksa: 0`, dan "penyapu tidak menemukan apa-apa"
    // terbaca sama persis dengan "setiap permintaan mati sebelum berangkat".
    console.error(`[pesanan] Check Status melempar untuk ${invoice}: ${sebab(galat)}`);
    return { jenis: "gagal", hasil: "gateway_tak_terjawab" };
  }

  if (jawaban.ok) return { jenis: "jawab", invoice, status: jawaban.status };
  // `-1` DULU, sebelum saringan 404: kunci yang belum terpasang berarti NOL
  // permintaan pernah keluar, jadi ini bukan "DOKU tidak menjawab" melainkan
  // "kita tidak pernah bertanya". Kalimatnya di rute staf menyuruh
  // menghubungi tim, bukan mencoba lagi — satu-satunya tindakan yang bisa
  // mengubah keadaannya.
  if (jawaban.kode === -1) return { jenis: "gagal", hasil: "kunci_belum_terpasang" };
  // Sisanya (0, 5xx, 401) berarti kita belum tahu apa-apa dan tidak menyentuh
  // `diperiksa_pada`.
  if (jawaban.kode !== 404) return { jenis: "gagal", hasil: "gateway_tak_terjawab" };
  return { jenis: "tak_dikenal", invoice };
}

/** Argumen mesin untuk jawaban DOKU yang ASLI (bukan vonis waktu lokal). */
function argumenJawaban(invoice: string, s: StatusDoku): ArgumenMesin {
  return {
    invoice,
    status: s.status,
    transaksiId: s.transaksiId,
    kanal: s.kanal,
    // `null` bila adapter tidak bisa membaca nominal (desimal bukan nol, dsb.):
    // mesin menahannya sebagai `selisih_nominal`, tidak pernah membulatkan.
    nominal: s.nominal,
    sidik: hitungSidikDoku({
      sumber: "status_api",
      invoice,
      status: s.status,
      pembeda: "",
    }),
    keterangan: null,
  };
}

const lunasDoku = (s: StatusDoku) => (STATUS_DOKU_LUNAS as readonly string[]).includes(s.status);

/** Urutan "paling berarti" untuk menggabungkan beberapa hasil mesin. */
const BOBOT_HASIL: Partial<Record<HasilPeriksaPesanan, number>> = {
  diterapkan: 3,
  tanpa_efek: 2,
  duplikat: 1,
  pesanan_tidak_ada: 0,
};

function lebihBerarti(a: HasilPeriksaPesanan, b: HasilPeriksaPesanan): HasilPeriksaPesanan {
  return (BOBOT_HASIL[b] ?? -1) > (BOBOT_HASIL[a] ?? -1) ? b : a;
}

type HasilBanyakPercobaan = {
  /**
   * Kegagalan PERTAMA (tak terjawab, kunci, waktu habis, bentuk, galat mesin),
   * atau `null` bila setiap percobaan terjawab dan setiap jawaban yang boleh
   * dikirim (`perluDikirimKeMesin`; EXPIRED percobaan lama tidak termasuk)
   * sudah diterapkan. Selain `null`, tidak ada keputusan "sudah lengkap" yang
   * boleh diambil: vonis tutup (F2a) maupun penanda selesai (F2b).
   */
  gagal: HasilPeriksaPesanan | null;
  /** Ada percobaan yang menjawab SUCCESS: uangnya masuk lewat invoice itu. */
  lunasDitemukan: boolean;
  /** Gabungan hasil mesin; `tanpa_efek` bila tidak ada yang dikirim. */
  hasil: HasilPeriksaPesanan;
};

/**
 * Jawaban percobaan LAMA yang dikirim ke mesin: hanya yang membawa kabar
 * tentang UANG — SUCCESS, refund, dan status asing — yang mesin tandai tanpa
 * pernah menutup pesanan terbuka.
 *
 * TIDAK PERNAH dikirim (putaran 2, I1):
 *   - belum final (404, PENDING, ...): tidak ada yang bisa diputuskan, dan
 *     setiap kiriman menulis dua baris jejak;
 *   - `EXPIRED`: mesin mencari pesanan lewat `kode` SAJA, jadi EXPIRED untuk
 *     invoice percobaan 1 menutup pesanan di percobaan 3 seluruhnya — padahal
 *     ia hanya berkata tautan percobaan itu mati. Bila percobaan lain belum
 *     terjawab, pesanan `kedaluwarsa` yang lahir dari situ tidak pernah disapu
 *     lagi, dan uang di percobaan lain senyap selamanya. Yang boleh menutup
 *     pesanan hanya vonis tutup sesudah SEMUA percobaan terjawab
 *     (`tutupSesudahPercobaanLama`).
 */
function perluDikirimKeMesin(s: StatusDoku): boolean {
  return (
    !(STATUS_DOKU_MENUNGGU as readonly string[]).includes(s.status) &&
    !(STATUS_DOKU_KEDALUWARSA as readonly string[]).includes(s.status)
  );
}

/**
 * Menanyakan percobaan-percobaan `daftar` SATU PER SATU, lalu menerapkan
 * jawaban yang membawa kabar uang (`perluDikirimKeMesin`) lewat mesin.
 *
 * - Serial, dan berhenti pada kegagalan pertama: bila DOKU mati, sisa
 *   permintaannya hanya akan menghabiskan batas waktu masing-masing.
 * - Jawaban yang sudah terkumpul TETAP diterapkan walau percobaan berikutnya
 *   gagal: uang yang ditemukan tidak menunggu putaran berikutnya. Aman karena
 *   tidak satu pun dari jawaban itu bisa menutup pesanan terbuka.
 * - Penerapan berhenti pada galat mesin PERTAMA, dan `gagal` terisi: tidak
 *   ada vonis tutup maupun penanda selesai pada putaran ini; putaran
 *   berikutnya mengulang seluruhnya (sidik membuat yang sudah masuk
 *   `duplikat`).
 */
async function periksaPercobaan(
  pesananId: string,
  kode: string,
  daftar: readonly number[],
  opsi: OpsiPeriksa,
): Promise<HasilBanyakPercobaan> {
  const final: { invoice: string; status: StatusDoku }[] = [];
  let gagal: HasilPeriksaPesanan | null = null;
  for (const k of daftar) {
    const j = await tanyaPercobaan(pesananId, kode, k, opsi);
    if (j.jenis === "gagal") {
      gagal = j.hasil;
      break;
    }
    if (j.jenis === "jawab" && perluDikirimKeMesin(j.status)) {
      final.push({ invoice: j.invoice, status: j.status });
    }
  }

  let hasil: HasilPeriksaPesanan = "tanpa_efek";
  let lunasDitemukan = false;
  for (const f of final) {
    const h = await kirimKeMesin(argumenJawaban(f.invoice, f.status));
    if (h === "galat_basis_data") {
      gagal ??= h;
      break;
    }
    if (lunasDoku(f.status)) lunasDitemukan = true;
    hasil = lebihBerarti(hasil, h);
  }
  return { gagal, lunasDitemukan, hasil };
}

/**
 * F2a. Sebelum `vonis` yang menutup pesanan TERBUKA sebagai kedaluwarsa
 * dikirim, tanyakan percobaan 1..n-1.
 *
 * - Percobaan lama SUCCESS: mesin melunasi pesanan lewat jalur yang sudah ada
 *   (kode + percobaan dari invoice; `percobaan_lunas` = percobaan itu), dan
 *   vonis tutup TIDAK dikirim.
 * - Ada yang tidak terjawab (atau anggaran habis): tidak ada vonis. "Tidak
 *   tahu" bukan "tidak dibayar"; putaran berikutnya mencoba lagi.
 * - Setiap percobaan terjawab tanpa SUCCESS: vonis dikirim. REFUNDED/VOIDED
 *   percobaan lama sudah diterapkan mesin dengan tandanya sendiri dan TIDAK
 *   menahan vonis (kalau menahan, pesanan itu terbuka selamanya — jawaban yang
 *   sama pulang `duplikat` setiap putaran). EXPIRED percobaan lama tidak
 *   dikirim sama sekali (`perluDikirimKeMesin`): vonis inilah satu-satunya
 *   yang boleh menutup pesanan.
 */
async function tutupSesudahPercobaanLama(
  p: PesananDiperiksa,
  vonis: ArgumenMesin,
  opsi: OpsiPeriksa,
): Promise<HasilPeriksaPesanan> {
  const lama: number[] = [];
  for (let k = 1; k < p.percobaan; k += 1) lama.push(k);
  if (lama.length === 0) return kirimKeMesin(vonis);

  const r = await periksaPercobaan(p.id, p.kode, lama, opsi);
  if (r.gagal !== null) return r.gagal;
  if (r.lunasDitemukan) return r.hasil;

  const h = await kirimKeMesin(vonis);
  return h === "galat_basis_data" ? h : lebihBerarti(r.hasil, h);
}

/**
 * Vonis waktu lokal: `EXPIRED` untuk jawaban DOKU yang tak kunjung final.
 *
 * `pembeda` memuat status asli supaya sidiknya TIDAK bertabrakan dengan sidik
 * `EXPIRED` asli dari DOKU, dan supaya dua jawaban asli yang berbeda adalah
 * dua keputusan berbeda. Nominal `null`, BUKAN 0: "tidak tahu" bukan nol rupiah
 * (kolomnya nullable justru untuk itu; 0 melahirkan "diterima Rp 0" di layar
 * staf untuk setiap pesanan kedaluwarsa). `keterangan` hanya memuat nama status
 * dan lama tenggang, tanpa nominal atau deret angka panjang
 * (`tests/pesanan-teks-tanpa-nominal.test.ts`).
 */
function vonisWaktu(invoice: string, asli: string): ArgumenMesin {
  return {
    invoice,
    status: "EXPIRED",
    transaksiId: "",
    kanal: "",
    nominal: null,
    sidik: hitungSidikDoku({
      sumber: "status_api",
      invoice,
      status: "EXPIRED",
      pembeda: `lewat_tenggang:${asli}`,
    }),
    keterangan: `DOKU menjawab ${asli} sesudah tenggat + ${JAM_TENGGANG_TANPA_VONIS} jam`,
  };
}

/**
 * Nilai balik SAH `terapkan_notifikasi_gateway`, sebagai himpunan tertutup.
 *
 * Kembaran `hasilRpcSah` di `src/lib/doku/kode-jawaban.ts` (Tugas 8), dan
 * itu disengaja: rute webhook dan berkas ini memanggil RPC yang SAMA, jadi
 * keduanya harus punya sikap kepercayaan yang sama terhadap nilainya. Tanpa
 * penjaga di sini, `data as HasilPeriksaPesanan` membuat nilai kelima yang
 * kelak lahir masuk diam-diam sebagai tipe yang salah — rute Tugas 8 berhenti
 * aman, sementara jalur ini menyalurkan string asing ke `Record<...>` dan
 * memulangkan `undefined` sebagai kalimat ke layar staf.
 *
 * TIDAK mengimpor `hasilRpcSah`, dan alasannya TIPE — bukan letak berkas.
 * (Dokblok versi pertama berbunyi "`kode-jawaban.ts` hidup di sisi server-only
 * rute webhook"; itu tidak benar. Berkas itu nol impor dan tanpa `server-only`,
 * jadi menariknya ke sini tidak melanggar batas apa pun. Alasan yang salah
 * untuk keputusan yang benar tetap harus diperbaiki: ia mengundang orang
 * berikutnya mencabut keputusannya begitu ia memeriksa dan menemukan
 * alasannya bohong.)
 *
 * Alasan yang sebenarnya: `hasilRpcSah(nilai): nilai is HasilWebhook`
 * menyempitkan ke union MILIK RUTE WEBHOOK, yang memuat lima nilai yang tidak
 * pernah bisa dipulangkan RPC (`badan_terlalu_besar`, `tanda_tangan_salah`,
 * `skema_gagal`, `kunci_kosong`, `galat`) dan tidak memuat satu pun nilai
 * khas jalur ini. Dipakai di sini, `return data` sesudah penjaganya TIDAK
 * lolos kompilasi — `HasilWebhook` bukan `HasilPeriksaPesanan`.
 *
 * Duplikasinya karena itu bukan kelalaian melainkan sikap: dua pemanggil RPC
 * yang sama masing-masing memegang himpunan tertutupnya sendiri, sehingga
 * nilai kelima yang kelak lahir di SQL harus diakui SADAR di dua tempat, bukan
 * menyelinap ke salah satunya.
 */
const SAH = new Set(["diterapkan", "duplikat", "tanpa_efek", "pesanan_tidak_ada"]);

type ArgumenMesin = {
  invoice: string;
  status: string;
  transaksiId: string;
  kanal: string;
  /** Angka dari adapter, atau `null` untuk "tidak tahu berapa". BUKAN nol. */
  nominal: number | null;
  sidik: string;
  keterangan: string | null;
};

/**
 * SERVICE ROLE, dan itu disengaja: `terapkan_notifikasi_gateway` ada di
 * `MESIN_TERTUTUP` (tests/fungsi-mesin-tertutup.test.ts) — tertutup bagi
 * `authenticated` justru supaya vonis gateway tidak pernah bisa diketik
 * pemanggil bersesi.
 */
async function kirimKeMesin(a: ArgumenMesin): Promise<HasilPeriksaPesanan> {
  const admin = createAdminSupabase();
  const { data, error } = await admin.rpc("terapkan_notifikasi_gateway", {
    p_invoice: a.invoice,
    p_status: a.status,
    p_transaksi_id: a.transaksiId,
    p_kanal: a.kanal,
    // Angka yang sudah dinormalisasi adapter (bilangan bulat rupiah) atau null;
    // basis data meng-cast satu kali ke tipe kolom.
    p_nominal: a.nominal,
    p_sidik: a.sidik,
    // Sumbernya DINYATAKAN: itulah yang melahirkan jejak `diperiksa_ulang` dan
    // membedakannya dari notifikasi webhook di layar staf.
    p_sumber: "status_api",
    p_keterangan: a.keterangan,
  });
  if (error) {
    // Jantung mesin pembayaran GAGAL, dan sampai baris ini ditulis kegagalan
    // itu tidak meninggalkan satu jejak pun di mana pun: nilai baliknya
    // `galat_basis_data`, penghitung sapuan tidak naik, dan yang terbaca di
    // luar adalah `diperiksa: 0` — angka yang sama persis dengan penyapu yang
    // berjalan sempurna dan memang tidak menemukan apa-apa.
    //
    // Cabang "nilai balik tak dikenal" delapan baris di bawah sudah mencatat
    // sebabnya, dan rute webhook mencatatnya juga untuk RPC yang SAMA
    // (`src/app/api/pembayaran/doku/route.ts`). Dua jalur ke satu
    // fungsi yang hanya satu di antaranya bersuara berarti kegagalan yang
    // terlihat atau tidak bergantung pada pintu mana yang kebetulan dipakai.
    console.error(
      `[pesanan] terapkan_notifikasi_gateway gagal untuk ${a.invoice}: ${error.message}`,
    );
    return "galat_basis_data";
  }
  if (data == null) return "tanpa_efek";
  // Nilai di LUAR himpunan bukan "tanpa efek" dan bukan hasil yang bisa
  // dipetakan — ia berarti mesinnya sudah berubah dan jalur ini belum.
  // `galat_basis_data` karena itu jawaban yang jujur: ia memaksa 500 di rute
  // staf dan TIDAK menaikkan penghitung sapuan, alih-alih memalsukan "sudah
  // diperiksa" untuk nilai yang tidak seorang pun di sini mengerti.
  if (!SAH.has(data as string)) {
    console.error(`[pesanan] nilai balik terapkan_notifikasi_gateway tak dikenal: ${data}`);
    return "galat_basis_data";
  }
  return data as HasilPeriksaPesanan;
}

/**
 * Memilih pesanan terbuka yang layak ditanyakan, mencapnya, lalu menerapkannya.
 *
 * `pemilih` menentukan RADIUS-nya, dan itu satu-satunya perbedaan antara dua
 * pemanggilnya: Lapis 1b mengoper sesi pemanggil (policy "pesanan: klien baca
 * miliknya" yang memutuskan, jadi hanya pesanan sendiri), Lapis 3 mengoper
 * service role (lintas klien). Satu kueri, dua radius, nol duplikasi predikat.
 *
 * MELEMPAR pada DUA kegagalan, bukan satu: PEMILIHAN barisnya gagal, ATAU
 * PENCAPAN `diperiksa_pada` gagal. Yang kedua sengaja tidak diturunkan jadi
 * `{diperiksa: 0}` — bertanya ke DOKU tanpa berhasil mencap adalah bentuk
 * banjir yang paling mudah lolos review, jadi cabang itu berhenti keras.
 *
 * Kontraknya ditulis lengkap di sini karena rute cron (Tugas 12) memanggil
 * fungsi ini LANGSUNG dan membangun jawabannya di atas janji ini: pemanggil
 * yang harus bertahan hidup (`periksaPesananMenggantung`) menangkap keduanya
 * sendiri, pemanggil yang harus melapor menerjemahkan keduanya jadi 500.
 * Tanda tangan yang hanya menyebut satu dari dua jalur lempar adalah tanda
 * tangan yang menjanjikan 500 untuk separuh kegagalan dan kejutan untuk
 * separuh sisanya.
 *
 * ===== KENAPA DUA ANGKA DIPULANGKAN, BUKAN SATU =====
 * `diperiksa` sendirian AMBIGU, dan ambiguitasnya persis sebentuk dengan
 * lubang "server tanpa kunci melaporkan 20" yang sudah ditutup penghitung di
 * bawah: `{diperiksa: 0}` berarti "tidak ada yang perlu disapu" DAN "SETIAP
 * baris yang terpilih gagal". Yang pertama sehat, yang kedua adalah mesin
 * pembayaran yang mati — dan keduanya menulis angka yang sama ke satu-satunya
 * tempat yang pernah dibaca siapa pun (badan jawaban rute cron).
 *
 * `dilewati` adalah jumlah baris yang TERPILIH DAN DIPROSES tetapi tidak
 * memenuhi kalimat "kita bertanya dan jawabannya sampai" — setiap keadaan
 * yang dikecualikan `sampaiJawaban`, ditambah baris yang penerapannya melempar.
 * Dengan begitu `{0,0}` (sepi) dan `{0,10}` (mati total) berhenti terbaca
 * sama.
 *
 * `opsi.tenggatMs`: baris yang belum sempat ditanyakan saat anggaran habis
 * terhitung DILEWATI. Capnya hanya menahannya `MENIT_JEDA_PERIKSA`, jadi
 * putaran berikutnya mengambilnya lagi.
 */
export async function sapuPesananMenggantung(
  pemilih: SupabaseClient,
  batasBaris: number,
  clientId: string | null = null,
  opsi: OpsiPeriksa = {},
): Promise<{ diperiksa: number; dilewati: number }> {
  const batas = new Date(Date.now() - MENIT_JEDA_PERIKSA * 60_000).toISOString();

  let kueri = pemilih
    .from("orders")
    .select("id, kode, percobaan, kedaluwarsa_pada")
    // `PESANAN_TERBUKA`, bukan literal "menunggu_bayar" (Tugas 1). Nilai enum
    // keenam yang kelak lahir dan diklasifikasikan sebagai terbuka ikut
    // tersapu tanpa satu baris pun disunting di sini; dengan literal, ia
    // menghilang dari penyapu tanpa ada yang tahu.
    .in("status", [...PESANAN_TERBUKA])
    // Baru lahir = kliennya belum sempat membayar. Menanyakannya berarti
    // menembak DOKU untuk transaksi yang pasti belum berubah.
    .lt("dibuat_pada", batas)
    .or(`diperiksa_pada.is.null,diperiksa_pada.lt.${batas}`)
    .order("diperiksa_pada", { ascending: true, nullsFirst: true })
    .limit(batasBaris);

  // RADIUS. Lapis 1b mengisinya; Lapis 3 (cron, service role, lintas klien)
  // membiarkannya null. Kenapa ia tidak boleh diserahkan kepada RLS saja:
  // `orders` punya DUA policy SELECT, dan `"pesanan: staf baca"` memulangkan
  // pesanan SELURUH klien untuk sesi admin/owner. Lihat dokblok
  // `periksaPesananMenggantung` di bawah.
  if (clientId !== null) kueri = kueri.eq("client_id", clientId);

  const { data, error } = await kueri.returns<BarisMenggantung[]>();
  if (error) throw error;
  if (!data || data.length === 0) return { diperiksa: 0, dilewati: 0 };

  // ===== CAP DULU, BARU BERTANYA =====
  // `terapkan_notifikasi_gateway` juga menyetel `diperiksa_pada`, tapi ia
  // hanya berjalan untuk jawaban yang benar-benar diterapkan. Dua jawaban
  // paling sering — 404 sebelum tenggang lewat, dan DOKU tak terjawab —
  // tidak pernah sampai ke sana, jadi tanpa cap di sini PERSIS pesanan itulah
  // yang ditanyakan ulang setiap kali halamannya dibuka. Mencap lebih dulu
  // juga membuat pagar lajunya bertahan terhadap proses yang mati di tengah
  // jalan: yang dicatat adalah "kita sudah BERTANYA", bukan "jawabannya kena".
  //
  // UPDATE ini memakai service role dan menyentuh `orders` dari TypeScript —
  // satu dari dua tempat (kembarannya di `sapuPesananTertutup`, yang juga
  // mencap kolom penanda `rekonsiliasi_tutup_pada`). Keduanya sempit dengan
  // sengaja: kolom yang bukan status dan bukan uang, dan `where`-nya tetap
  // membawa pagar status supaya baris yang sudah bergerak di antara SELECT
  // dan UPDATE tidak ikut tersentuh.
  //
  // Pagarnya `PESANAN_TERBUKA`, bukan literal "menunggu_bayar" — himpunan yang
  // SAMA dengan yang dipakai pemilih di atas. Dua predikat yang harus selalu
  // sepakat tidak boleh ditulis dua cara: nilai enum keenam yang kelak
  // diklasifikasikan terbuka akan ikut terpilih tapi TIDAK ikut tercap, dan
  // pesanan yang tidak pernah tercap adalah pesanan yang ditanyakan ulang ke
  // DOKU setiap kali halamannya dibuka.
  const admin = createAdminSupabase();
  const { error: galatCap } = await admin
    .from("orders")
    .update({ diperiksa_pada: new Date().toISOString() })
    .in(
      "id",
      data.map((b) => b.id),
    )
    .in("status", [...PESANAN_TERBUKA]);
  // Gagal mencap -> BERHENTI, jangan bertanya. Bertanya tanpa cap adalah
  // bentuk banjir yang paling mudah lolos review.
  if (galatCap) throw galatCap;

  let diperiksa = 0;
  let dilewati = 0;
  for (const b of data) {
    // TRY PER BARIS. `terapkanJawabanGateway` sudah dikontrakkan tidak pernah
    // melempar, tapi kontrak yang dijaga di satu tempat saja adalah kontrak
    // yang patah diam-diam: satu baris cacat di tengah sapuan Lapis 3 akan
    // menghentikan SELURUH sisanya, dan `periksaPesananMenggantung` menelan
    // lemparannya jadi `{diperiksa: 0}` — penyapu yang mati terbaca sebagai
    // penyapu yang tidak menemukan apa-apa.
    let hasil: HasilPeriksaPesanan;
    try {
      hasil = await terapkanJawabanGateway(
        {
          id: b.id,
          kode: b.kode,
          percobaan: b.percobaan,
          kedaluwarsaPada: b.kedaluwarsa_pada,
        },
        opsi,
      );
    } catch {
      console.error(`[pesanan] pemeriksaan baris ${b.id} melempar; sapuan diteruskan.`);
      // Terpilih, dicap, lalu gagal: itu DILEWATI, bukan "tidak ada". Tanpa
      // baris ini sapuan yang setiap barisnya melempar pulang `{0, 0}` —
      // tidak terbedakan dari sapuan yang memang tidak menemukan apa pun.
      dilewati += 1;
      continue;
    }
    // "Diperiksa" berarti KITA BERTANYA DAN JAWABANNYA SAMPAI, apa pun isinya.
    // Yang tidak dihitung adalah SETIAP keadaan yang tidak memenuhi kalimat
    // itu — kalau ikut dihitung, angka yang dilaporkan penjadwal tidak bisa
    // dibedakan dari penjadwal yang jalan sempurna.
    //
    // `kunci_belum_terpasang` yang paling mahal bila lolos: server tanpa kunci
    // akan melaporkan "diperiksa: 20" tiap lima belas menit tanpa satu
    // permintaan pun pernah keluar.
    //
    // `bentuk_invoice` ikut dikecualikan atas ALASAN YANG SAMA PERSIS, dan
    // itulah kenapa ia ada di sini: baris ber-`kode` cacat berhenti sebelum
    // `bacaStatusDoku` dipanggil, jadi nol permintaan keluar untuknya —
    // kriteria yang identik dengan `kunci_belum_terpasang`. Menghitungnya
    // berarti aturannya berlaku untuk satu anggota dan tidak untuk anggota
    // lain yang memenuhi syarat yang sama, dan aturan yang begitu akan
    // dibongkar pembaca berikutnya sebagai kebetulan.
    //
    // `waktu_habis` sama: pesanan yang percobaannya belum semua ditanyakan
    // tidak memenuhi kalimat itu.
    if (sampaiJawaban(hasil)) {
      diperiksa += 1;
    } else {
      dilewati += 1;
    }
  }
  return { diperiksa, dilewati };
}

/**
 * "Kita bertanya dan jawabannya sampai", apa pun isinya. SATU daftar untuk
 * kedua penyapu; kebalikannya adalah DILEWATI. Ditulis sebagai satu predikat,
 * bukan dua daftar yang harus selalu berkebalikan: dua daftar adalah dua
 * peluang untuk berselisih, dan yang berselisih di sini adalah angka yang
 * dibaca orang untuk memutuskan apakah mesin pembayaran masih hidup.
 */
function sampaiJawaban(hasil: HasilPeriksaPesanan): boolean {
  return (
    hasil !== "bentuk_invoice" &&
    hasil !== "gateway_tak_terjawab" &&
    hasil !== "kunci_belum_terpasang" &&
    hasil !== "galat_basis_data" &&
    hasil !== "waktu_habis"
  );
}

type BarisTertutup = {
  id: string;
  kode: string;
  percobaan: number;
  percobaan_lunas: number | null;
  kedaluwarsa_pada: string;
};

/**
 * Percobaan yang ditanyakan untuk pesanan tertutup: 1..n, KECUALI percobaan
 * yang uangnya SUDAH tercatat:
 *   - percobaan pelunas (pesanan pernah `ditahan` lalu diputuskan staf
 *     "dibatalkan");
 *   - percobaan yang SUCCESS-nya sudah tercatat di `notifikasi_pesanan`
 *     (mis. webhook yang mendarat sesudah pesanan ditutup — sudah bertanda
 *     `lunas_setelah_tutup`, mungkin sudah ditinjau staf).
 * Menanyakannya lagi tidak bisa mengajarkan apa pun (SUCCESS kedua pada
 * invoice yang sama tidak ditandai, K4/R-F3), dan sejak putaran 2 mesin tidak
 * lagi menandainya dua kali (langkah 9a) — pengecualian di sini menghemat
 * permintaan DOKU dan jejak `diperiksa_ulang` setiap putaran.
 */
function percobaanTertutup(b: BarisTertutup, sudahTercatat: ReadonlySet<number>): number[] {
  const daftar: number[] = [];
  for (let k = 1; k <= b.percobaan; k += 1) {
    if (k !== b.percobaan_lunas && !sudahTercatat.has(k)) daftar.push(k);
  }
  return daftar;
}

/**
 * Penanda selesai sapuan pesanan tertutup. Penanda yang gagal berarti baris
 * itu terpilih lagi pada putaran berikutnya — idempoten lewat sidik, bukan
 * uang yang hilang. Dicatat, tidak dilempar: sisa sapuan tetap berjalan.
 */
async function tandaiTertutupSelesai(admin: SupabaseClient, id: string): Promise<void> {
  const { error } = await admin
    .from("orders")
    .update({ rekonsiliasi_tutup_pada: new Date().toISOString() })
    .eq("id", id)
    .in("status", [...PESANAN_TUTUP_DISAPU])
    .is("rekonsiliasi_tutup_pada", null);
  if (error) console.error(`[pesanan] penanda rekonsiliasi gagal untuk ${id}: ${error.message}`);
}

/**
 * LAPIS 3 SAJA — pesanan yang KITA tutup sementara tautan DOKU-nya bisa masih
 * hidup (F2b, perbaikan akhir 17 Nov).
 *
 * Contoh yang membuatnya ada: klien membayar VA pukul 13.58, admin menekan
 * "Terbitkan ulang" pukul 14.05, webhook pembayaran itu hilang. Pesanan lama
 * kini `dibatalkan`, penyapu terbuka tidak pernah melihatnya lagi, dan klien
 * tertagih dua kali tanpa tanda di mana pun. Hal yang sama untuk pembatalan
 * klien (`batalkan_pesanan_saya`, `batalkan_pengajuan_saya`), pembatalan staf,
 * perubahan masukan harga, dan percobaan kesepuluh.
 *
 * ===== YANG DISAPU =====
 * - status `PESANAN_TUTUP_DISAPU` (`dibatalkan`);
 * - PERNAH BERTAUTAN: `tautan_terbit_pada` terisi, ATAU `percobaan > 1`.
 *   Klausa kedua bukan tebakan: `buat_pesanan(p_ulang := true)` mengosongkan
 *   tautan percobaan sebelumnya, padahal tautan itu bisa sudah di tangan
 *   pembeli. Pesanan percobaan 1 yang tak pernah bertautan tidak punya
 *   halaman bayar untuk dibayar, dan tidak pernah ditanyakan;
 * - masih punya percobaan selain percobaan pelunas (`percobaanTertutup`);
 * - belum bertanda `rekonsiliasi_tutup_pada`, dan tidak ditanyakan dalam
 *   `MENIT_JEDA_PERIKSA` terakhir. Urut `diperiksa_pada nulls first` lalu
 *   `ditutup_pada`: yang paling lama tidak ditanyakan dapat giliran dulu, dan
 *   baris yang gagal terus-menerus bergeser ke belakang alih-alih memblokir.
 *
 * ===== KAPAN BERHENTI =====
 * Tautan DOKU mati pada `kedaluwarsa_pada` (`payment_due_date` diturunkan
 * darinya). Selama tautan hidup, pesanan ditanyakan setiap putaran — uang
 * yang ditemukan lebih awal menyalakan `lunas_setelah_tutup`, dan untuk
 * pesanan sesi itu menyembunyikan tombol Bayar tagihan penggantinya.
 * Penanda `rekonsiliasi_tutup_pada` baru dipasang oleh pemeriksaan yang
 * DIMULAI sesudah `kedaluwarsa_pada + JAM_TENGGANG_TANPA_VONIS` dan yang
 * SETIAP percobaannya terjawab. Sesudah itu baris tidak pernah dipilih lagi.
 * Dua pengecualian yang ditandai seketika (putaran 2): baris yang uang setiap
 * percobaannya sudah tercatat (tidak ada yang tersisa untuk ditanyakan), dan
 * baris ber-`kode` cacat (tidak pernah BISA ditanyakan).
 *
 * ===== KENAPA PENANDA BARU, BUKAN `diperiksa_pada` =====
 * `diperiksa_pada` adalah pagar laju, dan mesin menyetelnya pada SETIAP
 * jawaban Check Status — juga ketika baru satu dari beberapa percobaan yang
 * terjawab. "Ditanyakan sesudah tautan mati, untuk setiap percobaan" tidak
 * bisa dibaca dari kolom itu tanpa membuat percobaan yang gagal tampak sudah
 * selesai.
 *
 * SUCCESS yang ditemukan diterapkan lewat mesin yang sama: pesanan tertutup
 * -> `lunas_setelah_tutup` + tanda tinjauan (tidak ada transisi keluar dari
 * `dibatalkan`). Idempoten: sidik Check Status stabil per invoice+status, jadi
 * jawaban yang sama pulang `duplikat`.
 *
 * Kontrak lemparnya sama dengan `sapuPesananMenggantung`: pemilihan atau
 * pencapan yang gagal MELEMPAR; kegagalan per baris menjadi DILEWATI.
 */
export async function sapuPesananTertutup(
  batasBaris: number,
  opsi: OpsiPeriksa = {},
): Promise<{ diperiksa: number; dilewati: number }> {
  // Anggaran sudah habis: jangan mencap baris yang tidak akan ditanyakan.
  if (waktuHabis(opsi)) return { diperiksa: 0, dilewati: 0 };

  const admin = createAdminSupabase();
  const batas = new Date(Date.now() - MENIT_JEDA_PERIKSA * 60_000).toISOString();

  // Tiga `.or()` = tiga kelompok yang di-AND-kan PostgREST.
  const { data, error } = await admin
    .from("orders")
    .select("id, kode, percobaan, percobaan_lunas, kedaluwarsa_pada")
    .in("status", [...PESANAN_TUTUP_DISAPU])
    .is("rekonsiliasi_tutup_pada", null)
    .or("tautan_terbit_pada.not.is.null,percobaan.gt.1")
    .or("percobaan_lunas.is.null,percobaan.gt.1")
    .or(`diperiksa_pada.is.null,diperiksa_pada.lt.${batas}`)
    .order("diperiksa_pada", { ascending: true, nullsFirst: true })
    .order("ditutup_pada", { ascending: true })
    .limit(batasBaris)
    .returns<BarisTertutup[]>();
  if (error) throw error;
  if (!data || data.length === 0) return { diperiksa: 0, dilewati: 0 };
  const ids = data.map((b) => b.id);

  // Percobaan yang SUCCESS-nya sudah tercatat (`percobaanTertutup`). Bagian
  // dari pemilihan: gagal membacanya MELEMPAR, seperti pemilihan baris.
  const { data: tercatat, error: galatTercatat } = await admin
    .from("notifikasi_pesanan")
    .select("pesanan_id, percobaan")
    .in("pesanan_id", ids)
    .in("status_gateway", [...STATUS_DOKU_LUNAS])
    .not("percobaan", "is", null)
    .returns<{ pesanan_id: string; percobaan: number }[]>();
  if (galatTercatat) throw galatTercatat;
  const lunasTercatat = new Map<string, Set<number>>();
  for (const n of tercatat ?? []) {
    const himpunan = lunasTercatat.get(n.pesanan_id) ?? new Set<number>();
    himpunan.add(n.percobaan);
    lunasTercatat.set(n.pesanan_id, himpunan);
  }

  // CAP DULU, BARU BERTANYA — alasan yang sama dengan penyapu terbuka.
  const { error: galatCap } = await admin
    .from("orders")
    .update({ diperiksa_pada: new Date().toISOString() })
    .in("id", ids)
    .in("status", [...PESANAN_TUTUP_DISAPU])
    .is("rekonsiliasi_tutup_pada", null);
  if (galatCap) throw galatCap;

  let diperiksa = 0;
  let dilewati = 0;
  for (const b of data) {
    if (waktuHabis(opsi)) {
      dilewati += 1;
      continue;
    }
    const daftar = percobaanTertutup(b, lunasTercatat.get(b.id) ?? new Set<number>());
    if (daftar.length === 0) {
      // Uang SETIAP percobaan sudah tercatat: tidak ada lagi yang bisa
      // dipelajari dari DOKU tentang pesanan ini, jadi ia selesai sekarang,
      // tanpa menunggu tautannya mati. Dihitung DIPERIKSA: tidak ada yang
      // gagal, dan tidak ada yang tidak diketahui.
      diperiksa += 1;
      await tandaiTertutupSelesai(admin, b.id);
      continue;
    }

    // Dicatat SEBELUM permintaan pertama: penanda hanya sah bagi pemeriksaan
    // yang seluruhnya terjadi sesudah tautan pasti mati.
    const mulai = Date.now();
    let r: HasilBanyakPercobaan;
    try {
      r = await periksaPercobaan(b.id, b.kode, daftar, opsi);
    } catch {
      console.error(`[pesanan] pemeriksaan pesanan tertutup ${b.id} melempar; sapuan diteruskan.`);
      dilewati += 1;
      continue;
    }
    if (r.gagal === "bentuk_invoice") {
      // M5 (putaran 2): `kode` yang tidak berbentuk invoice TIDAK PERNAH bisa
      // ditanyakan ke DOKU — `rakitInvoice` menolaknya untuk setiap percobaan.
      // Tanpa penanda, baris itu terpilih setiap putaran selamanya dan
      // memakan jatah sapuan pesanan lain. Ditandai selesai dan dihitung
      // DILEWATI (tidak ditanyakan); sebabnya sudah tercatat di log oleh
      // `tanyaPercobaan`.
      dilewati += 1;
      console.error(`[pesanan] pesanan tertutup ${b.id} ditandai selesai tanpa ditanyakan (kode cacat).`);
      await tandaiTertutupSelesai(admin, b.id);
      continue;
    }
    if (r.gagal !== null) {
      dilewati += 1;
      continue;
    }
    diperiksa += 1;

    const tenggang = Date.parse(b.kedaluwarsa_pada) + JAM_TENGGANG_TANPA_VONIS * 3_600_000;
    if (!Number.isFinite(tenggang) || mulai < tenggang) continue;
    await tandaiTertutupSelesai(admin, b.id);
  }
  return { diperiksa, dilewati };
}

/**
 * Lapis 1b untuk halaman yang sedang dibuka klien. TIDAK PERNAH MELEMPAR.
 *
 * Doktrin rumah adalah kebalikannya — galat dibaca, tidak dibuang (lihat
 * `src/lib/admin/tagihan-pengajuan.ts:103-123`) — dan penyimpangan di sini
 * disebut terang: pemanggilnya bukan gerbang melainkan LATAR. Pemeriksaan yang
 * gagal tidak boleh membuat orang melihat layar galat saat yang ia cari
 * hanyalah produknya, dan tidak ada satu pun keputusan yang bergantung pada
 * nilai kembaliannya. Pemanggil yang memang gerbang — rute cron — memakai
 * `sapuPesananMenggantung` langsung dan melaporkan kegagalannya.
 */
export async function periksaPesananMenggantung(): Promise<{ diperiksa: number }> {
  try {
    const sesi = await createServerSupabase();

    // ===== RADIUS: DIGERBANGI DI SINI, BUKAN DISERAHKAN KE RLS =====
    // Dokblok versi pertama berbunyi "pemanggil anon memperoleh nol baris,
    // jadi tidak ada apa pun yang bisa dipicu atas nama orang lain" — dan itu
    // benar HANYA untuk anon. `orders` punya DUA policy SELECT (Tugas 2), dan
    // yang kedua, `"pesanan: staf baca"` ber-`user_role() in ('admin','owner')`,
    // memulangkan pesanan SELURUH klien.
    //
    // `/produk/[slug]` adalah halaman PUBLIK yang bisa dibuka staf mana pun,
    // dan efek mount `TombolBeli` memicu ini tanpa syarat. Tanpa gerbang di
    // bawah: admin yang cuma memeriksa tampilan etalase menembakkan tiga
    // permintaan Check Status atas pesanan tiga klien acak — dan mencap
    // `diperiksa_pada` mereka, sehingga `orders_sapuan_idx` yang mengurutkan
    // penyapu Lapis 3 `nulls first` jadi diperdaya: pesanan yang "baru
    // diperiksa" oleh orang yang cuma lewat dilewati penyapu selama lima
    // menit berikutnya.
    //
    // Gerbangnya `.eq("user_id", user.id)`, dan klausa itu BUKAN hiasan.
    // `clients` punya policy baca staf juga, jadi tanpa klausa itu sesi
    // admin/owner memungut baris `clients` siapa saja yang kebetulan pertama
    // dipulangkan — `maybeSingle()` bahkan melempar untuk lebih dari satu
    // baris, jadi gerbangnya "berhasil" hanya selama seed kebetulan punya satu
    // klien. Polanya `ambilKlien` (`src/lib/passport/data.ts:66`), dan alasan
    // yang ditulis di sana sama: operator setara atas `user_id`, tidak pernah
    // pola.
    const {
      data: { user },
    } = await sesi.auth.getUser();
    if (!user) return { diperiksa: 0 };

    const { data: klien } = await sesi
      .from("clients")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle<{ id: string }>();
    // Nol baris klien = pemanggilnya anon, staf, atau akun yang belum tertaut.
    // Tidak ada pesanan MILIKNYA untuk diperiksa, dan tidak ada apa pun yang
    // boleh dipicu atas nama orang lain.
    if (!klien) return { diperiksa: 0 };

    // DIPERSEMPIT ke `{diperiksa}` dengan sengaja, bukan diteruskan apa
    // adanya. `dilewati` lahir untuk PENJADWAL — sesuatu yang membedakan
    // "sepi" dari "mati" di log yang dibaca operator. Di Lapis 1b tidak ada
    // operator: pemanggilnya `picuPeriksaSekali` di peramban, yang hanya
    // memutuskan menyegarkan halaman atau tidak. Melebarkan tipe ini berarti
    // melebarkan tipe server action `periksaPesananSaya` juga, demi angka yang
    // tidak seorang pun di jalur itu bisa membaca.
    //
    // TANPA sapuan pesanan tertutup (`sapuPesananTertutup`): ia lintas
    // klien, bisa butuh sembilan permintaan per pesanan, dan menahan render.
    // Itu milik Lapis 3 saja. Anggaran waktu menahan F2a (percobaan lama)
    // pada kasus terburuk yang sama dengan sebelum F2a ada.
    const { diperiksa } = await sapuPesananMenggantung(
      sesi,
      BATAS_PERIKSA_SEKALI,
      klien.id,
      { tenggatMs: Date.now() + ANGGARAN_LAPIS_1B_MS },
    );
    return { diperiksa };
  } catch (galat) {
    // SEBABNYA DICATAT — dan justru di sini lebih mendesak daripada di rute
    // cron yang sudah mencatatnya. Keduanya menelan dua jalur lempar yang SAMA
    // PERSIS (`sapuPesananMenggantung`: pemilihan baris gagal, dan pencapan
    // `diperiksa_pada` gagal, keduanya bisu), tapi rute cron masih meninggalkan
    // 500 di stderr `curl` dan job Actions yang MERAH. Lapis 1b tidak
    // meninggalkan apa pun: nilai baliknya hanya memutuskan menyegarkan halaman
    // atau tidak, dan `{diperiksa: 0}` dari jaring yang MATI byte-identik
    // dengan `{diperiksa: 0}` dari jaring yang sehat dan sepi.
    //
    // Yang membuatnya mahal: spec menyebut Lapis 1b jaring pengaman UTAMA, dan
    // jadwal Lapis 3 dikirim dalam keadaan dikomentari — jadi saat go-live ini
    // SATU-SATUNYA jalur rekonsiliasi yang hidup. Kunci service role yang salah
    // pasang, atau UPDATE pencapan yang ditolak, mematikannya permanen; tanpa
    // baris ini tidak ada satu tempat pun di mana itu terlihat.
    //
    // Yang TIDAK berubah: ia tetap menelan. Pemanggilnya LATAR, bukan gerbang,
    // dan orang yang sedang mencari produknya tidak boleh melihat layar galat
    // karena pemeriksaan latar gagal.
    console.error(`[pesanan] Lapis 1b gagal menyapu: ${sebab(galat)}`);
    return { diperiksa: 0 };
  }
}
