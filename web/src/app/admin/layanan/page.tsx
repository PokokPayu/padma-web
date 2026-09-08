import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { ambilDaftarLayanan, SARING_LAYANAN } from "@/lib/admin/layanan";
import { daftarKatalogAdmin } from "@/lib/admin/katalog-admin";
import { uraikanParamDaftar, bangunQuery, type ParamMentah } from "@/app/_shell/panel/daftar";
import { BilahDaftar } from "@/app/_shell/panel/bilah-daftar";
import { Paginasi } from "@/app/_shell/panel/paginasi";
import { PanelGeser } from "@/app/_shell/panel/panel-geser";
import { Bantuan } from "@/app/_shell/panel/bantuan";
import { Tabel, Th, Td } from "@/app/_shell/panel/tabel";
import { FormLayananBaru, type PilihanFase } from "./form-layanan";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: "Layanan & Paket" };

const BASIS = "/admin/layanan";

/**
 * Pill ketersediaan.
 *
 * "Nonaktif" berarti dua hal saja: layanan berhenti muncul di katalog beranda,
 * dan berhenti ditawarkan saat menjadwalkan sesi baru. Ia TIDAK berarti
 * namanya hilang — riwayat sesi klien tetap menyebutnya. Perbedaan itu pernah
 * hilang pada data mitra, dan akibatnya seluruh riwayat lama berganti menjadi
 * teks cadangan tanpa satu pun error.
 */
function PillAktif({ aktif }: { aktif: boolean }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${
        aktif ? "bg-leaf-soft text-leaf" : "bg-clay/10 text-clay"
      }`}
    >
      {aktif ? "Aktif" : "Nonaktif"}
    </span>
  );
}

export default async function LayananPage({
  searchParams,
}: {
  searchParams: Promise<ParamMentah>;
}) {
  await requireRole(["admin", "owner"]);

  const sp = await searchParams;
  const param = uraikanParamDaftar(sp, SARING_LAYANAN);
  const { baris, total } = await ambilDaftarLayanan(param);

  const ubah = typeof sp.ubah === "string" ? sp.ubah : "";
  // HANYA "baru" yang membuka panel di sini. Mengubah sebuah layanan berarti
  // membuka HALAMAN detailnya (pola B) — layanan memiliki daftar anak, dan
  // daftar di dalam panel selebar setengah layar mengulangi kesalahan yang
  // sama seperti formulir di dalam sel tabel.
  const panelTerbuka = ubah === "baru";
  const hrefTutup = `${BASIS}${bangunQuery(param, { ubah: null })}`;

  // Daftar fase hanya dibutuhkan formulir "layanan baru".
  const fase: PilihanFase[] = panelTerbuka
    ? (await daftarKatalogAdmin()).map((f) => ({ id: f.id, nama: f.nama }))
    : [];

  return (
    <main>
      <header className="mb-4">
        <h1 className="text-[18px] font-bold text-panel-ink">Layanan &amp; Paket</h1>
        <Bantuan judul="Tentang halaman ini">
          Katalog yang dibaca beranda dan wizard pengajuan jadwal klien. Tidak ada satu pun angka
          harga di sini — tarif adalah wilayah Owner. Layanan, paket, dan varian tidak pernah
          dihapus, hanya <b>dinonaktifkan</b>: yang nonaktif berhenti muncul di beranda dan berhenti
          ditawarkan untuk sesi baru, tetapi namanya <b>tetap</b> menempel pada riwayat sesi klien
          yang sudah berjalan. Satu layanan tidak bisa kehilangan varian aktif terakhirnya —
          aktifkan varian lain dulu sebelum menonaktifkan yang sedang dipakai.
        </Bantuan>
      </header>

      <BilahDaftar
        basis={BASIS}
        param={param}
        kelompok={[
          {
            nama: "aktif",
            label: "Ketersediaan",
            pilihan: [
              { nilai: "ya", label: "Aktif" },
              { nilai: "tidak", label: "Nonaktif" },
            ],
          },
        ]}
        jumlah={baris.length}
        total={total}
        aksi={
          <Link
            href={`${BASIS}?ubah=baru`}
            className="rounded-lg bg-panel-ink px-3 py-2 text-[12px] font-bold text-panel-surface"
          >
            + Layanan baru
          </Link>
        }
      />

      {baris.length === 0 ? (
        <p className="rounded-lg border border-panel-border bg-panel-surface p-8 text-center text-[13px] italic text-panel-muted">
          {/* Dua sebab, dua kalimat — hanya `page.tsx` tahu bedanya karena
              hanya di sini `param` (cari + saring) terlihat sekaligus. */}
          {param.cari === "" && Object.keys(param.saring).length === 0 ? (
            <>Belum ada layanan yang terdaftar. Mulai dari tombol &ldquo;+ Layanan baru&rdquo;.</>
          ) : (
            "Tidak ada layanan yang cocok dengan pencarian ini."
          )}
        </p>
      ) : (
        <div className="rounded-lg border border-panel-border bg-panel-surface">
          <Tabel label="Daftar layanan">
            <thead>
              <tr>
                <Th>Nama</Th><Th>Fase</Th><Th>Varian</Th><Th>Paket</Th>
                <Th>Sesi tercatat</Th><Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {baris.map((l) => (
                <tr key={l.id}>
                  <Td>
                    {/* Barisnya sendiri yang menaut — pola B. Tidak ada kolom
                        "Aksi" berisi tombol Ubah: yang dibuka adalah halaman
                        layanan itu beserta varian dan paketnya, bukan
                        formulirnya saja. */}
                    <Link href={`${BASIS}/${l.id}`} className="font-bold text-panel-ink underline">
                      {l.nama}
                    </Link>
                    <span className="mt-0.5 block text-[11.5px] text-panel-muted">
                      {l.deskripsi || "Belum ada deskripsi."}
                    </span>
                  </Td>
                  <Td>{l.namaFase}</Td>
                  <Td className="font-mono text-[12.5px]">{l.jumlahVarian}</Td>
                  <Td className="font-mono text-[12.5px]">{l.jumlahPaket}</Td>
                  {/* Angka ini menjelaskan mengapa baris tidak boleh dihapus:
                      setiap sesi menunjuk layanan ini. */}
                  <Td className="font-mono text-[12.5px]">{l.sesiTercatat}</Td>
                  <Td><PillAktif aktif={l.aktif} /></Td>
                </tr>
              ))}
            </tbody>
          </Tabel>
        </div>
      )}

      <Paginasi basis={BASIS} param={param} total={total} />

      {panelTerbuka && (
        <PanelGeser judul="Layanan baru" hrefTutup={hrefTutup}>
          <FormLayananBaru fase={fase} />
        </PanelGeser>
      )}
    </main>
  );
}
