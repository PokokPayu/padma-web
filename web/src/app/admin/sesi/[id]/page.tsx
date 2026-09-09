import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { ambilDetailSesi, type SkriningPenopang } from "@/lib/admin/sesi-detail";
import { bacaPengaturan } from "@/lib/settings";
import { formatTanggalID } from "@/lib/passport/waktu";
import { formatJam, jamDariDb } from "@/lib/jadwal/jam";
import { LABEL_JENJANG } from "@/lib/transport/jarak";
import { PAKET_TAMPIL } from "@/lib/paket-tampil";
import { PanelSesi } from "../panel-sesi";
import { LABEL_STATUS_SESI, KELAS_PILL_SESI } from "../status";
import { PengunggahSertifikat } from "./pengunggah-sertifikat";

export const metadata = { title: "Detail Sesi" };

/**
 * Satu sesi, selengkapnya — termasuk SKRINING YANG MENOPANGNYA.
 *
 * Sebelum halaman ini ada, rantai `sessions` → `booking_requests` →
 * `screenings` sudah utuh di basis data tetapi tidak pernah ditempuh satu pun
 * layar: bidan yang hendak tahu kondisi klien sebelum berangkat harus menebak
 * kodenya lalu mencarinya di Inbox Skrining. Bagian "Skrining penopang" di
 * bawah menutup jarak itu.
 *
 * NOL RUPIAH, seperti seluruh modul Sesi: jenjang transport tampil sebagai
 * JARAK ("5–10 km"), tidak pernah sebagai nominal.
 */
export default async function DetailSesiPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole(["admin", "owner"]);
  const { id } = await params; // Next 16: `params` adalah Promise

  const [sesi, { jamLayanan }] = await Promise.all([ambilDetailSesi(id), bacaPengaturan()]);

  // Tidak ketemu ATAU tidak boleh dibaca — dua-duanya `null`, dan dua-duanya
  // berakhir sama. Membedakannya di layar akan membocorkan keberadaan sesi
  // yang tidak boleh dilihat pemanggilnya.
  if (!sesi) notFound();

  // Dibaca lewat sesi pengguna: policy "sertifikat: staf kelola" yang
  // memutuskan, bukan service role.
  const supabase = await createServerSupabase();
  const { data: sertifikat } = await supabase
    .from("certificates")
    .select("objek, created_at")
    .eq("session_id", sesi.id)
    .maybeSingle<{ objek: string; created_at: string }>();

  return (
    <main>
      <Link
        href="/admin/sesi?tab=sesi"
        className="mb-3.5 inline-block rounded-xl border border-panel-border bg-panel-surface px-4 py-2 text-[13px] font-bold"
      >
        ← Kembali ke daftar sesi
      </Link>

      <header className="mb-4 rounded-lg border border-panel-border bg-panel-surface p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-serif text-2xl text-panel-ink">{sesi.namaLayanan}</h1>
            <p className="mt-1 text-[13px] text-panel-muted">
              {/* Nama klien adalah TAUTAN, bukan teks: dari sesi ke kliennya
                  adalah langkah yang paling sering diambil admin, dan
                  sebaliknya sudah tersedia lewat riwayat di halaman klien. */}
              <Link
                href={`/admin/klien/${sesi.klienId}`}
                className="font-bold text-leaf underline underline-offset-4"
              >
                {sesi.namaKlien}
              </Link>{" "}
              <span className="font-mono text-xs">{sesi.padmaId}</span>
            </p>
          </div>
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${KELAS_PILL_SESI[sesi.status]}`}
          >
            {LABEL_STATUS_SESI[sesi.status]}
          </span>
        </div>

        <dl className="mt-4 grid gap-3 text-[13.5px] sm:grid-cols-3">
          <Medan judul="Jadwal">
            {formatTanggalID(sesi.tanggal)} · {formatJam(jamDariDb(sesi.jamMulai))}
          </Medan>
          <Medan judul="Bidan">{sesi.namaMitra}</Medan>
          <Medan judul="Jenjang transport">
            {sesi.jenjang ? LABEL_JENJANG[sesi.jenjang] : "belum ditetapkan"}
          </Medan>
          <Medan judul="Alamat">{sesi.alamat || "—"}</Medan>
          <Medan judul="Paket">{sesi.dalamPaket ? PAKET_TAMPIL : "Sesi satuan"}</Medan>
        </dl>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <KartuSkrining skrining={sesi.skrining} adaPengajuan={sesi.skrining !== null} />

        <section className="rounded-lg border border-panel-border bg-panel-surface p-5">
          <h2 className="mb-3 font-serif text-lg text-panel-ink">Tindakan</h2>
          {/* Panel yang sama persis dengan yang dipakai daftar sesi — bukan
              salinannya. Dua formulir "Tandai selesai" yang harus berperilaku
              identik selamanya adalah persis jenis kembaran yang akhirnya
              menyimpang. */}
          <PanelSesi sesi={sesi} jamPilihan={jamLayanan} />

          {/* Hanya untuk sesi yang SELESAI. Sertifikat kunjungan yang belum
              terjadi adalah pernyataan yang tidak benar — digerbang di sini demi
              layar yang jujur, dan di trigger basis data demi kebenaran yang tidak
              bergantung pada layar. */}
          {sesi.status === "selesai" && (
            <div className="mt-5 border-t border-panel-border pt-4">
              <h2 className="mb-1 text-[13px] font-bold text-panel-ink">Sertifikat</h2>
              <p className="mb-3 text-[12px] text-panel-muted">
                {sertifikat
                  ? "Sudah terbit — klien bisa membukanya dari badge Pencapaian dan halaman Materi."
                  : "Belum ada. PDF, JPEG, atau WEBP, maksimal 5 MB."}
              </p>
              <PengunggahSertifikat sessionId={sesi.id} sudahAda={Boolean(sertifikat)} />
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function Medan({ judul, children }: { judul: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11.5px] font-bold uppercase tracking-wider text-panel-muted">
        {judul}
      </dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

/**
 * Skrining penopang, dalam bentuk yang SAMA PERSIS dengan laci Inbox Skrining.
 *
 * Kesamaannya disengaja: staf yang sudah membaca bendera di Inbox tidak boleh
 * harus belajar bentuk kedua untuk data yang sama. Termasuk aturan
 * penandanya — URGENT dihitung dari LEVEL bendera, bukan dari warna hasil.
 */
function KartuSkrining({
  skrining,
  adaPengajuan,
}: {
  skrining: SkriningPenopang | null;
  adaPengajuan: boolean;
}) {
  return (
    <section className="rounded-lg border border-panel-border bg-panel-surface p-5">
      <h2 className="mb-3 font-serif text-lg text-panel-ink">Skrining penopang</h2>

      {skrining === null || !adaPengajuan ? (
        // Keadaan SAH, bukan galat — dan dikatakan apa adanya. "Tidak ada
        // skrining" tanpa sebabnya terbaca seperti data yang hilang.
        <p className="text-[13px] italic text-panel-muted">
          Sesi ini dijadwalkan admin langsung, tanpa pengajuan dari klien — jadi tidak ada
          skrining yang menopangnya.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              <span className="font-mono text-xs">{skrining.kode}</span>
              <span className="mt-0.5 block text-[11.5px] text-panel-muted">
                {formatTanggalID(skrining.dibuatPada.slice(0, 10))}
              </span>
            </span>
            <span
              className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${
                skrining.hasil === "hijau" ? "bg-leaf-soft text-leaf" : "bg-clay/10 text-clay"
              }`}
            >
              {skrining.hasil === "hijau"
                ? "HIJAU"
                : skrining.flags.some((f) => f.level === "urgent")
                  ? "MERAH · URGENT"
                  : "MERAH"}
            </span>
          </div>

          {skrining.flags.length === 0 ? (
            <p className="mt-3 text-[13px]">
              Semua pertanyaan dijawab <b>Tidak</b> — tidak ada bendera.
            </p>
          ) : (
            <>
              <p className="mt-3 text-[13px] font-bold">
                Jawaban &ldquo;Ya&rdquo; yang perlu diperhatikan:
              </p>
              <ul className="mt-2 list-disc pl-5 text-[13px] text-[#54463C]">
                {skrining.flags.map((f) => (
                  <li key={f.id}>
                    {f.teks}
                    {f.level === "urgent" && (
                      <span className="ml-2 rounded bg-clay/10 px-1.5 py-0.5 text-[10.5px] font-extrabold text-clay">
                        URGENT
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}

          <Link
            href={`/admin/skrining?cari=${skrining.kode}`}
            className="mt-3 inline-block text-[13px] font-bold text-leaf underline underline-offset-4"
          >
            Buka di Inbox Skrining
          </Link>
        </>
      )}
    </section>
  );
}
