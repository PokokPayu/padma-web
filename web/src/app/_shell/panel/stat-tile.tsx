import Link from "next/link";

/**
 * Satu angka besar berlabel.
 *
 * `href` opsional di sini, tetapi pemanggil di panel admin WAJIB mengisinya:
 * setiap angka antrean punya modul yang bisa memadamkannya, dan angka tanpa
 * tujuan adalah alarm yang tidak bisa dibersihkan. Angka owner (nominal pekan
 * berjalan) memang bukan antrean dan boleh tanpa tujuan.
 *
 * `menuntut` mewarnai angkanya clay. Sengaja bukan otomatis dari `nilai > 0`:
 * "3 sesi selesai" adalah kabar baik, "3 klaim menunggu" adalah pekerjaan, dan
 * hanya pemanggil yang tahu bedanya. Bila semua angka merah, tidak ada yang
 * berarti merah.
 */
export function StatTile({
  label,
  nilai,
  keterangan,
  href,
  menuntut = false,
}: {
  label: string;
  nilai: string;
  keterangan: string;
  href?: string;
  menuntut?: boolean;
}) {
  const isi = (
    <>
      <small className="mb-2 block text-[11px] font-extrabold uppercase tracking-[0.06em] text-panel-muted">
        {label}
      </small>
      <span
        className={`block text-[26px] font-bold leading-none tabular-nums ${
          menuntut ? "text-clay" : "text-panel-ink"
        }`}
      >
        {nilai}
      </span>
      <span className="mt-1.5 block text-[12px] text-panel-muted">
        {keterangan}
      </span>
    </>
  );

  const kelas =
    "block rounded-lg border border-panel-border bg-panel-surface px-4 py-4";

  if (!href) return <div className={kelas}>{isi}</div>;
  return (
    <Link href={href} className={`${kelas} transition hover:border-leaf/50`}>
      {isi}
    </Link>
  );
}
