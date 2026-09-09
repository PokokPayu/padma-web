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
  email,
  noHp,
  alamat,
}: {
  nama: string;
  /**
   * DITAMPILKAN, TIDAK PERNAH DIKIRIM. Medannya sengaja tanpa atribut `name`
   * dan ber-`disabled`, jadi ia tidak masuk FormData sama sekali — bukan
   * sekadar diabaikan server.
   *
   * Alasannya sama dengan alasan ia tidak boleh disunting: email adalah dasar
   * penautan akun (`linkClientByInvite` menuntutnya cocok persis), dan
   * satu-satunya pintu tulis profil — RPC `perbarui_profil_klien` — memang
   * hanya menerima nama, no_hp, dan alamat. Ketiadaan `name="email"` di sini
   * dijaga tests/passport-profil.test.ts, dan penjaga itu tetap berlaku.
   */
  email: string;
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
        <span className="font-semibold text-ink-soft">Email</span>
        <input
          value={email}
          disabled
          readOnly
          aria-describedby="ket-email"
          className={`${KELAS_MEDAN} cursor-not-allowed bg-paper-warm text-ink-soft`}
        />
        <span id="ket-email" className="mt-1 block text-xs text-ink-soft">
          Dipakai untuk masuk ke akun Anda. Hubungi tim PADMA bila perlu diubah.
        </span>
      </label>

      <label className="mb-4 block text-sm">
        <span className="font-semibold text-ink-soft">No. WhatsApp</span>
        <input
          name="no_hp"
          defaultValue={noHp}
          inputMode="tel"
          placeholder="08xx-xxxx-xxxx"
          className={KELAS_MEDAN}
        />
        <span className="mt-1 block text-xs text-ink-soft">
          Nomor yang tim PADMA hubungi untuk mengonfirmasi setiap jadwal.
        </span>
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
