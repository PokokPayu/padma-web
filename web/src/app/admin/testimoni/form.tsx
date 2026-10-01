"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MAKS_BYTE_VIDEO, periksaBerkasVideo } from "@/lib/materi/video";
import {
  buatTestimoni,
  cabutIzinTestimoni,
  catatVideoTestimoni,
  hapusTestimoni,
  konfirmasiIzinTestimoni,
  simpanTestimoni,
  tarikTestimoni,
  terbitkanTestimoni,
  terbitkanUrlUnggahTestimoni,
} from "./aksi";

const KELAS_MEDAN =
  "mt-1 min-h-[42px] w-full rounded-lg border border-panel-border bg-panel-surface px-3 py-2 text-[13.5px]";
const KELAS_LABEL = "block text-[12.5px] font-bold text-panel-muted";
const TOMBOL_UTAMA = "rounded-lg bg-panel-ink px-3 py-2 text-[12px] font-bold text-panel-surface disabled:opacity-50";
const TOMBOL_GARIS =
  "rounded-lg border border-panel-border px-3 py-2 text-[12px] font-bold text-panel-ink disabled:opacity-50";

type Hasil = { ok: true } | { ok: false; pesan: string };

function Pesan({ pesan }: { pesan: { ok: boolean; teks: string } | null }) {
  if (!pesan) return null;
  return <p className={`text-[13px] font-semibold ${pesan.ok ? "text-leaf" : "text-clay"}`}>{pesan.teks}</p>;
}

export function FormTestimoniBaru() {
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);
  return (
    <form
      action={(fd) =>
        mulai(async () => {
          const r = await buatTestimoni(fd);
          if (r.ok) router.push(`/admin/testimoni/${r.id}`);
          else setPesan(r.pesan);
        })
      }
      className="flex flex-wrap items-end gap-2"
    >
      <label className="min-w-[240px] flex-1">
        <span className={KELAS_LABEL}>Nama tampil testimoni baru (mis. inisial)</span>
        <input name="nama" required minLength={2} maxLength={80} className={KELAS_MEDAN} />
      </label>
      <button type="submit" disabled={pending} className={TOMBOL_UTAMA}>
        {pending ? "Membuat…" : "+ Buat draf"}
      </button>
      {pesan && <p className="w-full text-[13px] font-semibold text-clay">{pesan}</p>}
    </form>
  );
}

export function DataTestimoni({
  t,
}: {
  t: { id: string; nama: string; keterangan: string; kutipan: string; urutan: number };
}) {
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<{ ok: boolean; teks: string } | null>(null);
  return (
    <form
      action={(fd) =>
        mulai(async () => {
          const r = await simpanTestimoni(t.id, fd);
          setPesan(r.ok ? { ok: true, teks: "Tersimpan." } : { ok: false, teks: r.pesan });
          if (r.ok) router.refresh();
        })
      }
      className="grid gap-3"
    >
      <label>
        <span className={KELAS_LABEL}>Nama tampil</span>
        <input name="nama" required minLength={2} maxLength={80} defaultValue={t.nama} className={KELAS_MEDAN} />
      </label>
      <label>
        <span className={KELAS_LABEL}>Keterangan (mis. &ldquo;Ibu dari bayi 3 bulan · Shishu Nurturing Academy&rdquo;)</span>
        <input name="keterangan" maxLength={160} defaultValue={t.keterangan} className={KELAS_MEDAN} />
      </label>
      <label>
        <span className={KELAS_LABEL}>Kutipan singkat (opsional)</span>
        <textarea name="kutipan" maxLength={500} rows={3} defaultValue={t.kutipan} className={KELAS_MEDAN} />
      </label>
      <label className="max-w-[160px]">
        <span className={KELAS_LABEL}>Urutan tampil</span>
        <input name="urutan" type="number" step={1} defaultValue={t.urutan} className={KELAS_MEDAN} />
      </label>
      <Pesan pesan={pesan} />
      <div>
        <button type="submit" disabled={pending} className={TOMBOL_UTAMA}>
          {pending ? "Menyimpan…" : "Simpan"}
        </button>
      </div>
    </form>
  );
}

export function StatusTestimoni({
  id,
  nama,
  adaVideo,
  izin,
  terbit,
}: {
  id: string;
  nama: string;
  adaVideo: boolean;
  izin: boolean;
  terbit: boolean;
}) {
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<{ ok: boolean; teks: string } | null>(null);

  const jalankan = (aksi: () => Promise<Hasil>, sukses: string) =>
    mulai(async () => {
      const r = await aksi();
      setPesan(r.ok ? { ok: true, teks: sukses } : { ok: false, teks: r.pesan });
      router.refresh();
    });

  return (
    <div className="grid gap-3 text-[13px]">
      <ul className="grid gap-1 text-panel-ink">
        <li>{adaVideo ? "✓ Video terunggah" : "✗ Video belum diunggah"}</li>
        <li>{izin ? "✓ Izin tertulis keluarga dikonfirmasi" : "✗ Izin keluarga belum dikonfirmasi"}</li>
      </ul>
      <div className="flex flex-wrap gap-2">
        {izin ? (
          <button
            type="button"
            disabled={pending}
            className={TOMBOL_GARIS}
            onClick={() => jalankan(() => cabutIzinTestimoni(id), "Izin dicabut; testimoni tidak lagi tayang.")}
          >
            Cabut izin
          </button>
        ) : (
          <button
            type="button"
            disabled={pending}
            className={TOMBOL_GARIS}
            onClick={() => {
              if (!confirm("Konfirmasi: keluarga ini sudah memberi izin tertulis agar video & kutipannya tayang di situs PADMA?"))
                return;
              jalankan(() => konfirmasiIzinTestimoni(id), "Izin dicatat.");
            }}
          >
            Konfirmasi izin tertulis
          </button>
        )}
        {terbit ? (
          <button
            type="button"
            disabled={pending}
            className={TOMBOL_GARIS}
            onClick={() => jalankan(() => tarikTestimoni(id), "Testimoni ditarik menjadi draf.")}
          >
            Tarik ke draf
          </button>
        ) : (
          <button
            type="button"
            disabled={pending || !adaVideo || !izin}
            className={TOMBOL_UTAMA}
            onClick={() => jalankan(() => terbitkanTestimoni(id), "Testimoni diterbitkan.")}
          >
            Terbitkan
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          className="ml-auto rounded-lg px-3 py-2 text-[12px] font-bold text-clay disabled:opacity-50"
          onClick={() => {
            if (!confirm(`Hapus testimoni "${nama}" beserta videonya? Tindakan ini tidak bisa dibatalkan.`)) return;
            mulai(async () => {
              const r = await hapusTestimoni(id);
              if (!r.ok) return setPesan({ ok: false, teks: r.pesan });
              if (r.objekTersisa) alert("Testimoni terhapus, tetapi berkas videonya gagal dihapus dari penyimpanan.");
              router.push("/admin/testimoni");
            });
          }}
        >
          Hapus
        </button>
      </div>
      <Pesan pesan={pesan} />
    </div>
  );
}

type Keadaan = { fase: "diam" } | { fase: "unggah"; persen: number } | { fase: "sukses" } | { fase: "gagal"; pesan: string };

/** Pengunggah video testimoni — alur yang sama dengan `PengunggahVideo` materi. */
export function VideoTestimoni({ id, adaVideo, versi }: { id: string; adaVideo: boolean; versi: string }) {
  const router = useRouter();
  const [keadaan, setKeadaan] = useState<Keadaan>({ fase: "diam" });
  const berkasRef = useRef<File | null>(null);
  const [adaBerkas, setAdaBerkas] = useState(false);

  async function jalankan(berkas: File) {
    berkasRef.current = berkas;
    setAdaBerkas(true);
    const periksa = periksaBerkasVideo(berkas.type, berkas.size);
    if (!periksa.ok) return setKeadaan({ fase: "gagal", pesan: periksa.pesan });

    setKeadaan({ fase: "unggah", persen: 0 });
    const terbit = await terbitkanUrlUnggahTestimoni(id, periksa.nilai, berkas.size);
    if (!terbit.ok) return setKeadaan({ fase: "gagal", pesan: terbit.pesan });

    const hasil = await new Promise<{ ok: boolean; status: number }>((selesai) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", terbit.url);
      xhr.setRequestHeader("Content-Type", terbit.mime);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setKeadaan({ fase: "unggah", persen: Math.round((e.loaded / e.total) * 100) });
      };
      xhr.onload = () => selesai({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status });
      xhr.onerror = () => selesai({ ok: false, status: xhr.status });
      xhr.send(berkas);
    });
    if (!hasil.ok)
      return setKeadaan({
        fase: "gagal",
        pesan: `Unggahan terputus (kode ${hasil.status}). Berkasnya masih terpilih — coba lagi.`,
      });

    const catat = await catatVideoTestimoni(id, terbit.objek, terbit.mime);
    if (!catat.ok) return setKeadaan({ fase: "gagal", pesan: catat.pesan });
    setKeadaan({ fase: "sukses" });
    router.refresh();
  }

  return (
    <div className="grid gap-3">
      {adaVideo ? (
        <video
          key={versi}
          controls
          playsInline
          preload="metadata"
          src={`/api/testimoni/${id}/video`}
          className="aspect-[9/16] max-h-[480px] w-full rounded-lg bg-black object-contain"
        />
      ) : (
        <p className="text-[13px] text-panel-muted">Belum ada video — unggah di bawah.</p>
      )}
      <div>
        <input
          type="file"
          accept="video/mp4,video/webm"
          disabled={keadaan.fase === "unggah"}
          onChange={(e) => {
            const b = e.target.files?.[0];
            if (b) void jalankan(b);
          }}
        />
        <p className="mt-1 text-[11.5px] text-panel-muted">
          MP4 atau WebM, maksimal {Math.round(MAKS_BYTE_VIDEO / (1024 * 1024))} MB. Mengunggah ulang mengganti video
          lama.
        </p>
        {keadaan.fase === "unggah" && <p className="mt-2 text-[12px]">Mengunggah… {keadaan.persen}%</p>}
        {keadaan.fase === "sukses" && <p className="mt-2 text-[12px] text-leaf">Video tersimpan.</p>}
        {keadaan.fase === "gagal" && (
          <p className="mt-2 text-[12px] text-clay">
            {keadaan.pesan}{" "}
            {adaBerkas && (
              <button
                type="button"
                className="underline"
                onClick={() => {
                  const b = berkasRef.current;
                  if (b) void jalankan(b);
                }}
              >
                Coba lagi
              </button>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
