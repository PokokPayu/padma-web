"use client";

import { useState, useTransition } from "react";
import {
  aktifkanMateri,
  gantiVideo,
  hapusBab,
  lepasVideo,
  nonaktifkanMateri,
  perbaruiBab,
  perbaruiMateri,
  simpanMateri,
  tambahBab,
} from "./aksi";
import {
  LABEL_ISI,
  LABEL_TIPE,
  PANJANG_DESKRIPSI_MAKS,
  PANJANG_ISI_BAB_MAKS,
  PANJANG_JUDUL_MAKS,
  PENYEDIA_VIDEO,
  TIPE_SAH,
  URUTAN_BAB_MAKS,
  type TipeMateri,
} from "./status";

const KELAS_MEDAN =
  "mt-1 min-h-[42px] w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-[13.5px]";
const KELAS_LABEL = "block text-[12.5px] font-bold text-ink-soft";
const KELAS_TOMBOL_KECIL =
  "rounded-lg border border-black/15 px-3 py-1.5 text-[12px] font-bold text-ink-soft disabled:opacity-60";
const KELAS_TOMBOL_UTAMA =
  "rounded-lg bg-night px-3 py-1.5 text-[12px] font-bold text-gold-pale disabled:opacity-60";

export type PilihanLayanan = { id: string; nama: string };
export type BabProp = { id: string; urutan: number; judul: string; isi: string };

/**
 * Medan ISI materi — bab pertama untuk e-book, URL untuk video.
 *
 * Ia hidup di dalam formulir yang SAMA dengan metadata, dan itu bukan pilihan
 * tata letak: materi yang tersimpan tanpa isi terkunci selamanya bagi setiap
 * klien yang berhak, tanpa satu pun error, sementara kartunya berbunyi "Terbuka
 * setelah layanan terkait selesai" padahal layanannya sudah selesai. Formulir
 * dua langkah adalah cara paling wajar melahirkan keadaan itu.
 */
function MedanIsi({ tipe }: { tipe: TipeMateri }) {
  if (tipe === "video") {
    return (
      <label className="mt-3 block">
        <span className={KELAS_LABEL}>URL video ({PENYEDIA_VIDEO})</span>
        <input
          name="video_url"
          type="url"
          required
          placeholder="https://vimeo.com/123456789"
          className={KELAS_MEDAN}
        />
        <span className="mt-1 block text-[11.5px] text-ink-soft">
          Hanya penyedia yang bisa dikunci domain. Tautan Google Drive atau
          YouTube ditolak — materi bisa diteruskan ke luar klien PADMA.
        </span>
      </label>
    );
  }
  return (
    <div className="mt-3 grid gap-3">
      <label>
        <span className={KELAS_LABEL}>Judul bab pertama</span>
        <input
          name="bab_judul"
          type="text"
          required
          minLength={2}
          maxLength={PANJANG_JUDUL_MAKS}
          placeholder="mis. Mengenal Fase Siklus"
          className={KELAS_MEDAN}
        />
      </label>
      <label>
        <span className={KELAS_LABEL}>Isi bab pertama</span>
        <textarea
          name="bab_isi"
          rows={5}
          required
          maxLength={PANJANG_ISI_BAB_MAKS}
          className={KELAS_MEDAN}
        />
      </label>
    </div>
  );
}

/**
 * Formulir "Materi baru".
 *
 * Sengaja dimulai TERTUTUP, sama seperti formulir layanan, mitra & klien: layar
 * pertama modul ini adalah DAFTAR materi, dan formulir yang selalu terbuka
 * mendorong admin mendaftarkan ulang materi yang sebenarnya hanya sedang
 * nonaktif — sementara yang benar adalah mengaktifkannya kembali.
 */
export function FormMateriBaru({ layanan }: { layanan: PilihanLayanan[] }) {
  const [terbuka, setTerbuka] = useState(false);
  const [tipe, setTipe] = useState<TipeMateri>("ebook");
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
        + Materi baru
      </button>
    );
  }

  return (
    <form
      action={(fd) =>
        mulai(async () => {
          const r = await simpanMateri(fd);
          if (r.ok) {
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
        Materi baru — metadata dan isinya disimpan sekaligus
      </h2>

      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className={KELAS_LABEL}>Layanan induk</span>
          <select
            name="service_id"
            required
            defaultValue={layanan[0]?.id ?? ""}
            className={KELAS_MEDAN}
          >
            {layanan.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nama}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={KELAS_LABEL}>Judul materi</span>
          <input
            name="judul"
            type="text"
            required
            minLength={2}
            maxLength={PANJANG_JUDUL_MAKS}
            placeholder="mis. Panduan Siklus Subur"
            className={KELAS_MEDAN}
          />
        </label>
      </div>

      <label className="mt-3 block">
        <span className={KELAS_LABEL}>Tipe materi</span>
        <select
          name="tipe"
          value={tipe}
          onChange={(e) => setTipe(e.target.value as TipeMateri)}
          className={KELAS_MEDAN}
        >
          {TIPE_SAH.map((t) => (
            <option key={t} value={t}>
              {LABEL_TIPE[t]} — wajib {LABEL_ISI[t]}
            </option>
          ))}
        </select>
      </label>

      <label className="mt-3 block">
        <span className={KELAS_LABEL}>Deskripsi singkat (opsional)</span>
        <textarea
          name="deskripsi"
          rows={2}
          maxLength={PANJANG_DESKRIPSI_MAKS}
          className={KELAS_MEDAN}
        />
      </label>

      <MedanIsi tipe={tipe} />

      {pesan && <p className="mt-3 text-[13px] font-semibold text-clay">{pesan}</p>}

      <div className="mt-4 flex gap-2.5">
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl bg-night px-4 py-2.5 text-[13px] font-bold text-gold-pale disabled:opacity-60"
        >
          {pending ? "Menyimpan…" : "Simpan materi"}
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
 * Aksi per materi: ubah identitasnya, kelola isinya, nyalakan/matikan
 * ketersediaannya.
 *
 * Tidak ada tombol "Hapus materi", dan itu bukan kelalaian: hak DELETE atas
 * `materials` sudah dicabut dari peran aplikasi, jadi tombol semacam itu pasti
 * gagal — dan kegagalannya berupa kode Postgres di layar admin klinik.
 */
export function AksiMateri({
  id,
  judul,
  deskripsi,
  tipe,
  aktif,
  lengkap,
  layananId,
  layanan,
  bab,
  videoUrl,
}: {
  id: string;
  judul: string;
  deskripsi: string;
  tipe: TipeMateri;
  aktif: boolean;
  lengkap: boolean;
  layananId: string;
  layanan: PilihanLayanan[];
  bab: BabProp[];
  videoUrl: string | null;
}) {
  const [ubah, setUbah] = useState(false);
  const [tipeBaru, setTipeBaru] = useState<TipeMateri>(tipe);
  const [isi, setIsi] = useState(false);
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);

  if (ubah) {
    return (
      <form
        action={(fd) =>
          mulai(async () => {
            const r = await perbaruiMateri(id, fd);
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
        <select
          name="service_id"
          defaultValue={layananId}
          aria-label={`Layanan materi ${judul}`}
          className={KELAS_MEDAN}
        >
          {layanan.map((l) => (
            <option key={l.id} value={l.id}>
              {l.nama}
            </option>
          ))}
        </select>
        <input
          name="judul"
          type="text"
          required
          minLength={2}
          maxLength={PANJANG_JUDUL_MAKS}
          defaultValue={judul}
          aria-label={`Judul materi ${judul}`}
          className={KELAS_MEDAN}
        />
        <textarea
          name="deskripsi"
          rows={2}
          maxLength={PANJANG_DESKRIPSI_MAKS}
          defaultValue={deskripsi}
          aria-label={`Deskripsi materi ${judul}`}
          className={KELAS_MEDAN}
        />
        <select
          name="tipe"
          value={tipeBaru}
          onChange={(e) => setTipeBaru(e.target.value as TipeMateri)}
          aria-label={`Tipe materi ${judul}`}
          className={KELAS_MEDAN}
        >
          {TIPE_SAH.map((t) => (
            <option key={t} value={t}>
              {LABEL_TIPE[t]}
            </option>
          ))}
        </select>
        {tipeBaru !== tipe && (
          <>
            <span className="text-[12px] text-clay">
              Mengubah tipe wajib disertai {LABEL_ISI[tipeBaru]}. Tanpa itu
              materinya berubah menjadi kartu terkunci yang tidak akan pernah
              terbuka bagi klien yang sudah berhak.
            </span>
            <MedanIsi tipe={tipeBaru} />
          </>
        )}
        {pesan && <span className="text-[12px] font-semibold text-clay">{pesan}</span>}
        <span className="flex gap-2">
          <button type="submit" disabled={pending} className={KELAS_TOMBOL_UTAMA}>
            {pending ? "Menyimpan…" : "Simpan"}
          </button>
          <button
            type="button"
            onClick={() => {
              setUbah(false);
              setTipeBaru(tipe);
              setPesan(null);
            }}
            className={KELAS_TOMBOL_KECIL}
          >
            Batal
          </button>
        </span>
      </form>
    );
  }

  return (
    <div className="grid gap-2">
      <span className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setUbah(true)} className={KELAS_TOMBOL_KECIL}>
          Ubah
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            // Dua action terpisah, bukan satu action bernilai `!aktif`: keadaan
            // tujuan tidak pernah menyeberang batas server sebagai data.
            mulai(async () => {
              const r = aktif ? await nonaktifkanMateri(id) : await aktifkanMateri(id);
              setPesan(r.ok ? null : r.pesan);
            })
          }
          className={KELAS_TOMBOL_KECIL}
        >
          {aktif ? "Nonaktifkan" : "Aktifkan"}
        </button>
        <button type="button" onClick={() => setIsi((t) => !t)} className={KELAS_TOMBOL_KECIL}>
          {isi ? "Tutup isi" : "Kelola isi"}
        </button>
        {!lengkap && (
          <span className="text-[12px] font-semibold text-clay">
            Materi ini belum ada isinya ({LABEL_ISI[tipe]}) — belum bisa diterbitkan.
          </span>
        )}
      </span>

      {isi && tipe === "ebook" && (
        <IsiEbook materiId={id} judulMateri={judul} bab={bab} />
      )}
      {isi && tipe === "video" && (
        <IsiVideo materiId={id} judulMateri={judul} aktif={aktif} videoUrl={videoUrl} />
      )}

      {pesan && <span className="text-[12px] font-semibold text-clay">{pesan}</span>}
    </div>
  );
}

function IsiEbook({
  materiId,
  judulMateri,
  bab,
}: {
  materiId: string;
  judulMateri: string;
  bab: BabProp[];
}) {
  const [tambah, setTambah] = useState(false);
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);

  return (
    <div className="rounded-xl border border-black/10 bg-paper p-3">
      <ul className="grid gap-2">
        {bab.map((b) => (
          <BarisBab key={b.id} bab={b} judulMateri={judulMateri} />
        ))}
      </ul>

      {pesan && <p className="mt-2 text-[12px] font-semibold text-clay">{pesan}</p>}

      {tambah ? (
        <form
          action={(fd) =>
            mulai(async () => {
              const r = await tambahBab(materiId, fd);
              if (r.ok) {
                setPesan(null);
                setTambah(false);
              } else {
                setPesan(r.pesan);
              }
            })
          }
          className="mt-3 grid gap-2"
        >
          {/* Urutan bab TIDAK ada di sini: ia dihitung server sebagai
              nomor berikutnya. Dua bab yang lahir dengan urutan sama tampil
              berganti-ganti susunan tiap kali halaman dimuat. */}
          <input
            name="judul"
            type="text"
            required
            minLength={2}
            maxLength={PANJANG_JUDUL_MAKS}
            placeholder="Judul bab baru"
            aria-label={`Judul bab baru ${judulMateri}`}
            className={KELAS_MEDAN}
          />
          <textarea
            name="isi"
            rows={4}
            required
            maxLength={PANJANG_ISI_BAB_MAKS}
            placeholder="Isi bab"
            aria-label={`Isi bab baru ${judulMateri}`}
            className={KELAS_MEDAN}
          />
          <span className="flex gap-2">
            <button type="submit" disabled={pending} className={KELAS_TOMBOL_UTAMA}>
              {pending ? "Menyimpan…" : "Simpan bab"}
            </button>
            <button type="button" onClick={() => setTambah(false)} className={KELAS_TOMBOL_KECIL}>
              Batal
            </button>
          </span>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setTambah(true)}
          className={`mt-3 ${KELAS_TOMBOL_KECIL}`}
        >
          + Bab
        </button>
      )}
    </div>
  );
}

function BarisBab({ bab, judulMateri }: { bab: BabProp; judulMateri: string }) {
  const [ubah, setUbah] = useState(false);
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);

  if (ubah) {
    return (
      <li>
        <form
          action={(fd) =>
            mulai(async () => {
              const r = await perbaruiBab(bab.id, fd);
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
            name="urutan"
            type="number"
            required
            min={1}
            max={URUTAN_BAB_MAKS}
            defaultValue={bab.urutan}
            aria-label={`Urutan bab ${bab.judul}`}
            className={KELAS_MEDAN}
          />
          <input
            name="judul"
            type="text"
            required
            minLength={2}
            maxLength={PANJANG_JUDUL_MAKS}
            defaultValue={bab.judul}
            aria-label={`Judul bab ${bab.judul}`}
            className={KELAS_MEDAN}
          />
          <textarea
            name="isi"
            rows={5}
            required
            maxLength={PANJANG_ISI_BAB_MAKS}
            defaultValue={bab.isi}
            aria-label={`Isi bab ${bab.judul}`}
            className={KELAS_MEDAN}
          />
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
    <li className="flex flex-wrap items-center justify-between gap-2 border-b border-black/5 pb-2">
      <span className="min-w-[160px] flex-1">
        <b className="text-[13px] text-ink">
          {bab.urutan}. {bab.judul}
        </b>
        <span className="block text-[11.5px] text-ink-soft">
          {bab.isi.length} karakter · materi {judulMateri}
        </span>
      </span>
      <span className="flex gap-2">
        <button type="button" onClick={() => setUbah(true)} className={KELAS_TOMBOL_KECIL}>
          Ubah
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            mulai(async () => {
              const r = await hapusBab(bab.id);
              setPesan(r.ok ? null : r.pesan);
            })
          }
          className={KELAS_TOMBOL_KECIL}
        >
          Hapus bab
        </button>
      </span>
      {pesan && <span className="w-full text-[12px] font-semibold text-clay">{pesan}</span>}
    </li>
  );
}

function IsiVideo({
  materiId,
  judulMateri,
  aktif,
  videoUrl,
}: {
  materiId: string;
  judulMateri: string;
  aktif: boolean;
  videoUrl: string | null;
}) {
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);

  return (
    <div className="rounded-xl border border-black/10 bg-paper p-3">
      <form
        action={(fd) =>
          mulai(async () => {
            const r = await gantiVideo(materiId, fd);
            setPesan(r.ok ? null : r.pesan);
          })
        }
        className="grid gap-2"
      >
        <label>
          <span className={KELAS_LABEL}>URL video ({PENYEDIA_VIDEO})</span>
          <input
            name="video_url"
            type="url"
            required
            defaultValue={videoUrl ?? ""}
            aria-label={`URL video materi ${judulMateri}`}
            className={KELAS_MEDAN}
          />
        </label>
        <span className="flex flex-wrap gap-2">
          <button type="submit" disabled={pending} className={KELAS_TOMBOL_UTAMA}>
            {pending ? "Menyimpan…" : "Simpan URL"}
          </button>
          {/* "Lepas video" hanya ditawarkan pada materi yang sudah ditarik:
              materi video terbit tanpa URL adalah kartu terkunci yang tidak
              akan pernah terbuka. Server memeriksanya ulang. */}
          {!aktif && videoUrl !== null && (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                mulai(async () => {
                  const r = await lepasVideo(materiId);
                  setPesan(r.ok ? null : r.pesan);
                })
              }
              className={KELAS_TOMBOL_KECIL}
            >
              Lepas video
            </button>
          )}
        </span>
      </form>
      {pesan && <p className="mt-2 text-[12px] font-semibold text-clay">{pesan}</p>}
    </div>
  );
}
