import { describe, it, expect } from "vitest";
import { querySql } from "./helpers/db";
import { haversineKm, jenjangDariJarak } from "@/lib/transport/jarak";

/**
 * RUMUS JARAK HIDUP DI DUA BAHASA — DAN ITU DIJAGA DI SINI.
 *
 * `konfirmasi_permintaan()` menghitung jenjang jarak DI DALAM basis data, bukan
 * menerimanya dari pemanggil. Alasannya bukan selera: selama ia argumen, admin
 * yang memanggil RPC langsung bisa menyodorkan jenjang karangan dan
 * mendapatkannya tercatat sebagai hasil hitungan otomatis — dan
 * `sessions_alasan_penimpaan` tidak menahannya, karena ia hanya menuntut alasan
 * ketika sumbernya sudah 'admin'.
 *
 * Harganya: haversine kini ditulis dua kali, di `lib/transport/jarak.ts` dan di
 * fungsi `public.jarak_km`. Duplikasi rumus adalah persis yang ditolak Ruling 20
 * untuk `LABEL_JENJANG` — dan diterima di sini HANYA karena berkas ini ada.
 * Duplikasi yang dijaga uji berbeda dari duplikasi yang dibiarkan; yang tidak
 * bisa dijaga sama sekali adalah nilai yang datang dari pemanggil.
 *
 * Bila berkas ini dihapus, argumen itu harus dikembalikan atau lubangnya
 * kembali terbuka. Jangan menghapusnya tanpa membaca dokblok migration
 * `20260909150000_pagar_jam_dan_jenjang`.
 */

/** Titik-titik nyata di dan sekitar Malang, plus beberapa kasus batas. */
const PASANGAN: Array<[number, number, number, number]> = [
  // Sangat dekat — beda beberapa puluh meter.
  [-7.9666, 112.6326, -7.967, 112.633],
  // Beda beberapa kilometer, arah berbeda-beda.
  [-7.9666, 112.6326, -7.98, 112.64],
  [-7.9666, 112.6326, -7.99, 112.66],
  [-7.9666, 112.6326, -7.93, 112.61],
  [-7.9666, 112.6326, -8.02, 112.58],
  // Lintas kabupaten — melewati beberapa jenjang.
  [-7.9666, 112.6326, -8.1, 112.75],
  [-7.9666, 112.6326, -7.75, 112.45],
  // Jauh: Malang ke Surabaya, jelas di atas 20 km.
  [-7.9666, 112.6326, -7.2575, 112.7521],
  // Titik identik — jarak nol.
  [-7.9666, 112.6326, -7.9666, 112.6326],
  // Melintasi khatulistiwa dan meridian, untuk memastikan tandanya benar.
  [0.5, 101.45, -0.5, 101.45],
  [-6.2, 106.8, -6.2, 107.8],
  [1.0, -1.0, -1.0, 1.0],
];

describe("public.jarak_km sepakat dengan haversineKm()", () => {
  it("selisihnya di bawah satu meter untuk seluruh pasangan uji", async () => {
    for (const [lat1, lon1, lat2, lon2] of PASANGAN) {
      const [{ km }] = await querySql<{ km: number }>(
        "select public.jarak_km($1, $2, $3, $4) as km",
        [lat1, lon1, lat2, lon2],
      );
      const ts = haversineKm({ lat: lat1, lon: lon1 }, { lat: lat2, lon: lon2 });
      // 1e-6 km = 1 milimeter. Selisih sebesar itu hanya bisa datang dari
      // pembulatan floating point, bukan dari rumus yang berbeda.
      expect(Math.abs(Number(km) - ts), `pasangan ${lat1},${lon1} -> ${lat2},${lon2}`).toBeLessThan(
        1e-6,
      );
    }
  });
});

describe("public.jenjang_dari_jarak sepakat dengan jenjangDariJarak()", () => {
  it("sepakat pada seluruh jarak uji, TERMASUK tepat di batas jenjang", async () => {
    // Batasnya `<=`, bukan `<` — 5,0 km masih jenjang pertama dan 5,01 sudah
    // naik. Menyerahkan batas ini pada pembulatan berarti dua klien berjarak
    // sama ditagih berbeda tergantung pembulatan hari itu.
    const jarak = [0, 0.5, 4.999, 5, 5.001, 9.999, 10, 10.001, 15, 15.001, 20, 20.001, 50, 300];
    for (const km of jarak) {
      const [{ j }] = await querySql<{ j: string }>(
        "select public.jenjang_dari_jarak($1)::text as j",
        [km],
      );
      expect(j, `jarak ${km} km`).toBe(jenjangDariJarak(km));
    }
  });

  it("NULL tetap NULL — koordinat yang tidak lengkap bukan jarak nol", async () => {
    // Kalau NULL jatuh menjadi '0_5', sesi yang koordinatnya belum diketahui
    // akan tercatat sebagai jenjang termurah — dan owner membayarkan transport
    // yang salah tanpa satu pun tanda.
    const [{ j }] = await querySql<{ j: string | null }>(
      "select public.jenjang_dari_jarak(null)::text as j",
    );
    expect(j).toBeNull();
  });
});
