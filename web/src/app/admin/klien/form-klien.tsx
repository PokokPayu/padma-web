"use client";

import { useState, useTransition } from "react";
import { buatKlien, perbaruiKlien } from "./aksi";

export type PilihanFase = { id: string; nama: string };

const KELAS_MEDAN =
  "mt-1 min-h-[42px] w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-[13.5px]";
const KELAS_LABEL = "block text-[12.5px] font-bold text-ink-soft";

/**
 * Formulir "Klien baru".
 *
 * Sengaja dimulai TERTUTUP: layar pertama modul ini adalah DAFTAR klien, dan
 * formulir yang selalu terbuka mendorong admin membuat baris ganda untuk klien
 * yang sebenarnya sudah ada. Pilihan fase datang dari tabel `phases` lewat
 * prop — tidak pernah disalin ulang sebagai literal di komponen ini, supaya
 * fase yang ditambah klinik tidak perlu menunggu rilis kode.
 */
export function FormKlienBaru({ fase }: { fase: PilihanFase[] }) {
  const [terbuka, setTerbuka] = useState(false);
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);
  const [berhasil, setBerhasil] = useState<string | null>(null);

  if (!terbuka) {
    return (
      <button
        type="button"
        onClick={() => {
          setPesan(null);
          setBerhasil(null);
          setTerbuka(true);
        }}
        className="rounded-xl bg-night px-4 py-2.5 text-[13px] font-bold text-gold-pale"
      >
        + Klien baru
      </button>
    );
  }

  return (
    <form
      // Nilai formulir dikirim apa adanya; PADMA ID dan status penautan
      // ditetapkan server — keduanya tidak pernah menjadi medan di sini.
      action={(fd) =>
        mulai(async () => {
          const r = await buatKlien(fd);
          if (r.ok) {
            setBerhasil(r.padmaId);
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
        Klien baru — setelah disimpan, terbitkan tautan aktivasi dari halaman
        detailnya
      </h2>

      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className={KELAS_LABEL}>Nama lengkap</span>
          <input
            name="nama"
            type="text"
            required
            minLength={2}
            placeholder="mis. Sari Utami"
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
          <input name="no_hp" type="tel" placeholder="08xx" className={KELAS_MEDAN} />
        </label>
        <label>
          <span className={KELAS_LABEL}>Fase</span>
          <select name="fase" required defaultValue={fase[0]?.id ?? ""} className={KELAS_MEDAN}>
            {fase.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nama}
              </option>
            ))}
          </select>
        </label>
      </div>

      {pesan && <p className="mt-3 text-[13px] font-semibold text-clay">{pesan}</p>}

      <div className="mt-4 flex gap-2.5">
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl bg-night px-4 py-2.5 text-[13px] font-bold text-gold-pale disabled:opacity-60"
        >
          {pending ? "Menyimpan…" : "Simpan klien"}
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

      {berhasil && (
        <p className="mt-3 text-[13px] text-leaf">
          Tersimpan sebagai <b className="font-mono">{berhasil}</b>.
        </p>
      )}
    </form>
  );
}

/**
 * Formulir ubah data OPERASIONAL pada halaman detail.
 *
 * Alamat email sengaja tidak punya medan di sini: ia kunci pencocokan saat
 * klien menukarkan tautan aktivasi, dan mengubahnya diam-diam akan membuat
 * tautan yang sudah terkirim berhenti bekerja tanpa pesan apa pun.
 */
export function FormEditKlien({
  id,
  awal,
  fase,
}: {
  id: string;
  awal: { nama: string; noHp: string; faseId: string };
  fase: PilihanFase[];
}) {
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);
  const [tersimpan, setTersimpan] = useState(false);

  return (
    <form
      action={(fd) =>
        mulai(async () => {
          const r = await perbaruiKlien(id, fd);
          setTersimpan(r.ok);
          setPesan(r.ok ? null : r.pesan);
        })
      }
      className="rounded-2xl border border-black/10 bg-white p-5"
    >
      <h2 className="mb-3 font-serif text-lg text-night">Data operasional</h2>

      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className={KELAS_LABEL}>Nama lengkap</span>
          <input
            name="nama"
            type="text"
            required
            minLength={2}
            defaultValue={awal.nama}
            className={KELAS_MEDAN}
          />
        </label>
        <label>
          <span className={KELAS_LABEL}>No. WhatsApp</span>
          <input name="no_hp" type="tel" defaultValue={awal.noHp} className={KELAS_MEDAN} />
        </label>
        <label>
          <span className={KELAS_LABEL}>Fase</span>
          <select name="fase" required defaultValue={awal.faseId} className={KELAS_MEDAN}>
            {fase.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nama}
              </option>
            ))}
          </select>
        </label>
      </div>

      {pesan && <p className="mt-3 text-[13px] font-semibold text-clay">{pesan}</p>}
      {tersimpan && !pesan && (
        <p className="mt-3 text-[13px] text-leaf">Perubahan tersimpan.</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-4 rounded-xl bg-night px-4 py-2.5 text-[13px] font-bold text-gold-pale disabled:opacity-60"
      >
        {pending ? "Menyimpan…" : "Simpan perubahan"}
      </button>
    </form>
  );
}
