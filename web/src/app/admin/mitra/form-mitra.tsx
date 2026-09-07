"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { aktifkanMitra, nonaktifkanMitra, perbaruiMitra, simpanMitra } from "./aksi";

const KELAS_MEDAN =
  "mt-1 min-h-[38px] w-full rounded-lg border border-panel-border bg-panel-surface px-3 py-2 text-[13px]";
const KELAS_LABEL = "block text-[12px] font-bold text-panel-muted";

export type MitraForm = {
  id: string;
  nama: string;
  noHp: string;
  alamat: string;
  aktif: boolean;
};

/**
 * Satu formulir untuk membuat DAN mengubah.
 *
 * Sebelumnya ada dua komponen yang masing-masing menyimpan `terbuka`/`ubah`
 * sendiri, dan keduanya merender formulir di tempat yang berbeda — satu di
 * header halaman (`FormMitraBaru`), satu di dalam sel tabel (`AksiMitra`).
 * Sekarang yang menentukan terbuka atau tidak adalah URL (`?ubah=`), dan
 * `page.tsx` yang memutuskan kapan `PanelGeser` dirender sama sekali — jadi
 * komponen ini tinggal menjadi formulir saja, tanpa gerbang buka/tutup
 * miliknya sendiri.
 */
export function FormMitra({
  mitra,
  hrefTutup,
}: {
  /** `null` berarti mitra baru. */
  mitra: MitraForm | null;
  hrefTutup: string;
}) {
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);

  return (
    <form
      action={(fd) =>
        mulai(async () => {
          const r = mitra ? await perbaruiMitra(mitra.id, fd) : await simpanMitra(fd);
          if (r.ok) {
            setPesan(null);
            // Menutup panel DENGAN kembali ke daftar yang sama — cari dan
            // halaman ikut, jadi admin melanjutkan dari tempat ia berhenti.
            router.push(hrefTutup);
          } else {
            setPesan(r.pesan);
          }
        })
      }
      className="grid gap-3"
    >
      <label>
        <span className={KELAS_LABEL}>Nama mitra</span>
        <input
          name="nama"
          type="text"
          required
          minLength={2}
          defaultValue={mitra?.nama ?? ""}
          placeholder="mis. Bidan Sri Wahyuni"
          className={KELAS_MEDAN}
        />
      </label>
      <label>
        <span className={KELAS_LABEL}>No. WhatsApp</span>
        <input
          name="no_hp"
          type="tel"
          defaultValue={mitra?.noHp ?? ""}
          placeholder="08xx"
          className={KELAS_MEDAN}
        />
      </label>
      <label>
        <span className={KELAS_LABEL}>Domisili (opsional, bisa diisi menyusul)</span>
        <textarea
          name="alamat"
          rows={2}
          defaultValue={mitra?.alamat ?? ""}
          placeholder="Alamat domisili mitra"
          className={KELAS_MEDAN}
        />
        {/* Domisili ini digeocoding lewat Nominatim (OSM) untuk jarak garis
            lurus ke klien — lisensi ODbL mewajibkan atribusi tampak di layar
            yang memakai hasilnya, bukan cukup di komentar kode. */}
        <span className="mt-1 block text-[11px] text-panel-muted">
          Lokasi diperkirakan lewat data © OpenStreetMap contributors.
        </span>
      </label>

      {pesan && <p className="text-[12.5px] font-semibold text-clay">{pesan}</p>}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-panel-ink px-4 py-2 text-[12.5px] font-bold text-panel-surface disabled:opacity-60"
        >
          {pending ? "Menyimpan…" : "Simpan"}
        </button>
        {/* Dua action terpisah, bukan satu action bernilai `!aktif`: keadaan
            tujuan tidak pernah menyeberang batas server sebagai data. */}
        {mitra && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              mulai(async () => {
                const r = mitra.aktif
                  ? await nonaktifkanMitra(mitra.id)
                  : await aktifkanMitra(mitra.id);
                if (r.ok) router.push(hrefTutup);
                else setPesan(r.pesan);
              })
            }
            className="rounded-lg border border-panel-border px-4 py-2 text-[12.5px] font-bold text-panel-ink"
          >
            {mitra.aktif ? "Nonaktifkan" : "Aktifkan"}
          </button>
        )}
      </div>
    </form>
  );
}
