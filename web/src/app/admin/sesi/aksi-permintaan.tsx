"use client";

import { useState, useTransition, type ReactNode } from "react";
import { cariMitra, pilihMitra, konfirmasiPermintaan, terbitkanTagihan } from "./aksi";
import { tetapkanKoordinatPermintaan } from "./aksi-koordinat";
import {
  PERMINTAAN_AWAL,
  PERMINTAAN_DICARIKAN,
  PERMINTAAN_MENUNGGU_BAYAR,
  PERMINTAAN_SIAP_KONFIRMASI,
  type StatusPermintaan,
} from "@/lib/jadwal/status";

/** Satu pilihan bidan, jaraknya SUDAH diformat di server. */
export type MitraPilihan = { id: string; nama: string; jarak: string };

const KELAS_UTAMA =
  "rounded-lg bg-gold px-3 py-1.5 text-[12px] font-bold text-night disabled:opacity-60";
const KELAS_KEDUA =
  "rounded-lg border border-black/15 px-3 py-1.5 text-[12px] font-bold text-ink-soft disabled:opacity-60";

/**
 * Tombol-tombol satu permintaan — TIGA LANGKAH, bukan satu (spec C1 J7):
 *
 *   diminta        -> "Cari bidan"
 *   mencari_mitra  -> daftar bidan terurut jarak + "Tetapkan bidan"
 *   mitra_siap     -> "Terbitkan tagihan" + "Ganti bidan"
 *   menunggu_bayar -> WA tagihan, lalu "Konfirmasi jadwal" bila sudah lunas
 *
 * Langkahnya dipisah karena tarif transport berasal dari domisili BIDAN ke
 * alamat KLIEN: transport tidak bisa dihitung sebelum bidannya diketahui.
 *
 * TOMBOL "TOLAK" SENGAJA TIDAK ADA (spec C1 J8). Admin tidak menolak pengajuan;
 * klien yang membatalkan miliknya sendiri dari Passport. `tolakPermintaan`
 * masih hidup di aksi.ts, hanya tidak terjangkau dari layar — dan
 * tests/pembatalan-klien.test.ts menjaga agar tidak ada berkas di src/ yang
 * memanggilnya.
 *
 * Komponen ini KLIEN karena memanggil server action lalu menampilkan pesan
 * galatnya di tempat. Yang tidak ada di sini: pengambilan data dan
 * pemformatan — seluruhnya datang sebagai prop yang sudah jadi dari server.
 */
export function TombolPermintaan({
  permintaanId,
  status,
  namaMitra,
  mitra,
  lunas,
  tautanWa,
}: {
  permintaanId: string;
  status: StatusPermintaan;
  namaMitra: string | null;
  mitra: MitraPilihan[];
  lunas: boolean;
  tautanWa: string;
}) {
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);
  const [partnerId, setPartnerId] = useState(mitra[0]?.id ?? "");
  const tanpaMitra = mitra.length === 0;

  function jalankan(aksi: () => Promise<{ ok: true } | { ok: false; pesan: string }>) {
    mulai(async () => {
      const r = await aksi();
      setPesan(r.ok ? null : r.pesan);
    });
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {status === PERMINTAAN_AWAL && (
        <button
          type="button"
          disabled={pending}
          onClick={() => jalankan(() => cariMitra(permintaanId))}
          className={KELAS_UTAMA}
        >
          {pending ? "Memproses…" : "Cari bidan"}
        </button>
      )}

      {status === PERMINTAAN_DICARIKAN && (
        <>
          <label className="sr-only" htmlFor={`mitra-${permintaanId}`}>
            Bidan untuk permintaan ini
          </label>
          <select
            id={`mitra-${permintaanId}`}
            value={partnerId}
            onChange={(e) => setPartnerId(e.target.value)}
            className="min-h-[38px] w-full rounded-lg border border-black/15 bg-white px-2.5 py-1.5 text-[12.5px]"
          >
            {mitra.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nama} · {m.jarak}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={pending || tanpaMitra}
            onClick={() => jalankan(() => pilihMitra(permintaanId, partnerId))}
            className={KELAS_UTAMA}
          >
            {pending ? "Memproses…" : "Tetapkan bidan"}
          </button>
          {tanpaMitra && (
            <p className="text-[12px] font-semibold text-clay">
              Belum ada mitra aktif. Tambahkan di menu Mitra lebih dulu.
            </p>
          )}
        </>
      )}

      {status === PERMINTAAN_SIAP_KONFIRMASI && (
        <>
          <span className="text-[12.5px] font-semibold text-ink">Bidan: {namaMitra ?? "—"}</span>
          {/* Tagihan terbit TEPAT di sini, tidak lebih awal: tarif transport
              berasal dari domisili bidan ke alamat klien, jadi totalnya baru
              bisa diketahui sesudah bidannya dipilih. */}
          <button
            type="button"
            disabled={pending}
            onClick={() => jalankan(() => terbitkanTagihan(permintaanId))}
            className={KELAS_UTAMA}
          >
            {pending ? "Memproses…" : "Terbitkan tagihan"}
          </button>
          {/* JALAN MUNDUR. Tanpa tombol ini, permintaan yang bidannya
              berhalangan tersangkut permanen: konfirmasi menolaknya, dan sejak
              J8 admin tidak lagi punya tombol tolak. */}
          <button
            type="button"
            disabled={pending}
            onClick={() => jalankan(() => cariMitra(permintaanId))}
            className={KELAS_KEDUA}
          >
            Ganti bidan
          </button>
        </>
      )}

      {status === PERMINTAAN_MENUNGGU_BAYAR && (
        <>
          {tautanWa ? (
            <a href={tautanWa} target="_blank" rel="noopener" className={KELAS_KEDUA}>
              Kirim tagihan via WA
            </a>
          ) : (
            /* Tombolnya HILANG ketika nomor klien tidak sah, dan kalimat ini
               yang membuat hilangnya terlihat. Tanpa kalimat, admin membaca
               layar yang sama persis seperti layar yang benar dan menyimpulkan
               tagihannya sudah terkirim — sementara tenggat 24 jam berjalan. */
            <span className="text-[12px] font-semibold text-clay">
              Nomor WhatsApp klien belum sah — lengkapi di menu Klien.
            </span>
          )}
          {/* Konfirmasi hanya muncul ketika pembayaran SUDAH diverifikasi.
              Menampilkannya lebih awal berarti menawarkan tombol yang akan
              ditolak basis data — dan tombol yang berbohong adalah cara
              tercepat membuat admin berhenti memercayai layarnya. */}
          {lunas && (
            <button
              type="button"
              disabled={pending}
              onClick={() => jalankan(() => konfirmasiPermintaan(permintaanId))}
              className={KELAS_UTAMA}
            >
              {pending ? "Memproses…" : "Konfirmasi jadwal"}
            </button>
          )}
        </>
      )}

      {pesan && <p className="w-full text-[12px] font-semibold text-clay">{pesan}</p>}
    </div>
  );
}

/**
 * Formulir pin alamat permintaan.
 *
 * `PemilihLokasi` menaruh dua input tersembunyi bernama `lat`/`lon`; formulir
 * ini hanya membungkusnya dan menyerahkan FormData-nya ke server action.
 */
export function FormPinPermintaan({
  permintaanId,
  anak,
}: {
  permintaanId: string;
  /** `PemilihLokasi`, dirender halaman di server lalu dioper masuk. */
  anak: ReactNode;
}) {
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);

  return (
    <form
      action={(formData) =>
        mulai(async () => {
          const r = await tetapkanKoordinatPermintaan(permintaanId, formData);
          setPesan(r.ok ? "Pin tersimpan." : r.pesan);
        })
      }
    >
      {anak}
      <button type="submit" disabled={pending} className={`mt-2 ${KELAS_UTAMA}`}>
        {pending ? "Menyimpan…" : "Simpan pin"}
      </button>
      {pesan && <p className="mt-1 text-[12px] font-semibold text-ink-soft">{pesan}</p>}
    </form>
  );
}
