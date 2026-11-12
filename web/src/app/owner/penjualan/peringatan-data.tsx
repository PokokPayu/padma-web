const GAYA =
  "mb-3 rounded-lg border border-clay/35 bg-panel-bg px-3.5 py-3 text-[11.5px] text-clay";

/**
 * Peringatan bahwa angka di halaman penjualan tidak lengkap.
 *
 * Bulan kosong + `tanpaNilai > 0` berarti DATA TIDAK TERBACA, bukan "tidak ada
 * penjualan"; keduanya tampak identik di layar tanpa banner ini.
 * Tidak merender apa pun bila ketiganya bersih.
 */
export function PeringatanData({
  terpotong,
  tanpaTanggal,
  tanpaNilai,
}: {
  terpotong: boolean;
  tanpaTanggal: number;
  tanpaNilai: number;
}) {
  return (
    <>
      {terpotong && (
        <p data-peringatan="terpotong" className={GAYA}>
          Sebagian baris terpotong oleh batas kueri — angka di halaman ini belum lengkap.
        </p>
      )}

      {tanpaTanggal > 0 && (
        <p data-peringatan="tanpa-tanggal" className={GAYA}>
          {`${tanpaTanggal} pesanan tidak punya tanggal uang masuk dan tidak masuk bulan mana pun. Periksa di /admin/pesanan.`}
        </p>
      )}

      {tanpaNilai > 0 && (
        <p data-peringatan="tanpa-nilai" className={GAYA}>
          {`${tanpaNilai} pesanan tidak terbaca rincian itemnya, sehingga nilainya tidak ada di angka mana pun di halaman ini. Mungkin ini masalah hak akses, bukan penjualan yang hilang.`}
        </p>
      )}
    </>
  );
}
