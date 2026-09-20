import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { ambilDaftarProduk, SARING_PRODUK } from "@/lib/admin/produk-admin";
import { uraikanParamDaftar, bangunQuery, type ParamMentah } from "@/app/_shell/panel/daftar";
import { BilahDaftar } from "@/app/_shell/panel/bilah-daftar";
import { Paginasi } from "@/app/_shell/panel/paginasi";
import { PanelGeser } from "@/app/_shell/panel/panel-geser";
import { Bantuan } from "@/app/_shell/panel/bantuan";
import { Tabel, Th, Td } from "@/app/_shell/panel/tabel";
import { FormProduk } from "./form-produk";
import { formatRupiah } from "@/lib/rupiah-publik";
import { LABEL_JENIS } from "@/lib/produk/status";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: "Produk Digital" };

const BASIS = "/admin/produk";

/**
 * Pill tayang/nonaktif — bentuknya sama seperti `PillAktif` di
 * `admin/materi/page.tsx` dan `admin/mitra/page.tsx`.
 */
function PillAktif({ aktif }: { aktif: boolean }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${
        aktif ? "bg-leaf-soft text-leaf" : "bg-clay/10 text-clay"
      }`}
    >
      {aktif ? "Tayang" : "Nonaktif"}
    </span>
  );
}

function PillBelumAdaIsi() {
  return (
    <span className="rounded-full bg-clay/10 px-2.5 py-1 text-[11px] font-extrabold text-clay">
      Belum ada berkas
    </span>
  );
}

export default async function ProdukPage({
  searchParams,
}: {
  searchParams: Promise<ParamMentah>;
}) {
  await requireRole(["admin", "owner"]);

  const sp = await searchParams;
  const param = uraikanParamDaftar(sp, SARING_PRODUK);
  const { baris, total } = await ambilDaftarProduk(param);

  // `ubah` menunjuk id sebuah produk — bukan saringan berdaftar-putih.
  // Kesahihannya dibuktikan dengan menemukan barisnya di bawah, bukan dengan
  // mencocokkan pola. "baru" TIDAK dilayani di sini: produk baru punya rute
  // berdiri sendiri (`/admin/produk/baru`, pola `/admin/klien/baru`) supaya
  // formulir kosong tidak nongkrong terus di header daftar.
  const ubah = typeof sp.ubah === "string" ? sp.ubah : "";
  const barisUbah = baris.find((p) => p.id === ubah);
  const panelTerbuka = barisUbah !== undefined;
  const hrefTutup = `${BASIS}${bangunQuery(param, { ubah: null })}`;

  return (
    <main>
      <header className="mb-4">
        <h1 className="text-[18px] font-bold text-panel-ink">Produk Digital</h1>
        <Bantuan judul="Tentang halaman ini">
          Master produk yang dijual di etalase publik — video dan PDF. Admin mengelola ISI
          (judul, deskripsi, berkas, tayang/tidak); harga TAMPIL di sini tapi hanya owner yang
          bisa menetapkannya. Produk baru selalu lahir <b>nonaktif</b> — ia baru bisa ditayangkan
          sesudah berkasnya terunggah, supaya tidak ada janji di etalase yang tidak bisa ditepati.
        </Bantuan>
      </header>

      <BilahDaftar
        basis={BASIS}
        param={param}
        kelompok={[
          {
            nama: "aktif",
            label: "Tayang",
            pilihan: [
              { nilai: "ya", label: "Tayang" },
              { nilai: "tidak", label: "Nonaktif" },
            ],
          },
          {
            nama: "jenis",
            label: "Jenis",
            pilihan: [
              { nilai: "video", label: LABEL_JENIS.video },
              { nilai: "pdf", label: LABEL_JENIS.pdf },
            ],
          },
          {
            nama: "isi",
            label: "Isi",
            pilihan: [
              { nilai: "ada", label: "Ada berkas" },
              { nilai: "belum", label: "Belum ada berkas", menuntut: true },
            ],
          },
        ]}
        jumlah={baris.length}
        total={total}
        aksi={
          <Link
            href={`${BASIS}/baru`}
            className="rounded-lg bg-panel-ink px-3 py-2 text-[12px] font-bold text-panel-surface"
          >
            + Produk baru
          </Link>
        }
      />

      {baris.length === 0 ? (
        <p className="rounded-lg border border-panel-border bg-panel-surface p-8 text-center text-[13px] italic text-panel-muted">
          {param.cari === "" && Object.keys(param.saring).length === 0 ? (
            <>Belum ada produk yang terdaftar. Mulai dari tombol &ldquo;+ Produk baru&rdquo;.</>
          ) : (
            "Tidak ada produk yang cocok dengan pencarian ini."
          )}
        </p>
      ) : (
        <div className="rounded-lg border border-panel-border bg-panel-surface">
          <Tabel label="Daftar produk digital">
            <thead>
              <tr>
                <Th>Judul</Th><Th>Jenis</Th><Th>Isi</Th><Th>Harga</Th><Th>Tayang</Th><Th>Urutan</Th><Th>Aksi</Th>
              </tr>
            </thead>
            <tbody>
              {baris.map((p) => (
                <tr key={p.id}>
                  <Td>
                    <b>{p.judul}</b>
                    <span className="mt-0.5 block text-[11.5px] text-panel-muted">
                      {p.deskripsi || "Belum ada deskripsi."}
                    </span>
                  </Td>
                  <Td>
                    <span className="rounded-full border border-panel-border px-2.5 py-1 text-[11px] font-extrabold text-panel-ink">
                      {LABEL_JENIS[p.jenis]}
                    </span>
                  </Td>
                  <Td>
                    {p.adaIsi ? (
                      <span className="font-mono text-[12.5px]">berkas terpasang</span>
                    ) : (
                      <PillBelumAdaIsi />
                    )}
                  </Td>
                  <Td className="font-mono text-[12.5px]">
                    {p.harga === null ? (
                      <span className="italic text-panel-muted">Belum ditetapkan</span>
                    ) : (
                      formatRupiah(p.harga)
                    )}
                  </Td>
                  <Td><PillAktif aktif={p.aktif} /></Td>
                  <Td className="font-mono text-[12.5px]">{p.urutan}</Td>
                  <Td>
                    <Link
                      href={`${BASIS}${bangunQuery(param, { ubah: p.id })}`}
                      className="text-[12px] font-bold text-panel-ink underline"
                    >
                      Ubah
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Tabel>
        </div>
      )}

      <Paginasi basis={BASIS} param={param} total={total} />

      {panelTerbuka && (
        <PanelGeser judul={`Ubah ${barisUbah.judul}`} hrefTutup={hrefTutup}>
          <FormProduk produk={barisUbah} hrefTutup={hrefTutup} />
        </PanelGeser>
      )}
    </main>
  );
}
