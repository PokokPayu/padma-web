"use client";

import { useState, useTransition } from "react";
import type { SetelanAdmin } from "@/lib/admin/pengaturan";
import {
  keFormatLokal,
  nomorWaTerpakai,
  PANJANG_TEKS_MAKS,
} from "@/lib/pengaturan/bentuk";
import { simpanSetelan } from "./aksi";

const KELAS_MEDAN =
  "mt-1 min-h-[42px] w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-[13.5px]";

/**
 * Satu kartu per kunci terdaftar.
 *
 * Yang menyeberang ke server hanyalah NILAI. Kunci adalah argumen terikat dari
 * server component, dan `bentuk` tidak pernah dikirim sama sekali — validator
 * dipilih server dari registri. Medan tersembunyi berisi `bentuk` akan terlihat
 * tidak berbahaya dan menghapus seluruh gunanya sanitasi digit: siapa pun yang
 * bisa membuka DevTools tinggal menyebut `nomor_wa` sebagai teks bebas.
 *
 * Pratinjau di bawah medan bukan hiasan. Nilai setelan mendarat di `href`, dan
 * satu-satunya cara admin klinik bisa tahu bahwa `0877-7840-0200` diterjemahkan
 * menjadi `wa.me/6287778400200` adalah dengan melihatnya sebelum menyimpan.
 */
export function KartuSetelan({ setelan }: { setelan: SetelanAdmin }) {
  const [nilai, setNilai] = useState(setelan.nilai);
  const [pesan, setPesan] = useState<string | null>(null);
  const [tersimpan, setTersimpan] = useState(false);
  const [pending, mulai] = useTransition();

  const nomor = setelan.bentuk === "nomor_wa";
  const idMedan = `setelan-${setelan.key}`;

  return (
    <form
      data-kunci={setelan.key}
      action={(fd) =>
        mulai(async () => {
          setTersimpan(false);
          const r = await simpanSetelan(setelan.key, fd);
          if (r.ok) {
            // Nilai yang ditampilkan diganti dengan nilai TERNORMALISASI yang
            // benar-benar tersimpan — bukan yang diketik. Menampilkan yang
            // diketik membuat admin percaya basis data memegang ejaan itu.
            setNilai(r.nilai);
            setPesan(null);
            setTersimpan(true);
          } else {
            setPesan(r.pesan);
          }
        })
      }
      className="rounded-2xl border border-black/10 bg-white p-4"
    >
      <label htmlFor={idMedan} className="block text-[13px] font-extrabold text-night">
        {setelan.keterangan}
      </label>
      <span className="mt-0.5 block font-mono text-[11px] text-ink-soft">
        {setelan.key}
      </span>

      <input
        id={idMedan}
        name="nilai"
        type={nomor ? "tel" : "text"}
        value={nilai}
        onChange={(e) => {
          setNilai(e.target.value);
          setPesan(null);
          setTersimpan(false);
        }}
        maxLength={nomor ? 24 : PANJANG_TEKS_MAKS}
        placeholder={nomor ? "0877-7840-0200" : "Tulis di sini"}
        className={KELAS_MEDAN}
      />

      {nomor && (
        <p className="mt-2 text-[12px] text-ink-soft">
          Tautan yang akan dipakai:{" "}
          <span className="font-mono text-ink">
            https://wa.me/{nomorWaTerpakai(nilai)}
          </span>
          <span className="mt-0.5 block">
            Tampil sebagai {keFormatLokal(nomorWaTerpakai(nilai))}
          </span>
        </p>
      )}

      {pesan && (
        <p className="mt-2 text-[12.5px] font-semibold text-clay">{pesan}</p>
      )}
      {tersimpan && !pesan && (
        <p className="mt-2 text-[12.5px] font-semibold text-leaf">
          Tersimpan. Halaman publik sudah memakai nilai baru.
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-3 rounded-xl bg-night px-4 py-2.5 text-[13px] font-bold text-gold-pale disabled:opacity-60"
      >
        {pending ? "Menyimpan…" : "Simpan"}
      </button>
    </form>
  );
}
