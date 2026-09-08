import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import {
  ambilTarifTransport,
  ambilSesiMenungguTarif,
  type BarisTarifTransport,
} from "@/lib/owner/data";
import { formatRupiah } from "@/lib/owner/rupiah";
import { formatTanggalID, hariIniJakarta } from "@/lib/passport/waktu";
import { JENJANG_TARIF_RATE_CARD } from "./status";
import { LABEL_JENJANG } from "@/lib/transport/jarak";
import { FormTarifTransport, FormTarifKhusus } from "./form-tarif-transport";
import { uraikanParamDaftar, bangunQuery, hitungRentang, type ParamMentah } from "@/app/_shell/panel/daftar";
import { PanelGeser } from "@/app/_shell/panel/panel-geser";
import { Paginasi } from "@/app/_shell/panel/paginasi";
import { Bantuan } from "@/app/_shell/panel/bantuan";
import { Tabel, Th, Td } from "@/app/_shell/panel/tabel";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: "Transport" };

const BASIS = "/owner/transport";

export default async function TransportPage({
  searchParams,
}: {
  searchParams: Promise<ParamMentah>;
}) {
  await requireRole(["owner"]);

  const sp = await searchParams;
  // Tidak ada saringan di halaman ini: empat jenjang adalah tabel TETAP, dan
  // menyaring empat baris adalah bilah yang lebih besar daripada isinya.
  // `uraikanParamDaftar` tetap dipakai demi `hal` — dan demi satu tempat yang
  // sama untuk aturan "halaman minimal 1".
  const param = uraikanParamDaftar(sp, {});

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

  // Paginasi memotong daftar yang SUDAH terbaca seluruhnya oleh
  // `ambilSesiMenungguTarif()` — memperbaiki layar, bukan batas bacaan.
  // Fungsi itu sendiri sudah dipaginasi terhadap `max_rows` di lapisan
  // datanya; yang di sini murni tampilan.
  const { dari, sampai } = hitungRentang(param.hal);
  const halamanMenunggu = menunggu.slice(dari, sampai + 1);

  // DAFTAR PUTIH. `ubah` datang dari URL: panel yang terbuka atas nilai asing
  // merender formulir yang menunjuk jenjang atau sesi yang tidak ada, dan
  // penolakannya baru datang dari basis data sebagai kode Postgres.
  const ubah = typeof sp.ubah === "string" ? sp.ubah : "";
  const jenjangDibuka = JENJANG_TARIF_RATE_CARD.find((j) => j === ubah) ?? null;
  const sesiDibuka = ubah.startsWith("sesi-")
    ? (menunggu.find((s) => s.id === ubah.slice("sesi-".length)) ?? null)
    : null;
  const hrefTutup = `${BASIS}${bangunQuery(param, { ubah: null })}`;

  return (
    <main>
      <header className="mb-4">
        <h1 className="text-[18px] font-bold text-panel-ink">Transport</h1>
        <Bantuan judul="Tentang halaman ini">
          Tarif transport ke klien &amp; honor mitra per jenjang jarak, berlaku{" "}
          {formatTanggalID(hariIni)}. Sama seperti Rate Card layanan: tarif transport tidak pernah
          ditimpa, hanya <b>ditambah</b>, dan tarif lama tidak bisa dihapus maupun disunting —
          basis data menolaknya, bahkan untuk pemilik, karena baris lama adalah bukti berapa honor
          yang seharusnya dibayarkan pada sesi-sesi yang sudah lewat. Jenjang{" "}
          <b>di atas 20 km</b> sengaja tidak muncul di tabel: nominalnya bukan tarif rate card,
          melainkan konfirmasi PER SESI yang ditetapkan di bagian bawah halaman ini.
        </Bantuan>
      </header>

      <div className="rounded-lg border border-panel-border bg-panel-surface">
        <Tabel label="Rate card transport per jenjang jarak">
          <thead>
            <tr>
              <Th>Jenjang jarak</Th><Th>Tarif klien</Th><Th>Honor mitra</Th>
              <Th>Subsidi PADMA</Th><Th>Berlaku sejak</Th><Th>Tetapkan</Th>
            </tr>
          </thead>
          <tbody>
            {JENJANG_TARIF_RATE_CARD.map((jenjang) => {
              const b = cariTarif(jenjang);
              return (
                <tr key={jenjang}>
                  <Td><b className="text-panel-ink">{LABEL_JENJANG[jenjang]}</b></Td>
                  <Td className="font-mono text-[13px]">{b ? formatRupiah(b.tarifKlien) : "—"}</Td>
                  <Td className="font-mono text-[13px]">{b ? formatRupiah(b.honorMitra) : "—"}</Td>
                  {/* Subsidi DIHITUNG, tidak pernah disimpan sebagai kolom —
                      lihat komentar `BarisTarifTransport` di lib/owner/data.ts. */}
                  <Td className="font-mono text-[13px] text-leaf">
                    {b ? formatRupiah(b.subsidi) : "—"}
                  </Td>
                  <Td>
                    {b ? formatTanggalID(b.berlakuSejak) : <span className="text-clay">Belum bertarif</span>}
                  </Td>
                  <Td>
                    <Link
                      href={`${BASIS}${bangunQuery(param, { ubah: jenjang })}`}
                      className="font-bold text-panel-ink underline"
                    >
                      {b === null ? "Tetapkan tarif" : "Tarif baru"}
                    </Link>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Tabel>
      </div>

      <section aria-label="Sesi menunggu tarif khusus" className="mt-8">
        <h2 className="text-[15px] font-bold text-panel-ink">
          Sesi &gt;20 km menunggu tarif khusus
        </h2>
        <p className="mt-1 max-w-2xl text-[12.5px] text-panel-muted">
          Materi klien menulis &quot;&gt;20 km: konfirmasi admin&quot; — bukan tarif, melainkan
          ketiadaan tarif. Setiap sesi di bawah ini butuh nominal yang Anda tetapkan SENDIRI, per
          kasus.
        </p>
        <p className="mt-2 text-[12px] text-panel-muted">
          Menampilkan {halamanMenunggu.length} dari {menunggu.length}
        </p>

        {menunggu.length === 0 ? (
          <p className="mt-3 rounded-lg border border-panel-border bg-panel-surface p-4 text-[13px] italic text-panel-muted">
            Tidak ada sesi &gt;20 km yang menunggu tarif khusus.
          </p>
        ) : (
          <ul className="mt-3 grid gap-3">
            {halamanMenunggu.map((s) => (
              <li key={s.id} className="rounded-lg border border-panel-border bg-panel-surface p-4">
                <p className="text-[13px] text-panel-ink">
                  <b>{s.namaKlien}</b> · {formatTanggalID(s.tanggal)}
                </p>
                <Link
                  href={`${BASIS}${bangunQuery(param, { ubah: `sesi-${s.id}` })}`}
                  className="mt-1 inline-block text-[12.5px] font-bold text-panel-ink underline"
                >
                  Tetapkan tarif khusus
                </Link>
              </li>
            ))}
          </ul>
        )}

        <Paginasi basis={BASIS} param={param} total={menunggu.length} />
      </section>

      {jenjangDibuka !== null && (
        <PanelGeser judul={`Tarif ${LABEL_JENJANG[jenjangDibuka]}`} hrefTutup={hrefTutup}>
          <FormTarifTransport
            jenjang={jenjangDibuka}
            labelJenjang={LABEL_JENJANG[jenjangDibuka]}
            hariIni={hariIni}
            tarifSekarang={cariTarif(jenjangDibuka)?.tarifKlien ?? null}
            honorSekarang={cariTarif(jenjangDibuka)?.honorMitra ?? null}
          />
        </PanelGeser>
      )}

      {sesiDibuka !== null && (
        <PanelGeser judul={`Tarif khusus · ${sesiDibuka.namaKlien}`} hrefTutup={hrefTutup}>
          <FormTarifKhusus sessionId={sesiDibuka.id} namaKlien={sesiDibuka.namaKlien} />
        </PanelGeser>
      )}
    </main>
  );
}
