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
 *
 * `disabled` (Tugas 11): Kartu "Layanan tertaut" di halaman detail memakai
 * komponen ini sebagai RINGKASAN bacaan saja, bukan editor kedua. Menulis
 * relasi `material_services` tetap HANYA lewat formulir "Ubah" di
 * `AksiMateri` (Kartu "Data materi") — dua tempat yang bisa menulis satu
 * relasi adalah persis kelas bug yang komentar `Kartu "Materi yang termasuk
 * layanan ini"` di `layanan/[id]/page.tsx` sudah tolak untuk arah sebaliknya.
 */
export function CentangLayanan({
  layanan,
  terpilih,
  labelUntuk,
  disabled = false,
}: {
  layanan: PilihanLayanan[];
  terpilih: string[];
  labelUntuk: (nama: string) => string;
  disabled?: boolean;
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
              disabled={disabled}
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
 * Formulir "Materi baru" — ISI panel geser `?ubah=baru`, bukan gerbangnya.
 *
 * Komponen ini dulu memegang gerbang buka/tutupnya SENDIRI (`useState(false)`)
 * karena ia duduk di header halaman daftar. Sejak sapuan rencana 2 ia dirender
 * di dalam `<PanelGeser>`, dan panel itulah gerbangnya. Gerbang kedua berarti
 * admin mengeklik "+ Materi baru", panel terbuka, lalu isinya tombol
 * "+ Materi baru" lagi — dua klik untuk satu formulir. Cacat itu lolos tiga
 * gerbang review karena berkas ini tidak ikut berubah di diff mana pun, dan
 * lolos uji karena ujinya memeriksa TEKS SUMBER berkas (`sumberForm` memuat
 * `name="judul"`) alih-alih markup yang benar-benar dirender panel.
 *
 * Alasan gerbang lama tetap sah dan kini dijawab panelnya: layar pertama modul
 * ini adalah DAFTAR materi, supaya admin tidak mendaftarkan ulang materi yang
 * sebenarnya hanya sedang nonaktif — yang benar adalah mengaktifkannya kembali.
 */
export function FormMateriBaru({
  layanan,
  hrefTutup,
}: {
  layanan: PilihanLayanan[];
  /** Alamat halaman TANPA `?ubah` — ke sinilah sukses & "Batal" menuju. */
  hrefTutup: string;
}) {
  const router = useRouter();
  const [tipe, setTipe] = useState<TipeMateri>("ebook");
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);

  return (
    <form
      action={(fd) =>
        mulai(async () => {
          const r = await simpanMateri(fd);
          if (r.ok) {
            setPesan(null);
            // Menutup panel = kembali ke alamat tanpa `?ubah`. Keadaan panel
            // hidup di URL, jadi menutupnya adalah NAVIGASI, bukan setState —
            // pola yang sama dengan `FormJadwalSesi` dan `FormMitra`.
            router.push(hrefTutup);
          } else {
            setPesan(r.pesan);
          }
        })
      }
    >
      <div className="grid gap-3">
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

      <div className="mt-4 flex items-center gap-2.5">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-panel-ink px-3.5 py-2 text-[12.5px] font-bold text-panel-surface disabled:opacity-60"
        >
          {pending ? "Menyimpan…" : "Simpan materi"}
        </button>
        {/* `<a>` biasa, bukan tombol ber-onClick: menutup panel adalah
            perpindahan alamat, dan jalan keluar yang bekerja tanpa JavaScript
            adalah jalan keluar yang tidak bisa hilang bersama hidrasi. */}
        <a href={hrefTutup} className="text-[12.5px] font-bold text-panel-muted">
          Batal
        </a>
      </div>
    </form>
  );
}

/**
 * Aksi per materi: ubah identitasnya (termasuk layanan tertautnya) dan
 * nyalakan/matikan ketersediaannya.
 *
 * Sejak Tugas 11, ini adalah SATU-SATUNYA tempat yang menulis layanan
 * tertaut — formulir "Ubah" di sini mengirim `judul`/`tipe`/`deskripsi`
 * MAUPUN `service_id` dalam satu `perbaruiMateri()`, karena aksinya menulis
 * ulang seluruh tautan sekaligus (hapus-lalu-sisip berskop `materiId`, lihat
 * `gantiLayananMateri` di `./aksi.ts`) — checkbox yang tidak ikut terkirim
 * berarti "lepaskan tautan itu". Kartu "Layanan tertaut" di halaman detail
 * (`CentangLayanan disabled`) hanya menampilkan RINGKASAN, bukan editor
 * kedua: dua tempat yang bisa menulis relasi yang sama adalah persis kelas
 * bug yang membuat komentar `layanan/[id]/page.tsx` menahan arah sebaliknya
 * jadi bacaan saja.
 *
 * Kelola isi (`IsiEbook`/`IsiVideo`) dan penugasan (`PanelPenugasan`) TIDAK
 * lagi lahir dari sini sejak halaman detail materi (Tugas 11) menjadi
 * wadahnya sendiri — masing-masing Kartu terpisah SELALU tampil, bukan lagi
 * di balik tombol "Kelola isi"/"Kelola penugasan" yang harus diklik dulu.
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
}: {
  id: string;
  judul: string;
  deskripsi: string;
  tipe: TipeMateri;
  aktif: boolean;
  lengkap: boolean;
  layananId: string[];
  layanan: PilihanLayanan[];
}) {
  const [ubah, setUbah] = useState(false);
  const [tipeBaru, setTipeBaru] = useState<TipeMateri>(tipe);
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
        {!lengkap && (
          <span className="text-[12px] font-semibold text-clay">
            Materi ini belum ada isinya ({LABEL_ISI[tipe]}) — belum bisa diterbitkan.
          </span>
        )}
      </span>

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
 *
 * Sejak Tugas 11 hidup di Kartu tersendiri ("Penugasan manual") di halaman
 * detail materi — SELALU tampil, tidak lagi di balik tombol "Kelola
 * penugasan" milik `AksiMateri`.
 */
export function PanelPenugasan({
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
          name="client_id"
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
 *
 * Sejak Tugas 11 hidup di Kartu "Isi" tersendiri di halaman detail materi —
 * SELALU tampil untuk materi bertipe `ebook`, tidak lagi di balik tombol
 * "Kelola isi" milik `AksiMateri`.
 */
export function IsiEbook({ materiId, jumlahHalaman }: { materiId: string; jumlahHalaman: number }) {
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
 * sudah ditarik. `objekVideo` di sini adalah props SERVER yang basi begitu
 * unggahan sukses secara lokal — karena itu `onSelesai={() => router.refresh()}`
 * dipasang sama seperti `IsiEbook`/`PengunggahPdf`: tanpanya paragraf status di
 * atas ("Belum ada video…") tetap basi berdampingan dengan "Video tersimpan."
 * milik `PengunggahVideo` sendiri, sampai admin berpindah halaman. "Lepas
 * video" memakai `router.refresh()` yang sama, untuk alasan simetris.
 *
 * Sejak Tugas 11 hidup di Kartu "Isi" tersendiri di halaman detail materi —
 * SELALU tampil untuk materi bertipe `video`, tidak lagi di balik tombol
 * "Kelola isi" milik `AksiMateri`.
 */
export function IsiVideo({
  materiId,
  aktif,
  objekVideo,
}: {
  materiId: string;
  aktif: boolean;
  objekVideo: string | null;
}) {
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);

  return (
    <div className="rounded-xl border border-black/10 bg-paper p-3">
      <p className="text-[13px] text-ink">
        {objekVideo !== null ? "Video tersimpan." : "Belum ada video — unggah di bawah."}
      </p>
      <PengunggahVideo materiId={materiId} onSelesai={() => router.refresh()} />
      {/* "Lepas video" hanya ditawarkan pada materi yang sudah ditarik: materi
          video terbit tanpa isi adalah kartu terkunci yang tidak akan pernah
          terbuka. Server memeriksanya ulang. */}
      {!aktif && objekVideo !== null && (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            mulai(async () => {
              const r = await lepasVideo(materiId);
              if (r.ok) {
                // Lunak, tetapi tidak boleh senyap: sama seperti peringatan
                // `objekLamaTersisa` milik `PengunggahVideo` — objek yatim
                // memakan kuota 10 GB dan hanya bisa dibersihkan seseorang
                // yang tahu ia ada.
                setPesan(
                  r.objekTersisa
                    ? "Video dilepas, tetapi berkas videonya gagal dihapus dari penyimpanan. Beri tahu tim teknis agar tidak menumpuk."
                    : null,
                );
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
