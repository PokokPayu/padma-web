import { awalPekan, geserHari, rentangPekan } from "./pekan";

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
  serviceId: string;
  hargaKlien: number;
  honorMitra: number;
  berlakuSejak: string; // YYYY-MM-DD
};

export type SesiRekap = {
  id: string;
  serviceId: string;
  namaLayanan: string;
  partnerId: string;
  namaMitra: string;
  tanggal: string; // YYYY-MM-DD
  status: "terjadwal" | "selesai" | "batal";
  clientPackageId: string | null;
  /** `sessions.updated_at` — kapan sesi terakhir disentuh admin. Boleh null. */
  selesaiPada: string | null;
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
 * Mengembalikan `null` bila sesi lebih tua dari tarif paling awal layanan itu —
 * dan `null` itu WAJIB dilaporkan pemanggilnya, bukan dijadikan 0.
 *
 * Perbandingan tanggal = perbandingan string; keduanya YYYY-MM-DD sehingga
 * urutan leksikografis = urutan kronologis.
 */
export function tarifPadaTanggal(
  tarif: readonly TarifRingkas[],
  serviceId: string,
  tgl: string,
): TarifRingkas | null {
  let terpilih: TarifRingkas | null = null;
  for (const t of tarif) {
    if (t.serviceId !== serviceId) continue;
    if (t.berlakuSejak > tgl) continue;
    if (terpilih === null || t.berlakuSejak > terpilih.berlakuSejak) {
      terpilih = t;
      continue;
    }
    // Seri. UNIQUE (service_id, berlaku_sejak) baru dipasang belakangan dan
    // tidak ada `created_at` pemecah seri, jadi seri masih mungkin ada di data
    // lama. Dipecah dengan `id` supaya hasilnya tidak bergantung pada urutan
    // baris yang dipulangkan PostgREST — rekap yang sama harus selalu
    // menghasilkan angka yang sama.
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
  tanda: readonly TandaBayar[];
}): RekapPekan[] {
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
      //     pekan yang sudah lewat (spec bagian 5).
      const t = tarifPadaTanggal(input.tarif, s.serviceId, s.tanggal);
      if (t === null) {
        // (3) Sesi lebih tua dari tarif paling awal. TIDAK dihitung nol
        //     diam-diam — itu uang yang hilang tanpa jejak. Ia dilaporkan.
        baris.jumlahTakBertarif += 1;
        sesiTakBertarif.push({
          id: s.id,
          namaLayanan: s.namaLayanan,
          namaMitra: s.namaMitra,
          tanggal: s.tanggal,
        });
      } else {
        // (4) Sesi berpaket DAN sesi lepas keduanya menghasilkan honor —
        //     bidan bekerja pada keduanya. `clientPackageId` sengaja TIDAK
        //     dipakai sebagai penyaring di sini.
        baris.totalHonor += t.honorMitra;
        totalHonor += t.honorMitra;
        totalHarga += t.hargaKlien;
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
