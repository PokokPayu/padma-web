import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { ambilDaftarMitra, SARING_MITRA } from "@/lib/admin/mitra";
import { uraikanParamDaftar, bangunQuery, type ParamMentah } from "@/app/_shell/panel/daftar";
import { BilahDaftar } from "@/app/_shell/panel/bilah-daftar";
import { Paginasi } from "@/app/_shell/panel/paginasi";
import { PanelGeser } from "@/app/_shell/panel/panel-geser";
import { Bantuan } from "@/app/_shell/panel/bantuan";
import { Tabel, Th, Td } from "@/app/_shell/panel/tabel";
import { FormMitra } from "./form-mitra";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: "Mitra" };

const BASIS = "/admin/mitra";

/**
 * Pill ketersediaan mitra.
 *
 * "Nonaktif" berarti satu hal saja: mitra tidak lagi ditawarkan saat
 * menjadwalkan sesi baru. Ia TIDAK berarti namanya hilang — riwayat sesi klien
 * tetap menyebutnya, karena `partner_publik` sengaja tidak menyaring
 * ketersediaan. Perbedaan itu pernah hilang, dan akibatnya seluruh catatan
 * bidan pada riwayat lama berganti menjadi "Tim PADMA" tanpa error apa pun.
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

export default async function DaftarMitraPage({
  searchParams,
}: {
  searchParams: Promise<ParamMentah>;
}) {
  await requireRole(["admin", "owner"]);

  const sp = await searchParams;
  const param = uraikanParamDaftar(sp, SARING_MITRA);
  const { baris, total } = await ambilDaftarMitra(param);

  // `ubah` sengaja TIDAK lewat `uraikanParamDaftar`: ia bukan saringan
  // berdaftar-putih melainkan sebuah id, dan kesahihannya dibuktikan dengan
  // menemukan barisnya di bawah — bukan dengan mencocokkan pola.
  const ubah = typeof sp.ubah === "string" ? sp.ubah : "";
  const barisUbah = ubah === "baru" ? null : baris.find((m) => m.id === ubah);
  // Panel hanya terbuka bila ada yang benar-benar bisa ditampilkan. Id yang
  // sudah dihapus atau berada di halaman lain menutup panel, bukan membuka
  // panel kosong yang formulirnya tidak menunjuk apa pun.
  const panelTerbuka = ubah === "baru" || barisUbah !== undefined;
  // Menutup = alamat yang sama TANPA `ubah`. Cari, saringan, dan halaman ikut
  // terbawa, jadi admin melanjutkan dari tempat ia berhenti.
  const hrefTutup = `${BASIS}${bangunQuery(param, { ubah: null })}`;

  return (
    <main>
      <header className="mb-4">
        <h1 className="text-[18px] font-bold text-panel-ink">Mitra</h1>
        <Bantuan judul="Tentang halaman ini">
          Mitra adalah data, bukan pengguna aplikasi — bidan melapor lewat WhatsApp dan
          admin yang mencatat. Mitra yang berhenti melayani cukup dinonaktifkan; namanya
          tetap menempel pada sesi yang sudah dijalaninya.
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
            + Mitra baru
          </Link>
        }
      />

      {baris.length === 0 ? (
        <p className="rounded-lg border border-panel-border bg-panel-surface p-8 text-center text-[13px] italic text-panel-muted">
          {/* Dua sebab, dua kalimat — hanya `page.tsx` tahu bedanya karena
              hanya di sini `param` (cari + saring) terlihat sekaligus. */}
          {param.cari === "" && Object.keys(param.saring).length === 0 ? (
            <>Belum ada mitra terdaftar. Mulai dari tombol &ldquo;+ Mitra baru&rdquo;.</>
          ) : (
            "Tidak ada mitra yang cocok dengan pencarian ini."
          )}
        </p>
      ) : (
        <div className="rounded-lg border border-panel-border bg-panel-surface">
          <Tabel label="Daftar mitra">
            <thead>
              <tr>
                <Th>Nama</Th><Th>Kontak</Th><Th>Kinerja</Th><Th>Status</Th><Th>Aksi</Th>
              </tr>
            </thead>
            <tbody>
              {baris.map((m) => (
                <tr key={m.id}>
                  <Td><b>{m.nama}</b></Td>
                  <Td>{m.noHp || "—"}</Td>
                  {/* Angka kinerja hanya jumlah sesi selesai. Honor mitra
                      adalah wilayah owner dan tidak pernah singgah di sini. */}
                  <Td className="font-mono text-[12.5px]">{m.sesiSelesai} sesi selesai</Td>
                  <Td><PillAktif aktif={m.aktif} /></Td>
                  <Td>
                    <Link
                      href={`${BASIS}${bangunQuery(param, { ubah: m.id })}`}
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
        <PanelGeser
          judul={barisUbah ? `Ubah ${barisUbah.nama}` : "Mitra baru"}
          hrefTutup={hrefTutup}
        >
          <FormMitra mitra={barisUbah ?? null} hrefTutup={hrefTutup} />
        </PanelGeser>
      )}
    </main>
  );
}
