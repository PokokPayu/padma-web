/**
 * Penamaan objek backup. MURNI: tanpa I/O dan tanpa membaca jam mesin.
 *
 * Cap waktu SELALU string UTC `YYYYMMDD-HHMMSSZ` dan dibuat DI LUAR modul ini
 * (workflow memakai `date -u`). Repo ini melarang `toISOString`/`setDate`/
 * `getDay` karena Vercel berjalan UTC sementara mesin dev WIB; di berkas ini
 * taruhannya konkret — salah tujuh jam berarti objek dihapus sehari lebih cepat
 * daripada yang dimaksud.
 */

export const PREFIKS_BACKUP = "db";

const POLA_CAP = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})Z$/;
const POLA_KUNCI = /(?:^|\/)padma-(\d{8}-\d{6}Z)\.dump\.age$/;

export function kunciObjekBackup(capWaktu: string): string {
  const cocok = POLA_CAP.exec(capWaktu);
  if (cocok === null || epochDariCapWaktu(capWaktu) === null) {
    throw new Error(`Cap waktu backup tidak sah: ${JSON.stringify(capWaktu)}`);
  }
  return `${PREFIKS_BACKUP}/${cocok[1]}/${cocok[2]}/padma-${capWaktu}.dump.age`;
}

export function capWaktuDariKunci(kunci: string): string | null {
  const cocok = POLA_KUNCI.exec(kunci);
  return cocok === null ? null : cocok[1];
}

export function epochDariCapWaktu(capWaktu: string): number | null {
  const c = POLA_CAP.exec(capWaktu);
  if (c === null) return null;
  const [tahun, bulan, tanggal, jam, menit, detik] =
    [c[1], c[2], c[3], c[4], c[5], c[6]].map(Number);

  const ms = Date.UTC(tahun, bulan - 1, tanggal, jam, menit, detik);
  if (!Number.isFinite(ms)) return null;

  // Date.UTC MENGGULUNG nilai di luar jangkauan: bulan 13 menjadi Januari tahun
  // berikutnya, 30 Februari menjadi 2 Maret. Perjalanan bolak-balik ini menolak
  // cap waktu semacam itu alih-alih diam-diam memindahkan umur objek.
  const d = new Date(ms);
  const sama =
    d.getUTCFullYear() === tahun && d.getUTCMonth() === bulan - 1 &&
    d.getUTCDate() === tanggal && d.getUTCHours() === jam &&
    d.getUTCMinutes() === menit && d.getUTCSeconds() === detik;
  return sama ? ms : null;
}
