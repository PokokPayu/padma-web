import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { ambilDaftarSkrining, SARING_SKRINING } from "@/lib/admin/skrining";
import { LABEL_STATUS } from "./status";
import { uraikanParamDaftar, type ParamMentah } from "@/app/_shell/panel/daftar";
import { BilahDaftar } from "@/app/_shell/panel/bilah-daftar";
import { Paginasi } from "@/app/_shell/panel/paginasi";
import { Bantuan } from "@/app/_shell/panel/bantuan";
import { TabelInbox } from "./tabel-inbox";

export const metadata = { title: "Inbox Skrining" };

const BASIS = "/admin/skrining";

export default async function InboxSkriningPage({
  searchParams,
}: {
  searchParams: Promise<ParamMentah>;
}) {
  await requireRole(["admin", "owner"]);

  const param = uraikanParamDaftar(await searchParams, SARING_SKRINING);
  const supabase = await createServerSupabase();

  const [{ baris, total }, { data: fase }] = await Promise.all([
    ambilDaftarSkrining(param),
    // Nama fase datang dari tabel `phases`, tidak pernah disalin sebagai
    // literal ke komponen.
    supabase
      .from("phases")
      .select("id, nama, urutan")
      .order("urutan")
      .returns<{ id: string; nama: string; urutan: number }[]>(),
  ]);

  return (
    <main>
      <header className="mb-4">
        <h1 className="text-[18px] font-bold text-panel-ink">Inbox Skrining</h1>
        <Bantuan judul="Tentang halaman ini">
          Saat pesan WhatsApp masuk, cocokkan kodenya di sini untuk melihat jawaban asli — bukan
          sekadar percaya isi pesan. Penanda <b>URGENT</b> dihitung dari level bendera, bukan dari
          warna hasil: demam pada ibu hamil dan benjolan menopause sama-sama merah, tetapi hanya
          yang pertama perlu ditangani hari ini.
        </Bantuan>
      </header>

      <BilahDaftar
        basis={BASIS}
        param={param}
        kelompok={[
          {
            nama: "tindak",
            label: "Tindak lanjut",
            pilihan: [
              { nilai: "baru", label: LABEL_STATUS.baru, menuntut: true },
              { nilai: "dihubungi", label: LABEL_STATUS.dihubungi },
              { nilai: "jadi_klien", label: LABEL_STATUS.jadi_klien },
              { nilai: "ditolak", label: LABEL_STATUS.ditolak },
            ],
          },
          {
            nama: "hasil",
            label: "Hasil",
            pilihan: [
              { nilai: "merah", label: "Merah", menuntut: true },
              { nilai: "hijau", label: "Hijau" },
            ],
          },
        ]}
        jumlah={baris.length}
        total={total}
        // Skrining lahir dari pengunjung yang mengisi formulir publik, tidak
        // pernah diketik admin — karena itu tidak ada tombol "+ baru".
        aksi={null}
      />

      {baris.length === 0 ? (
        <p className="rounded-lg border border-panel-border bg-panel-surface p-8 text-center text-[13px] italic text-panel-muted">
          {/* Dua sebab, dua kalimat — hanya `page.tsx` tahu bedanya karena
              hanya di sini `param` (cari + saring) terlihat sekaligus. */}
          {param.cari === "" && Object.keys(param.saring).length === 0 ? (
            <>
              Belum ada hasil skrining masuk. Begitu ada pengunjung mengisi skrining, entrinya
              muncul di sini.
            </>
          ) : (
            "Tidak ada hasil skrining yang cocok dengan pencarian ini."
          )}
        </p>
      ) : (
        <TabelInbox baris={baris} fase={fase ?? []} />
      )}

      <Paginasi basis={BASIS} param={param} total={total} />
    </main>
  );
}
