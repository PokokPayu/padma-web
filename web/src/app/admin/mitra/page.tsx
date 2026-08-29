import { requireRole } from "@/lib/auth/require-role";
import { ambilDaftarMitra } from "@/lib/admin/mitra";
import { AksiMitra, FormMitraBaru } from "./form-mitra";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: "Mitra" };

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

export default async function DaftarMitraPage() {
  await requireRole(["admin", "owner"]);

  const mitra = await ambilDaftarMitra();

  return (
    <main>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl text-night">Mitra</h1>
          <p className="mt-1 max-w-xl text-[13px] text-ink-soft">
            Mitra adalah data, bukan pengguna aplikasi — bidan melapor lewat
            WhatsApp dan admin yang mencatat. Mitra yang berhenti melayani
            cukup dinonaktifkan; namanya tetap menempel pada sesi yang sudah
            dijalaninya.
          </p>
        </div>
        <FormMitraBaru />
      </header>

      {mitra.length === 0 ? (
        <p className="rounded-2xl border border-black/10 bg-white p-8 text-center text-sm italic text-ink-soft">
          Belum ada mitra terdaftar. Mulai dari tombol &ldquo;+ Mitra
          baru&rdquo;.
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-black/10 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[13.5px]">
              <thead>
                <tr className="border-b-[1.5px] border-black/10 bg-paper text-[11px] uppercase tracking-wider text-ink-soft">
                  <th className="p-4 text-left font-extrabold">Nama</th>
                  <th className="p-4 text-left font-extrabold">Kontak</th>
                  <th className="p-4 text-left font-extrabold">Kinerja</th>
                  <th className="p-4 text-left font-extrabold">Status</th>
                  <th className="p-4 text-left font-extrabold">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {mitra.map((m) => (
                  <tr key={m.id} className="border-b border-black/5">
                    <td className="p-4">
                      <b>{m.nama}</b>
                    </td>
                    <td className="p-4">{m.noHp || "—"}</td>
                    {/* Angka kinerja hanya jumlah sesi selesai. Honor mitra
                        adalah wilayah owner dan tidak pernah singgah di sini. */}
                    <td className="p-4 font-mono text-[12.5px]">
                      {m.sesiSelesai} sesi selesai
                    </td>
                    <td className="p-4">
                      <PillAktif aktif={m.aktif} />
                    </td>
                    <td className="p-4">
                      <AksiMitra
                        id={m.id}
                        nama={m.nama}
                        noHp={m.noHp}
                        aktif={m.aktif}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}
