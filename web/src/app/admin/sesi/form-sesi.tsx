"use client";

import { useState, useTransition } from "react";
import { jadwalkanSesi } from "./aksi";

export type PilihanKlien = { id: string; nama: string; padmaId: string };
export type PilihanSederhana = { id: string; nama: string };

const KELAS_MEDAN =
  "mt-1 min-h-[42px] w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-[13.5px]";
const KELAS_LABEL = "block text-[12.5px] font-bold text-ink-soft";

/**
 * Formulir "Jadwalkan sesi" — jalur langsung, tanpa antrean permintaan.
 *
 * Sengaja dimulai TERTUTUP, mengikuti `FormKlienBaru`. Alasannya bukan sekadar
 * kerapian: layar pertama modul ini adalah DAFTAR sesi dan antrean permintaan
 * yang menunggu jawaban. Formulir yang selalu terbuka mendorong admin membuat
 * jadwal baru untuk permintaan yang sebenarnya tinggal dikonfirmasi — dan sesi
 * hasil jalur itu kehilangan tautan ke permintaan asalnya.
 *
 * Yang tidak ada di sini juga penting: tidak ada medan status (sesi selalu
 * lahir `terjadwal`) dan tidak ada medan paket bebas. Centang paket hanyalah
 * pertanyaan ya/tidak; paket mana yang dipakai ditentukan server dari klien
 * yang dipilih.
 */
export function FormJadwalSesi({
  klien,
  layanan,
  mitra,
  tanggalAwal,
}: {
  klien: PilihanKlien[];
  layanan: PilihanSederhana[];
  mitra: PilihanSederhana[];
  tanggalAwal: string;
}) {
  const [terbuka, setTerbuka] = useState(false);
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);
  const [berhasil, setBerhasil] = useState(false);

  if (!terbuka) {
    return (
      <div className="text-right">
        <button
          type="button"
          onClick={() => {
            setPesan(null);
            setBerhasil(false);
            setTerbuka(true);
          }}
          className="rounded-xl bg-night px-4 py-2.5 text-[13px] font-bold text-gold-pale"
        >
          + Jadwalkan sesi
        </button>
        {/* Konfirmasi ditampilkan SESUDAH formulir ditutup — kalau ditaruh di
            dalam formulir, ia ikut hilang bersama formulirnya dan admin tidak
            pernah melihat bahwa jadwalnya tersimpan. */}
        {berhasil && (
          <p className="mt-2 text-[12.5px] text-leaf">Jadwal sesi tersimpan.</p>
        )}
      </div>
    );
  }

  const kosong = klien.length === 0 || layanan.length === 0 || mitra.length === 0;

  return (
    <form
      action={(fd) =>
        mulai(async () => {
          const r = await jadwalkanSesi(fd);
          if (r.ok) {
            setBerhasil(true);
            setPesan(null);
            setTerbuka(false);
          } else {
            setPesan(r.pesan);
          }
        })
      }
      className="w-full rounded-2xl border-[1.5px] border-dashed border-gold bg-[#FDFAF1] p-4"
    >
      <h2 className="mb-3 text-[13.5px] font-extrabold text-ink">
        Jadwalkan sesi baru — sesi langsung tampil di Passport klien
      </h2>

      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className={KELAS_LABEL}>Klien</span>
          <select name="client_id" required className={KELAS_MEDAN}>
            {klien.map((k) => (
              <option key={k.id} value={k.id}>
                {k.nama} ({k.padmaId})
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={KELAS_LABEL}>Layanan</span>
          <select name="service_id" required className={KELAS_MEDAN}>
            {layanan.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nama}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={KELAS_LABEL}>Tanggal</span>
          <input
            name="tanggal"
            type="date"
            required
            defaultValue={tanggalAwal}
            className={KELAS_MEDAN}
          />
        </label>
        <label>
          <span className={KELAS_LABEL}>Mitra</span>
          <select name="partner_id" required className={KELAS_MEDAN}>
            {mitra.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nama}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="mt-3 flex items-start gap-2 text-[12.5px] text-ink">
        <input name="pakai_paket" type="checkbox" className="mt-0.5" />
        <span>
          Hitung ke paket aktif klien (bila ada). Paketnya ditentukan dari klien
          yang dipilih — sesi lepas bila klien itu belum punya paket berjalan.
        </span>
      </label>

      {kosong && (
        <p className="mt-3 text-[12.5px] font-semibold text-clay">
          Klien, layanan, dan mitra aktif harus ada dulu sebelum sesi bisa
          dijadwalkan.
        </p>
      )}
      {pesan && <p className="mt-3 text-[13px] font-semibold text-clay">{pesan}</p>}

      <div className="mt-4 flex gap-2.5">
        <button
          type="submit"
          disabled={pending || kosong}
          className="rounded-xl bg-night px-4 py-2.5 text-[13px] font-bold text-gold-pale disabled:opacity-60"
        >
          {pending ? "Menyimpan…" : "Simpan jadwal"}
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
