import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { ambilDaftarTarif, SARING_TARIF } from "@/lib/owner/daftar-tarif";
import { formatRupiah } from "@/lib/owner/rupiah";
import { formatTanggalID, hariIniJakarta } from "@/lib/passport/waktu";
import { uraikanParamDaftar, type ParamMentah } from "@/app/_shell/panel/daftar";
import { BilahDaftar } from "@/app/_shell/panel/bilah-daftar";
import { Paginasi } from "@/app/_shell/panel/paginasi";
import { Bantuan } from "@/app/_shell/panel/bantuan";
import { Tabel, Th, Td } from "@/app/_shell/panel/tabel";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: "Rate Card" };

const BASIS = "/owner/tarif";

export default async function TarifPage({
  searchParams,
}: {
  searchParams: Promise<ParamMentah>;
}) {
  await requireRole(["owner"]);

  // "Hari ini" menurut Jakarta, bukan menurut jam server (Vercel berjalan UTC).
  const hariIni = hariIniJakarta();
  const param = uraikanParamDaftar(await searchParams, SARING_TARIF);
  const { baris, total } = await ambilDaftarTarif(param, hariIni);

  return (
    <main>
      <header className="mb-4">
        <h1 className="text-[18px] font-bold text-panel-ink">Rate Card</h1>
        <Bantuan judul="Tentang halaman ini">
          Harga ke klien &amp; honor mitra per sesi, berlaku {formatTanggalID(hariIni)}. Angka ini
          hidup hanya di panel Owner — tidak satu pun layar lain di PADMA pernah menampilkannya.
          Tarif tidak pernah ditimpa, hanya <b>ditambah</b>: setiap penetapan melahirkan satu baris
          baru bertanggal berlaku, dan rekap honor memakai tarif yang berlaku <b>pada tanggal
          sesi</b> — jadi menaikkan tarif hari ini tidak menggeser satu angka pun di pekan yang
          sudah lewat, termasuk pekan yang honornya sudah dibayarkan. Tarif lama tidak bisa dihapus
          maupun disunting; basis data menolaknya, bahkan untuk pemilik. Salah ketik diperbaiki
          dengan menetapkan tarif baru.
        </Bantuan>
      </header>

      <BilahDaftar
        basis={BASIS}
        param={param}
        kelompok={[
          {
            nama: "tarif",
            label: "Tarif",
            pilihan: [
              { nilai: "bertarif", label: "Sudah bertarif" },
              // `menuntut` mewarnai chip clay: varian tanpa tarif adalah
              // PEKERJAAN, bukan kabar — sesi yang sudah selesai padanya
              // muncul di rekap sebagai tak-bertarif dan honornya tidak ikut
              // dihitung di angka mana pun.
              { nilai: "belum", label: "Belum bertarif", menuntut: true },
            ],
          },
          {
            nama: "aktif",
            label: "Ketersediaan",
            pilihan: [
              { nilai: "ya", label: "Ditawarkan" },
              { nilai: "tidak", label: "Tidak ditawarkan" },
            ],
          },
        ]}
        jumlah={baris.length}
        total={total}
        // Varian baru lahir di panel Admin (`/admin/layanan/[id]`), bukan di
        // sini: halaman ini menetapkan HARGA varian yang sudah ada, dan tidak
        // pernah menciptakan katalog.
        aksi={null}
      />

      {baris.length === 0 ? (
        <p className="rounded-lg border border-panel-border bg-panel-surface p-8 text-center text-[13px] italic text-panel-muted">
          {param.cari === "" && Object.keys(param.saring).length === 0
            ? "Belum ada varian layanan di katalog. Varian lahir di panel Admin."
            : "Tidak ada varian yang cocok dengan pencarian ini."}
        </p>
      ) : (
        <div className="rounded-lg border border-panel-border bg-panel-surface">
          <Tabel label="Rate card layanan">
            <thead>
              <tr>
                <Th>Layanan</Th><Th>Harga klien</Th><Th>Honor mitra</Th>
                <Th>Margin</Th><Th>Berlaku sejak</Th>
              </tr>
            </thead>
            <tbody>
              {baris.map((b) => {
                const t = b.berlaku;
                // Varian baku (label kosong) jatuh ke nama layanannya —
                // keputusan tampilan ini milik layar, sesuai kontrak
                // `labelVarian()`.
                const nama = b.labelVarian === "" ? b.namaLayanan : b.labelVarian;
                return (
                  <tr key={b.variantId}>
                    <Td>
                      <Link
                        href={`${BASIS}/${b.variantId}`}
                        className="font-bold text-panel-ink underline"
                      >
                        {nama}
                      </Link>
                      <span className="mt-0.5 block text-[11.5px] text-panel-muted">
                        {b.namaFase}
                        {b.labelVarian !== "" && ` · ${b.namaLayanan}`}
                        {!b.aktif && " · tidak ditawarkan lagi"}
                      </span>
                    </Td>
                    <Td className="font-mono text-[13px]">{t ? formatRupiah(t.hargaKlien) : "—"}</Td>
                    <Td className="font-mono text-[13px]">{t ? formatRupiah(t.honorMitra) : "—"}</Td>
                    {/* Margin adalah angka PADMA. Ia DIHITUNG, tidak pernah
                        disimpan: kolom nominal turunan akan hidup di dalam
                        sebuah VIEW milik postgres yang berjalan dengan hak
                        pemilik dan karenanya MELEWATI RLS. */}
                    <Td className="font-mono text-[13px] text-leaf">
                      {t ? formatRupiah(t.margin) : "—"}
                    </Td>
                    <Td>
                      {t ? (
                        formatTanggalID(t.berlakuSejak)
                      ) : (
                        <span className="text-clay">Belum bertarif</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Tabel>
        </div>
      )}

      <Paginasi basis={BASIS} param={param} total={total} />
    </main>
  );
}
