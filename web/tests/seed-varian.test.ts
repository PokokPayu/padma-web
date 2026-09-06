import { describe, it, expect } from "vitest";
import { querySql } from "./helpers/db";

/**
 * Data pengembangan harus memuat KEDUA dimensi varian.
 *
 * Tanpa contoh bertingkat di seed, bug tampilan varian tidak punya satu pun
 * baris untuk memunculkan dirinya di lokal — dan baru ketahuan di produksi.
 */
describe("seed — contoh varian bertingkat", () => {
  // `and aktif = true` di kedua uji berikut BUKAN dari brief aslinya — brief
  // mengujinya tanpa filter ini dan gagal MERAH secara SALAH: varian baku
  // pensiun lewat `aktif = false`, bukan dihapus (aturan proyek), jadi
  // baris baku (durasi & format NULL) tetap ada di tabel selamanya dan ikut
  // cocok dengan `format is null` maupun tanpa filter apa pun, mendorong
  // [null, 60, 90, 120] alih-alih [60, 90, 120]. Produksi (`bacaKatalog` di
  // `src/lib/katalog.ts`) selalu memfilter `aktif = true` untuk alasan yang
  // sama — varian nonaktif tidak boleh muncul di landing — jadi filter ini
  // di sini menirukan query nyata, bukan melonggarkan asersi.
  it("ada layanan dengan tiga varian durasi tanpa format", async () => {
    const baris = await querySql<{ durasi_menit: number }>(
      `select durasi_menit from public.service_variants
        where service_id = '11111111-1111-1111-1111-111111111107'
          and format is null
          and aktif = true
        order by urutan`,
    );
    expect(baris.map((b) => b.durasi_menit)).toEqual([60, 90, 120]);
  });

  it("ada layanan dengan varian Private & Circle", async () => {
    const baris = await querySql<{ format: string }>(
      `select format from public.service_variants
        where service_id = '11111111-1111-1111-1111-111111111109'
          and aktif = true
        order by urutan`,
    );
    expect(baris.map((b) => b.format)).toEqual(["private", "circle"]);
  });

  it("kedua cabang harga coret ada di data pengembangan", async () => {
    const [row] = await querySql<{ dengan: string; tanpa: string }>(
      `select count(*) filter (where harga_coret is not null) as dengan,
              count(*) filter (where harga_coret is null)     as tanpa
         from public.variant_rates`,
    );
    expect(Number(row.dengan)).toBeGreaterThan(0);
    expect(Number(row.tanpa)).toBeGreaterThan(0);
  });
});
