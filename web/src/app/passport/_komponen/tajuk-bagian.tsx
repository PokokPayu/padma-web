/**
 * Tajuk satu bagian beranda: nama serif, garis rambut emas yang menghabiskan
 * sisa baris, dan — kalau ada — satu keterangan pendek di kanan.
 *
 * Bentuknya SENGAJA sama dengan tajuk fase di katalog pemesanan dan di lini
 * layanan landing. Beranda sebelumnya membungkus tiap bagian dalam kartu putih
 * beradius sama, sehingga "Perjalanan Anda", "Pencapaian", dan daftar jadwal
 * terlihat setara padahal kepentingannya jauh berbeda; yang membedakan bagian
 * seharusnya tajuknya, bukan kotak di sekelilingnya.
 */
export function TajukBagian({
  judul,
  keterangan,
}: {
  judul: string;
  keterangan?: string;
}) {
  return (
    <div className="mb-3 flex items-baseline gap-2.5">
      <h2 className="font-serif text-[17px] leading-none text-night">{judul}</h2>
      <span aria-hidden className="h-px flex-1 bg-gold/35" />
      {keterangan && <span className="text-[12px] text-ink-soft">{keterangan}</span>}
    </div>
  );
}
