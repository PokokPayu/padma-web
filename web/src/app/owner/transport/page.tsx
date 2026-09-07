import { requireRole } from "@/lib/auth/require-role";
import {
  ambilTarifTransport,
  ambilSesiMenungguTarif,
  type BarisTarifTransport,
} from "@/lib/owner/data";
import { formatRupiah } from "@/lib/owner/rupiah";
import { formatTanggalID, hariIniJakarta } from "@/lib/passport/waktu";
import { JENJANG_TARIF_RATE_CARD, LABEL_JENJANG } from "./status";
import { FormTarifTransport, FormTarifKhusus } from "./form-tarif-transport";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: "Transport" };

const KELAS_TH = "p-4 text-left font-extrabold";

export default async function TransportPage() {
  await requireRole(["owner"]);

  // "Hari ini" menurut Jakarta, bukan menurut jam server (Vercel berjalan
  // UTC). Diteruskan sebagai argumen: `ambilTarifTransport` sengaja tidak
  // membaca jam sistem sendiri, sama seperti `ambilRateCard`.
  const hariIni = hariIniJakarta();
  const [tarif, menunggu] = await Promise.all([
    ambilTarifTransport(hariIni),
    ambilSesiMenungguTarif(),
  ]);

  const cariTarif = (jenjang: (typeof JENJANG_TARIF_RATE_CARD)[number]): BarisTarifTransport | null =>
    tarif.find((t) => t.jenjang === jenjang) ?? null;

  return (
    <main>
      <header className="mb-5">
        <h1 className="font-serif text-2xl text-night">Transport</h1>
        <p className="mt-1 max-w-2xl text-[13px] text-ink-soft">
          Tarif transport ke klien &amp; honor mitra per jenjang jarak, berlaku{" "}
          {formatTanggalID(hariIni)}, ditambah tarif khusus untuk sesi yang
          jaraknya di atas 20 km.
        </p>
      </header>

      <p className="mb-4 rounded-2xl border-[1.5px] border-dashed border-gold bg-[#FDFAF1] p-4 text-[13px] leading-relaxed text-ink">
        ✦ Sama seperti Rate Card layanan: tarif transport tidak pernah ditimpa,
        hanya <b>ditambah</b>. Jenjang <b>di atas 20 km</b> sengaja tidak
        muncul di tabel ini — nominalnya bukan tarif rate card, melainkan
        konfirmasi PER SESI yang ditetapkan di bagian bawah halaman ini.
      </p>

      <div className="overflow-hidden rounded-2xl border border-black/10 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-[13.5px]">
            <thead>
              <tr className="border-b-[1.5px] border-black/10 bg-paper text-[11px] uppercase tracking-wider text-ink-soft">
                <th className={KELAS_TH}>Jenjang jarak</th>
                <th className={KELAS_TH}>Tarif klien</th>
                <th className={KELAS_TH}>Honor mitra</th>
                <th className={KELAS_TH}>Subsidi PADMA</th>
                <th className={KELAS_TH}>Berlaku sejak</th>
                <th className={KELAS_TH}>Tetapkan</th>
              </tr>
            </thead>
            <tbody>
              {JENJANG_TARIF_RATE_CARD.map((jenjang) => {
                const b = cariTarif(jenjang);
                return (
                  <tr key={jenjang} className="border-b border-black/5 align-top">
                    <td className="p-4">
                      <b className="text-[14px] text-night">{LABEL_JENJANG[jenjang]}</b>
                    </td>
                    <td className="p-4 font-mono text-[13.5px] text-night">
                      {b ? formatRupiah(b.tarifKlien) : "—"}
                    </td>
                    <td className="p-4 font-mono text-[13.5px] text-night">
                      {b ? formatRupiah(b.honorMitra) : "—"}
                    </td>
                    {/* Subsidi DIHITUNG, tidak pernah disimpan sebagai kolom —
                        lihat komentar `BarisTarifTransport` di lib/owner/data.ts. */}
                    <td className="p-4 font-mono text-[13.5px] text-leaf">
                      {b ? formatRupiah(b.subsidi) : "—"}
                    </td>
                    <td className="p-4 text-[12.5px] text-ink-soft">
                      {b ? (
                        formatTanggalID(b.berlakuSejak)
                      ) : (
                        <span className="text-clay">Belum bertarif.</span>
                      )}
                    </td>
                    <td className="p-4">
                      <FormTarifTransport
                        jenjang={jenjang}
                        labelJenjang={LABEL_JENJANG[jenjang]}
                        hariIni={hariIni}
                        tarifSekarang={b?.tarifKlien ?? null}
                        honorSekarang={b?.honorMitra ?? null}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-3 text-[12px] leading-relaxed text-ink-soft">
        Tarif lama tidak bisa dihapus maupun disunting — basis data
        menolaknya, bahkan untuk pemilik. Baris lama adalah bukti berapa
        honor yang seharusnya dibayarkan pada sesi-sesi yang sudah lewat.
      </p>

      <section aria-label="Sesi menunggu tarif khusus" className="mt-8">
        <h2 className="font-serif text-xl text-night">
          Sesi &gt;20 km menunggu tarif khusus
        </h2>
        <p className="mt-1 max-w-2xl text-[13px] text-ink-soft">
          Materi klien menulis &quot;&gt;20 km: konfirmasi admin&quot; — bukan
          tarif, melainkan ketiadaan tarif. Setiap sesi di bawah ini butuh
          nominal yang Anda tetapkan SENDIRI, per kasus.
        </p>

        {menunggu.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-black/10 bg-white p-4 text-[13px] text-ink-soft">
            Tidak ada sesi &gt;20 km yang menunggu tarif khusus.
          </p>
        ) : (
          <ul className="mt-3 grid gap-3">
            {menunggu.map((s) => (
              <li
                key={s.id}
                className="rounded-2xl border border-black/10 bg-white p-4"
              >
                <p className="mb-2 text-[13px] text-night">
                  <b>{s.namaKlien}</b> · {formatTanggalID(s.tanggal)}
                </p>
                <FormTarifKhusus sessionId={s.id} namaKlien={s.namaKlien} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
