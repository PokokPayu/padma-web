import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { ambilPenilaianTerbaru } from "@/lib/admin/penilaian";
import { Bantuan } from "@/app/_shell/panel/bantuan";

export const metadata = { title: "Penilaian" };

/**
 * PENILAIAN — LAYAR ADMIN (spec C1 J10).
 *
 * Dua angka ditampilkan TERPISAH, tidak pernah dirata-ratakan menjadi satu.
 * Sesi yang layanannya bagus tetapi bidannya bermasalah punya rata-rata yang
 * tampak wajar; menampilkannya sebagai satu angka menyembunyikan persis kasus
 * yang perlu dibaca manusia.
 *
 * Komentar dirender sebagai TEKS BIASA. Ia tulisan klien — tak tepercaya — dan
 * bisa memuat keterangan kesehatan.
 */
export default async function HalamanPenilaian({
  searchParams,
}: {
  searchParams: Promise<{ rendah?: string }>;
}) {
  await requireRole(["admin", "owner"]);

  const sp = await searchParams;
  const rendah = sp.rendah === "ya";
  const baris = await ambilPenilaianTerbaru({ rendah });

  return (
    <main>
      <header className="mb-4">
        <h1 className="text-[18px] font-bold text-panel-ink">Penilaian</h1>
        <Bantuan judul="Tentang halaman ini">
          Dua angka, sengaja tidak digabung: <b>sesi</b> dan <b>bidan</b> dinilai terpisah supaya
          layanan yang salah rancang tidak terbaca sebagai bidan yang buruk. Penilaian ini alat
          pembinaan — ia tidak memengaruhi honor dan tidak dipakai memilih bidan.
        </Bantuan>
      </header>

      <div className="mb-4 flex gap-2">
        <Link
          href="/admin/penilaian"
          aria-current={!rendah ? "page" : undefined}
          className={`rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold ${
            !rendah ? "border-panel-ink bg-panel-surface text-panel-ink" : "border-panel-border text-panel-muted"
          }`}
        >
          Semua
        </Link>
        <Link
          href="/admin/penilaian?rendah=ya"
          aria-current={rendah ? "page" : undefined}
          className={`rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold ${
            rendah ? "border-clay bg-clay/10 text-clay" : "border-panel-border text-panel-muted"
          }`}
        >
          Bintang ≤ 3
        </Link>
      </div>

      {baris.length === 0 ? (
        <p className="rounded-lg border border-panel-border bg-panel-surface p-8 text-center text-[13px] italic text-panel-muted">
          {rendah ? "Tidak ada penilaian rendah." : "Belum ada penilaian."}
        </p>
      ) : (
        <ul>
          {baris.map((b) => (
            <li
              key={b.id}
              data-penilaian={b.id}
              className="mb-2 rounded-lg border border-panel-border bg-panel-surface p-3.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <b className="text-[13.5px] text-panel-ink">
                  {b.namaKlien} · {b.namaLayanan}
                </b>
                <span className="text-[12.5px] text-panel-muted">{b.tanggal}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-4 text-[12.5px]">
                <span data-bintang="layanan">
                  Sesi: <b className="text-panel-ink">{b.bintangLayanan}/5</b>
                </span>
                <span data-bintang="bidan">
                  {b.namaMitra}: <b className="text-panel-ink">{b.bintangBidan}/5</b>
                </span>
              </div>
              {b.komentar && (
                <p className="mt-2 border-l-2 border-panel-border pl-3 text-[12.5px] text-panel-muted">
                  {b.komentar}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
