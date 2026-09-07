"use client";

import { useState, useTransition } from "react";
import { PAKET_TAMPIL } from "@/lib/paket-tampil";
import {
  aktifkanLayanan,
  aktifkanPaket,
  nonaktifkanLayanan,
  nonaktifkanPaket,
  perbaruiLayanan,
  perbaruiPaket,
  simpanLayanan,
  simpanPaket,
} from "./aksi";
import {
  PANJANG_DESKRIPSI_MAKS,
  PANJANG_NAMA_MAKS,
  SESI_PAKET_MAKS,
} from "./status";

const KELAS_MEDAN =
  "mt-1 min-h-[42px] w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-[13.5px]";
const KELAS_LABEL = "block text-[12.5px] font-bold text-ink-soft";
const KELAS_TOMBOL_KECIL =
  "rounded-lg border border-black/15 px-3 py-1.5 text-[12px] font-bold text-ink-soft disabled:opacity-60";
const KELAS_TOMBOL_UTAMA =
  "rounded-lg bg-night px-3 py-1.5 text-[12px] font-bold text-gold-pale disabled:opacity-60";

export type PilihanFase = { id: string; nama: string };

/**
 * Formulir "Layanan baru".
 *
 * Sengaja dimulai TERTUTUP, sama seperti formulir mitra & klien: layar pertama
 * modul ini adalah KATALOG, dan formulir yang selalu terbuka mendorong admin
 * mendaftarkan ulang layanan yang sebenarnya hanya sedang nonaktif — sementara
 * yang benar adalah mengaktifkannya kembali, supaya seluruh sesi yang sudah
 * berjalan tetap menempel pada satu baris yang sama.
 */
export function FormLayananBaru({ fase }: { fase: PilihanFase[] }) {
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
        + Layanan baru
      </button>
    );
  }

  return (
    <form
      action={(fd) =>
        mulai(async () => {
          const r = await simpanLayanan(fd);
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
        Layanan baru — nama inilah yang dibaca pengunjung di beranda
      </h2>

      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className={KELAS_LABEL}>Fase perjalanan</span>
          <select name="phase_id" required defaultValue={fase[0]?.id ?? ""} className={KELAS_MEDAN}>
            {fase.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nama}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={KELAS_LABEL}>Nama layanan</span>
          <input
            name="nama"
            type="text"
            required
            minLength={2}
            maxLength={PANJANG_NAMA_MAKS}
            placeholder="mis. Sankalpa Fertility Massage"
            className={KELAS_MEDAN}
          />
        </label>
      </div>
      <label className="mt-3 block">
        <span className={KELAS_LABEL}>Deskripsi singkat (opsional)</span>
        <textarea
          name="deskripsi"
          rows={2}
          maxLength={PANJANG_DESKRIPSI_MAKS}
          className={KELAS_MEDAN}
        />
      </label>

      {pesan && <p className="mt-3 text-[13px] font-semibold text-clay">{pesan}</p>}

      <div className="mt-4 flex gap-2.5">
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl bg-night px-4 py-2.5 text-[13px] font-bold text-gold-pale disabled:opacity-60"
        >
          {pending ? "Menyimpan…" : "Simpan layanan"}
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
 * Aksi per layanan: ubah identitasnya, dan nyalakan/matikan ketersediaannya.
 *
 * Tidak ada tombol HAPUS di sini, dan itu bukan kelalaian: hak DELETE atas
 * `services` sudah dicabut dari peran aplikasi, jadi tombol semacam itu pasti
 * gagal — dan kegagalannya berupa kode Postgres di layar admin klinik.
 * Menghapus barisnya pun akan memutus `sessions.service_id` milik riwayat lama.
 */
export function AksiLayanan({
  id,
  nama,
  deskripsi,
  faseId,
  aktif,
  fase,
}: {
  id: string;
  nama: string;
  deskripsi: string;
  faseId: string;
  aktif: boolean;
  fase: PilihanFase[];
}) {
  const [ubah, setUbah] = useState(false);
  const [tambahPaket, setTambahPaket] = useState(false);
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);

  if (ubah) {
    return (
      <form
        action={(fd) =>
          mulai(async () => {
            const r = await perbaruiLayanan(id, fd);
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
          name="phase_id"
          defaultValue={faseId}
          aria-label={`Fase layanan ${nama}`}
          className={KELAS_MEDAN}
        >
          {fase.map((f) => (
            <option key={f.id} value={f.id}>
              {f.nama}
            </option>
          ))}
        </select>
        <input
          name="nama"
          type="text"
          required
          minLength={2}
          maxLength={PANJANG_NAMA_MAKS}
          defaultValue={nama}
          aria-label={`Nama layanan ${nama}`}
          className={KELAS_MEDAN}
        />
        <textarea
          name="deskripsi"
          rows={2}
          maxLength={PANJANG_DESKRIPSI_MAKS}
          defaultValue={deskripsi}
          aria-label={`Deskripsi layanan ${nama}`}
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
    );
  }

  return (
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
            const r = aktif ? await nonaktifkanLayanan(id) : await aktifkanLayanan(id);
            setPesan(r.ok ? null : r.pesan);
          })
        }
        className={KELAS_TOMBOL_KECIL}
      >
        {aktif ? "Nonaktifkan" : "Aktifkan"}
      </button>
      {/* GERBANG SAKLAR (K11, ditemukan Task 3 lewat test render
          /admin/layanan): tidak ada di brief awal berkas ini, tapi tombol
          ini membuka jalan MENULIS paket baru — kontrol yang lebih tajam
          dari sekadar menampilkan yang sudah ada, dan tetap sepenuhnya
          berfungsi terlepas dari gerbang data Task 1/2 karena `simpanPaket`
          (server action, aksi.ts) tidak disentuh saklar ini. Dicabut di
          sini; `simpanPaket` sendiri TIDAK diubah. */}
      {PAKET_TAMPIL && (
        <>
          <button
            type="button"
            onClick={() => setTambahPaket((t) => !t)}
            className={KELAS_TOMBOL_KECIL}
          >
            + Paket
          </button>
          {tambahPaket && (
            <FormPaketBaru
              serviceId={id}
              namaLayanan={nama}
              selesai={() => setTambahPaket(false)}
            />
          )}
        </>
      )}
      {pesan && <span className="text-[12px] font-semibold text-clay">{pesan}</span>}
    </span>
  );
}

function FormPaketBaru({
  serviceId,
  namaLayanan,
  selesai,
}: {
  serviceId: string;
  namaLayanan: string;
  selesai: () => void;
}) {
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);

  return (
    <form
      action={(fd) =>
        mulai(async () => {
          const r = await simpanPaket(fd);
          if (r.ok) {
            setPesan(null);
            selesai();
          } else {
            setPesan(r.pesan);
          }
        })
      }
      className="mt-2 grid w-full gap-2 rounded-xl border-[1.5px] border-dashed border-gold bg-[#FDFAF1] p-3"
    >
      {/* `service_id` terikat pada layanan yang sedang dibuka — paket tidak
          pernah bisa lahir menempel pada layanan lain lewat satu medan yang
          ditulis ulang di DevTools tanpa admin menyadarinya. Server tetap
          memeriksanya ulang, karena argumen action pun masukan jaringan. */}
      <input type="hidden" name="service_id" value={serviceId} />
      <label>
        <span className={KELAS_LABEL}>Nama paket untuk {namaLayanan}</span>
        <input
          name="nama"
          type="text"
          required
          minLength={2}
          maxLength={PANJANG_NAMA_MAKS}
          placeholder="mis. Sankalpa Prima"
          className={KELAS_MEDAN}
        />
      </label>
      <label>
        <span className={KELAS_LABEL}>Jumlah sesi</span>
        <input
          name="jumlah_sesi"
          type="number"
          required
          min={1}
          max={SESI_PAKET_MAKS}
          defaultValue={8}
          className={KELAS_MEDAN}
        />
      </label>
      {pesan && <span className="text-[12px] font-semibold text-clay">{pesan}</span>}
      <span className="flex gap-2">
        <button type="submit" disabled={pending} className={KELAS_TOMBOL_UTAMA}>
          {pending ? "Menyimpan…" : "Simpan paket"}
        </button>
        <button type="button" onClick={selesai} className={KELAS_TOMBOL_KECIL}>
          Batal
        </button>
      </span>
    </form>
  );
}

/**
 * Aksi per paket.
 *
 * Peringatan `jumlah_sesi` bukan hiasan. Nilainya adalah PENYEBUT progres
 * passport: memperkecilnya menggeser angka setiap klien yang paketnya sedang
 * berjalan, dan grid stempel ikut menyusut. `progresPaket()` membatasi persen
 * pada 100 supaya tidak lahir angka "200%", tetapi tidak ada yang bisa
 * mengembalikan konteksnya — jadi jumlah klien yang terdampak ditulis di sini,
 * sebelum tombol simpan ditekan.
 */
export function AksiPaket({
  id,
  nama,
  jumlahSesi,
  aktif,
  dipakai,
}: {
  id: string;
  nama: string;
  jumlahSesi: number;
  aktif: boolean;
  dipakai: number;
}) {
  const [ubah, setUbah] = useState(false);
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);

  if (ubah) {
    return (
      <form
        action={(fd) =>
          mulai(async () => {
            const r = await perbaruiPaket(id, fd);
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
          maxLength={PANJANG_NAMA_MAKS}
          defaultValue={nama}
          aria-label={`Nama paket ${nama}`}
          className={KELAS_MEDAN}
        />
        <input
          name="jumlah_sesi"
          type="number"
          required
          min={1}
          max={SESI_PAKET_MAKS}
          defaultValue={jumlahSesi}
          aria-label={`Jumlah sesi paket ${nama}`}
          className={KELAS_MEDAN}
        />
        <span className="text-[12px] text-clay">
          {dipakai > 0
            ? `Perhatian: ${dipakai} klien sedang menjalani paket ini. Mengubah jumlah sesi menggeser progres passport mereka seketika — kotak stempel ikut bertambah atau menyusut, dan progres yang sudah lewat batas ditampilkan 100%.`
            : "Mengubah jumlah sesi akan menggeser progres passport setiap klien yang kelak memakai paket ini."}
        </span>
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
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => setUbah(true)} className={KELAS_TOMBOL_KECIL}>
        Ubah
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          mulai(async () => {
            const r = aktif ? await nonaktifkanPaket(id) : await aktifkanPaket(id);
            setPesan(r.ok ? null : r.pesan);
          })
        }
        className={KELAS_TOMBOL_KECIL}
      >
        {aktif ? "Nonaktifkan" : "Aktifkan"}
      </button>
      {pesan && <span className="text-[12px] font-semibold text-clay">{pesan}</span>}
    </span>
  );
}
