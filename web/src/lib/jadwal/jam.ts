/**
 * JAM SESI — bentuk, daftar pilihan, tampilan, dan aritmatika waktunya.
 *
 * Sebelum C1, satu-satunya keterangan waktu pada sebuah pemesanan adalah
 * `preferensi_waktu` (`pagi`/`siang`/`sore`) — sebuah PREFERENSI, bukan janji.
 * Seluruh kebijakan pembatalan klien bersandar pada "≥ 24 jam sebelum sesi" dan
 * "< 2 jam"; tanpa jam, tidak satu pun batas itu bisa dihitung (spec J2).
 *
 * Berkas ini MURNI — tanpa impor, sehingga aman dipakai komponen `"use client"`
 * (formulir pemesanan) maupun server.
 *
 * ===== KENAPA OFFSET TETAP +07:00, BUKAN Intl =====
 * `hariIniJakarta()` di `lib/passport/waktu.ts` memakai `Intl.DateTimeFormat`
 * untuk mendapatkan TANGGAL Jakarta, dan itu benar untuk pekerjaannya. Yang
 * dibutuhkan di sini berbeda: mengubah "10 September 2026 pukul 09.00 waktu
 * Jakarta" menjadi satu titik waktu absolut, supaya "berapa jam lagi" bisa
 * dihitung. Intl memformat instan menjadi teks; ia tidak mengurai teks menjadi
 * instan.
 *
 * WIB adalah offset TETAP +07:00. Indonesia tidak menjalankan daylight saving
 * (dan belum sejak 1964), jadi tidak ada tanggal dalam setahun di mana `+07:00`
 * menjadi salah. Itulah yang membuat `Date.parse` dengan offset eksplisit di
 * bawah sah — dan sekaligus alasan cara ini TIDAK boleh disalin untuk zona yang
 * ber-DST.
 *
 * Vercel berjalan UTC. Menghitung tenggat dengan kalender mesin akan menggeser
 * batasnya tujuh jam, dan pergeseran itu berbentuk uang klien yang hangus
 * sehari lebih awal (spec J2).
 */

/** Offset tetap WIB. Bukan tebakan — lihat dokblok di atas. */
const OFFSET_WIB = "+07:00";

const POLA_JAM = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const POLA_TANGGAL = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * Jam cadangan bila `app_settings.jam_layanan` belum diisi atau isinya tidak
 * masuk akal.
 *
 * Ini BUKAN "jam operasional PADMA yang sebenarnya" — nilai sungguhannya
 * ditetapkan klien lewat /admin/pengaturan, dan memang akan berubah (spec J2:
 * "perubahan seperti itu tidak boleh menuntut deploy"). Ia jaring pengaman
 * supaya formulir pemesanan tidak pernah terbit tanpa satu pun pilihan jam —
 * kegagalan senyap yang bentuknya sama persis dengan `https://wa.me/` kosong
 * yang sudah pernah terjadi di repo ini (lihat `lib/pengaturan/bentuk.ts`).
 */
export const JAM_LAYANAN_BAWAAN: readonly string[] = [
  "08:00",
  "09:00",
  "10:00",
  "11:00",
  "13:00",
  "14:00",
  "15:00",
  "16:00",
];

export function bentukJamSah(jam: string): boolean {
  return POLA_JAM.test(jam);
}

/**
 * Mengubah nilai setelan menjadi daftar jam yang boleh dipilih klien.
 *
 * Satu entri yang salah ketik DIBUANG, bukan menggagalkan seluruh daftar: nilai
 * ini diketik manusia di panel admin, dan formulir pemesanan yang kehilangan
 * seluruh pilihan jamnya karena satu koma nyasar adalah kegagalan yang jauh
 * lebih besar daripada satu jam yang hilang. Bila TIDAK ADA entri yang tersisa,
 * barulah daftar bawaan dipakai — supaya tidak pernah ada keadaan "nol pilihan".
 */
export function uraikanDaftarJam(mentah: string | null | undefined): string[] {
  const entri = (mentah ?? "")
    .split(",")
    .map((bagian) => bagian.trim())
    .filter((bagian) => bentukJamSah(bagian));

  const unik = [...new Set(entri)].sort();
  return unik.length > 0 ? unik : [...JAM_LAYANAN_BAWAAN];
}

/**
 * Tampilan untuk manusia. Bahasa Indonesia memakai TITIK sebagai pemisah jam
 * ("09.00"), dan zona disebut eksplisit karena klien membaca layar ini dari
 * mana saja.
 */
export function formatJam(jam: string): string {
  if (!bentukJamSah(jam)) throw new Error(`Jam tidak sah: ${jam}`);
  return `${jam.replace(":", ".")} WIB`;
}

/**
 * Postgres `time` dibaca kembali sebagai 'HH:MM:SS'. Layar hanya butuh 'HH:MM',
 * dan `formatJam` menolak apa pun yang bukan itu.
 *
 * Fungsi terpisah, bukan pelonggaran `bentukJamSah`: yang datang DARI basis data
 * dan yang datang DARI peramban tidak boleh dinilai dengan aturan yang sama.
 * Melonggarkan `bentukJamSah` untuk menerima detik berarti '09:00:07' dari
 * FormData ikut lolos.
 */
export function jamDariDb(nilai: string): string {
  return nilai.slice(0, 5);
}

/**
 * "Tanggal + jam menurut Jakarta" sebagai satu titik waktu absolut.
 *
 * MELEMPAR untuk masukan tak sah, tidak memulangkan `Invalid Date`. Tanggal
 * yang diam-diam menjadi NaN akan merambat menjadi tenggat yang diam-diam
 * menjadi NaN, dan perbandingan apa pun dengan NaN bernilai false — artinya
 * setiap pagar waktu terbuka tanpa satu pun galat di log.
 */
export function instanSesi(tanggal: string, jam: string): Date {
  if (!POLA_TANGGAL.test(tanggal)) throw new Error(`Tanggal tidak sah: ${tanggal}`);
  if (!bentukJamSah(jam)) throw new Error(`Jam tidak sah: ${jam}`);
  return new Date(`${tanggal}T${jam}:00${OFFSET_WIB}`);
}

/**
 * Berapa jam lagi sesinya, dari sudut pandang `sekarang`.
 *
 * Negatif berarti sudah lewat. Sengaja mengembalikan angka pecahan apa adanya
 * (bukan dibulatkan): pembulatan di dalam fungsi ini akan diam-diam memindahkan
 * batas "≥ 24 jam" milik C3, dan yang berpindah bersamanya adalah uang klien.
 * Pembulatan adalah urusan lapisan tampilan.
 */
export function jamSampaiSesi(tanggal: string, jam: string, sekarang: Date = new Date()): number {
  const sesi = instanSesi(tanggal, jam);
  return (sesi.getTime() - sekarang.getTime()) / 3_600_000;
}
