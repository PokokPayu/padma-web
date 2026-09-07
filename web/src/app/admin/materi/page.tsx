import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { ambilDaftarMateri, pilihanLayananMateri, SARING_MATERI } from "@/lib/admin/materi-admin";
import { uraikanParamDaftar, bangunQuery, type ParamMentah } from "@/app/_shell/panel/daftar";
import { BilahDaftar } from "@/app/_shell/panel/bilah-daftar";
import { Paginasi } from "@/app/_shell/panel/paginasi";
import { PanelGeser } from "@/app/_shell/panel/panel-geser";
import { Bantuan } from "@/app/_shell/panel/bantuan";
import { Tabel, Th, Td } from "@/app/_shell/panel/tabel";
import { FormMateriBaru, type PilihanLayanan } from "./form-materi";
import { LABEL_TIPE, type TipeMateri } from "./status";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: "Materi Panduan" };

const BASIS = "/admin/materi";

/**
 * Pill ketersediaan.
 *
 * "Nonaktif" di sini berarti lebih dari sekadar hilang dari daftar klien:
 * migration `gating_materi_hormati_aktif` membuat policy baca klien pada
 * `material_pages` & `material_videos` ikut mengevaluasi `materials.aktif`,
 * sehingga isinya benar-benar berhenti dijawab PostgREST — bukan sekadar
 * disembunyikan dari layar. Yang TETAP terbaca hanyalah baris metadata
 * materi; menutupnya juga akan mengulangi bug `partner_publik`, tempat satu
 * klik "nonaktifkan" menghapus sebuah nama dari riwayat SELURUH klien tanpa
 * satu pun error.
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

function PillTipe({ tipe }: { tipe: TipeMateri }) {
  return (
    <span className="rounded-full border border-panel-border px-2.5 py-1 text-[11px] font-extrabold text-panel-ink">
      {LABEL_TIPE[tipe]}
    </span>
  );
}

/**
 * Materi tanpa satu pun layanan tertaut. Keadaan SAH — admin wajar ingin
 * menumpuk bahan dulu — tetapi keadaan itu WAJIB terlihat: materi seperti ini
 * tidak pernah terbuka lewat jalur otomatis (sesi selesai), hanya lewat
 * penugasan manual. Materi yang diam-diam tidak terlihat siapa pun adalah
 * persis kegagalan yang modul ini ada untuk mencegah.
 */
function PillTanpaLayanan() {
  return (
    <span className="rounded-full bg-clay/10 px-2.5 py-1 text-[11px] font-extrabold text-clay">
      Tanpa layanan · hanya lewat assign
    </span>
  );
}

function PillBelumAdaIsi() {
  return (
    <span className="rounded-full bg-clay/10 px-2.5 py-1 text-[11px] font-extrabold text-clay">
      Belum ada isi
    </span>
  );
}

export default async function MateriPage({
  searchParams,
}: {
  searchParams: Promise<ParamMentah>;
}) {
  await requireRole(["admin", "owner"]);

  const sp = await searchParams;
  const param = uraikanParamDaftar(sp, SARING_MATERI);
  const { baris, total } = await ambilDaftarMateri(param);

  const ubah = typeof sp.ubah === "string" ? sp.ubah : "";
  // HANYA "baru" yang membuka panel di sini. Membuka sebuah materi berarti
  // membuka HALAMAN detailnya (pola B) — materi punya daftar anak (penugasan
  // per klien), dan daftar di dalam panel selebar setengah layar mengulangi
  // kesalahan yang sama seperti formulir di dalam sel tabel.
  const panelTerbuka = ubah === "baru";
  const hrefTutup = `${BASIS}${bangunQuery(param, { ubah: null })}`;

  // Daftar layanan hanya dibutuhkan formulir "materi baru".
  const layananPilihan: PilihanLayanan[] = panelTerbuka ? await pilihanLayananMateri() : [];

  return (
    <main>
      <header className="mb-4">
        <h1 className="text-[18px] font-bold text-panel-ink">Materi Panduan</h1>
        <Bantuan judul="Tentang halaman ini">
          Isi yang terbuka untuk klien setelah layanan terkaitnya selesai dijalani, atau lewat
          penugasan manual. Satu materi boleh menempel ke lebih dari satu layanan — atau tidak
          satu pun. Materi tidak pernah dihapus, hanya <b>dinonaktifkan</b> — dan menonaktifkannya benar-benar
          menutup isinya: halaman e-book dan isi videonya berhenti dijawab basis data untuk klien,
          bukan sekadar hilang dari layarnya. Materi juga tidak pernah bisa terbit tanpa isi:
          e-book wajib punya satu berkas PDF, video wajib punya satu berkas video. Materi kosong
          tampil kepada klien sebagai kartu terkunci yang tidak akan pernah terbuka.
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
          {
            nama: "tipe",
            label: "Tipe",
            pilihan: [
              { nilai: "ebook", label: LABEL_TIPE.ebook },
              { nilai: "video", label: LABEL_TIPE.video },
            ],
          },
          {
            nama: "isi",
            label: "Isi",
            pilihan: [{ nilai: "belum", label: "Belum ada isi", menuntut: true }],
          },
        ]}
        jumlah={baris.length}
        total={total}
        aksi={
          <Link
            href={`${BASIS}?ubah=baru`}
            className="rounded-lg bg-panel-ink px-3 py-2 text-[12px] font-bold text-panel-surface"
          >
            + Materi baru
          </Link>
        }
      />

      {baris.length === 0 ? (
        <p className="rounded-lg border border-panel-border bg-panel-surface p-8 text-center text-[13px] italic text-panel-muted">
          {/* Dua sebab, dua kalimat — hanya `page.tsx` tahu bedanya karena
              hanya di sini `param` (cari + saring) terlihat sekaligus. */}
          {param.cari === "" && Object.keys(param.saring).length === 0 ? (
            <>Belum ada materi yang terdaftar. Mulai dari tombol &ldquo;+ Materi baru&rdquo;.</>
          ) : (
            "Tidak ada materi yang cocok dengan pencarian ini."
          )}
        </p>
      ) : (
        <div className="rounded-lg border border-panel-border bg-panel-surface">
          <Tabel label="Daftar materi">
            <thead>
              <tr>
                <Th>Judul</Th><Th>Tipe</Th><Th>Isi</Th><Th>Layanan</Th><Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {baris.map((m) => (
                <tr key={m.id}>
                  <Td>
                    {/* Barisnya sendiri yang menaut — pola B. Materi punya
                        daftar anak (penugasan per klien), jadi yang dibuka
                        adalah halaman detailnya, bukan formulir di sel. */}
                    <Link href={`${BASIS}/${m.id}`} className="font-bold text-panel-ink underline">
                      {m.judul}
                    </Link>
                    <span className="mt-0.5 block text-[11.5px] text-panel-muted">
                      {m.deskripsi || "Belum ada deskripsi."}
                    </span>
                  </Td>
                  <Td><PillTipe tipe={m.tipe} /></Td>
                  <Td>
                    {/* Angka/keterangan ini membuat "materi setengah jadi"
                        terlihat, bukan tertebak: materi video tanpa objek
                        video (atau e-book tanpa halaman) terkunci selamanya
                        bagi klien yang sudah berhak, tanpa satu pun error. */}
                    <span className="font-mono text-[12.5px]">
                      {m.tipe === "ebook"
                        ? `${m.jumlahHalaman} halaman`
                        : m.objekVideo !== null
                          ? "video terpasang"
                          : "video belum terpasang"}
                    </span>
                    {!m.lengkap && (
                      <span className="mt-1 block">
                        <PillBelumAdaIsi />
                      </span>
                    )}
                  </Td>
                  <Td>
                    <span className="font-mono text-[12.5px]">{m.jumlahLayanan}</span>
                    {m.jumlahLayanan === 0 && (
                      <span className="mt-1 block">
                        <PillTanpaLayanan />
                      </span>
                    )}
                  </Td>
                  <Td><PillAktif aktif={m.aktif} /></Td>
                </tr>
              ))}
            </tbody>
          </Tabel>
        </div>
      )}

      <Paginasi basis={BASIS} param={param} total={total} />

      {panelTerbuka && (
        <PanelGeser judul="Materi baru" hrefTutup={hrefTutup}>
          <FormMateriBaru layanan={layananPilihan} />
        </PanelGeser>
      )}
    </main>
  );
}
