"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { jadikanKlien } from "./aksi";

const KELAS_MEDAN =
  "mt-1 min-h-[42px] w-full rounded-lg border border-panel-border bg-panel-surface px-3 py-2 text-[13.5px]";
const KELAS_LABEL = "block text-[12.5px] font-bold text-panel-muted";

/**
 * Dialog konversi Skrining → Klien.
 *
 * Bentuknya sengaja kembar dengan formulir "Klien baru" di
 * `src/app/admin/klien/form-klien.tsx` — medan yang sama, urutan yang sama —
 * dengan dua perbedaan yang keduanya disengaja:
 *
 *  1. Nama dan nomor sudah TERISI dari baris skrining. Itulah seluruh alasan
 *     jalur ini ada: mengetik ulang data yang sudah ada di layar adalah cara
 *     paling mudah melahirkan klien kembar dengan nomor yang meleset satu
 *     angka.
 *
 *  2. Fase TIDAK punya medan. Ia dibaca server dari baris skriningnya dan
 *     hanya ditampilkan di sini sebagai keterangan. Fase menentukan rencana
 *     dan materi yang diterima klien; membiarkannya menjadi dropdown di dialog
 *     yang diklik cepat berarti satu salah pilih menerbitkan passport yang
 *     salah — dan `phases` akan menerimanya tanpa keberatan.
 *
 * Alamat email memang harus diketik: skrining publik tidak pernah memintanya
 * (yang diminta hanya nomor WhatsApp), sedangkan email adalah kunci yang
 * dipakai klien untuk masuk dan mencocokkan tautan aktivasinya.
 */
export function JadikanKlien({
  skriningId,
  nama,
  noHp,
  namaFase,
}: {
  skriningId: string;
  nama: string;
  noHp: string;
  namaFase: string;
}) {
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);
  const [hasil, setHasil] = useState<{ clientId: string; padmaId: string } | null>(
    null,
  );

  if (hasil) {
    return (
      <div className="rounded-lg border-[1.5px] border-dashed border-leaf bg-leaf-soft p-4 text-[13px]">
        <p>
          Tersimpan sebagai <b className="font-mono">{hasil.padmaId}</b>. Langkah
          berikutnya: terbitkan tautan aktivasi dari halaman kliennya.
        </p>
        <Link
          href={`/admin/klien/${hasil.clientId}`}
          className="mt-2 inline-block font-bold text-leaf underline underline-offset-4"
        >
          Buka halaman klien →
        </Link>
      </div>
    );
  }

  return (
    <form
      action={(fd) =>
        mulai(async () => {
          const r = await jadikanKlien(skriningId, fd);
          if (r.ok) {
            setPesan(null);
            setHasil({ clientId: r.clientId, padmaId: r.padmaId });
          } else {
            setPesan(r.pesan);
          }
        })
      }
      className="rounded-lg border-[1.5px] border-panel-border bg-panel-bg p-4"
    >
      <h3 className="mb-1 text-[13.5px] font-extrabold text-panel-ink">
        Daftarkan sebagai klien
      </h3>
      <p className="mb-3 text-[12.5px] text-panel-muted">
        Fase mengikuti hasil skrining: <b className="text-panel-ink">{namaFase}</b>.
        PADMA ID dibuat otomatis, dan akunnya baru hidup setelah tautan aktivasi
        ditukarkan.
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <label>
          <span className={KELAS_LABEL}>Nama lengkap</span>
          <input
            name="nama"
            type="text"
            required
            minLength={2}
            defaultValue={nama}
            className={KELAS_MEDAN}
          />
        </label>
        <label>
          <span className={KELAS_LABEL}>Email (dipakai untuk masuk)</span>
          <input
            name="email"
            type="email"
            required
            placeholder="nama@gmail.com"
            className={KELAS_MEDAN}
          />
        </label>
        <label>
          <span className={KELAS_LABEL}>No. WhatsApp</span>
          <input name="no_hp" type="tel" defaultValue={noHp} className={KELAS_MEDAN} />
        </label>
      </div>

      {pesan && <p className="mt-3 text-[13px] font-semibold text-clay">{pesan}</p>}

      <button
        type="submit"
        disabled={pending}
        className="mt-4 rounded-xl bg-panel-ink px-4 py-2.5 text-[13px] font-bold text-panel-surface disabled:opacity-60"
      >
        {pending ? "Menyimpan…" : "Simpan klien"}
      </button>
    </form>
  );
}
