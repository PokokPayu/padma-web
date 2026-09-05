"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  aktifkanMateri,
  lepasVideo,
  nonaktifkanMateri,
  perbaruiMateri,
  simpanMateri,
} from "./aksi";
import { cabutTugasMateri, tugaskanMateri } from "./penugasan-aksi";
import type { PasienRingkas } from "@/lib/admin/penugasan";
import type { KlienPilihan } from "@/lib/admin/materi-admin";
import {
  LABEL_ISI,
  LABEL_TIPE,
  PANJANG_DESKRIPSI_MAKS,
  PANJANG_JUDUL_MAKS,
  TIPE_SAH,
  type TipeMateri,
} from "./status";
import { PengunggahPdf } from "./pengunggah-pdf";
import { PengunggahVideo } from "./pengunggah-video";

const KELAS_MEDAN =
  "mt-1 min-h-[42px] w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-[13.5px]";
const KELAS_LABEL = "block text-[12.5px] font-bold text-ink-soft";
const KELAS_TOMBOL_KECIL =
  "rounded-lg border border-black/15 px-3 py-1.5 text-[12px] font-bold text-ink-soft disabled:opacity-60";
const KELAS_TOMBOL_UTAMA =
  "rounded-lg bg-night px-3 py-1.5 text-[12px] font-bold text-gold-pale disabled:opacity-60";

export type PilihanLayanan = { id: string; nama: string };

/**
 * Daftar checkbox layanan — NOL ATAU LEBIH boleh dicentang. Materi tanpa
 * layanan sama sekali adalah keadaan SAH sejak Task 11 (materi.service_id
 * tunggal sudah digantikan `material_services`, yang boleh nol baris): admin
 * wajar ingin menumpuk bahan dulu, dan materi seperti itu tetap bisa dibuka
 * lewat penugasan manual. Karena itu TIDAK ADA satu pun checkbox di sini yang
 * `required`.
 */
function CentangLayanan({
  layanan,
  terpilih,
  labelUntuk,
}: {
  layanan: PilihanLayanan[];
  terpilih: string[];
  labelUntuk: (nama: string) => string;
}) {
  return (
    <fieldset className="mt-3">
      <legend className={KELAS_LABEL}>Layanan (boleh lebih dari satu, atau tidak sama sekali)</legend>
      <div className="mt-1.5 grid gap-1.5 rounded-lg border border-black/15 bg-white p-2.5 sm:grid-cols-2">
        {layanan.map((l) => (
          <label key={l.id} className="flex items-center gap-2 text-[13px] text-ink">
            <input
              type="checkbox"
              name="service_id"
              value={l.id}
              defaultChecked={terpilih.includes(l.id)}
              aria-label={labelUntuk(l.nama)}
            />
            {l.nama}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Medan ISI materi — unggahan berkas untuk KEDUA tipe sejak Task 6: video
 * (`<PengunggahVideo/>`) menggantikan medan URL penyedia lama, dan e-book
 * (`<PengunggahPdf/>`) sudah begitu sejak Task 11. Keduanya butuh `materiId`
 * yang sudah ada di basis data, sehingga pada formulir "materi baru" (id
 * belum ada) cabang di bawah hanya menjelaskan bahwa unggahannya menyusul
 * sesudah materi tersimpan. Pada formulir SUNTING (materiId sudah ada, baik
 * untuk materi lama maupun yang baru dipindah tipenya) komponen pengunggah
 * masing-masing tampil sungguhan.
 */
function MedanIsi({ tipe, materiId }: { tipe: TipeMateri; materiId?: string }) {
  if (tipe === "video") {
    // Video kini berupa BERKAS yang diunggah ke R2, bukan URL penyedia — jadi
    // ia mengikuti pola e-book: unggahan butuh `materiId` yang sudah ada di
    // basis data, sehingga pada formulir "materi baru" ia belum bisa muncul.
    if (materiId === undefined) {
      return (
        <p className="mt-3 text-[12px] text-ink-soft">
          Simpan materi ini dulu, lalu unggah videonya lewat “Kelola isi”.
        </p>
      );
    }
    return <PengunggahVideo materiId={materiId} />;
  }
  if (!materiId) {
    return (
      <p className="mt-3 rounded-lg bg-black/5 px-3 py-2 text-[11.5px] leading-relaxed text-ink-soft">
        Berkas PDF diunggah SESUDAH materi ini tersimpan — simpan dulu, lalu
        buka &quot;Kelola isi&quot; pada baris materinya. Materi lahir
        nonaktif sampai halamannya ada.
      </p>
    );
  }
  return <PengunggahPdf materiId={materiId} />;
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
      <h2 className="mb-3 text-[13.5px] font-extrabold text-ink">Materi baru</h2>

      <div className="grid gap-3 sm:grid-cols-2">
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
        <label>
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
      </div>

      <CentangLayanan layanan={layanan} terpilih={[]} labelUntuk={(nama) => `Layanan ${nama}`} />

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
  jumlahHalaman,
  videoUrl,
  ditugaskan,
  otomatis,
  pilihanKlien,
}: {
  id: string;
  judul: string;
  deskripsi: string;
  tipe: TipeMateri;
  aktif: boolean;
  lengkap: boolean;
  layananId: string[];
  layanan: PilihanLayanan[];
  jumlahHalaman: number;
  videoUrl: string | null;
  ditugaskan: PasienRingkas[];
  otomatis: PasienRingkas[];
  pilihanKlien: KlienPilihan[];
}) {
  const [ubah, setUbah] = useState(false);
  const [tipeBaru, setTipeBaru] = useState<TipeMateri>(tipe);
  const [isi, setIsi] = useState(false);
  const [tugas, setTugas] = useState(false);
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
        <CentangLayanan
          layanan={layanan}
          terpilih={layananId}
          labelUntuk={(nama) => `Layanan ${nama} untuk materi ${judul}`}
        />
        {tipeBaru !== tipe && (
          <>
            <span className="text-[12px] text-clay">
              Mengubah tipe wajib disertai {LABEL_ISI[tipeBaru]}. Tanpa itu
              materinya berubah menjadi kartu terkunci yang tidak akan pernah
              terbuka bagi klien yang sudah berhak.
            </span>
            <MedanIsi tipe={tipeBaru} materiId={id} />
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
        <button type="button" onClick={() => setTugas((t) => !t)} className={KELAS_TOMBOL_KECIL}>
          {tugas ? "Tutup penugasan" : "Kelola penugasan"}
        </button>
        {!lengkap && (
          <span className="text-[12px] font-semibold text-clay">
            Materi ini belum ada isinya ({LABEL_ISI[tipe]}) — belum bisa diterbitkan.
          </span>
        )}
      </span>

      {isi && tipe === "ebook" && <IsiEbook materiId={id} jumlahHalaman={jumlahHalaman} />}
      {isi && tipe === "video" && (
        <IsiVideo materiId={id} aktif={aktif} videoUrl={videoUrl} />
      )}
      {tugas && (
        <PanelPenugasan
          materiId={id}
          judulMateri={judul}
          ditugaskan={ditugaskan}
          otomatis={otomatis}
          pilihan={pilihanKlien}
        />
      )}

      {pesan && <span className="text-[12px] font-semibold text-clay">{pesan}</span>}
    </div>
  );
}

/**
 * Panel penugasan manual per materi.
 *
 * `otomatis` ditampilkan bacaan saja — tanpanya admin akan meng-assign ulang
 * pasien yang materinya memang sudah terbuka lewat sesi selesai, lalu bingung
 * kenapa tidak ada yang berubah. Klien yang sudah punya akses (otomatis
 * ATAUPUN sudah ditugaskan) tidak ditawarkan lagi di daftar pilih "Tugaskan":
 * itu kenyamanan tampilan, BUKAN pagar keamanan — server tetap menolak
 * duplikat lewat kode 23505 apa pun yang dikirim.
 */
function PanelPenugasan({
  materiId,
  judulMateri,
  ditugaskan,
  otomatis,
  pilihan,
}: {
  materiId: string;
  judulMateri: string;
  ditugaskan: PasienRingkas[];
  otomatis: PasienRingkas[];
  pilihan: KlienPilihan[];
}) {
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);
  const [klienBaru, setKlienBaru] = useState("");

  const sudahPunyaAkses = new Set([
    ...ditugaskan.map((p) => p.clientId),
    ...otomatis.map((p) => p.clientId),
  ]);
  const bisaDitugaskan = pilihan.filter((k) => !sudahPunyaAkses.has(k.id));

  return (
    <div className="rounded-xl border border-black/10 bg-paper p-3">
      <p className={KELAS_LABEL}>Penugasan manual</p>
      {otomatis.length > 0 && (
        <p className="mt-1 text-[11.5px] text-ink-soft">
          Sudah terbuka otomatis (sesi layanan selesai): {otomatis.map((p) => p.nama).join(", ")}.
        </p>
      )}
      <ul className="mt-2 grid gap-1.5">
        {ditugaskan.length === 0 && (
          <li className="text-[12px] text-ink-soft">Belum ada penugasan manual.</li>
        )}
        {ditugaskan.map((p) => (
          <li
            key={p.clientId}
            className="flex items-center justify-between gap-2 text-[12.5px] text-ink"
          >
            <span>
              {p.nama} <span className="font-mono text-[11px] text-ink-soft">{p.padmaId}</span>
            </span>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                mulai(async () => {
                  const r = await cabutTugasMateri(materiId, p.clientId);
                  if (!r.ok) {
                    setPesan(r.pesan);
                  } else {
                    setPesan(null);
                    router.refresh();
                  }
                })
              }
              className={KELAS_TOMBOL_KECIL}
            >
              Cabut
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-2.5 flex flex-wrap gap-2">
        <select
          value={klienBaru}
          onChange={(e) => setKlienBaru(e.target.value)}
          aria-label={`Tugaskan materi ${judulMateri} ke klien`}
          className={KELAS_MEDAN}
        >
          <option value="">Pilih klien…</option>
          {bisaDitugaskan.map((k) => (
            <option key={k.id} value={k.id}>
              {k.nama} · {k.padmaId}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={pending || !klienBaru}
          onClick={() =>
            mulai(async () => {
              const r = await tugaskanMateri(materiId, klienBaru);
              if (!r.ok) {
                setPesan(r.pesan);
              } else {
                setPesan(null);
                setKlienBaru("");
                router.refresh();
              }
            })
          }
          className={KELAS_TOMBOL_UTAMA}
        >
          Tugaskan
        </button>
      </div>
      {pesan && <p className="mt-2 text-[12px] font-semibold text-clay">{pesan}</p>}
    </div>
  );
}

/**
 * Panel isi e-book: jumlah halaman yang sudah tersimpan, dan tempat mengunggah
 * penggantinya. `PengunggahPdf` menulis lewat server action-nya sendiri
 * (`./unggah.ts`, RPC `ganti_halaman_materi`) — bukan lewat `aksi.ts` — jadi
 * jumlah di sini disegarkan lewat `router.refresh()` sesudah unggahan selesai,
 * bukan lewat state lokal yang mudah menyimpang dari basis data.
 */
function IsiEbook({ materiId, jumlahHalaman }: { materiId: string; jumlahHalaman: number }) {
  const router = useRouter();
  return (
    <div className="rounded-xl border border-black/10 bg-paper p-3">
      <p className="text-[13px] text-ink">
        {jumlahHalaman > 0
          ? `${jumlahHalaman} halaman tersimpan.`
          : "Belum ada halaman — unggah PDF-nya di bawah."}
      </p>
      <PengunggahPdf materiId={materiId} onSelesai={() => router.refresh()} />
    </div>
  );
}

/**
 * Panel isi video: status ringkas, pengunggah penggantinya
 * (`<PengunggahVideo/>`, menulis lewat `./unggah-video.ts` — bukan `aksi.ts`,
 * persis pola `IsiEbook`/`PengunggahPdf`), dan tombol lepas untuk materi yang
 * sudah ditarik. `videoUrl` di sini tidak disegarkan otomatis sesudah
 * unggahan sukses — `PengunggahVideo` menampilkan status suksesnya sendiri —
 * tapi DISEGARKAN lewat `router.refresh()` sesudah "Lepas video", supaya
 * tombolnya sendiri ikut menghilang begitu isinya benar-benar kosong.
 */
function IsiVideo({
  materiId,
  aktif,
  videoUrl,
}: {
  materiId: string;
  aktif: boolean;
  videoUrl: string | null;
}) {
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);

  return (
    <div className="rounded-xl border border-black/10 bg-paper p-3">
      <p className="text-[13px] text-ink">
        {videoUrl !== null ? "Video tersimpan." : "Belum ada video — unggah di bawah."}
      </p>
      <PengunggahVideo materiId={materiId} />
      {/* "Lepas video" hanya ditawarkan pada materi yang sudah ditarik: materi
          video terbit tanpa isi adalah kartu terkunci yang tidak akan pernah
          terbuka. Server memeriksanya ulang. */}
      {!aktif && videoUrl !== null && (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            mulai(async () => {
              const r = await lepasVideo(materiId);
              if (r.ok) {
                setPesan(null);
                router.refresh();
              } else {
                setPesan(r.pesan);
              }
            })
          }
          className={`${KELAS_TOMBOL_KECIL} mt-2`}
        >
          Lepas video
        </button>
      )}
      {pesan && <p className="mt-2 text-[12px] font-semibold text-clay">{pesan}</p>}
    </div>
  );
}
