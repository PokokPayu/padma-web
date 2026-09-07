"use client";

import { useState, useTransition } from "react";
import { perbaruiProfil } from "@/lib/passport/aksi-profil";

const KELAS_MEDAN =
  "mt-1 min-h-[44px] w-full rounded-lg border border-black/15 px-3 py-2.5 text-[13.5px]";

/**
 * Tiga medan yang boleh disunting klien sendiri. Medan identitas — email,
 * PADMA ID, fase — sengaja TIDAK ada di sini, dan ketiadaannya diuji.
 *
 * Idiom submit-nya menyalin `passport/ajukan/form.tsx`: `useTransition` plus
 * satu pesan, bukan `useActionState`. Bukan karena `useActionState` buruk, tapi
 * karena ia menuntut tanda tangan `(prevState, formData)` — dan mengubah tanda
 * tangan `perbaruiProfil` hanya demi komponen ini akan membuat action tersebut
 * berbeda sendiri dari seluruh server action lain di repo.
 */
export function FormProfil({
  nama,
  noHp,
  alamat,
}: {
  nama: string;
  noHp: string;
  alamat: string;
}) {
  const [sibuk, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);
  const [tersimpan, setTersimpan] = useState(false);

  return (
    <form
      action={(fd) => {
        setPesan(null);
        setTersimpan(false);
        mulai(async () => {
          const r = await perbaruiProfil(fd);
          if (r.ok) setTersimpan(true);
          else setPesan(r.pesan);
        });
      }}
    >
      <label className="mb-4 block text-sm">
        <span className="font-semibold text-ink-soft">Nama lengkap</span>
        <input
          name="nama"
          defaultValue={nama}
          required
          minLength={2}
          className={KELAS_MEDAN}
        />
      </label>

      <label className="mb-4 block text-sm">
        <span className="font-semibold text-ink-soft">No. WhatsApp</span>
        <input name="no_hp" defaultValue={noHp} inputMode="tel" className={KELAS_MEDAN} />
      </label>

      <label className="mb-2 block text-sm">
        <span className="font-semibold text-ink-soft">Alamat rumah</span>
        <textarea name="alamat" rows={3} defaultValue={alamat} className={KELAS_MEDAN} />
        <span className="mt-1 block text-xs text-ink-soft">
          Dipakai untuk mengisi otomatis formulir pengajuan jadwal, dan menjadi
          tujuan mitra yang datang. Boleh dikosongkan.
        </span>
      </label>

      {pesan && <p className="mt-3 text-sm text-clay">{pesan}</p>}
      {tersimpan && <p className="mt-3 text-sm text-leaf">Perubahan tersimpan.</p>}

      <button
        type="submit"
        disabled={sibuk}
        className="mt-4 w-full rounded-xl bg-night py-3 font-bold text-gold-pale disabled:opacity-50"
      >
        {sibuk ? "Menyimpan..." : "Simpan perubahan"}
      </button>
    </form>
  );
}
