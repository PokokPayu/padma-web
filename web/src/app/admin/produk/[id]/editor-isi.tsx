"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { BabKelola, MateriKelola } from "@/lib/admin/produk-admin";
import { JENIS_MATERI, LABEL_JENIS_MATERI } from "@/lib/produk/status";
import {
  tambahBab, ubahJudulBab, geserBab, hapusBab,
  tambahMateri, perbaruiMateri, geserMateri, hapusMateri,
} from "./aksi-isi";
import { PengunggahSampul } from "./pengunggah-sampul";
import { PengunggahVideoMateri, PengunggahPdfMateri, LepasIsiMateri } from "./pengunggah-produk";

const KELAS_MEDAN =
  "mt-1 min-h-[36px] w-full rounded-lg border border-panel-border bg-panel-surface px-3 py-1.5 text-[13px]";
const KELAS_TOMBOL =
  "rounded-lg border border-panel-border px-2.5 py-1 text-[12px] font-bold text-panel-ink disabled:opacity-50";

type Hasil = { ok: true } | { ok: false; pesan: string };

const PESAN_OBJEK_TERSISA =
  "Materi terhapus, tetapi sebagian berkas lama gagal dibersihkan. Beri tahu tim teknis.";

/** Satu pola untuk setiap aksi di layar ini: jalankan, tampilkan galat, segarkan. */
function useAksi(onPeringatan?: (teks: string) => void) {
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);
  function jalankan(fn: () => Promise<Hasil | { ok: true; objekTersisa: boolean }>) {
    mulai(async () => {
      const r = await fn();
      if (!r.ok) { setPesan(r.pesan); return; }
      const sisa = "objekTersisa" in r && r.objekTersisa;
      // Baris yang dihapus ikut lenyap saat refresh, jadi peringatannya harus
      // dititipkan ke induk yang tetap terpasang.
      if (sisa && onPeringatan) {
        setPesan(null);
        onPeringatan(PESAN_OBJEK_TERSISA);
      } else {
        setPesan(sisa ? PESAN_OBJEK_TERSISA : null);
      }
      router.refresh();
    });
  }
  return { pending, pesan, setPesan, jalankan };
}

function Pesan({ teks }: { teks: string | null }) {
  return teks ? <p className="text-[12px] font-semibold text-clay">{teks}</p> : null;
}

function BarisMateri({
  productId, produkAktif, materi, pertama, terakhir, onPeringatan,
}: {
  productId: string;
  produkAktif: boolean;
  materi: MateriKelola;
  pertama: boolean;
  terakhir: boolean;
  onPeringatan: (teks: string) => void;
}) {
  const { pending, pesan, jalankan } = useAksi(onPeringatan);

  return (
    <li className="rounded-lg border border-panel-border bg-panel-surface p-3">
      <div className="flex flex-wrap items-start gap-3">
        <PengunggahSampul productId={productId} materiId={materi.id} sampulObjek={materi.sampulObjek} />
        <div className="min-w-0 flex-1">
          <b className="block text-[13px] text-panel-ink">{materi.judul}</b>
          <span className="text-[11.5px] text-panel-muted">
            {LABEL_JENIS_MATERI[materi.jenis]}
            {materi.pratinjau && " · Pratinjau"}
            {materi.bolehUnduh && " · Bisa diunduh"}
            {" · "}
            {materi.berisi
              ? materi.jenis === "pdf" ? `${materi.jumlahHalaman} halaman` : "video tersimpan"
              : <span className="font-bold text-clay">belum berisi</span>}
          </span>
        </div>
        <div className="flex gap-1.5">
          <button type="button" className={KELAS_TOMBOL} disabled={pending || pertama}
            onClick={() => jalankan(() => geserMateri(materi.id, "naik"))} aria-label="Naikkan materi">↑</button>
          <button type="button" className={KELAS_TOMBOL} disabled={pending || terakhir}
            onClick={() => jalankan(() => geserMateri(materi.id, "turun"))} aria-label="Turunkan materi">↓</button>
          <button type="button" className={KELAS_TOMBOL} disabled={pending}
            onClick={() => {
              if (confirm(`Hapus materi "${materi.judul}" beserta isinya? Ini tidak bisa dibatalkan.`)) {
                jalankan(() => hapusMateri(materi.id));
              }
            }}>Hapus</button>
        </div>
      </div>
      <Pesan teks={pesan} />

      <details className="mt-2">
        <summary className="cursor-pointer text-[12px] font-bold text-panel-muted">Sunting & unggah isi</summary>
        <form
          className="mt-2 grid gap-2"
          action={(fd) => jalankan(() => perbaruiMateri(materi.id, fd))}
        >
          <label className="text-[12px] font-bold text-panel-muted">
            Judul
            <input name="judul" required minLength={2} defaultValue={materi.judul} className={KELAS_MEDAN} />
          </label>
          <label className="text-[12px] font-bold text-panel-muted">
            Keterangan
            <textarea name="keterangan" rows={2} defaultValue={materi.keterangan} className={KELAS_MEDAN} />
          </label>
          <label className="text-[12px] font-bold text-panel-muted">
            Jenis
            <select name="jenis" defaultValue={materi.jenis} className={KELAS_MEDAN}>
              {JENIS_MATERI.map((j) => <option key={j} value={j}>{LABEL_JENIS_MATERI[j]}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-[12.5px] text-panel-ink">
            <input name="pratinjau" type="checkbox" defaultChecked={materi.pratinjau} className="h-4 w-4" />
            Pratinjau — bisa dibuka pengguna yang login tanpa membeli
          </label>
          <label className="flex items-center gap-2 text-[12.5px] text-panel-ink">
            <input name="boleh_unduh" type="checkbox" defaultChecked={materi.bolehUnduh} className="h-4 w-4" />
            Boleh diunduh pembeli
          </label>
          <button type="submit" disabled={pending} className={`${KELAS_TOMBOL} justify-self-start`}>
            {pending ? "Menyimpan…" : "Simpan materi"}
          </button>
        </form>

        <div className="mt-3 rounded-lg border border-panel-border bg-panel-bg p-3">
          {materi.jenis === "video" ? (
            <PengunggahVideoMateri materiId={materi.id} />
          ) : (
            <PengunggahPdfMateri materiId={materi.id} bolehUnduh={materi.bolehUnduh} />
          )}
          {!produkAktif && materi.berisi && <LepasIsiMateri materiId={materi.id} />}
        </div>
      </details>
    </li>
  );
}

function KartuBab({
  productId, produkAktif, bab, pertama, terakhir,
}: {
  productId: string;
  produkAktif: boolean;
  bab: BabKelola;
  pertama: boolean;
  terakhir: boolean;
}) {
  const { pending, pesan, setPesan, jalankan } = useAksi();

  return (
    <section className="rounded-lg border border-panel-border bg-panel-bg p-3">
      <div className="flex flex-wrap items-center gap-2">
        <form className="flex flex-1 gap-2" action={(fd) => jalankan(() => ubahJudulBab(bab.id, String(fd.get("judul") ?? "")))}>
          <input name="judul" required defaultValue={bab.judul} aria-label="Judul bab"
            className="min-h-[36px] flex-1 rounded-lg border border-panel-border bg-panel-surface px-3 text-[13px] font-bold" />
          <button type="submit" disabled={pending} className={KELAS_TOMBOL}>Simpan</button>
        </form>
        <span className="text-[11.5px] text-panel-muted">{bab.materi.length} materi</span>
        <button type="button" className={KELAS_TOMBOL} disabled={pending || pertama}
          onClick={() => jalankan(() => geserBab(bab.id, "naik"))} aria-label="Naikkan bab">↑</button>
        <button type="button" className={KELAS_TOMBOL} disabled={pending || terakhir}
          onClick={() => jalankan(() => geserBab(bab.id, "turun"))} aria-label="Turunkan bab">↓</button>
        {bab.materi.length === 0 && (
          <button type="button" className={KELAS_TOMBOL} disabled={pending}
            onClick={() => jalankan(() => hapusBab(bab.id))}>Hapus bab</button>
        )}
      </div>
      <Pesan teks={pesan} />

      <ul className="mt-3 grid gap-2">
        {bab.materi.map((m, i) => (
          <BarisMateri key={m.id} productId={productId} produkAktif={produkAktif} materi={m}
            pertama={i === 0} terakhir={i === bab.materi.length - 1}
            onPeringatan={setPesan} />
        ))}
      </ul>

      <form
        className="mt-3 grid gap-2 rounded-lg border border-dashed border-panel-border p-3 sm:grid-cols-[1fr_140px_auto]"
        action={(fd) => jalankan(() => tambahMateri(bab.id, fd))}
      >
        <input name="judul" required minLength={2} placeholder="Judul materi baru" aria-label="Judul materi baru"
          className="min-h-[36px] rounded-lg border border-panel-border bg-panel-surface px-3 text-[13px]" />
        <select name="jenis" defaultValue="video" aria-label="Jenis materi"
          className="min-h-[36px] rounded-lg border border-panel-border bg-panel-surface px-2 text-[13px]">
          {JENIS_MATERI.map((j) => <option key={j} value={j}>{LABEL_JENIS_MATERI[j]}</option>)}
        </select>
        <button type="submit" disabled={pending} className={KELAS_TOMBOL}>+ Materi</button>
        <input type="hidden" name="keterangan" value="" />
      </form>
    </section>
  );
}

export function EditorIsi({
  productId, produkAktif, bab,
}: {
  productId: string;
  produkAktif: boolean;
  bab: BabKelola[];
}) {
  const { pending, pesan, jalankan } = useAksi();

  return (
    <div className="grid gap-3">
      {bab.length === 0 && (
        <p className="text-[12.5px] italic text-panel-muted">
          Belum ada bab. Produk kecil cukup punya satu bab, misalnya &ldquo;Materi&rdquo;.
        </p>
      )}
      {bab.map((b, i) => (
        <KartuBab key={b.id} productId={productId} produkAktif={produkAktif} bab={b}
          pertama={i === 0} terakhir={i === bab.length - 1} />
      ))}
      <form className="flex gap-2" action={(fd) => jalankan(() => tambahBab(productId, String(fd.get("judul") ?? "")))}>
        <input name="judul" required placeholder="Judul bab baru" aria-label="Judul bab baru"
          className="min-h-[36px] flex-1 rounded-lg border border-panel-border bg-panel-surface px-3 text-[13px]" />
        <button type="submit" disabled={pending}
          className="rounded-lg bg-panel-ink px-3 py-1.5 text-[12px] font-bold text-panel-surface disabled:opacity-60">
          + Bab
        </button>
      </form>
      <Pesan teks={pesan} />
    </div>
  );
}
