import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { FormKlienBaru } from "./form-klien";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: "Klien" };

type BarisKlien = {
  id: string;
  padma_id: string;
  nama: string;
  email: string;
  phase_id: string;
  user_id: string | null;
};

type BarisPaket = {
  client_id: string;
  status: string;
  packages: { nama: string; jumlah_sesi: number } | null;
};

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

export default async function DaftarKlienPage() {
  await requireRole(["admin", "owner"]);

  // Sesi pengguna, bukan service role: policy `clients: staf` yang mengizinkan
  // daftar ini terbaca, dan itulah yang ingin diuji ikut berjalan.
  const supabase = await createServerSupabase();

  const [{ data: klien }, { data: fase }, { data: paket }, { data: sesiSelesai }] =
    await Promise.all([
      supabase
        .from("clients")
        .select("id, padma_id, nama, email, phase_id, user_id")
        .order("created_at", { ascending: false })
        .returns<BarisKlien[]>(),
      supabase
        .from("phases")
        .select("id, nama, urutan")
        .order("urutan")
        .returns<{ id: string; nama: string; urutan: number }[]>(),
      // Hanya paket yang masih berjalan yang menjadi identitas baris klien;
      // paket lama tidak menggantikan gambaran "sedang menjalani apa".
      supabase
        .from("client_packages")
        .select("client_id, status, packages ( nama, jumlah_sesi )")
        .eq("status", "aktif")
        .returns<BarisPaket[]>(),
      // Sesi dihitung di sini, bukan lewat agregat tertanam PostgREST: filter
      // pada sumber tertanam mengubah arti gabungannya dan gampang menghitung
      // sesi milik klien lain tanpa error apa pun.
      supabase
        .from("sessions")
        .select("client_id")
        .eq("status", "selesai")
        .returns<{ client_id: string }[]>(),
    ]);

  const labelFase = new Map((fase ?? []).map((f) => [f.id, f.nama]));
  const paketAktif = new Map((paket ?? []).map((p) => [p.client_id, p.packages]));

  const selesaiPerKlien = new Map<string, number>();
  for (const s of sesiSelesai ?? []) {
    selesaiPerKlien.set(s.client_id, (selesaiPerKlien.get(s.client_id) ?? 0) + 1);
  }

  const baris = klien ?? [];

  return (
    <main>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl text-night">Klien</h1>
          <p className="mt-1 max-w-xl text-[13px] text-ink-soft">
            Data klien dibuat di sini. Akunnya baru hidup setelah klien membuka
            tautan aktivasi yang Anda kirim — sampai saat itu statusnya
            &ldquo;Belum aktif&rdquo;.
          </p>
        </div>
        <FormKlienBaru fase={fase ?? []} />
      </header>

      {baris.length === 0 ? (
        <p className="rounded-2xl border border-black/10 bg-white p-8 text-center text-sm italic text-ink-soft">
          Belum ada klien terdaftar. Mulai dari tombol &ldquo;+ Klien
          baru&rdquo;.
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-black/10 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[13.5px]">
              <thead>
                <tr className="border-b-[1.5px] border-black/10 bg-paper text-[11px] uppercase tracking-wider text-ink-soft">
                  <th className="p-4 text-left font-extrabold">PADMA ID</th>
                  <th className="p-4 text-left font-extrabold">Nama</th>
                  <th className="p-4 text-left font-extrabold">Fase</th>
                  <th className="p-4 text-left font-extrabold">Paket</th>
                  <th className="p-4 text-left font-extrabold">Sesi selesai</th>
                  <th className="p-4 text-left font-extrabold">Aktivasi</th>
                </tr>
              </thead>
              <tbody>
                {baris.map((k) => {
                  const p = paketAktif.get(k.id);
                  return (
                    <tr key={k.id} className="border-b border-black/5">
                      <td className="p-4">
                        <Link
                          href={`/admin/klien/${k.id}`}
                          className="font-mono text-xs font-bold text-leaf underline underline-offset-4"
                        >
                          {k.padma_id}
                        </Link>
                      </td>
                      <td className="p-4">
                        <b>{k.nama}</b>
                        <span className="mt-0.5 block text-[11.5px] text-ink-soft">
                          {k.email}
                        </span>
                      </td>
                      <td className="p-4">{labelFase.get(k.phase_id) ?? k.phase_id}</td>
                      <td className="p-4">
                        {p ? (
                          `${p.nama} · ${p.jumlah_sesi} sesi`
                        ) : (
                          <span className="text-ink-soft">Sesi lepas</span>
                        )}
                      </td>
                      <td className="p-4 font-mono">{selesaiPerKlien.get(k.id) ?? 0}</td>
                      <td className="p-4">
                        <PillAktivasi aktif={k.user_id !== null} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}
