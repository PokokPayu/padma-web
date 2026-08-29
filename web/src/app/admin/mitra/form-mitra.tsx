"use client";

import { useState, useTransition } from "react";
import {
  aktifkanMitra,
  nonaktifkanMitra,
  perbaruiMitra,
  simpanMitra,
} from "./aksi";

const KELAS_MEDAN =
  "mt-1 min-h-[42px] w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-[13.5px]";
const KELAS_LABEL = "block text-[12.5px] font-bold text-ink-soft";

/**
 * Formulir "Mitra baru".
 *
 * Sengaja dimulai TERTUTUP, sama seperti formulir klien: layar pertama modul
 * ini adalah DAFTAR mitra, dan formulir yang selalu terbuka mendorong admin
 * mendaftarkan ulang bidan yang sebenarnya hanya sedang nonaktif — sementara
 * yang benar adalah mengaktifkannya kembali, supaya riwayat sesinya tetap
 * menempel pada satu baris yang sama.
 */
export function FormMitraBaru() {
  const [terbuka, setTerbuka] = useState(false);
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);

  if (!terbuka) {
    return (
      <button
        type="button"
        onClick={() => {
          setPesan(null);
          setTerbuka(true);
        }}
        className="rounded-xl bg-night px-4 py-2.5 text-[13px] font-bold text-gold-pale"
      >
        + Mitra baru
      </button>
    );
  }

  return (
    <form
      action={(fd) =>
        mulai(async () => {
          const r = await simpanMitra(fd);
          if (r.ok) {
            setPesan(null);
            setTerbuka(false);
          } else {
            setPesan(r.pesan);
          }
        })
      }
      className="rounded-2xl border-[1.5px] border-dashed border-gold bg-[#FDFAF1] p-4"
    >
      <h2 className="mb-3 text-[13.5px] font-extrabold text-ink">
        Mitra baru — hanya nama dan nomor kontak; mitra tidak punya akun aplikasi
      </h2>

      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className={KELAS_LABEL}>Nama mitra</span>
          <input
            name="nama"
            type="text"
            required
            minLength={2}
            placeholder="mis. Bidan Sri Wahyuni"
            className={KELAS_MEDAN}
          />
        </label>
        <label>
          <span className={KELAS_LABEL}>No. WhatsApp</span>
          <input name="no_hp" type="tel" placeholder="08xx" className={KELAS_MEDAN} />
        </label>
      </div>

      {pesan && <p className="mt-3 text-[13px] font-semibold text-clay">{pesan}</p>}

      <div className="mt-4 flex gap-2.5">
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl bg-night px-4 py-2.5 text-[13px] font-bold text-gold-pale disabled:opacity-60"
        >
          {pending ? "Menyimpan…" : "Simpan mitra"}
        </button>
        <button
          type="button"
          onClick={() => {
            setTerbuka(false);
            setPesan(null);
          }}
          className="rounded-xl border border-black/15 px-4 py-2.5 text-[13px] font-bold text-ink-soft"
        >
          Batal
        </button>
      </div>
    </form>
  );
}

/**
 * Aksi per baris: ubah identitas, dan nyalakan/matikan ketersediaannya.
 *
 * Tidak ada tombol HAPUS di sini, dan itu disengaja: menghapus baris mitra akan
 * memutus `sessions.partner_id` milik riwayat lama. "Nonaktif" adalah bentuk
 * pensiun yang benar — mitra berhenti ditawarkan untuk sesi baru, sementara
 * namanya tetap menempel pada sesi yang sudah dijalaninya.
 */
export function AksiMitra({
  id,
  nama,
  noHp,
  aktif,
}: {
  id: string;
  nama: string;
  noHp: string;
  aktif: boolean;
}) {
  const [ubah, setUbah] = useState(false);
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);

  if (ubah) {
    return (
      <form
        action={(fd) =>
          mulai(async () => {
            const r = await perbaruiMitra(id, fd);
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
        <input
          name="nama"
          type="text"
          required
          minLength={2}
          defaultValue={nama}
          aria-label={`Nama mitra ${nama}`}
          className={KELAS_MEDAN}
        />
        <input
          name="no_hp"
          type="tel"
          defaultValue={noHp}
          aria-label={`Kontak mitra ${nama}`}
          className={KELAS_MEDAN}
        />
        {pesan && <span className="text-[12px] font-semibold text-clay">{pesan}</span>}
        <span className="flex gap-2">
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-night px-3 py-1.5 text-[12px] font-bold text-gold-pale disabled:opacity-60"
          >
            {pending ? "Menyimpan…" : "Simpan"}
          </button>
          <button
            type="button"
            onClick={() => {
              setUbah(false);
              setPesan(null);
            }}
            className="rounded-lg border border-black/15 px-3 py-1.5 text-[12px] font-bold text-ink-soft"
          >
            Batal
          </button>
        </span>
      </form>
    );
  }

  return (
    <span className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => setUbah(true)}
        className="rounded-lg border border-black/15 px-3 py-1.5 text-[12px] font-bold text-ink-soft"
      >
        Ubah
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          // Dua action terpisah, bukan satu action bernilai `!aktif`: keadaan
          // tujuan tidak pernah menyeberang batas server sebagai data.
          mulai(async () => {
            const r = aktif ? await nonaktifkanMitra(id) : await aktifkanMitra(id);
            setPesan(r.ok ? null : r.pesan);
          })
        }
        className="rounded-lg border border-black/15 px-3 py-1.5 text-[12px] font-bold text-ink-soft disabled:opacity-60"
      >
        {aktif ? "Nonaktifkan" : "Aktifkan"}
      </button>
      {pesan && <span className="text-[12px] font-semibold text-clay">{pesan}</span>}
    </span>
  );
}
