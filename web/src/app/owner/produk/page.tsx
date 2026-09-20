import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { ambilDaftarHargaProduk, SARING_PRODUK_HARGA } from "@/lib/owner/daftar-produk";
import { formatRupiah } from "@/lib/owner/rupiah";
import { formatTanggalID, hariIniJakarta } from "@/lib/passport/waktu";
import { uraikanParamDaftar, bangunQuery, type ParamMentah } from "@/app/_shell/panel/daftar";
import { BilahDaftar } from "@/app/_shell/panel/bilah-daftar";
import { Paginasi } from "@/app/_shell/panel/paginasi";
import { PanelGeser } from "@/app/_shell/panel/panel-geser";
import { Bantuan } from "@/app/_shell/panel/bantuan";
import { Tabel, Th, Td } from "@/app/_shell/panel/tabel";
import { LABEL_JENIS } from "@/lib/produk/status";
import { FormHargaProduk } from "./form-harga-produk";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: "Harga Produk" };

const BASIS = "/owner/produk";

export default async function ProdukHargaPage({
  searchParams,
}: {
  searchParams: Promise<ParamMentah>;
}) {
  await requireRole(["owner"]);

  // "Hari ini" menurut Jakarta, bukan menurut jam server (Vercel berjalan UTC).
  const hariIni = hariIniJakarta();
  const sp = await searchParams;
  const param = uraikanParamDaftar(sp, SARING_PRODUK_HARGA);
  const { baris, total } = await ambilDaftarHargaProduk(param, hariIni);

  // `ubah` menunjuk id sebuah produk — bukan saringan berdaftar-putih.
  // Kesahihannya dibuktikan dengan menemukan barisnya di bawah, bukan dengan
  // mencocokkan pola.
  const ubah = typeof sp.ubah === "string" ? sp.ubah : "";
  const barisUbah = baris.find((p) => p.productId === ubah);
  const panelTerbuka = barisUbah !== undefined;
  const hrefTutup = `${BASIS}${bangunQuery(param, { ubah: null })}`;

  return (
    <main>
      <header className="mb-4">
        <h1 className="text-[18px] font-bold text-panel-ink">Harga Produk</h1>
        <Bantuan judul="Tentang halaman ini">
          Harga produk digital (video &amp; PDF), berlaku {formatTanggalID(hariIni)}. Halaman ini
          adalah SATU-SATUNYA tempat harga produk digital bisa ditetapkan — admin melihatnya di
          panel Produk tapi tidak bisa menyuntingnya. Harga tidak pernah ditimpa, hanya{" "}
          <b>ditambah</b>: setiap penetapan melahirkan satu baris baru bertanggal berlaku, dan
          harga lama tidak bisa dihapus maupun disunting — basis data menolaknya, bahkan untuk
          pemilik. Harga <b>0</b> berarti produk itu GRATIS dan diambil tanpa pembayaran, bukan
          &ldquo;belum ditetapkan&rdquo;. Salah ketik diperbaiki dengan menetapkan harga baru.
        </Bantuan>
      </header>

      <BilahDaftar
        basis={BASIS}
        param={param}
        kelompok={[
          {
            nama: "harga",
            label: "Harga",
            pilihan: [
              { nilai: "bertarif", label: "Sudah bertarif" },
              // `menuntut` mewarnai chip clay: produk tanpa harga adalah
              // PEKERJAAN, bukan kabar — ia tidak bisa dijual sampai owner
              // menetapkan angkanya.
              { nilai: "belum", label: "Belum bertarif", menuntut: true },
            ],
          },
          {
            nama: "aktif",
            label: "Ketersediaan",
            pilihan: [
              { nilai: "ya", label: "Tayang" },
              { nilai: "tidak", label: "Nonaktif" },
            ],
          },
        ]}
        jumlah={baris.length}
        total={total}
        // Produk baru lahir di panel Admin (`/admin/produk/baru`), bukan di
        // sini: halaman ini menetapkan HARGA produk yang sudah ada, dan tidak
        // pernah menciptakan katalog.
        aksi={null}
      />

      {baris.length === 0 ? (
        <p className="rounded-lg border border-panel-border bg-panel-surface p-8 text-center text-[13px] italic text-panel-muted">
          {param.cari === "" && Object.keys(param.saring).length === 0
            ? "Belum ada produk digital di katalog. Produk lahir di panel Admin."
            : "Tidak ada produk yang cocok dengan pencarian ini."}
        </p>
      ) : (
        <div className="rounded-lg border border-panel-border bg-panel-surface">
          <Tabel label="Harga produk digital">
            <thead>
              <tr>
                <Th>Produk</Th><Th>Jenis</Th><Th>Harga</Th><Th>Harga coret</Th>
                <Th>Berlaku sejak</Th><Th>Aksi</Th>
              </tr>
            </thead>
            <tbody>
              {baris.map((b) => {
                const t = b.berlaku;
                return (
                  <tr key={b.productId}>
                    <Td>
                      <b className="text-panel-ink">{b.judul}</b>
                      <span className="mt-0.5 block text-[11.5px] text-panel-muted">
                        {!b.aktif && "tidak ditayangkan"}
                      </span>
                    </Td>
                    <Td>
                      <span className="rounded-full border border-panel-border px-2.5 py-1 text-[11px] font-extrabold text-panel-ink">
                        {LABEL_JENIS[b.jenis]}
                      </span>
                    </Td>
                    <Td className="font-mono text-[13px]">
                      {t ? formatRupiah(t.harga) : <span className="text-clay">Belum bertarif</span>}
                    </Td>
                    <Td className="font-mono text-[13px]">
                      {t?.hargaCoret != null ? formatRupiah(t.hargaCoret) : "—"}
                    </Td>
                    <Td>{t ? formatTanggalID(t.berlakuSejak) : "—"}</Td>
                    <Td>
                      <Link
                        href={`${BASIS}${bangunQuery(param, { ubah: b.productId })}`}
                        className="text-[12px] font-bold text-panel-ink underline"
                      >
                        Tetapkan harga
                      </Link>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Tabel>
        </div>
      )}

      <Paginasi basis={BASIS} param={param} total={total} />

      {panelTerbuka && (
        <PanelGeser judul={`Harga ${barisUbah.judul}`} hrefTutup={hrefTutup}>
          <FormHargaProduk
            productId={barisUbah.productId}
            judul={barisUbah.judul}
            hariIni={hariIni}
            hargaSekarang={barisUbah.berlaku?.harga ?? null}
            hargaCoretSekarang={barisUbah.berlaku?.hargaCoret ?? null}
          />

          {barisUbah.riwayat.length > 0 && (
            <div className="mt-4">
              <h3 className="text-[12.5px] font-bold text-panel-muted">Riwayat penetapan</h3>
              <ul className="mt-1.5 grid gap-1.5">
                {barisUbah.riwayat.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between rounded-lg border border-panel-border px-3 py-2 text-[12.5px]"
                  >
                    <span>
                      {formatTanggalID(r.berlakuSejak)}
                      {r.belumBerlaku && <span className="ml-1.5 text-clay">(terjadwal)</span>}
                      {r.berlakuSekarang && <span className="ml-1.5 text-leaf">(berlaku)</span>}
                    </span>
                    <span className="font-mono">
                      {formatRupiah(r.harga)}
                      {r.hargaCoret != null && (
                        <span className="ml-1.5 text-panel-muted line-through">
                          {formatRupiah(r.hargaCoret)}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </PanelGeser>
      )}
    </main>
  );
}
