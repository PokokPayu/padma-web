"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { labelVarian, type FormatVarian } from "@/lib/varian";
import { aktifkanVarian, buatVarian, nonaktifkanVarian, perbaruiVarian } from "./aksi";
import {
  DURASI_VARIAN_MAKS_MENIT,
  PANJANG_LABEL_VARIAN_MAKS,
  URUTAN_VARIAN_MAKS,
} from "./status";

const KELAS_MEDAN =
  "mt-1 min-h-[42px] w-full rounded-lg border border-panel-border bg-panel-surface px-3 py-2 text-[13.5px] text-panel-ink";
const KELAS_LABEL = "block text-[12.5px] font-bold text-panel-muted";
const KELAS_TOMBOL_KECIL =
  "rounded-lg border border-panel-border px-3 py-1.5 text-[12px] font-bold text-panel-ink disabled:opacity-60";
const KELAS_TOMBOL_UTAMA =
  "rounded-lg bg-panel-ink px-3 py-1.5 text-[12px] font-bold text-panel-surface disabled:opacity-60";

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

/**
 * Isi panel geser varian: formulir SATU varian, baru maupun ubah.
 *
 * `varian === null` berarti varian baru. Satu komponen untuk keduanya, bukan
 * dua — pola yang sama dengan `FormMitra` sejak rencana 1: dua komponen yang
 * hampir identik berpisah diam-diam pada perubahan berikutnya.
 *
 * Menggantikan `BlokVarian`/`BarisVarian`/`FormVarianBaru` (Tugas 7 dan
 * sebelumnya): daftar varian kini dirender `page.tsx` sendiri, jadi berkas ini
 * tidak lagi butuh gerbang buka/tutup atau daftar `<li>` miliknya sendiri —
 * hanya formulir satu baris yang `PanelGeser` bungkus dari luar.
 */
export function FormVarian({
  serviceId,
  namaLayanan,
  varian,
  hrefTutup,
}: {
  serviceId: string;
  namaLayanan: string;
  varian: VarianTampil | null;
  hrefTutup: string;
}) {
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);
  // Varian baku (label kosong, durasi & format NULL) tidak punya apa pun untuk
  // ditampilkan sebagai namanya sendiri — jatuh ke teks penjelas, sama dengan
  // keputusan tampilan lama `BarisVarian` dan `BarisLayanan` di `owner/tarif`.
  const namaTampilan = varian
    ? labelVarian(varian) || "Varian baku (mengikuti nama layanan)"
    : null;

  return (
    <div className="grid gap-3">
      {varian === null ? (
        <p className="text-[12.5px] text-panel-muted">
          Varian baru untuk <b className="text-panel-ink">{namaLayanan}</b>.
        </p>
      ) : (
        <p className="text-[12.5px] text-panel-muted">
          {namaTampilan} ·{" "}
          {varian.sesiTercatat > 0
            ? `${varian.sesiTercatat} sesi tercatat memakai varian ini.`
            : "Belum dipakai sesi mana pun."}
        </p>
      )}

      <form
        action={(fd) =>
          mulai(async () => {
            const r = varian ? await perbaruiVarian(fd) : await buatVarian(fd);
            if (r.ok) {
              setPesan(null);
              // Menutup panel DENGAN kembali ke halaman detail yang sama —
              // pola yang sama dengan `FormMitra`.
              router.push(hrefTutup);
            } else {
              setPesan(r.pesan);
            }
          })
        }
        className="grid gap-3"
      >
        {varian ? (
          // `varian` mengidentifikasi baris yang diubah. TIDAK ADA medan
          // `service_id` di sini — `perbaruiVarian` tidak pernah membacanya,
          // dan formulir yang tidak menawarkannya membuat niat itu terlihat
          // di layar juga, bukan cuma di server.
          <input type="hidden" name="varian" value={varian.id} />
        ) : (
          // `service_id` terikat pada layanan yang sedang dibuka — server
          // tetap memeriksanya ulang karena argumen action pun masukan
          // jaringan.
          <input type="hidden" name="service_id" value={serviceId} />
        )}

        <label>
          <span className={KELAS_LABEL}>Nama varian (opsional)</span>
          <input
            name="label"
            type="text"
            maxLength={PANJANG_LABEL_VARIAN_MAKS}
            defaultValue={varian?.label ?? ""}
            placeholder="mis. Basic, Couple, 2 modul — kosongkan bila tidak ada"
            className={KELAS_MEDAN}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            <span className={KELAS_LABEL}>Durasi (menit, opsional)</span>
            <input
              name="durasi_menit"
              type="number"
              min={1}
              max={DURASI_VARIAN_MAKS_MENIT}
              defaultValue={varian?.durasiMenit ?? ""}
              placeholder="mis. 90"
              className={KELAS_MEDAN}
            />
          </label>
          <label>
            <span className={KELAS_LABEL}>Format (opsional)</span>
            <select name="format" defaultValue={varian?.format ?? ""} className={KELAS_MEDAN}>
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
            defaultValue={varian?.urutan ?? 0}
            className={KELAS_MEDAN}
          />
        </label>

        {pesan && <p className="text-[12.5px] font-semibold text-clay">{pesan}</p>}

        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={pending} className={KELAS_TOMBOL_UTAMA}>
            {pending ? "Menyimpan…" : "Simpan"}
          </button>
          {varian && (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                // Dua action terpisah dipanggil lewat FormData yang dirakit di
                // sini, bukan satu action bernilai `!aktif`: keadaan tujuan
                // tidak pernah menyeberang batas server sebagai data.
                mulai(async () => {
                  const fd = new FormData();
                  fd.set("varian", varian.id);
                  const r = varian.aktif
                    ? await nonaktifkanVarian(fd)
                    : await aktifkanVarian(fd);
                  if (r.ok) {
                    setPesan(null);
                    router.push(hrefTutup);
                  } else {
                    // TIDAK menutup panel saat gagal: pesan pagar "layanan
                    // tidak boleh kehilangan varian aktif terakhir" (lihat
                    // `nonaktifkanVarian` di aksi.ts) harus tetap terbaca di
                    // panel yang sama, bukan raib bersama navigasi menutup —
                    // ini SATU-SATUNYA tempat admin membaca penjelasan itu.
                    setPesan(r.pesan);
                  }
                })
              }
              className={KELAS_TOMBOL_KECIL}
            >
              {varian.aktif ? "Nonaktifkan" : "Aktifkan"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
