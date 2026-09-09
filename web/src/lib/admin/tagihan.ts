import { createServerSupabase } from "@/lib/supabase/server";
import { formatTanggalID } from "@/lib/passport/waktu";
import { labelVarian, type FormatVarian } from "@/lib/varian";
import type { PayStatus } from "@/lib/passport/turunan";
import { LABEL_JENJANG, type JenjangTransport } from "@/lib/transport/jarak";
import { PER_HAL, hitungRentang, type ParamDaftar, type SaringSah } from "@/app/_shell/panel/daftar";
import { PAKET_TAMPIL } from "@/lib/paket-tampil";
import { FILTER_SESI_BATAL } from "@/lib/jadwal/status";

/** Nilai saringan yang sah untuk daftar tagihan — dipakai halaman DAN uji. */
export const SARING_BAYAR = {
  status: ["belum", "menunggu_verifikasi", "lunas"],
} as const satisfies SaringSah;

export type ItemTagihanAdmin = {
  jenis: "paket" | "sesi";
  id: string;
  namaKlien: string;
  padmaId: string;
  label: string;
  /**
   * Rincian transport (Task 9, Ruling 16 — fix round 1). `null` untuk setiap
   * item paket, dan untuk item sesi yang tidak berjenjang, atau berjenjang
   * `di_atas_20` yang TIDAK PUNYA NOMINAL SAMA SEKALI — tidak ada penimpa per
   * kasus MAUPUN tarif dasar jenjang yang berlaku pada tanggalnya (lihat
   * gerbang di `daftarTagihanAdmin()`; definisinya hidup di view
   * `sesi_menunggu_tarif_transport`, migrasi
   * `20260914130000_menunggu_tarif_hanya_tanpa_nominal`).
   *
   * Nama tabel nominalnya SENGAJA tidak ditulis di berkas ini: pemindai money
   * firewall di `tests/admin-bayar.test.ts` memerah bila modul ini menyebut
   * salah satunya, dan pemindai itu tidak bisa — dan tidak seharusnya —
   * membedakan sebutan di komentar dari `.from()` yang sungguhan.
   *
   * SENGAJA sebuah MEDAN pada item sesi yang sudah ada — BUKAN item kedua
   * ber-`id` yang sama. Draf pertama Task 9 menambahkan item transport KEDUA
   * dengan `id` sama seperti sesinya, dan itu bug: `hitungKlaimMenunggu()`
   * menghitung baris `sessions` (satu per sesi) sementara daftar ini
   * menghitung ITEM (dua per sesi berjenjang) — badge dan tabel berselisih
   * persis pada sesi yang paling sering terjadi (jenjang diisi OTOMATIS saat
   * sesi lahir, `app/admin/sesi/aksi.ts`). Satu sesi punya SATU
   * `status_bayar`, jadi ia wajib menghasilkan SATU item.
   */
  rincianTransport: string | null;
  status: PayStatus;
};

type BarisPaket = {
  id: string;
  status_bayar: PayStatus;
  clients: { nama: string; padma_id: string } | null;
  packages: { nama: string; jumlah_sesi: number } | null;
};

type BarisSesi = {
  id: string;
  status_bayar: PayStatus;
  tanggal: string;
  variant_id: string | null;
  jenjang: JenjangTransport | null;
  clients: { nama: string; padma_id: string } | null;
  services: { nama: string } | null;
};

type BarisVarian = {
  id: string;
  label: string;
  durasi_menit: number | null;
  format: FormatVarian | null;
};

type BarisMenungguTransport = { id: string };

// Yang menunggu verifikasi naik ke atas — itulah pekerjaan admin hari ini.
const URUT: Record<PayStatus, number> = {
  menunggu_verifikasi: 0,
  belum: 1,
  lunas: 2,
};

/**
 * Seluruh tagihan klinik yang bisa diputuskan admin, satu daftar untuk semua
 * klien.
 *
 * SARINGANNYA WAJIB IDENTIK dengan `susunTagihan()` di `@/lib/passport/turunan`
 * + `ambilPaket()` di `@/lib/passport/data` — yaitu daftar yang benar-benar
 * dilihat KLIEN:
 *   - paket: hanya yang berstatus 'aktif';
 *   - sesi: hanya yang LEPAS (`client_package_id is null`) dan tidak batal.
 *
 * Saringan naif (`status_bayar <> 'lunas'`) mengembalikan tujuh baris tambahan
 * pada data seed, semuanya sesi anggota paket yang SUDAH lunas. Karena
 * transisi `belum -> lunas` diizinkan basis data, admin benar-benar bisa
 * "melunasi" tujuh tagihan hantu itu — dan menulis tujuh baris jejak audit
 * untuk keputusan yang tidak pernah ada uangnya. Sesi di dalam paket mengikuti
 * status paketnya; `sessions.status_bayar` hanya relevan untuk sesi lepas, dan
 * sejak `sessions_bayar_hanya_lepas` itu ditegakkan constraint.
 *
 * Sesi pengguna, bukan service role: RLS staf yang mengizinkan bacaan ini, dan
 * di bawah service role `user_role()` justru mengembalikan 'klien'.
 *
 * Nominal tidak pernah ikut: tabel tarif & honor mengembalikan [] untuk admin
 * (HTTP 200, kosong senyap), dan besaran uang disampaikan tim PADMA lewat
 * WhatsApp (keputusan #10). Berkas ini karena itu tidak pernah menyebut satu
 * pun tabel uang — dan itu diuji.
 *
 * Label sesi menyertakan LABEL varian sejak layanan punya lebih dari satu
 * harga (Task 1-6): dua sesi layanan yang sama bisa berbeda harga bila
 * variannya berbeda (mis. 60 menit vs 90 menit), dan label yang hanya
 * menyebut nama layanan membuat admin — atau klien lewat WhatsApp — menagih
 * varian yang salah tanpa satu pun jalan untuk sadar. Dirangkai lewat
 * `labelVarian()` (`@/lib/varian`), SATU-SATUNYA perangkai label varian di
 * proyek ini; jangan menulis perangkai kedua di sini.
 */
export async function daftarTagihanAdmin(
  param: ParamDaftar,
): Promise<{ baris: ItemTagihanAdmin[]; total: number }> {
  const supabase = await createServerSupabase();

  // Saringan status dikerjakan di SQL pada kedua sumber, bukan sesudah
  // penggabungan: memfilter di JS berarti menarik seluruh baris lunas hanya
  // untuk membuangnya, dan itulah yang membuat `max_rows` cepat tersentuh.
  const saringStatus = param.saring.status;

  // Embed `clients`/`packages`/`services` aman: ketiganya foreign key sungguhan.
  // (Embed ke `jejak_status_bayar` atau `profiles` yang GAGAL — PGRST200 —
  // adalah embed ke tabel tanpa FK; keduanya sengaja tidak dipakai di sini.)
  //
  // `service_variants` TIDAK di-embed langsung dari `sessions`: FK-nya
  // gabungan (service_id, variant_id), dan PostgREST butuh hint constraint
  // untuk embed semacam itu. Pola yang sudah dipakai `ambilSesiRekap()`
  // (`@/lib/owner/data`) diikuti di sini — tarik `variant_id` mentah, lalu
  // cocokkan ke katalog varian yang ditarik terpisah.
  let qPaket = supabase
    .from("client_packages")
    .select("id, status_bayar, clients(nama, padma_id), packages(nama, jumlah_sesi)")
    .eq("status", "aktif");
  if (saringStatus) qPaket = qPaket.eq("status_bayar", saringStatus);

  let qSesi = supabase
    .from("sessions")
    .select(
      "id, status_bayar, tanggal, variant_id, jenjang, clients(nama, padma_id), services(nama)",
    )
    .is("client_package_id", null)
    .not("status", "in", FILTER_SESI_BATAL)
    // `tanggal` bertipe date dan sudah berupa YYYY-MM-DD: urutannya
    // diserahkan ke Postgres, tidak pernah ke aritmatika Date di JS.
    .order("tanggal", { ascending: false });
  if (saringStatus) qSesi = qSesi.eq("status_bayar", saringStatus);

  const [
    { data: paket },
    { data: sesi },
    { data: varian },
    { data: menunggu, error: galatMenunggu },
  ] = await Promise.all([
      qPaket.returns<BarisPaket[]>(),
      qSesi.returns<BarisSesi[]>(),
      // Katalog varian saja (bukan tarifnya) — RLS "service_variants: baca
      // terautentikasi" menjawab TRUE untuk siapa pun yang login, jadi baris
      // ini tetap ada bagi admin.
      supabase
        .from("service_variants")
        .select("id, label, durasi_menit, format")
        .returns<BarisVarian[]>(),
      // (Task 9, Ruling 17) Sesi `di_atas_20` yang BELUM punya tarif per-kasus
      // — dibaca dari VIEW `sesi_menunggu_tarif_transport` (Task 8, migrasi
      // `20260907140000`), BUKAN dengan mencoba membaca tabel nominalnya
      // langsung: RLS tabel itu ("hanya owner") akan memulangkan `[]` untuk
      // admin tanpa error, dan `[]` yang dibaca naif sebagai "tidak ada yang
      // menunggu" akan membuat SETIAP sesi >20 km lolos seolah sudah
      // bertarif. View ini sudah jadi satu-satunya definisi "menunggu tarif
      // khusus" untuk badge (`hitungMenungguTarifTransport`) & daftar owner
      // (`ambilSesiMenungguTarif`, `lib/owner/data.ts`) — dipakai ULANG di
      // sini, bukan predikat ketiga yang bisa berpisah diam-diam. Proyeksinya
      // NOL NOMINAL (id, nama_klien, tanggal); hanya `id` yang diambil.
      supabase
        .from("sesi_menunggu_tarif_transport")
        .select("id")
        .returns<BarisMenungguTransport[]>(),
    ]);

  const varianPerId = new Map((varian ?? []).map((v) => [v.id, v] as const));
  // (Ruling 25, gelombang perbaikan akhir) Gagal TERTUTUP bila view ini
  // gagal dibaca — mis. PGRST205 saat schema cache PostgREST belum reload
  // sesudah deploy, atau timeout.
  //
  // Draf sebelumnya mendestrukturisasi `{ data: menunggu }` TANPA memeriksa
  // `error`: bila query gagal, `menunggu` jatuh ke `null` → `menungguTransportId`
  // jadi Set KOSONG → gerbang di bawah (`!(s.jenjang === "di_atas_20" &&
  // menungguTransportId.has(s.id))`) lolos untuk SETIAP sesi `di_atas_20`,
  // termasuk yang nominalnya belum pernah ditetapkan siapa pun. Itu Ruling 17
  // batal diam-diam: `/admin/bayar` akan menampilkan "Transport · >20 km · …"
  // untuk sesi yang tarif per-kasusnya tidak ada.
  //
  // Perbaikannya BUKAN melempar (lihat Ruling 25 lengkap): jalur admin ini
  // dipanggil dari halaman `/admin/bayar` yang menangani operasional harian,
  // bukan dari konteks yang boleh menampilkan 500 untuk satu galat baca view
  // sekunder. Sebaliknya, `menungguTransportId = null` menandai "gagal
  // dibaca — anggap SELURUH sesi di_atas_20 masih menunggu tarif", sehingga
  // TIDAK SATU PUN mendapat rincian transport sampai galatnya reda. Arah
  // aman yang benar: tidak menagih sesuatu yang belum ada nominalnya, bukan
  // menagih sesuatu yang sudah lunas dua kali.
  const menungguTransportId = galatMenunggu
    ? null
    : new Set((menunggu ?? []).map((m) => m.id));

  const item: ItemTagihanAdmin[] = [];

  // GERBANG SAKLAR (K11, Task 2 — R4): /admin/bayar tidak lagi menampilkan
  // baris tagihan paket, sejalan dengan klien yang sudah tidak melihatnya
  // sejak `ambilPaket()` digerbang (Task 1). Kueri `client_packages` di atas
  // dibiarkan berjalan apa adanya — hanya perakitan ITEM-nya yang dilewati —
  // supaya bentuk fungsi ini (dan pagar "TIDAK ADA nominal uang" di atas)
  // tidak berubah bagi pembaca lain berkas ini.
  if (PAKET_TAMPIL) {
    for (const p of paket ?? []) {
      item.push({
        jenis: "paket",
        id: p.id,
        namaKlien: p.clients?.nama ?? "—",
        padmaId: p.clients?.padma_id ?? "—",
        label: `${p.packages?.nama ?? "Paket"} · ${p.packages?.jumlah_sesi ?? 0} sesi`,
        // Paket tidak pernah punya rincian transport sendiri: harganya tetap/
        // pre-paid per paket, bukan per sesi — lihat Ruling 18 di `hitungRekap()`
        // (lib/owner/rekap.ts) untuk keputusan uang yang sama pada sisi owner.
        rincianTransport: null,
        status: p.status_bayar,
      });
    }
  }

  for (const s of sesi ?? []) {
    const namaLayanan = s.services?.nama ?? "Layanan";
    const v = s.variant_id ? varianPerId.get(s.variant_id) : undefined;
    // Varian baku (label kosong, durasi & format NULL) memulangkan string
    // kosong dari `labelVarian()` — label lama (hanya nama layanan) sengaja
    // dipertahankan apa adanya untuk kasus itu, bukan diberi akhiran kosong.
    const varLabel = v
      ? labelVarian({ label: v.label, durasiMenit: v.durasi_menit, format: v.format })
      : "";

    // Rincian TRANSPORT (Task 9) — TANPA NOMINAL sama sekali (money
    // firewall), teksnya IDENTIK huruf demi huruf dengan `susunTagihan()`
    // (`@/lib/passport/turunan`): keduanya merangkai dari `LABEL_JENJANG`
    // (`@/lib/transport/jarak`), SATU-SATUNYA sumber. Dikunci lewat uji
    // parity di tests/admin-bayar.test.ts.
    //
    // `di_atas_20` yang MASIH di `sesi_menunggu_tarif_transport` TIDAK
    // mendapat rincian: view itu adalah satu-satunya definisi "sesi ini tidak
    // punya nominal di mana pun", dan menampilkan rincian untuk sesi seperti
    // itu berarti menagih admin untuk sesuatu yang tidak ada.
    //
    // (Ruling 26, gelombang perbaikan akhir) Arti view itu BERUBAH bersama
    // migrasi `20260914130000_menunggu_tarif_hanya_tanpa_nominal`: dulu
    // "belum punya penimpa per kasus" — yang sesudah tarif dasar lahir berarti
    // SETIAP sesi jarak jauh yang normal — sekarang "tidak punya penimpa DAN
    // tidak punya tarif dasar yang berlaku pada tanggalnya".
    // Gerbang di sini SENGAJA tidak diubah bersamanya: ia sudah menanyakan
    // pertanyaan yang benar ("apakah sesi ini punya nominal?"), dan yang
    // salah adalah jawaban yang diberikan view lama. Efeknya, sesi jarak jauh
    // bertarif dasar kini MENDAPAT rincian ini — sejajar dengan sisi klien
    // (`susunTagihan()`, `lib/passport/turunan.ts`) yang pengecualian
    // `di_atas_20`-nya dicabut pada gelombang yang sama, dan sejajar dengan
    // kartu tagihan pengajuan yang sudah lebih dulu menampilkannya. Rincian
    // ini TETAP tanpa nominal apa pun (hanya label ">20 km").
    //
    // `menungguTransportId === null` (Ruling 25 — view gagal dibaca) membuat
    // kondisi ini TRUE untuk SETIAP sesi `di_atas_20`, apa pun `s.id`-nya:
    // gagal tertutup berarti tidak satu sesi >20 km pun mendapat rincian
    // transport selama status tarifnya tidak bisa dipastikan.
    const rincianTransport =
      s.jenjang !== null &&
      !(
        s.jenjang === "di_atas_20" &&
        (menungguTransportId === null || menungguTransportId.has(s.id))
      )
        ? `Transport · ${LABEL_JENJANG[s.jenjang]} · ${formatTanggalID(s.tanggal)}`
        : null;

    item.push({
      jenis: "sesi",
      id: s.id,
      namaKlien: s.clients?.nama ?? "—",
      padmaId: s.clients?.padma_id ?? "—",
      // Label ini IDENTIK huruf demi huruf dengan yang dibaca klien di
      // `susunTagihan()` (`@/lib/passport/turunan`) — sejak Ruling 13 (Task 9)
      // keduanya merangkai lewat `labelVarian()` yang SAMA persis, dari medan
      // varian yang sama, dengan komposisi "<layanan> · <varian?> · <tanggal>"
      // yang sama. Dikunci lewat uji parity di
      // `tests/admin-bayar.test.ts` ("label klien dan label admin IDENTIK
      // huruf demi huruf untuk sesi ber-varian yang sama") — bila salah satu
      // sisi berubah tanpa yang lain, uji itu yang harus merah duluan, bukan
      // komentar ini yang dibiarkan berbohong.
      label:
        varLabel === ""
          ? `${namaLayanan} · ${formatTanggalID(s.tanggal)}`
          : `${namaLayanan} · ${varLabel} · ${formatTanggalID(s.tanggal)}`,
      rincianTransport,
      status: s.status_bayar,
    });
  }

  // Komparator mengembalikan 0 untuk peringkat kembar: komparator yang
  // mengembalikan 1 untuk elemen setara melanggar kontrak Array#sort.
  const terurut = item.sort((a, b) => URUT[a.status] - URUT[b.status]);

  // Pencarian dikerjakan DI SINI, bukan di SQL, karena daftar ini adalah
  // gabungan DUA tabel yang tidak punya kolom nama bersama: `client_packages`
  // dan `sessions` sama-sama menempel ke `clients`, tetapi PostgREST tidak
  // bisa meng-OR-kan dua query berbeda menjadi satu hasil terurut.
  const cari = param.cari.trim().toLowerCase();
  const cocok = cari === ""
    ? terurut
    : terurut.filter(
        (t) =>
          t.namaKlien.toLowerCase().includes(cari) ||
          t.padmaId.toLowerCase().includes(cari) ||
          t.label.toLowerCase().includes(cari),
      );

  // BATAS YANG TIDAK DITUTUP DI SINI, dicatat supaya tidak diklaim sebaliknya:
  // kedua query sumber di atas tidak memakai `.range()` dan karena itu tetap
  // tunduk pada `max_rows = 1000` PostgREST — masing-masing. Paginasi di bawah
  // memotong daftar yang SUDAH terbaca, jadi ia memperbaiki layar dan beban
  // render, BUKAN batas bacaan. Menutupnya menuntut satu view SQL yang
  // menyatukan kedua sumber (`union all` berkolom seragam) supaya `.range()`
  // bisa bekerja di sisi database — pekerjaan rencana tersendiri, dan sama
  // kelasnya dengan utang #1 runbook rencana 1.
  const { dari } = hitungRentang(param.hal);
  return { baris: cocok.slice(dari, dari + PER_HAL), total: cocok.length };
}
