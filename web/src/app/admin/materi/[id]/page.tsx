import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { ambilMateri, pilihanKlien, pilihanLayananMateri } from "@/lib/admin/materi-admin";
import { daftarPenugasan } from "@/lib/admin/penugasan";
import { Kartu } from "@/app/_shell/panel/kartu";
import { AksiMateri, CentangLayanan, IsiEbook, IsiVideo, PanelPenugasan } from "../form-materi";
import { LABEL_TIPE, type TipeMateri } from "../status";

export const metadata = { title: "Detail materi" };

const BASIS = "/admin/materi";

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
 * Halaman detail materi — pola B (spec K1).
 *
 * Materi punya SATU daftar anak yang sungguh butuh layarnya sendiri:
 * penugasan manual per klien. Menyesakkannya ke dalam panel geser selebar
 * setengah layar (bersama isi & layanan tertaut) mengulangi kesalahan yang
 * sama seperti formulir di dalam sel tabel — hanya dengan wadah yang berbeda.
 */
export default async function DetailMateriPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole(["admin", "owner"]);

  const { id } = await params;

  const materi = await ambilMateri(id);
  // `notFound()`, bukan halaman kosong: URL yang salah ketik harus menjawab
  // 404, bukan 200 berisi kerangka tanpa isi.
  if (!materi) notFound();

  const [layananPilihan, klien, penugasan] = await Promise.all([
    pilihanLayananMateri(),
    pilihanKlien(),
    daftarPenugasan(id),
  ]);

  return (
    <main>
      <Link href={BASIS} className="text-[12px] font-bold text-panel-muted">
        ‹ Kembali ke Materi
      </Link>

      <header className="mb-4 mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-bold text-panel-ink">{materi.judul}</h1>
          <p className="mt-0.5 text-[12.5px] text-panel-muted">
            {materi.deskripsi || "Belum ada deskripsi."}
          </p>
        </div>
        <span className="flex items-center gap-2">
          <PillTipe tipe={materi.tipe} />
          <PillAktif aktif={materi.aktif} />
        </span>
      </header>

      <div className="grid gap-3">
        <Kartu judul="Data materi">
          <AksiMateri
            id={materi.id}
            judul={materi.judul}
            deskripsi={materi.deskripsi}
            tipe={materi.tipe}
            aktif={materi.aktif}
            lengkap={materi.lengkap}
            layananId={materi.layananId}
            layanan={layananPilihan}
          />
        </Kartu>

        <Kartu judul="Isi">
          {materi.tipe === "ebook" ? (
            <IsiEbook materiId={materi.id} jumlahHalaman={materi.jumlahHalaman} />
          ) : (
            <IsiVideo materiId={materi.id} aktif={materi.aktif} objekVideo={materi.objekVideo} />
          )}
        </Kartu>

        {/*
          Bacaan saja, sengaja — SATU-SATUNYA penulis relasi
          `material_services` untuk materi ini tetap formulir "Ubah" di Kartu
          "Data materi" (AksiMateri), yang mengirim `service_id` bersamaan
          dengan judul/tipe/deskripsi dalam satu `perbaruiMateri()`. Kartu ini
          hanya menjawab "layanan apa saja yang sudah menaut materi ini" tanpa
          staf perlu membuka mode Ubah — dua tempat yang bisa menulis satu
          relasi yang sama adalah persis kelas bug yang membuat Kartu "Materi
          yang termasuk layanan ini" di layanan/[id]/page.tsx bacaan saja
          untuk arah sebaliknya (lihat komentarnya di sana).

          `pilihanLayananMateri()` hanya memuat layanan AKTIF — sama seperti
          sumber yang sudah dipakai formulir Ubah hari ini — jadi materi yang
          tertaut ke layanan yang SUDAH dipensiunkan tidak akan tampil di
          daftar ini. Keterbatasan ini sudah ada sebelum Tugas 11 (warisan
          bentuk `pilihan` di halaman daftar lama); tidak diperbaiki di sini
          karena bukan bagian dari lingkup tugas ini.
        */}
        <Kartu judul="Layanan tertaut">
          {layananPilihan.length === 0 ? (
            <p className="text-[12.5px] italic text-panel-muted">
              Belum ada layanan aktif yang bisa ditautkan.
            </p>
          ) : (
            <CentangLayanan
              layanan={layananPilihan}
              terpilih={materi.layananId}
              labelUntuk={(nama) => `Layanan ${nama} untuk materi ${materi.judul}`}
              disabled
            />
          )}
        </Kartu>

        <Kartu judul="Penugasan manual">
          <PanelPenugasan
            materiId={materi.id}
            judulMateri={materi.judul}
            ditugaskan={penugasan.ditugaskan}
            otomatis={penugasan.otomatis}
            pilihan={klien}
          />
        </Kartu>
      </div>
    </main>
  );
}
