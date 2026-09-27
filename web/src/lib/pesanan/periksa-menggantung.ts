import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { bacaStatusTransaksi } from "@/lib/midtrans/adapter";
import { hitungSidik } from "@/lib/midtrans/tanda-tangan";
import { MENIT_JEDA_PERIKSA, JAM_TENGGANG_404, PESANAN_TERBUKA } from "./status";
import { rakitOrderId } from "./order-id";

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
 */

/**
 * Berapa pesanan yang boleh ditanyakan dalam SATU pembukaan halaman.
 *
 * Tiga, bukan "semua": satu klien hanya boleh punya satu pesanan terbuka
 * (`pesanan_terbuka_satu_per_klien`), jadi tiga sudah longgar — dan batas ini
 * yang menahan biaya bila kelak P2 melonggarkan indeks itu.
 */
export const BATAS_PERIKSA_SEKALI = 3;

export type PesananDiperiksa = {
  id: string;
  kode: string;
  percobaan: number;
  /** ISO. Dipakai memutuskan kapan 404 Midtrans boleh dibaca sebagai kedaluwarsa. */
  kedaluwarsaPada: string;
};

/**
 * Empat nilai pertama datang APA ADANYA dari `terapkan_notifikasi_midtrans`;
 * lima sisanya lahir di sini karena RPC-nya tidak pernah dipanggil untuk kasus
 * itu. Dibedakan supaya pemanggil (rute staf) bisa mengatakan "Midtrans tidak
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
  // `orders.kode` / `percobaan` yang cacat: `rakitOrderId` MELEMPAR untuk
  // keduanya, dan fungsi ini tidak boleh melempar. Lihat dokblok di bawah.
  | "bentuk_order_id"
  | "belum_kedaluwarsa"
  | "midtrans_tak_terjawab"
  // TERPISAH dari `midtrans_tak_terjawab`, dan pemisahan itu seluruh gunanya:
  // jaringan yang mati sembuh dengan dicoba lagi, `MIDTRANS_SERVER_KEY` yang
  // belum terpasang TIDAK PERNAH. Dilebur, staf membaca "Coba lagi beberapa
  // saat lagi." untuk keadaan yang tidak akan berubah sampai seseorang
  // memasang env — dan mencoba lagi selamanya. Adapter sudah memisahkannya di
  // sumbernya (`kode: -1`), dan dua permukaan Tugas 8 yang lain sudah lama
  // mengatakan kalimat yang benar (webhook 503 `kunci_kosong`,
  // `terbitkanTokenSnap` "Pembayaran belum aktif. Hubungi tim PADMA.").
  | "kunci_belum_terpasang"
  | "galat_basis_data";

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
 * Menanyakan Status API untuk SATU pesanan lalu menjalankan jawabannya lewat
 * jalur yang sama dengan webhook.
 *
 * Tidak pernah melempar: setiap kegagalan menjadi salah satu nilai
 * `HasilPeriksaPesanan`. Pemanggilnya adalah halaman yang sedang dibuka orang.
 */
export async function terapkanJawabanMidtrans(
  p: PesananDiperiksa,
): Promise<HasilPeriksaPesanan> {
  // `rakitOrderId` MELEMPAR untuk `kode` cacat atau `percobaan` di luar 1..9 —
  // keputusan yang benar untuk checkout (kegagalan yang dilempar di sana
  // berhenti di checkout; yang diloloskan berhenti di uang), tapi fungsi INI
  // seluruh nilainya adalah tidak pernah melempar, dan Tugas 11 membangun peta
  // kode HTTP-nya di atas janji itu. Karena itu ia berada DI DALAM try.
  //
  // Bentuk kegagalannya bila ia di luar: satu baris `orders` ber-`kode` cacat
  // (fixture service role, atau perbaikan SQL manual) membuat
  // `/api/pesanan/[id]/periksa-ulang` menjawab 500 telanjang alih-alih
  // `{hasil}` yang dikontrakkan — dan lebih mahal di Lapis 3, di mana satu
  // baris cacat menghentikan SELURUH sapuan sementara
  // `periksaPesananMenggantung` menelan lemparannya jadi `{diperiksa: 0}`:
  // penyapu yang MATI terbaca sebagai penyapu yang tidak menemukan apa-apa.
  let orderId: string;
  try {
    orderId = rakitOrderId(p.kode, p.percobaan);
  } catch {
    console.error(`[pesanan] bentuk kode/percobaan cacat pada pesanan ${p.id}`);
    return "bentuk_order_id";
  }

  let jawaban: Awaited<ReturnType<typeof bacaStatusTransaksi>>;
  try {
    jawaban = await bacaStatusTransaksi(orderId);
  } catch (galat) {
    // SEBABNYA DICATAT. `bacaStatusTransaksi` sudah menangkap jaringan mati dan
    // batas waktu sendiri (`{ok:false, kode:0}`), jadi lemparan yang sampai ke
    // sini adalah yang TIDAK diramalkan adapter — dan justru itu yang tidak
    // boleh hilang. Tanpa baris ini jalurnya bisu sempurna: nilai baliknya
    // ditelan jadi `diperiksa: 0`, dan "penyapu tidak menemukan apa-apa"
    // terbaca sama persis dengan "setiap permintaan mati sebelum berangkat".
    console.error(
      `[pesanan] Status API melempar untuk ${orderId}: ${sebab(galat)}`,
    );
    return "midtrans_tak_terjawab";
  }

  if (!jawaban.ok) {
    // `-1` DULU, sebelum saringan 404: kunci server yang belum terpasang berarti
    // NOL permintaan pernah keluar, jadi ini bukan "Midtrans tidak menjawab"
    // melainkan "kita tidak pernah bertanya". Kalimatnya di Tugas 11 menyuruh
    // menghubungi tim, bukan mencoba lagi — dan itulah satu-satunya tindakan
    // yang bisa mengubah keadaannya.
    if (jawaban.kode === -1) return "kunci_belum_terpasang";
    // 404 "Transaction doesn't exist" adalah SATU-SATUNYA kegagalan yang boleh
    // dibaca sebagai vonis; sisanya (5xx, timeout) berarti kita belum tahu
    // apa-apa.
    if (jawaban.kode !== 404) return "midtrans_tak_terjawab";

    const tenggang = Date.parse(p.kedaluwarsaPada) + JAM_TENGGANG_404 * 3_600_000;
    // Satu jam itu MARGIN terhadap jam Midtrans, bukan perpanjangan tenggat:
    // menutup pesanan lebih cepat daripada Midtrans berarti settlement mendarat
    // pada pesanan yang sudah kita tutup. `Number.isFinite` menjaga cap waktu
    // yang tidak bisa diurai — kalau tidak, `NaN` membuat perbandingannya
    // false dan pesanan itu tak pernah bisa kedaluwarsa.
    if (!Number.isFinite(tenggang) || Date.now() < tenggang) return "belum_kedaluwarsa";

    return kirimKeMesin({
      orderId,
      transactionStatus: "expire",
      fraudStatus: "",
      transactionId: "",
      paymentType: "",
      // `null`, BUKAN 0. Tugas 3 menulis kolomnya nullable JUSTRU supaya
      // "tidak tahu" bukan "nol rupiah", dan Tugas 11 mengulanginya di tipe
      // (`null = belum ada notifikasi bernominal. BUKAN nol.`). Mengirim 0 di
      // sini melahirkan baris `notifikasi_pesanan` ber-`nominal_diterima =
      // 0.00` untuk SETIAP pesanan kedaluwarsa, dan /admin/pesanan menampilkan
      // "diterima Rp 0" bersebelahan dengan "ditagih Rp 150.000" untuk pesanan
      // yang tidak pernah dibayar siapa pun — selisih palsu di kolom yang
      // seluruh keberadaannya dibenarkan sebagai "angka yang jadi keputusan
      // manusia".
      //
      // Aman terhadap Tugas 5: verifikasi jumlah hanya berjalan bila vonisnya
      // `lunas`, dan vonis cabang 404 selalu `kedaluwarsa`.
      grossAmount: null,
      sidik: hitungSidik({
        orderId,
        statusCode: "404",
        transactionStatus: "expire",
        fraudStatus: "",
        transactionId: "",
      }),
    });
  }

  const s = jawaban.status;
  return kirimKeMesin({
    orderId,
    transactionStatus: s.transaction_status,
    fraudStatus: s.fraud_status ?? "",
    transactionId: s.transaction_id,
    paymentType: s.payment_type ?? "",
    // STRING apa adanya. Adapter sudah menjamin bentuknya angka (jawaban tanpa
    // `gross_amount` yang bisa dibaca dipulangkan sebagai `{ok:false, kode:0}`),
    // jadi tidak ada yang perlu di-parse di sini — dan tidak ada yang boleh.
    grossAmount: s.gross_amount,
    sidik: hitungSidik({
      orderId,
      statusCode: s.status_code,
      transactionStatus: s.transaction_status,
      fraudStatus: s.fraud_status ?? "",
      transactionId: s.transaction_id,
    }),
  });
}

/**
 * Nilai balik SAH `terapkan_notifikasi_midtrans`, sebagai himpunan tertutup.
 *
 * Kembaran `hasilRpcSah` di `src/lib/midtrans/kode-jawaban.ts` (Tugas 8), dan
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

/**
 * SERVICE ROLE, dan itu disengaja: `terapkan_notifikasi_midtrans` ada di
 * `MESIN_TERTUTUP` (tests/fungsi-mesin-tertutup.test.ts) — tertutup bagi
 * `authenticated` justru supaya vonis Midtrans tidak pernah bisa diketik
 * pemanggil bersesi.
 */
async function kirimKeMesin(a: {
  orderId: string;
  transactionStatus: string;
  fraudStatus: string;
  transactionId: string;
  paymentType: string;
  /** STRING seperti dikirim Midtrans, atau `null` untuk "tidak tahu berapa". */
  grossAmount: string | null;
  sidik: string;
}): Promise<HasilPeriksaPesanan> {
  const admin = createAdminSupabase();
  const { data, error } = await admin.rpc("terapkan_notifikasi_midtrans", {
    p_order_id: a.orderId,
    p_transaction_status: a.transactionStatus,
    p_fraud_status: a.fraudStatus,
    p_transaction_id: a.transactionId,
    p_payment_type: a.paymentType,
    // STRING apa adanya, atau null — bentuk yang SAMA dengan yang dikirim
    // rute webhook (Tugas 8). Satu parameter `numeric` dengan dua bentuk
    // kiriman berarti dua jalur cast yang tidak pernah diuji bersama, jadi
    // salah satunya tidak terjaga; dan mengubahnya jadi `number` di TypeScript
    // berarti pembulatan JavaScript ikut menentukan verifikasi jumlah. Yang
    // meng-cast adalah basis data, satu kali, ke tipe kolom yang sudah
    // memutuskan presisinya.
    p_gross_amount: a.grossAmount,
    p_sidik: a.sidik,
    // Sumbernya DINYATAKAN: itulah yang melahirkan jejak `diperiksa_ulang` dan
    // membedakannya dari notifikasi webhook di layar staf.
    p_sumber: "status_api",
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
    // (`src/app/api/pembayaran/midtrans/route.ts:160`). Dua jalur ke satu
    // fungsi yang hanya satu di antaranya bersuara berarti kegagalan yang
    // terlihat atau tidak bergantung pada pintu mana yang kebetulan dipakai.
    console.error(
      `[pesanan] terapkan_notifikasi_midtrans gagal untuk ${a.orderId}: ${error.message}`,
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
    console.error(`[pesanan] nilai balik terapkan_notifikasi_midtrans tak dikenal: ${data}`);
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
 * `{diperiksa: 0}` — bertanya ke Midtrans tanpa berhasil mencap adalah bentuk
 * banjir yang paling mudah lolos review, jadi cabang itu berhenti keras.
 *
 * Kontraknya ditulis lengkap di sini karena rute cron (Tugas 12) memanggil
 * fungsi ini LANGSUNG dan membangun jawabannya di atas janji ini: pemanggil
 * yang harus bertahan hidup (`periksaPesananMenggantung`) menangkap keduanya
 * sendiri, pemanggil yang harus melapor menerjemahkan keduanya jadi 500.
 * Tanda tangan yang hanya menyebut satu dari dua jalur lempar adalah tanda
 * tangan yang menjanjikan 500 untuk separuh kegagalan dan kejutan untuk
 * separuh sisanya.
 */
export async function sapuPesananMenggantung(
  pemilih: SupabaseClient,
  batasBaris: number,
  clientId: string | null = null,
): Promise<{ diperiksa: number }> {
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
    // menembak Midtrans untuk transaksi yang pasti belum berubah.
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
  if (!data || data.length === 0) return { diperiksa: 0 };

  // ===== CAP DULU, BARU BERTANYA =====
  // `terapkan_notifikasi_midtrans` juga menyetel `diperiksa_pada`, tapi ia
  // hanya berjalan untuk jawaban yang benar-benar diterapkan. Dua jawaban
  // paling sering — 404 sebelum tenggang lewat, dan Midtrans tak terjawab —
  // tidak pernah sampai ke sana, jadi tanpa cap di sini PERSIS pesanan itulah
  // yang ditanyakan ulang setiap kali halamannya dibuka. Mencap lebih dulu
  // juga membuat pagar lajunya bertahan terhadap proses yang mati di tengah
  // jalan: yang dicatat adalah "kita sudah BERTANYA", bukan "jawabannya kena".
  //
  // UPDATE ini memakai service role dan menyentuh `orders` dari TypeScript —
  // satu-satunya di seluruh P1. Ia sempit dengan sengaja: satu kolom yang
  // bukan status dan bukan uang, dan `where`-nya tetap membawa pagar status
  // supaya baris yang sudah bergerak di antara SELECT dan UPDATE tidak ikut
  // tersentuh.
  //
  // Pagarnya `PESANAN_TERBUKA`, bukan literal "menunggu_bayar" — himpunan yang
  // SAMA dengan yang dipakai pemilih di atas. Dua predikat yang harus selalu
  // sepakat tidak boleh ditulis dua cara: nilai enum keenam yang kelak
  // diklasifikasikan terbuka akan ikut terpilih tapi TIDAK ikut tercap, dan
  // pesanan yang tidak pernah tercap adalah pesanan yang ditanyakan ulang ke
  // Midtrans setiap kali halamannya dibuka.
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
  for (const b of data) {
    // TRY PER BARIS. `terapkanJawabanMidtrans` sudah dikontrakkan tidak pernah
    // melempar, tapi kontrak yang dijaga di satu tempat saja adalah kontrak
    // yang patah diam-diam: satu baris cacat di tengah sapuan Lapis 3 akan
    // menghentikan SELURUH sisanya, dan `periksaPesananMenggantung` menelan
    // lemparannya jadi `{diperiksa: 0}` — penyapu yang mati terbaca sebagai
    // penyapu yang tidak menemukan apa-apa.
    let hasil: HasilPeriksaPesanan;
    try {
      hasil = await terapkanJawabanMidtrans({
        id: b.id,
        kode: b.kode,
        percobaan: b.percobaan,
        kedaluwarsaPada: b.kedaluwarsa_pada,
      });
    } catch {
      console.error(`[pesanan] pemeriksaan baris ${b.id} melempar; sapuan diteruskan.`);
      continue;
    }
    // "Diperiksa" berarti KITA BERTANYA DAN JAWABANNYA SAMPAI, apa pun isinya.
    // Yang tidak dihitung adalah KEEMPAT keadaan yang tidak memenuhi kalimat
    // itu — kalau ikut dihitung, angka yang dilaporkan penjadwal tidak bisa
    // dibedakan dari penjadwal yang jalan sempurna.
    //
    // `kunci_belum_terpasang` yang paling mahal bila lolos: server tanpa kunci
    // akan melaporkan "diperiksa: 20" tiap lima belas menit tanpa satu
    // permintaan pun pernah keluar.
    //
    // `bentuk_order_id` ikut dikecualikan atas ALASAN YANG SAMA PERSIS, dan
    // itulah kenapa ia ada di sini: baris ber-`kode` cacat berhenti sebelum
    // `bacaStatusTransaksi` dipanggil, jadi nol permintaan keluar untuknya —
    // kriteria yang identik dengan `kunci_belum_terpasang`. Menghitungnya
    // berarti aturannya berlaku untuk satu anggota dan tidak untuk anggota
    // lain yang memenuhi syarat yang sama, dan aturan yang begitu akan
    // dibongkar pembaca berikutnya sebagai kebetulan.
    if (
      hasil !== "bentuk_order_id" &&
      hasil !== "midtrans_tak_terjawab" &&
      hasil !== "kunci_belum_terpasang" &&
      hasil !== "galat_basis_data"
    ) {
      diperiksa += 1;
    }
  }
  return { diperiksa };
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
    // permintaan Status API atas pesanan tiga klien acak — dan mencap
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

    return await sapuPesananMenggantung(sesi, BATAS_PERIKSA_SEKALI, klien.id);
  } catch {
    return { diperiksa: 0 };
  }
}
