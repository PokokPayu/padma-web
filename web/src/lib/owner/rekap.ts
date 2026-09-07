import { awalPekan, geserHari, rentangPekan } from "./pekan";
import type { JenjangTransport } from "@/lib/transport/jarak";
import { tarifTransportPadaTanggal, type TarifTransportRingkas } from "@/lib/transport/tarif";

// ============================================================================
// REKAP HONOR — agregasi uang, dihitung di TYPESCRIPT
// ============================================================================
// KENAPA BUKAN VIEW SQL. Sebuah `create view rekap_honor as select ...` adalah
// cara paling wajar menulis ini, dan justru itu yang paling mematikan: view
// dimiliki `postgres` dan berjalan dengan hak PEMILIK, jadi ia MELEWATI RLS.
// Terbukti — admin membaca 10 baris rate card lengkap lewat view biasa
// sementara SELECT langsung ke tabelnya memulangkan 0 baris. Money firewall
// jebol tanpa satu pun policy berubah. Selain itu
// tests/money-firewall-struktural.test.ts memindai VIEW juga, sehingga kolom
// bernama `total_honor`/`total_harga` memerahkan suite seketika.
//
// Maka seluruh agregasi hidup di sini: fungsi MURNI, tanpa I/O, tanpa jam,
// tanpa DB. Pemanggilnya sudah menarik baris lewat klien Supabase milik owner,
// sehingga RLS-lah yang menentukan apa yang boleh terbaca — bukan hak pemilik
// view. Kemurnian itu juga yang membuat kalkulasi ini bisa diuji dengan puluhan
// kasus batas di tests/owner-rekap.test.ts tanpa menyentuh Postgres.

export type TarifRingkas = {
  id: string;
  variantId: string;
  hargaKlien: number;
  /** Harga PEMASARAN sebelum diskon soft launch, dicoret di layar. Diisi MANUAL. */
  hargaCoret: number | null;
  honorMitra: number;
  berlakuSejak: string; // YYYY-MM-DD
};

export type SesiRekap = {
  id: string;
  serviceId: string;
  /** Kunci pencocokan tarif — harga menempel di VARIAN, bukan di layanan. */
  variantId: string;
  namaLayanan: string;
  partnerId: string;
  namaMitra: string;
  tanggal: string; // YYYY-MM-DD
  status: "terjadwal" | "selesai" | "batal";
  clientPackageId: string | null;
  /** `sessions.updated_at` — kapan sesi terakhir disentuh admin. Boleh null. */
  selesaiPada: string | null;
  /**
   * Jenjang jarak (Task 8) — `null` berarti jaraknya belum pernah diketahui
   * (sesi lama dari sebelum kolom ini lahir, atau mitra belum ditentukan saat
   * sesi dicatat), BUKAN transport gratis. Lihat komentar di `hitungRekap()`
   * untuk bagaimana `null` diperlakukan berbeda dari jenjang yang tarifnya
   * hilang.
   */
  jenjang: JenjangTransport | null;
};

/**
 * Nominal transport >20 km, DITETAPKAN OWNER PER KASUS (`transport_khusus`,
 * Task 8) — bukan rate card per jenjang. Satu baris per SESI, bukan per
 * jenjang: jenjang `di_atas_20` sengaja tidak pernah punya baris
 * `transport_rates` (CHECK `transport_rates_bukan_per_kasus`), jadi
 * `tarifTransportPadaTanggal()` tidak pernah bisa menjawabnya.
 */
export type TransportKhususRingkas = {
  sessionId: string;
  tarifKlien: number;
  honorMitra: number;
};

export type TandaBayar = {
  partnerId: string;
  senin: string;       // honor_marks.week_start
  dibayarPada: string; // honor_marks.dibayar_pada (ISO)
};

export type BarisMitra = {
  partnerId: string;
  nama: string;
  /** Seluruh sesi selesai mitra itu pekan ini — termasuk yang tak bertarif. */
  jumlahSesi: number;
  /** Berapa di antaranya tidak bisa dihargai. Nol pada keadaan sehat. */
  jumlahTakBertarif: number;
  totalHonor: number;
  sudahDibayar: boolean;
  dibayarPada: string | null;
  /**
   * Ada sesi yang baru diselesaikan SESUDAH pekan ini ditandai dibayar —
   * honornya bertambah di bawah label "sudah dibayar". Harus terlihat, bukan
   * diam-diam menaikkan angka.
   */
  adaSesiSesudahDitandai: boolean;
};

export type SesiTakBertarif = {
  id: string;
  namaLayanan: string;
  namaMitra: string;
  tanggal: string;
  /**
   * Ruling 14: dua sebab tak-bertarif diperbaiki di DUA LAYAR berbeda —
   * "varian" di `/owner/tarif` (harga layanan belum ditetapkan), "transport"
   * di `/owner/transport` (tarif jenjang atau tarif khusus >20 km belum
   * ditetapkan). Tanpa medan ini owner tidak tahu layar mana yang harus ia
   * buka, dan menebak salah berarti membuka layar yang tidak akan pernah
   * menyelesaikan apa pun.
   */
  sebab: "varian" | "transport";
};

export type RekapPekan = {
  senin: string;
  rentang: string;
  jumlahSesi: number;
  perMitra: BarisMitra[];
  totalHonor: number;
  totalHarga: number;
  /** Angka PADMA — per PEKAN, bukan per mitra (spec keputusan #6). */
  margin: number;
  sesiTakBertarif: SesiTakBertarif[];
};

/**
 * Tarif yang BERLAKU pada `tgl`: `berlaku_sejak` terbesar yang masih ≤ `tgl`.
 * Mengembalikan `null` bila sesi lebih tua dari tarif paling awal varian itu —
 * dan `null` itu WAJIB dilaporkan pemanggilnya, bukan dijadikan 0.
 *
 * Dicocokkan lewat `variantId`, BUKAN `serviceId`: harga menempel di VARIAN.
 * Dua varian satu layanan boleh punya tarif berbeda, dan tarif varian A tidak
 * pernah boleh bocor menjadi "berlaku" bagi varian B.
 *
 * Perbandingan tanggal = perbandingan string; keduanya YYYY-MM-DD sehingga
 * urutan leksikografis = urutan kronologis.
 */
export function tarifPadaTanggal(
  tarif: readonly TarifRingkas[],
  variantId: string,
  tgl: string,
): TarifRingkas | null {
  let terpilih: TarifRingkas | null = null;
  for (const t of tarif) {
    if (t.variantId !== variantId) continue;
    if (t.berlakuSejak > tgl) continue;
    if (terpilih === null || t.berlakuSejak > terpilih.berlakuSejak) {
      terpilih = t;
      continue;
    }
    // Seri. UNIQUE (variant_id, berlaku_sejak) — `variant_rates_unik_per_tanggal`
    // — baru dipasang belakangan dan tidak ada `created_at` pemecah seri, jadi
    // seri masih mungkin ada di data lama. Dipecah dengan `id` supaya hasilnya
    // tidak bergantung pada urutan baris yang dipulangkan PostgREST — rekap
    // yang sama harus selalu menghasilkan angka yang sama.
    if (t.berlakuSejak === terpilih.berlakuSejak && t.id < terpilih.id) {
      terpilih = t;
    }
  }
  return terpilih;
}

type Ember = {
  senin: string;
  sesi: SesiRekap[];
};

/**
 * Rekap honor per pekan Senin–Minggu (kalender Jakarta), pekan terbaru di atas.
 * Fungsi MURNI: masukan tidak dimutasi, jam sistem tidak dibaca.
 */
export function hitungRekap(input: {
  sesi: readonly SesiRekap[];
  tarif: readonly TarifRingkas[];
  /**
   * Riwayat tarif transport per JENJANG (`transport_rates`, Task 8) —
   * OPSIONAL, default `[]`. Dibuat opsional (bukan wajib) supaya seluruh
   * pemanggil yang lahir sebelum transport ada tetap kompilasi tanpa
   * perubahan: `[]` berarti "tidak ada tarif transport yang dikenal", yang
   * konsisten dengan `tarifTransportPadaTanggal()` memulangkan `null` untuk
   * setiap jenjang — sesi berjenjang tanpa satu pun baris di sini jatuh
   * tak-bertarif, bukan dianggap gratis.
   */
  tarifTransport?: readonly TarifTransportRingkas[];
  /**
   * Nominal >20 km PER SESI (`transport_khusus`, Task 8) — OPSIONAL, default
   * `[]`, alasan yang sama dengan `tarifTransport` di atas.
   */
  transportKhusus?: readonly TransportKhususRingkas[];
  tanda: readonly TandaBayar[];
}): RekapPekan[] {
  const tarifTransport = input.tarifTransport ?? [];
  const petaKhusus = new Map(
    (input.transportKhusus ?? []).map((k) => [k.sessionId, k] as const),
  );
  // (1) Hanya sesi SELESAI yang berhak menghasilkan honor. Sesi terjadwal
  //     belum dikerjakan; sesi batal tidak pernah dikerjakan.
  const ember = new Map<string, Ember>();
  for (const s of input.sesi) {
    if (s.status !== "selesai") continue;
    // awalPekan melempar untuk tanggal tak sah — sengaja: satu NaN yang lolos
    // akan mengelompokkan honor ke bucket hantu yang tidak pernah muncul di UI.
    const senin = awalPekan(s.tanggal);
    const e = ember.get(senin) ?? { senin, sesi: [] };
    e.sesi.push(s);
    ember.set(senin, e);
  }

  // Tanda bayar dipetakan "partnerId|senin". Tanda yang seninnya tidak cocok
  // dengan bucket mana pun (mis. week_start bukan-Senin dari data lama) tidak
  // akan pernah terbaca — itu memang perilaku yang benar.
  const petaTanda = new Map<string, TandaBayar>();
  for (const t of input.tanda) petaTanda.set(`${t.partnerId}|${t.senin}`, t);

  const hasil: RekapPekan[] = [];

  for (const e of ember.values()) {
    // Akumulator per mitra. Mitra masuk daftar begitu ia punya SATU sesi
    // selesai — termasuk bila seluruh sesinya tak bertarif. Menghilangkannya
    // sama dengan menghapus pekerjaan yang benar-benar dilakukan.
    const perMitra = new Map<string, BarisMitra>();
    const sesiTakBertarif: SesiTakBertarif[] = [];
    let totalHonor = 0;
    let totalHarga = 0;

    for (const s of e.sesi) {
      const baris = perMitra.get(s.partnerId) ?? {
        partnerId: s.partnerId,
        nama: s.namaMitra,
        jumlahSesi: 0,
        jumlahTakBertarif: 0,
        totalHonor: 0,
        sudahDibayar: false,
        dibayarPada: null,
        adaSesiSesudahDitandai: false,
      };
      baris.jumlahSesi += 1;

      // (2) Tarif diambil menurut TANGGAL SESI, bukan tarif berjalan. Karena
      //     itu menaikkan tarif hari ini tidak menggeser satu angka pun di
      //     pekan yang sudah lewat (spec bagian 5). Dicocokkan lewat variantId
      //     — harga menempel di varian, bukan di layanan.
      const t = tarifPadaTanggal(input.tarif, s.variantId, s.tanggal);

      // (3a) Komponen TRANSPORT (Task 9), dicari TERPISAH dari tarif varian
      //      di atas — tabel sumbernya berbeda (`transport_rates` per
      //      jenjang, `transport_khusus` per SESI untuk `di_atas_20`) dan
      //      keduanya harus dikonsultasikan sebelum honor sesi ini dianggap
      //      lengkap.
      //
      //      `s.jenjang === null` SENGAJA diperlakukan BERBEDA dari jenjang
      //      yang tarifnya hilang: null berarti jaraknya belum pernah
      //      diketahui, bukan "transport gratis" maupun "tak-bertarif".
      //      Memilih menandainya tak-bertarif akan membuat honor VARIAN
      //      (yang sudah sah) ikut hilang hanya karena kolom jarak yang
      //      kosong — komponen transportnya sendiri diperlakukan NOL, di
      //      sini, sengaja, dengan alasan ini tertulis di tempat keputusannya
      //      diambil.
      //
      //      DUA sumber `jenjang = null` (Ruling 24, gelombang perbaikan
      //      akhir — komentar ini SEBELUMNYA hanya menyebut sumber pertama):
      //        1. sesi PRA-MIGRASI, dari sebelum kolom `sessions.jenjang`
      //           ada — tidak akan pernah terisi retroaktif, sesuai
      //           keputusan Task 9 di atas.
      //        2. sesi BARU yang GEOCODING-nya gagal (Task 6/7) — alamat
      //           tidak dikenal OSM, `geocodeAlamat()` memulangkan `null`,
      //           dan admin tetap bisa menugaskan mitra tanpa satu pun galat
      //           atau peringatan. Sumber ini TIDAK ADA saat komentar ini
      //           mula-mula ditulis, dan diperlakukan NOL transport yang
      //           sama seperti sumber (1) — benar untuk (1), tapi untuk (2)
      //           murni kebetulan, karena kolomnya BISA dan SEHARUSNYA
      //           diisi (`tetapkanJenjang`, `app/admin/sesi/aksi.ts`).
      //
      //      Perlakuan NOL di sini TIDAK berubah untuk kedua sumber — sesi
      //      ber-jenjang null tetap tidak menyumbang komponen transport, titik
      //      itu bukan yang diperbaiki. Yang diperbaiki adalah VISIBILITASNYA:
      //      view `sesi_menunggu_jenjang_transport` (migrasi `20260907150000`)
      //      + `hitungMenungguJenjangTransport()` (`lib/admin/antrean.ts`)
      //      kini menghitung SETIAP sesi SELESAI ber-jenjang null sebagai
      //      antrean di dashboard admin — sebelum perbaikan ini, sumber (2)
      //      adalah lubang honor yang senyap total: sesi selesai, dihitung
      //      SEHAT di sini (honor varian penuh, transport nol,
      //      `jumlahTakBertarif` = 0), dan tidak ada satu tempat pun di
      //      aplikasi yang menunjuk sesi mana yang butuh jenjangnya
      //      ditetapkan.
      let transport: { tarifKlien: number; honorMitra: number } | null = null;
      let transportHilang = false;
      if (s.jenjang === "di_atas_20") {
        const khusus = petaKhusus.get(s.id);
        if (khusus) transport = { tarifKlien: khusus.tarifKlien, honorMitra: khusus.honorMitra };
        else transportHilang = true;
      } else if (s.jenjang !== null) {
        // (Ruling 19, Task 9 fix round 1) Sesi lebih tua dari tarif transport
        // paling awal jenjangnya JATUH TAK-BERTARIF PERMANEN — tidak ada jalur
        // retroaktif: `guard_tarif_transport_maju` menolak SETIAP tarif baru
        // yang `berlaku_sejak`-nya mundur, bahkan dari owner, jadi tarif lama
        // tidak akan pernah bisa ditambahkan untuk menutup sesi ini. Ini BUKAN
        // lubang baru milik Task 9 — sejajar persis konsekuensi append-only
        // yang sudah diterima untuk tarif VARIAN (`variant_rates`, spec
        // sebelumnya) — dan karena itu SENGAJA tidak "diperbaiki" di sini;
        // memperlebar jalur mundur adalah keputusan tingkat spec rate card,
        // bukan keputusan kalkulasi rekap.
        const tt = tarifTransportPadaTanggal(tarifTransport, s.jenjang, s.tanggal);
        if (tt) transport = { tarifKlien: tt.tarifKlien, honorMitra: tt.honorMitra };
        else transportHilang = true;
      }

      if (t === null || transportHilang) {
        // (3b) Sesi tak-bertarif — TIDAK dihitung nol diam-diam, dalam DUA
        //      keadaan yang sejajar persis: tarif varian hilang (t === null,
        //      seperti sebelum Task 9), ATAU tarif transport hilang padahal
        //      jenjangnya diketahui (di_atas_20 tanpa transport_khusus, atau
        //      jenjang lain yang rate card-nya belum mencakup tanggal sesi).
        //      Honor separuh yang terlihat lengkap — honor varian dibayar,
        //      transport ditelan senyap — lebih berbahaya daripada sesi yang
        //      jujur dilaporkan tertunda: yang pertama tidak punya jejak yang
        //      bisa diperiksa siapa pun. Karena itu honor VARIAN pun ikut
        //      TIDAK disumkan di sini, walau `t` sendiri valid.
        baris.jumlahTakBertarif += 1;
        sesiTakBertarif.push({
          id: s.id,
          namaLayanan: s.namaLayanan,
          namaMitra: s.namaMitra,
          tanggal: s.tanggal,
          // Varian diperiksa dulu: sesi yang KEDUANYA hilang menuding sebab
          // yang paling mendasar (harga layanan itu sendiri belum ada) —
          // memperbaikinya di /owner/tarif otomatis membuat sesi ini
          // dievaluasi ulang, sementara menuding "transport" lebih dulu akan
          // mengirim owner ke layar yang tidak akan pernah menyelesaikannya
          // selama tarif variannya sendiri masih kosong.
          sebab: t === null ? "varian" : "transport",
        });
      } else {
        // (4) Sesi berpaket DAN sesi lepas keduanya menghasilkan HONOR —
        //     bidan bekerja pada keduanya, dan honor transport (perjalanan
        //     yang benar-benar ditempuh) TETAP dibayarkan tanpa syarat
        //     `clientPackageId` — persis seperti honor varian di atasnya.
        //
        //     (Ruling 18, Task 9 fix round 1) `tarifKlien` TRANSPORT beda
        //     ceritanya: sesi berpaket dibayar klien lewat harga PAKET yang
        //     tetap/pre-paid, dan struktur itu BELUM punya spec "transport
        //     tambahan di atas harga paket". Menambah `tarifKlien` transport
        //     ke `totalHarga` untuk sesi berpaket akan membuat margin PADMA
        //     terlihat lebih besar daripada uang yang akan benar-benar
        //     ditagihkan — pendapatan yang tidak pernah sampai ke siapa pun.
        //     Ditunda sampai ada spec paket transport: hari ini `tarifKlien`
        //     transport HANYA masuk `totalHarga` untuk sesi LEPAS, dan
        //     PADMA-lah yang menanggung selisihnya (margin turun sebesar
        //     honor transport pada sesi berpaket) — angka yang jujur, karena
        //     memang tidak ditagihkan.
        const honorTransport = transport?.honorMitra ?? 0;
        const hargaTransportKlien = s.clientPackageId === null ? (transport?.tarifKlien ?? 0) : 0;
        baris.totalHonor += t.honorMitra + honorTransport;
        totalHonor += t.honorMitra + honorTransport;
        totalHarga += t.hargaKlien + hargaTransportKlien;
      }

      perMitra.set(s.partnerId, baris);
    }

    for (const baris of perMitra.values()) {
      const tanda = petaTanda.get(`${baris.partnerId}|${e.senin}`);
      if (!tanda) continue;
      baris.sudahDibayar = true;
      baris.dibayarPada = tanda.dibayarPada;
      // (5) Sesi yang baru diselesaikan sesudah tandanya dipasang. Dibandingkan
      //     sebagai timestamp ISO — keduanya UTC dari Postgres, jadi urutan
      //     leksikografisnya sudah kronologis; tetap dilewatkan Date agar
      //     presisi pecahan detik yang berbeda tidak salah dibandingkan.
      baris.adaSesiSesudahDitandai = e.sesi.some(
        (s) =>
          s.partnerId === baris.partnerId &&
          s.selesaiPada !== null &&
          Date.parse(s.selesaiPada) > Date.parse(tanda.dibayarPada),
      );
    }

    hasil.push({
      senin: e.senin,
      rentang: rentangPekan(e.senin),
      jumlahSesi: e.sesi.length,
      // Urutan menurut nama supaya rekap tidak berubah-ubah antar render;
      // localeCompare("id") agar abjad Indonesia benar.
      perMitra: [...perMitra.values()].sort((a, b) => a.nama.localeCompare(b.nama, "id")),
      totalHonor,
      totalHarga,
      // (6) Margin adalah angka PADMA per PEKAN — bukan per mitra
      //     (spec keputusan #6). Sengaja tidak ada medan margin di BarisMitra.
      margin: totalHarga - totalHonor,
      sesiTakBertarif,
    });
  }

  // Pekan terbaru di atas. `senin` YYYY-MM-DD, jadi urutan leksikografis =
  // kronologis; komparator mengembalikan 0 untuk nilai setara agar tidak
  // melanggar kontrak Array#sort.
  return hasil.sort((a, b) => (a.senin > b.senin ? -1 : a.senin < b.senin ? 1 : 0));
}

/**
 * `pekan` pekan berurutan sampai pekan berjalan, TERLAMA DI KIRI.
 *
 * `hitungRekap()` mengelompokkan sesi, jadi pekan yang tidak punya satu sesi
 * pun tidak menghasilkan ember sama sekali. Grafik yang memakai hasilnya apa
 * adanya akan MELOMPATI pekan sepi: delapan pekan tampil sebagai enam titik,
 * jarak antar titik menjadi tidak sama, dan garisnya berbohong tanpa satu
 * angka pun yang salah.
 *
 * Pekan kosong diisi nol, bukan dihilangkan — dan nol memang benar: tidak ada
 * sesi berarti tidak ada honor, tidak ada harga, tidak ada margin.
 *
 * Fungsi MURNI: tidak membaca jam sistem dan tidak menyentuh basis data.
 */
export function deretPekanTerakhir(
  rekap: readonly RekapPekan[],
  hariIni: string,
  pekan = 8,
): RekapPekan[] {
  const seninKini = awalPekan(hariIni);
  const adaNya = new Map(rekap.map((p) => [p.senin, p]));

  return Array.from({ length: pekan }, (_, i) => {
    const senin = geserHari(seninKini, -7 * (pekan - 1 - i));
    const punya = adaNya.get(senin);
    if (punya) return punya;
    return {
      senin,
      rentang: rentangPekan(senin),
      jumlahSesi: 0,
      perMitra: [],
      totalHonor: 0,
      totalHarga: 0,
      margin: 0,
      sesiTakBertarif: [],
    };
  });
}
