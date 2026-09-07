import Link from "next/link";
import { bangunQuery, jumlahHalaman, type ParamDaftar } from "./daftar";

/**
 * Sebelumnya / Berikutnya, bukan deretan nomor halaman.
 *
 * Nomor halaman berguna ketika orang mengingat "data itu ada di halaman 7".
 * Di panel ini urutan daftar berubah setiap hari, jadi yang diingat orang
 * adalah NAMANYA — dan untuk itu pencarian lebih cepat daripada nomor mana pun.
 */
export function Paginasi({
  basis,
  param,
  total,
}: {
  basis: string;
  param: ParamDaftar;
  total: number;
}) {
  const halaman = jumlahHalaman(total);
  if (halaman <= 1) return null;

  const hal = Math.min(param.hal, halaman);

  return (
    <nav aria-label="Navigasi halaman" className="mt-4 flex items-center gap-3">
      {hal > 1 && (
        <Link
          href={`${basis}${bangunQuery(param, { hal: hal - 1 })}`}
          className="rounded-lg border border-panel-border px-3 py-1.5 text-[12px] font-bold text-panel-ink"
        >
          ‹ Sebelumnya
        </Link>
      )}
      <span className="text-[12px] text-panel-muted">
        Halaman {hal} dari {halaman}
      </span>
      {hal < halaman && (
        <Link
          href={`${basis}${bangunQuery(param, { hal: hal + 1 })}`}
          className="rounded-lg border border-panel-border px-3 py-1.5 text-[12px] font-bold text-panel-ink"
        >
          Berikutnya ›
        </Link>
      )}
    </nav>
  );
}
