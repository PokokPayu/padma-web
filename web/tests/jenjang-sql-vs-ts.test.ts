import { describe, it, expect } from "vitest";
import { querySql } from "./helpers/db";
import { jenjangPembatalan } from "@/lib/pembatalan/jenjang";
import { instanSesi } from "@/lib/jadwal/jam";

/**
 * RUMUS JENJANG HIDUP DI DUA BAHASA — DAN SEJAK BERKAS INI, KEMBARANNYA DIJAGA.
 *
 * `jenjangPembatalan()` (TypeScript) MENERANGKAN: ia menampilkan ke admin apa
 * yang AKAN terjadi sebelum tombol ditekan. `public.jenjang_pembatalan()` (SQL)
 * MEMUTUSKAN: ia dipanggil di dalam `batalkan_sesi()` dan `jadwal_ulang_sesi()`,
 * dan hasilnyalah yang menentukan status baris dan apakah `hak_sesi` terbit.
 * Yang memutuskan tidak boleh ada di lapisan yang bisa dilewati satu panggilan
 * RPC — karena itu rumusnya ditulis dua kali, disengaja.
 *
 * Komentar migrasi `20260913102000_rpc_pembatalan.sql` DAN catatan tindak
 * lanjut C3-a sama-sama membenarkan kembaran itu dengan menunjuk preseden
 * `jarak_km` vs `haversineKm` "yang dijaga uji `tests/jarak-sql-vs-ts.test.ts`".
 * Pagar setara untuk jenjang TIDAK ADA sampai berkas ini lahir — dua komentar
 * menjanjikan jaminan yang belum pernah dibangun. Komentar yang menjanjikan
 * jaminan yang tidak ada lebih berbahaya daripada tidak ada komentar sama
 * sekali: pembaca berikutnya percaya begitu saja dan tidak memeriksa ulang.
 *
 * ===== KENAPA DIBANDINGKAN LEWAT SELISIH, BUKAN LEWAT `now()` YANG SAMA =====
 * Sisi SQL membaca `now()` sendiri dan tidak menerimanya sebagai argumen —
 * sengaja, karena "sekarang" yang bisa dikirim pemanggil adalah "sekarang" yang
 * bisa dikarang klien. Akibatnya kedua sisi tidak bisa disuapi INSTAN yang
 * sama; yang bisa disuapi sama adalah SELISIHNYA, dan selisih itulah satu-
 * satunya hal yang dibaca kedua rumus.
 *
 * Caranya: untuk sebuah selisih `d`,
 *   • SQL menerima pasangan `(tanggal, jam)` yang dihitung sebagai
 *     `(now() at time zone 'Asia/Jakarta') + d` DI DALAM SATU PERNYATAAN —
 *     `now()` bernilai sama di seluruh pernyataan, jadi jaraknya PERSIS `d`,
 *     sampai mikrodetik, bukan dibulatkan ke menit;
 *   • TypeScript menerima pasangan tetap `(tanggal, jam)` dan `sekarang`
 *     yang dihitung sebagai `instanSesi(pasangan) - d`.
 *
 * Kedua sisi karena itu menjawab pertanyaan yang identik, dan ambangnya diuji
 * TEPAT di 24 jam dan 2 jam — bukan "kira-kira di sekitarnya", yang justru
 * satu-satunya tempat rumus ini bisa berselisih tanpa ketahuan.
 *
 * Sisi SQL tetap diuji zona waktunya di sini: pasangannya dirakit dari
 * `now() at time zone 'Asia/Jakarta'` lalu dibaca ulang oleh fungsi yang
 * mengubahnya kembali dengan `at time zone 'Asia/Jakarta'`. Mencabut konversi
 * itu dari fungsinya menggeser hasilnya tujuh jam dan memerahkan berkas ini.
 * Zona sisi TypeScript TIDAK dijaga di sini — selisih yang sama menggeser
 * `sekarang` sejauh yang sama — dan memang tidak perlu: ia sudah punya dua uji
 * sendiri di `tests/pembatalan-jenjang.test.ts` yang merah tepat saat offset
 * WIB-nya hilang.
 */

const JAM = 3_600_000;

/**
 * Selisih uji, dalam milidetik. Yang penting bukan banyaknya melainkan
 * ketepatannya: ambang atas bersifat INKLUSIF ("≥ 24 jam" di poster), jadi satu
 * milidetik di kedua sisinya adalah selisih antara uang kembali penuh dan
 * kredit 30 hari.
 */
const SELISIH: Array<[label: string, ms: number]> = [
  ["jauh di depan (7 hari)", 7 * 24 * JAM],
  ["sedikit di atas 24 jam", 24 * JAM + 1],
  ["TEPAT 24 jam", 24 * JAM],
  ["semilidetik di bawah 24 jam", 24 * JAM - 1],
  ["tengah jendela jenjang 2 (6 jam)", 6 * JAM],
  ["sedikit di atas 2 jam", 2 * JAM + 1],
  ["TEPAT 2 jam", 2 * JAM],
  ["semilidetik di bawah 2 jam", 2 * JAM - 1],
  ["setengah jam lagi", 0.5 * JAM],
  ["tepat saat sesi dimulai", 0],
  ["sesi SUDAH LEWAT satu jam", -1 * JAM],
  ["sesi sudah lewat lebih dari sehari", -25 * JAM],
];

/**
 * Pasangan tanggal & jam yang dipakai sisi TypeScript. Beberapa, bukan satu:
 * salah satunya menyeberangi pergantian hari saat `sekarang` mundur 24 jam, dan
 * salah satunya jatuh di jam larut supaya pergeseran zona tujuh jam pada sisi
 * mana pun benar-benar memindahkan tanggalnya.
 */
const PASANGAN: Array<[tanggal: string, jam: string]> = [
  ["2027-03-10", "09:00"],
  ["2027-03-01", "00:00"],
  ["2027-12-31", "23:30"],
  ["2028-02-29", "13:00"], // tahun kabisat
];

describe("public.jenjang_pembatalan sepakat dengan jenjangPembatalan()", () => {
  it("sepakat untuk seluruh selisih uji, TERMASUK tepat di ambang 24 jam dan 2 jam", async () => {
    for (const [label, ms] of SELISIH) {
      // SATU pernyataan: `now()` bernilai sama untuk perakitan pasangan dan
      // untuk pemanggilan fungsinya, jadi jaraknya persis `ms`.
      const [{ j }] = await querySql<{ j: number }>(
        `select public.jenjang_pembatalan(t.tgl, t.jm) as j
           from (
             select ((now() at time zone 'Asia/Jakarta') + ($1 || ' milliseconds')::interval)::date as tgl,
                    ((now() at time zone 'Asia/Jakarta') + ($1 || ' milliseconds')::interval)::time as jm
           ) t`,
        [String(ms)],
      );

      for (const [tanggal, jam] of PASANGAN) {
        const sekarang = new Date(instanSesi(tanggal, jam).getTime() - ms);
        expect(
          Number(j),
          `selisih ${label} (${ms} ms), pasangan ${tanggal} ${jam}`,
        ).toBe(jenjangPembatalan(tanggal, jam, sekarang));
      }
    }
  });

  it("tidak pernah memulangkan 4 — jenjang 4 pertanyaan SIAPA, bukan waktu", async () => {
    // Kalau rumus waktu suatu hari ikut memulangkan 4, `batalkan_sesi()` akan
    // menandai pembatalan klien sebagai `dibatalkan_padma` (refund penuh) tanpa
    // seorang pun menyatakannya — persis cacat aktor yang baru saja ditutup,
    // lahir kembali dari sisi lain.
    const [{ semua }] = await querySql<{ semua: boolean }>(
      `select bool_and(j between 1 and 3) as semua
         from (
           select public.jenjang_pembatalan(
                    ((now() at time zone 'Asia/Jakarta') + (g || ' hours')::interval)::date,
                    ((now() at time zone 'Asia/Jakarta') + (g || ' hours')::interval)::time
                  ) as j
             from generate_series(-48, 96) as g
         ) x`,
    );
    expect(semua).toBe(true);
  });
});
