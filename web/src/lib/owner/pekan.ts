// ============================================================================
// PEKAN JAKARTA — Senin s.d. Minggu, dihitung TANPA aritmatika Date
// ============================================================================
// KENAPA TANPA Date — diukur, bukan dikutip.
//
// Plan menyatakan `mondayOf` prototipe menghasilkan "2026-08-25" untuk
// "2026-08-30" di zona barat. Klaim itu DIJALANKAN ULANG, dan angkanya TERBUKTI
// PERSIS — tetapi hanya pada salah satu dari dua varian yang beredar:
//
//   • `new Date(s)` POLOS — TERBUKTI SALAH. String YYYY-MM-DD di-parse sebagai
//     tengah malam UTC lalu dibaca dengan getter LOKAL, jadi di
//     TZ=America/Los_Angeles tanggalnya mundur sehari SEBELUM dibulatkan.
//     Dijalankan: mondayOf("2026-08-30") -> "2026-08-25" (Selasa — bahkan bukan
//     Senin), dan menyapu satu tahun penuh: 365 dari 365 hari salah, umumnya
//     mendarat di SENIN PEKAN SEBELUMNYA (2026-01-01 -> 2025-12-29, seharusnya
//     2025-12-30). Honor satu pekan penuh pindah bucket tanpa satu angka pun
//     terlihat ganjil.
//   • `new Date(s + "T00:00:00")` — pada sapuan yang sama (UTC,
//     America/Los_Angeles, Asia/Jakarta, Pacific/Apia) nol penyimpangan, karena
//     "T00:00:00" ditafsirkan waktu LOKAL dan getDay/setDate juga membaca lokal
//     sehingga zonanya saling meniadakan.
//
// Kedua varian hanya terpaut sembilan karakter yang tak kasatmata, dan yang
// benar berubah menjadi yang salah begitu seseorang "merapikan" kodenya.
//
// Karena bug itu bergantung pada varian penulisan yang tak kasatmata, modul ini
// menghapus seluruh kelasnya: nomor hari absolut (algoritma days_from_civil
// Howard Hinnant), bilangan bulat murni dari string tanggal. `Date` HANYA
// dipakai untuk MEMFORMAT nama bulan dengan timeZone Asia/Jakarta, tidak pernah
// untuk aritmatika — jadi tidak ada zona, DST, maupun ICU yang bisa menggesernya.

const ZONA = "Asia/Jakarta";
const POLA_TANGGAL = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Nomor hari absolut sejak 1970-01-01 (hari 0). Bilangan bulat, tanpa Date. */
function keNomorHari(tgl: string): number {
  const cocok = POLA_TANGGAL.exec(tgl);
  if (!cocok) {
    // Tanggal tak sah TIDAK BOLEH menghasilkan pekan diam-diam salah: sebuah
    // NaN yang lolos akan mengelompokkan honor ke bucket hantu.
    throw new Error(`Tanggal tidak sah (harap YYYY-MM-DD): ${JSON.stringify(tgl)}`);
  }
  const th = Number(cocok[1]);
  const bl = Number(cocok[2]);
  const hr = Number(cocok[3]);
  if (bl < 1 || bl > 12 || hr < 1 || hr > 31) {
    throw new Error(`Tanggal tidak sah (di luar rentang): ${tgl}`);
  }

  const y = th - (bl <= 2 ? 1 : 0);
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;                                     // [0, 399]
  const doy = Math.floor((153 * (bl + (bl > 2 ? -3 : 9)) + 2) / 5) + hr - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Kebalikan keNomorHari — kembali ke string YYYY-MM-DD. */
function keTanggal(nomor: number): string {
  const z = nomor + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;                                  // [0, 146096]
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );                                                             // [0, 399]
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);                    // [0, 11]
  const hr = doy - Math.floor((153 * mp + 2) / 5) + 1;           // [1, 31]
  const bl = mp + (mp < 10 ? 3 : -9);                            // [1, 12]
  const th = y + (bl <= 2 ? 1 : 0);
  return `${String(th).padStart(4, "0")}-${String(bl).padStart(2, "0")}-${String(hr).padStart(2, "0")}`;
}

/**
 * Hari dalam pekan menurut ISO: 1 = Senin … 7 = Minggu.
 * Hari 0 (1970-01-01) adalah Kamis, maka ((z + 3) mod 7) + 1.
 * Modulo dirapikan agar tetap benar untuk nomor hari negatif (sebelum 1970).
 */
export function isoDow(tgl: string): number {
  const z = keNomorHari(tgl);
  return (((z + 3) % 7) + 7) % 7 + 1;
}

/** Senin dari pekan yang memuat `tgl`. Idempoten: awalPekan(awalPekan(x)) === awalPekan(x). */
export function awalPekan(tgl: string): string {
  const z = keNomorHari(tgl);
  const dow = (((z + 3) % 7) + 7) % 7 + 1;
  return keTanggal(z - (dow - 1));
}

/** Minggu dari pekan yang memuat `tgl` — enam hari sesudah Seninnya. */
export function akhirPekan(tgl: string): string {
  return keTanggal(keNomorHari(awalPekan(tgl)) + 6);
}

/** Menggeser tanggal sejumlah hari, tetap tanpa aritmatika Date. */
export function geserHari(tgl: string, hari: number): string {
  return keTanggal(keNomorHari(tgl) + hari);
}

// `Date` di bawah ini hanya untuk MEMFORMAT. Tanggal dirakit sebagai UTC tengah
// hari lalu diformat di zona Jakarta (pola yang sama dengan lib/passport/waktu.ts)
// sehingga tidak pernah mundur/maju sehari di zona server mana pun.
const FMT_HARI = new Intl.DateTimeFormat("id-ID", { timeZone: ZONA, day: "numeric" });
const FMT_BULAN = new Intl.DateTimeFormat("id-ID", { timeZone: ZONA, month: "short" });

function keDate(tgl: string): Date {
  return new Date(`${tgl}T12:00:00Z`);
}

function bagian(tgl: string): { hari: string; bulan: string; tahun: string } {
  const d = keDate(tgl);
  return {
    hari: FMT_HARI.format(d),
    bulan: FMT_BULAN.format(d).replace(".", ""),
    tahun: tgl.slice(0, 4), // tahun dari string — tidak perlu dilewatkan Intl
  };
}

/**
 * Label rentang pekan, mis. "24 – 30 Agu 2026". Bulan/tahun hanya diulang di
 * sisi kiri bila memang berbeda: "31 Agu – 6 Sep 2026",
 * "28 Des 2026 – 3 Jan 2027".
 */
export function rentangPekan(tgl: string): string {
  const senin = awalPekan(tgl);
  const minggu = akhirPekan(senin);
  const a = bagian(senin);
  const b = bagian(minggu);

  const kanan = `${b.hari} ${b.bulan} ${b.tahun}`;
  if (a.tahun !== b.tahun) return `${a.hari} ${a.bulan} ${a.tahun} – ${kanan}`;
  if (a.bulan !== b.bulan) return `${a.hari} ${a.bulan} – ${kanan}`;
  return `${a.hari} – ${kanan}`;
}
