import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { ambilVarianTarif } from "@/lib/owner/daftar-tarif";
import type { TarifRiwayat } from "@/lib/owner/data";
import { formatRupiah } from "@/lib/owner/rupiah";
import { formatTanggalID, hariIniJakarta } from "@/lib/passport/waktu";
import { FormTarif } from "../form-tarif";

// Judul mengandalkan template `%s · PADMA` di root layout. Sengaja STATIS:
// judul dinamis menuntut `generateMetadata` yang akan membaca rate card untuk
// KEDUA kalinya per kunjungan — dan `ambilRateCard()` membaca seluruh riwayat
// tarif klinik sekali jalan.
export const metadata = { title: "Tarif varian" };

/**
 * Satu baris riwayat tarif.
 *
 * Terender penuh, tidak terlipat: riwayat adalah bukti berapa honor yang
 * seharusnya dibayarkan pada pekan-pekan yang sudah lewat, dan halaman ini
 * ADALAH tempatnya — berbeda dari daftar rate card, tempat ia dulu terlipat di
 * balik `<details>` karena tidak muat.
 */
function BarisRiwayat({ tarif }: { tarif: TarifRiwayat }) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-panel-border py-2 last:border-b-0">
      <span className="font-mono text-[12px] text-panel-muted">
        {formatTanggalID(tarif.berlakuSejak)}
        {tarif.berlakuSekarang && (
          <b className="ml-2 rounded-full bg-leaf-soft px-2 py-0.5 text-[10.5px] font-extrabold text-leaf">
            berlaku sekarang
          </b>
        )}
        {tarif.belumBerlaku && (
          <b className="ml-2 rounded-full border border-panel-border px-2 py-0.5 text-[10.5px] font-extrabold text-panel-muted">
            belum berlaku
          </b>
        )}
      </span>
      <span className="text-[12.5px] text-panel-ink">
        Harga {formatRupiah(tarif.hargaKlien)} · Honor {formatRupiah(tarif.honorMitra)} ·{" "}
        <span className="text-leaf">Margin {formatRupiah(tarif.margin)}</span>
      </span>
    </li>
  );
}

export default async function TarifVarianPage({
  params,
}: {
  params: Promise<{ variantId: string }>;
}) {
  await requireRole(["owner"]);

  const { variantId } = await params;
  const hariIni = hariIniJakarta();
  const varian = await ambilVarianTarif(variantId, hariIni);
  // `notFound()`, bukan halaman kosong: id yang salah ketik yang dijawab
  // "belum ada tarif" akan mengundang owner menetapkan tarif ke varian yang
  // tidak ada, dan penolakannya baru datang dari basis data sebagai kode.
  if (varian === null) notFound();

  const nama = varian.labelVarian === "" ? varian.namaLayanan : varian.labelVarian;
  const t = varian.berlaku;

  return (
    <main>
      <header className="mb-4">
        <Link href="/owner/tarif" className="text-[12px] font-bold text-panel-muted">
          ‹ Rate Card
        </Link>
        <h1 className="mt-1 text-[18px] font-bold text-panel-ink">{nama}</h1>
        <p className="mt-0.5 text-[12px] text-panel-muted">
          {varian.namaFase}
          {varian.labelVarian !== "" && ` · ${varian.namaLayanan}`}
          {!varian.aktif && " · tidak ditawarkan lagi"}
        </p>
      </header>

      <section className="mb-5 rounded-lg border border-panel-border bg-panel-surface p-4">
        <h2 className="mb-2 text-[13px] font-bold text-panel-ink">
          Berlaku {formatTanggalID(hariIni)}
        </h2>
        {t === null ? (
          <p className="text-[13px] text-clay">
            Belum bertarif — sesi yang sudah selesai pada varian ini muncul di rekap sebagai{" "}
            <b>tak bertarif</b>, dan honornya belum ikut dihitung di angka mana pun.
          </p>
        ) : (
          <p className="font-mono text-[13.5px] text-panel-ink">
            Harga {formatRupiah(t.hargaKlien)} · Honor {formatRupiah(t.honorMitra)} ·{" "}
            <span className="text-leaf">Margin {formatRupiah(t.margin)}</span> · sejak{" "}
            {formatTanggalID(t.berlakuSejak)}
          </p>
        )}
      </section>

      <section className="mb-5 rounded-lg border border-panel-border bg-panel-surface p-4">
        <h2 className="mb-3 text-[13px] font-bold text-panel-ink">Tetapkan tarif baru</h2>
        <FormTarif
          variantId={varian.variantId}
          namaLayanan={nama}
          hariIni={hariIni}
          hargaSekarang={t?.hargaKlien ?? null}
          honorSekarang={t?.honorMitra ?? null}
          hargaCoretSekarang={t?.hargaCoret ?? null}
        />
      </section>

      <section className="rounded-lg border border-panel-border bg-panel-surface p-4">
        <h2 className="mb-1 text-[13px] font-bold text-panel-ink">
          Riwayat tarif ({varian.riwayat.length})
        </h2>
        {/* Ketiadaan tombol hapus bukan kelalaian, dan alasannya ditulis di
            layar supaya tidak ada yang menambahkannya sebagai "kenyamanan
            kecil": hak DELETE atas `variant_rates` sudah dicabut, bahkan untuk
            pemilik. Baris lama adalah satu-satunya bukti berapa honor yang
            seharusnya dibayarkan pada pekan-pekan yang sudah lewat. */}
        <p className="mb-3 text-[12px] leading-relaxed text-panel-muted">
          Tarif lama tidak bisa dihapus maupun disunting — basis data menolaknya, bahkan untuk
          pemilik. Salah ketik diperbaiki dengan menetapkan tarif baru.
        </p>
        {varian.riwayat.length === 0 ? (
          <p className="text-[13px] italic text-panel-muted">Belum pernah ditetapkan.</p>
        ) : (
          <ul>
            {varian.riwayat.map((r) => (
              <BarisRiwayat key={r.id} tarif={r} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
