import Link from "next/link";
import type { ReactNode } from "react";
import { bangunQuery, type ParamDaftar } from "./daftar";

export type PilihanSaring = {
  nilai: string;
  label: string;
  /** Mewarnai chip clay — untuk saringan yang menunjuk PEKERJAAN, bukan kabar. */
  menuntut?: boolean;
};

export type KelompokSaring = {
  nama: string;
  label: string;
  pilihan: readonly PilihanSaring[];
  /**
   * Nilai yang dianggap aktif ketika `param.saring[nama]` TIDAK ADA di URL —
   * untuk saringan yang server-nya sendiri sudah menjatuhkan bawaan diam-diam
   * (mis. tab Permintaan menyaring ke "menunggu" walau `?status` kosong).
   * HANYA memengaruhi chip mana yang menyala di sini; TIDAK pernah dioper ke
   * `bangunQuery` atau ke medan tersembunyi formulir cari di atas — kalau
   * ikut ke sana, setiap tautan yang dibangun ulang mulai membawa
   * `status=menunggu` secara eksplisit padahal keadaan bawaan seharusnya
   * tidak tampil sama sekali di URL.
   */
  bawaan?: string;
};

/**
 * Bilah di atas setiap daftar panel: cari, saring, jumlah, tombol baru.
 *
 * Tidak ada satu baris JavaScript klien di sini, dan itu disengaja. Kotak cari
 * adalah `<form method="get">` biasa; chip saringan adalah `<Link>` biasa.
 * Akibatnya bilah ini bekerja sebelum hidrasi selesai, dan — yang menentukan
 * bagi proyek ini — SELURUH perilakunya bisa diuji dengan
 * `renderToStaticMarkup`, satu-satunya perkakas render yang dimiliki suite
 * yang berjalan tanpa jsdom.
 */
export function BilahDaftar({
  basis,
  param,
  kelompok,
  jumlah,
  total,
  aksi,
}: {
  /** Path halaman tanpa query, mis. "/admin/mitra". */
  basis: string;
  param: ParamDaftar;
  kelompok: readonly KelompokSaring[];
  /** Baris yang tampil di halaman ini. */
  jumlah: number;
  /** Baris yang cocok dengan saringan, seluruh halaman. */
  total: number;
  aksi: ReactNode;
}) {
  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-2">
        {/* Saringan aktif dibawa sebagai input tersembunyi: tanpa ini, mencari
            sesuatu akan diam-diam melepas saringan yang sedang menyala, dan
            hasilnya terbaca sebagai "pencariannya salah". `hal` sengaja TIDAK
            dibawa — pencarian baru selalu mulai dari halaman pertama. */}
        <form method="get" action={basis} className="flex min-w-[12rem] flex-1 items-center">
          {Object.entries(param.saring).map(([nama, nilai]) => (
            <input key={nama} type="hidden" name={nama} value={nilai} />
          ))}
          {/* Lengket ikut dibawa bersama saringan. Tanpa baris ini, mencari
              sesuatu dari tab Sesi mengirim form tanpa `tab`, dan admin
              mendarat di tab bawaan dengan kata cari yang benar — kegagalan
              yang terbaca sebagai "pencariannya yang salah". */}
          {Object.entries(param.lengket ?? {}).map(([nama, nilai]) => (
            <input key={nama} type="hidden" name={nama} value={nilai} />
          ))}
          <input
            type="search"
            name="cari"
            defaultValue={param.cari}
            placeholder="Cari…"
            aria-label="Cari di daftar ini"
            className="h-9 w-full rounded-lg border border-panel-border bg-panel-surface px-3 text-[13px] text-panel-ink"
          />
        </form>

        {kelompok.map((k) =>
          k.pilihan.map((p) => {
            const menyala = (param.saring[k.nama] ?? k.bawaan) === p.nilai;
            // Chip yang menyala menaut untuk MELEPAS dirinya. Chip yang hanya
            // bisa dipasang adalah saringan yang tidak bisa dibatalkan tanpa
            // mengetik ulang URL.
            const href = `${basis}${bangunQuery(param, { [k.nama]: menyala ? null : p.nilai })}`;
            return (
              <Link
                key={`${k.nama}:${p.nilai}`}
                href={href}
                aria-current={menyala ? "true" : undefined}
                className={`rounded-full border px-3 py-1.5 text-[12px] font-bold ${
                  menyala
                    ? "border-panel-ink bg-panel-ink text-panel-surface"
                    : `border-panel-border bg-panel-surface ${p.menuntut ? "text-clay" : "text-panel-muted"}`
                }`}
              >
                {p.label}
              </Link>
            );
          }),
        )}

        <span className="ml-auto">{aksi}</span>
      </div>

      {/* Dua angka, selalu. "40 mitra" pada halaman berisi 25 baris membuat
          admin mengira ada yang hilang; "25 dari 40" tidak pernah begitu. */}
      <p className="mt-2 text-[12px] text-panel-muted">
        Menampilkan {jumlah} dari {total}
      </p>
    </div>
  );
}
