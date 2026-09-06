"use client";

import { useState, useTransition } from "react";
import { labelVarian, type FormatVarian } from "@/lib/varian";
import { aktifkanVarian, buatVarian, nonaktifkanVarian, perbaruiVarian } from "./aksi";
import {
  DURASI_VARIAN_MAKS_MENIT,
  PANJANG_LABEL_VARIAN_MAKS,
  URUTAN_VARIAN_MAKS,
} from "./status";

/**
 * Blok "Varian" satu layanan — berkas TERPISAH dari `form-layanan.tsx`,
 * bukan ditambahkan ke sana. Layanan/Paket punya 2-3 medan formulir; varian
 * membawa EMPAT (label, durasi, format, urutan) plus pagar "aktif terakhir"
 * yang tidak dimiliki keduanya. Menumpuknya di `AksiLayanan` yang sudah ada
 * akan membuat berkas itu mengelola tiga entitas sekaligus dari satu fungsi.
 *
 * Token gaya (KELAS_*) di bawah SENGAJA disalin dari `form-layanan.tsx`,
 * bukan diimpor: keduanya cuma string Tailwind statis, dan mengimpornya akan
 * membuat dua berkas client component saling mengimpor satu sama lain
 * (`form-layanan.tsx` butuh `FormVarianBaru` dari sini untuk tombol
 * "+ Varian") — lingkaran impor untuk empat baris kelas bukan pertukaran
 * yang sepadan.
 */
const KELAS_MEDAN =
  "mt-1 min-h-[42px] w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-[13.5px]";
const KELAS_LABEL = "block text-[12.5px] font-bold text-ink-soft";
const KELAS_TOMBOL_KECIL =
  "rounded-lg border border-black/15 px-3 py-1.5 text-[12px] font-bold text-ink-soft disabled:opacity-60";
const KELAS_TOMBOL_UTAMA =
  "rounded-lg bg-night px-3 py-1.5 text-[12px] font-bold text-gold-pale disabled:opacity-60";

export type VarianTampil = {
  id: string;
  label: string;
  durasiMenit: number | null;
  format: FormatVarian | null;
  urutan: number;
  aktif: boolean;
  sesiTercatat: number;
};

function OpsiFormat() {
  return (
    <>
      <option value="">— tidak dibedakan —</option>
      <option value="private">Private</option>
      <option value="circle">Circle</option>
    </>
  );
}

function BarisVarian({ v }: { v: VarianTampil }) {
  const [ubah, setUbah] = useState(false);
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);
  // Varian baku (label kosong, durasi & format NULL) tidak punya apa pun
  // untuk ditampilkan sebagai namanya sendiri — jatuh ke teks penjelas, sama
  // dengan keputusan tampilan `BarisLayanan` di `owner/tarif/page.tsx`.
  const namaTampilan = labelVarian(v) || "Varian baku (mengikuti nama layanan)";

  if (ubah) {
    return (
      <li className="rounded-lg border border-black/10 p-2.5">
        <form
          action={(fd) =>
            mulai(async () => {
              const r = await perbaruiVarian(fd);
              if (r.ok) {
                setPesan(null);
                setUbah(false);
              } else {
                setPesan(r.pesan);
              }
            })
          }
          className="grid gap-2"
        >
          {/* `varian` mengidentifikasi baris yang diubah. TIDAK ADA medan
              `service_id` di sini — `perbaruiVarian` tidak pernah membacanya,
              dan formulir yang tidak menawarkannya membuat niat itu terlihat
              di layar juga, bukan cuma di server. */}
          <input type="hidden" name="varian" value={v.id} />
          <label>
            <span className={KELAS_LABEL}>Nama varian (opsional)</span>
            <input
              name="label"
              type="text"
              maxLength={PANJANG_LABEL_VARIAN_MAKS}
              defaultValue={v.label}
              placeholder="mis. Basic, Couple, 2 modul"
              aria-label={`Nama varian ${namaTampilan}`}
              className={KELAS_MEDAN}
            />
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            <label>
              <span className={KELAS_LABEL}>Durasi (menit, opsional)</span>
              <input
                name="durasi_menit"
                type="number"
                min={1}
                max={DURASI_VARIAN_MAKS_MENIT}
                defaultValue={v.durasiMenit ?? ""}
                aria-label={`Durasi varian ${namaTampilan}`}
                className={KELAS_MEDAN}
              />
            </label>
            <label>
              <span className={KELAS_LABEL}>Format (opsional)</span>
              <select
                name="format"
                defaultValue={v.format ?? ""}
                aria-label={`Format varian ${namaTampilan}`}
                className={KELAS_MEDAN}
              >
                <OpsiFormat />
              </select>
            </label>
          </div>
          <label>
            <span className={KELAS_LABEL}>Urutan tampil</span>
            <input
              name="urutan"
              type="number"
              min={0}
              max={URUTAN_VARIAN_MAKS}
              defaultValue={v.urutan}
              aria-label={`Urutan varian ${namaTampilan}`}
              className={KELAS_MEDAN}
            />
          </label>
          {pesan && <span className="text-[12px] font-semibold text-clay">{pesan}</span>}
          <span className="flex gap-2">
            <button type="submit" disabled={pending} className={KELAS_TOMBOL_UTAMA}>
              {pending ? "Menyimpan…" : "Simpan"}
            </button>
            <button
              type="button"
              onClick={() => {
                setUbah(false);
                setPesan(null);
              }}
              className={KELAS_TOMBOL_KECIL}
            >
              Batal
            </button>
          </span>
        </form>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-2.5 rounded-lg border border-black/10 p-2.5">
      <span className="min-w-[180px] flex-1">
        <b className="text-[13px] text-ink">{namaTampilan}</b>
        <span className="block text-[11.5px] text-ink-soft">
          {v.sesiTercatat > 0
            ? `${v.sesiTercatat} sesi tercatat memakai varian ini.`
            : "Belum dipakai sesi mana pun."}
        </span>
      </span>
      <span
        className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${
          v.aktif ? "bg-leaf-soft text-leaf" : "bg-clay/10 text-clay"
        }`}
      >
        {v.aktif ? "Aktif" : "Nonaktif"}
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setUbah(true)} className={KELAS_TOMBOL_KECIL}>
          Ubah
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            // Dua action terpisah dipanggil lewat FormData yang dirakit di
            // sini, bukan satu action bernilai `!aktif`: keadaan tujuan tidak
            // pernah menyeberang batas server sebagai data.
            mulai(async () => {
              const fd = new FormData();
              fd.set("varian", v.id);
              const r = v.aktif ? await nonaktifkanVarian(fd) : await aktifkanVarian(fd);
              setPesan(r.ok ? null : r.pesan);
            })
          }
          className={KELAS_TOMBOL_KECIL}
        >
          {v.aktif ? "Nonaktifkan" : "Aktifkan"}
        </button>
      </span>
      {pesan && <span className="w-full text-[12px] font-semibold text-clay">{pesan}</span>}
    </li>
  );
}

function FormVarianBaru({
  serviceId,
  namaLayanan,
  selesai,
}: {
  serviceId: string;
  namaLayanan: string;
  selesai: () => void;
}) {
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);

  return (
    <form
      action={(fd) =>
        mulai(async () => {
          const r = await buatVarian(fd);
          if (r.ok) {
            setPesan(null);
            selesai();
          } else {
            setPesan(r.pesan);
          }
        })
      }
      className="mt-2 grid gap-2 rounded-xl border-[1.5px] border-dashed border-gold bg-[#FDFAF1] p-3"
    >
      {/* `service_id` terikat pada layanan yang sedang dibuka, sama seperti
          `FormPaketBaru` — server tetap memeriksanya ulang karena argumen
          action pun masukan jaringan. */}
      <input type="hidden" name="service_id" value={serviceId} />
      <label>
        <span className={KELAS_LABEL}>Nama varian untuk {namaLayanan} (opsional)</span>
        <input
          name="label"
          type="text"
          maxLength={PANJANG_LABEL_VARIAN_MAKS}
          placeholder="mis. Basic, Couple, 2 modul — kosongkan bila tidak ada"
          className={KELAS_MEDAN}
        />
      </label>
      <div className="grid gap-2 sm:grid-cols-2">
        <label>
          <span className={KELAS_LABEL}>Durasi (menit, opsional)</span>
          <input
            name="durasi_menit"
            type="number"
            min={1}
            max={DURASI_VARIAN_MAKS_MENIT}
            placeholder="mis. 90"
            className={KELAS_MEDAN}
          />
        </label>
        <label>
          <span className={KELAS_LABEL}>Format (opsional)</span>
          <select name="format" defaultValue="" className={KELAS_MEDAN}>
            <OpsiFormat />
          </select>
        </label>
      </div>
      <label>
        <span className={KELAS_LABEL}>Urutan tampil</span>
        <input
          name="urutan"
          type="number"
          min={0}
          max={URUTAN_VARIAN_MAKS}
          defaultValue={0}
          className={KELAS_MEDAN}
        />
      </label>
      {pesan && <span className="text-[12px] font-semibold text-clay">{pesan}</span>}
      <span className="flex gap-2">
        <button type="submit" disabled={pending} className={KELAS_TOMBOL_UTAMA}>
          {pending ? "Menyimpan…" : "Simpan varian"}
        </button>
        <button type="button" onClick={selesai} className={KELAS_TOMBOL_KECIL}>
          Batal
        </button>
      </span>
    </form>
  );
}

/**
 * Daftar varian satu layanan + jalan menambah yang baru. Dipanggil langsung
 * dari `page.tsx`, sejajar dengan daftar Paket yang dirender di sana — bukan
 * dari dalam `AksiLayanan`, supaya berkas ini bisa berdiri sendiri.
 */
export function BlokVarian({
  serviceId,
  namaLayanan,
  varian,
}: {
  serviceId: string;
  namaLayanan: string;
  varian: VarianTampil[];
}) {
  const [tambah, setTambah] = useState(false);

  return (
    <div className="mt-3 border-t border-black/5 pt-3">
      <p className="text-[11.5px] font-bold uppercase tracking-wide text-ink-soft">
        Varian — durasi, format, atau program bernama
      </p>
      <ul className="mt-1.5 grid gap-1.5">
        {varian.map((v) => (
          <BarisVarian key={v.id} v={v} />
        ))}
      </ul>
      {tambah ? (
        <FormVarianBaru
          serviceId={serviceId}
          namaLayanan={namaLayanan}
          selesai={() => setTambah(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setTambah(true)}
          className={`mt-2 ${KELAS_TOMBOL_KECIL}`}
        >
          + Varian
        </button>
      )}
    </div>
  );
}
