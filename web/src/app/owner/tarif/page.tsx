import { requireRole } from "@/lib/auth/require-role";
import { ambilRateCard, type BarisRateCard, type TarifRiwayat } from "@/lib/owner/data";
import { formatRupiah } from "@/lib/owner/rupiah";
import { formatTanggalID, hariIniJakarta } from "@/lib/passport/waktu";
import { FormTarif } from "./form-tarif";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: "Rate Card" };

const KELAS_TH = "p-4 text-left font-extrabold";

/**
 * Satu baris riwayat tarif.
 *
 * Riwayat sengaja dirender di dalam `<details>` HTML biasa, bukan disembunyikan
 * di balik state React: `<details>` tetap tercetak utuh ke markup dan tetap
 * bisa dibuka tanpa satu baris JavaScript pun. Riwayat tarif adalah bukti
 * berapa honor yang seharusnya dibayarkan pada pekan-pekan yang sudah lewat —
 * bukti yang hanya muncul setelah hidrasi berhasil adalah bukti yang bisa
 * hilang tanpa ada yang tahu.
 */
function BarisRiwayat({ tarif }: { tarif: TarifRiwayat }) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-black/5 py-2 last:border-b-0">
      <span className="font-mono text-[12px] text-ink-soft">
        {formatTanggalID(tarif.berlakuSejak)}
        {tarif.berlakuSekarang && (
          <b className="ml-2 rounded-full bg-leaf-soft px-2 py-0.5 text-[10.5px] font-extrabold text-leaf">
            berlaku sekarang
          </b>
        )}
        {tarif.belumBerlaku && (
          <b className="ml-2 rounded-full bg-gold/20 px-2 py-0.5 text-[10.5px] font-extrabold text-night">
            belum berlaku
          </b>
        )}
      </span>
      <span className="text-[12.5px] text-ink">
        Harga {formatRupiah(tarif.hargaKlien)} · Honor {formatRupiah(tarif.honorMitra)} ·{" "}
        <span className="text-leaf">Margin {formatRupiah(tarif.margin)}</span>
      </span>
    </li>
  );
}

function BarisLayanan({ baris, hariIni }: { baris: BarisRateCard; hariIni: string }) {
  const t = baris.berlaku;
  return (
    <>
      <tr className="border-b border-black/5 align-top">
        <td className="p-4">
          <b className="text-[14px] text-night">{baris.namaLayanan}</b>
          <span className="mt-0.5 block text-[11.5px] uppercase tracking-wider text-ink-soft">
            {baris.namaFase}
            {!baris.aktif && " · tidak ditawarkan lagi"}
          </span>
        </td>
        <td className="p-4 font-mono text-[13.5px] text-night">
          {t ? formatRupiah(t.hargaKlien) : "—"}
        </td>
        <td className="p-4 font-mono text-[13.5px] text-night">
          {t ? formatRupiah(t.honorMitra) : "—"}
        </td>
        {/* Margin adalah angka PADMA. Ia DIHITUNG, tidak pernah disimpan:
            kolom nominal turunan di basis data akan hidup di dalam
            sebuah VIEW milik postgres yang berjalan dengan hak pemilik dan
            karenanya MELEWATI RLS. */}
        <td className="p-4 font-mono text-[13.5px] text-leaf">
          {t ? formatRupiah(t.margin) : "—"}
        </td>
        <td className="p-4 text-[12.5px] text-ink-soft">
          {t ? (
            formatTanggalID(t.berlakuSejak)
          ) : (
            <span className="text-clay">
              Belum bertarif — sesinya tidak bisa dihitung honornya.
            </span>
          )}
        </td>
        <td className="p-4">
          <FormTarif
            serviceId={baris.serviceId}
            namaLayanan={baris.namaLayanan}
            hariIni={hariIni}
            hargaSekarang={t?.hargaKlien ?? null}
            honorSekarang={t?.honorMitra ?? null}
          />
        </td>
      </tr>
      {baris.riwayat.length > 0 && (
        <tr className="border-b-[1.5px] border-black/10">
          <td colSpan={6} className="px-4 pb-4">
            <details>
              <summary className="cursor-pointer text-[12px] font-bold text-ink-soft">
                Riwayat tarif {baris.namaLayanan} ({baris.riwayat.length})
              </summary>
              <ul className="mt-2 rounded-xl border border-black/10 bg-paper px-3.5 py-1">
                {baris.riwayat.map((r) => (
                  <BarisRiwayat key={r.id} tarif={r} />
                ))}
              </ul>
            </details>
          </td>
        </tr>
      )}
    </>
  );
}

export default async function TarifPage() {
  await requireRole(["owner"]);

  // "Hari ini" menurut Jakarta, bukan menurut jam server (Vercel berjalan UTC).
  // Diteruskan sebagai argumen: lapisan data sengaja tidak membaca jam sistem
  // sendiri supaya "tarif mana yang berlaku" bisa diuji pada tanggal mana pun.
  const hariIni = hariIniJakarta();
  const kartu = await ambilRateCard(hariIni);
  const belumBertarif = kartu.filter((b) => b.berlaku === null && b.aktif);

  return (
    <main>
      <header className="mb-5">
        <h1 className="font-serif text-2xl text-night">Rate Card</h1>
        <p className="mt-1 max-w-2xl text-[13px] text-ink-soft">
          Harga ke klien &amp; honor mitra per sesi, berlaku {formatTanggalID(hariIni)}.
          Angka ini hidup hanya di panel ini — tidak satu pun layar lain di PADMA
          pernah menampilkannya.
        </p>
      </header>

      <p className="mb-4 rounded-2xl border-[1.5px] border-dashed border-gold bg-[#FDFAF1] p-4 text-[13px] leading-relaxed text-ink">
        ✦ Tarif tidak pernah ditimpa, hanya <b>ditambah</b>. Setiap penetapan
        melahirkan satu baris baru bertanggal berlaku, dan rekap honor memakai
        tarif yang berlaku <b>pada tanggal sesi</b> — jadi menaikkan tarif hari
        ini tidak menggeser satu angka pun di pekan yang sudah lewat, termasuk
        pekan yang honornya sudah dibayarkan. Tanggal berlaku juga tidak bisa
        dimundurkan, karena mundur berarti mengubah masa lalu.
      </p>

      {belumBertarif.length > 0 && (
        <p className="mb-4 rounded-2xl border border-clay/35 bg-white px-5 py-4 text-[12.5px] leading-relaxed text-ink">
          <b className="text-clay">
            {belumBertarif.length} layanan aktif belum punya tarif.
          </b>{" "}
          Sesi yang sudah selesai pada layanan itu muncul di rekap sebagai{" "}
          <b>tak bertarif</b> dan honornya belum ikut dihitung di angka mana pun.
        </p>
      )}

      <div className="overflow-hidden rounded-2xl border border-black/10 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-[13.5px]">
            <thead>
              <tr className="border-b-[1.5px] border-black/10 bg-paper text-[11px] uppercase tracking-wider text-ink-soft">
                <th className={KELAS_TH}>Layanan</th>
                <th className={KELAS_TH}>Harga klien</th>
                <th className={KELAS_TH}>Honor mitra</th>
                <th className={KELAS_TH}>Margin</th>
                <th className={KELAS_TH}>Berlaku sejak</th>
                <th className={KELAS_TH}>Tetapkan</th>
              </tr>
            </thead>
            <tbody>
              {kartu.map((b) => (
                <BarisLayanan key={b.serviceId} baris={b} hariIni={hariIni} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Ketiadaan tombol hapus bukan kelalaian, dan alasannya ditulis di layar
          supaya tidak ada yang menambahkannya sebagai "kenyamanan kecil". */}
      <p className="mt-3 text-[12px] leading-relaxed text-ink-soft">
        Tarif lama tidak bisa dihapus maupun disunting — basis data menolaknya,
        bahkan untuk pemilik. Itu disengaja: baris lama adalah satu-satunya bukti
        berapa honor yang seharusnya dibayarkan pada pekan-pekan yang sudah
        lewat. Salah ketik diperbaiki dengan menetapkan tarif baru.
      </p>
    </main>
  );
}
