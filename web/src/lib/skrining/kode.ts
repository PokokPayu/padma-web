import { randomInt } from "node:crypto";

// Tanpa I/O/0/1 agar kode bisa dibacakan lewat telepon tanpa salah dengar.
const ALFABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PANJANG_SUFIKS = 4;
const RUANG_SUFIKS = ALFABET.length ** PANJANG_SUFIKS; // 32^4 = 1.048.576

/**
 * Prototipe memakai `Math.random()` dan menghasilkan panjang tidak konsisten.
 * Di sini: kriptografis (CSPRNG), zero-padded, panjang tetap.
 *
 * KEUNIKAN — jangan disederhanakan jadi "acak saja":
 * prefiks kode hanya seresolusi MENIT, jadi seluruh kode yang lahir dalam satu
 * menit hanya dibedakan oleh sufiks 4 karakter (1.048.576 kemungkinan). Dengan
 * acak murni, 1000 kode dalam satu menit bentrok pada ~36% eksekusi (paradoks
 * ulang tahun — diukur, bukan diperkirakan). Karena itu sufiks yang sudah
 * dikeluarkan untuk menit berjalan diingat, dan undian diulang bila terpakai.
 *
 * Jaminan ini bersifat per-proses. Instance server lain tetap bisa mengeluarkan
 * sufiks sama, jadi `screenings.kode UNIQUE` + retry di route handler tetap
 * penjaga terakhir — bukan pengganti fungsi ini, tetapi pelengkapnya.
 */
let prefiksTerakhir = "";
let terpakai = new Set<string>();

// Batas memori jejak. Di atas ini keunikan diserahkan ke CSPRNG + UNIQUE di DB,
// supaya banjir permintaan tidak bisa menggelembungkan memori proses.
const MAKS_JEJAK = 200_000;

function sufiksAcak(): string {
  let acak = "";
  for (let i = 0; i < PANJANG_SUFIKS; i++) acak += ALFABET[randomInt(ALFABET.length)];
  return acak;
}

function sufiksDariIndeks(indeks: number): string {
  let sufiks = "";
  let n = indeks;
  for (let i = 0; i < PANJANG_SUFIKS; i++) {
    sufiks = ALFABET[n % ALFABET.length] + sufiks;
    n = Math.floor(n / ALFABET.length);
  }
  return sufiks;
}

// Cadangan bila undian ulang terus kalah (ruang sufiks hampir penuh): telusuri
// dari titik acak sampai menemukan sufiks yang belum dipakai. Terbatas dan
// pasti berhenti.
function sufiksBelumTerpakai(): string | null {
  const mulai = randomInt(RUANG_SUFIKS);
  for (let k = 0; k < RUANG_SUFIKS; k++) {
    const kandidat = sufiksDariIndeks((mulai + k) % RUANG_SUFIKS);
    if (!terpakai.has(kandidat)) return kandidat;
  }
  return null; // satu menit menghabiskan seluruh ruang — DB yang menolak duplikat
}

export function buatKodeSkrining(sekarang: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const tanggal =
    p(sekarang.getFullYear() % 100) + p(sekarang.getMonth() + 1) + p(sekarang.getDate());
  const jam = p(sekarang.getHours()) + p(sekarang.getMinutes());
  const prefiks = `PDM-${tanggal}-${jam}`;

  // Menit berganti -> prefiks sudah membedakan; jejak lama boleh dilupakan.
  if (prefiks !== prefiksTerakhir) {
    prefiksTerakhir = prefiks;
    terpakai = new Set();
  }

  let sufiks = sufiksAcak();
  if (terpakai.size < MAKS_JEJAK) {
    for (let i = 0; i < 8 && terpakai.has(sufiks); i++) sufiks = sufiksAcak();
    if (terpakai.has(sufiks)) sufiks = sufiksBelumTerpakai() ?? sufiks;
    terpakai.add(sufiks);
  }

  return `${prefiks}-${sufiks}`;
}
