import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { ambilDaftarKlien, SARING_KLIEN } from "@/lib/admin/klien";
import { uraikanParamDaftar, type ParamMentah } from "@/app/_shell/panel/daftar";
import { BilahDaftar } from "@/app/_shell/panel/bilah-daftar";
import { Paginasi } from "@/app/_shell/panel/paginasi";
import { Bantuan } from "@/app/_shell/panel/bantuan";
import { Tabel, Th, Td } from "@/app/_shell/panel/tabel";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: "Klien" };

/**
 * Pill status aktivasi.
 *
 * Ini satu-satunya tempat staf melihat beda antara "klien sudah dibuat" dan
 * "klien sudah bisa masuk". Bedanya bukan kosmetik: selama `user_id` kosong,
 * tautan aktivasi belum ditukarkan dan passport-nya belum bisa dibuka siapa
 * pun — termasuk oleh klien yang sudah dikirimi pesan sambutan.
 */
function PillAktivasi({ aktif }: { aktif: boolean }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${
        aktif ? "bg-leaf-soft text-leaf" : "bg-clay/10 text-clay"
      }`}
    >
      {aktif ? "Aktif" : "Belum aktif"}
    </span>
  );
}

export default async function DaftarKlienPage({
  searchParams,
}: {
  searchParams: Promise<ParamMentah>;
}) {
  await requireRole(["admin", "owner"]);

  const param = uraikanParamDaftar(await searchParams, SARING_KLIEN);
  const { baris, total } = await ambilDaftarKlien(param);

  return (
    <main>
      <header className="mb-4">
        <h1 className="text-[18px] font-bold text-panel-ink">Klien</h1>
        <Bantuan judul="Tentang halaman ini">
          &ldquo;Belum aktif&rdquo; berarti tautan aktivasi belum ditukarkan: passport-nya
          belum bisa dibuka siapa pun, termasuk oleh klien yang sudah dikirimi pesan
          sambutan.
        </Bantuan>
      </header>

      <BilahDaftar
        basis="/admin/klien"
        param={param}
        kelompok={[
          {
            nama: "aktivasi",
            label: "Aktivasi",
            pilihan: [
              { nilai: "aktif", label: "Aktif" },
              { nilai: "belum", label: "Belum aktivasi", menuntut: true },
            ],
          },
          { nama: "paket", label: "Paket", pilihan: [{ nilai: "ada", label: "Punya paket" }] },
        ]}
        jumlah={baris.length}
        total={total}
        aksi={
          <Link
            href="/admin/klien/baru"
            className="rounded-lg bg-panel-ink px-3 py-2 text-[12px] font-bold text-panel-surface"
          >
            + Klien baru
          </Link>
        }
      />
      {baris.length === 0 ? (
        <p className="rounded-lg border border-panel-border bg-panel-surface p-8 text-center text-[13px] italic text-panel-muted">
          Tidak ada klien yang cocok dengan pencarian ini.
        </p>
      ) : (
        <div className="rounded-lg border border-panel-border bg-panel-surface">
          <Tabel label="Daftar klien">
            <thead>
              <tr>
                <Th>Nama</Th>
                <Th>PADMA ID</Th>
                <Th>Fase</Th>
                <Th>Paket</Th>
                <Th>Sesi</Th>
                <Th>Aktivasi</Th>
              </tr>
            </thead>
            <tbody>
              {baris.map((k) => (
                <tr key={k.id}>
                  <Td>
                    {/* Barisnya sendiri yang menaut — pola B. Tidak ada kolom
                        "Aksi" berisi tombol Ubah, karena yang dibuka adalah
                        halaman klien itu, bukan formulirnya saja. */}
                    <Link href={`/admin/klien/${k.id}`} className="font-bold text-panel-ink underline">
                      {k.nama}
                    </Link>
                  </Td>
                  <Td className="font-mono text-[12.5px]">{k.padmaId}</Td>
                  <Td>{k.namaFase}</Td>
                  <Td>{k.paketAktif ?? "—"}</Td>
                  <Td className="font-mono text-[12.5px]">{k.sesiSelesai}</Td>
                  <Td>
                    <PillAktivasi aktif={k.aktif} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Tabel>
        </div>
      )}

      <Paginasi basis="/admin/klien" param={param} total={total} />
    </main>
  );
}
