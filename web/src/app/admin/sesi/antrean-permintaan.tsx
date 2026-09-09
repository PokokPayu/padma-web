"use client";

import { useState, useTransition } from "react";
import { cariMitra, pilihMitra, konfirmasiPermintaan, terbitkanTagihan } from "./aksi";
import {
  PERMINTAAN_AWAL,
  PERMINTAAN_DICARIKAN,
  PERMINTAAN_MENUNGGU_BAYAR,
  PERMINTAAN_SIAP_KONFIRMASI,
  type StatusPermintaan,
} from "@/lib/jadwal/status";

export type PermintaanAntre = {
  id: string;
  namaKlien: string;
  namaLayanan: string;
  tanggal: string; // sudah diformat untuk manusia
  jam: string; // sudah diformat, mis. "09.00 WIB"
  // Label preferensi waktu. Sejak C1 ia berarti ALTERNATIF bila jam yang
  // diminta tidak bisa (spec J2), bukan lagi satu-satunya keterangan waktu —
  // karena itu ia dirender di belakang jam, bukan menggantikannya.
  waktu: string;
  catatan: string;
  status: StatusPermintaan;
  /** Nama mitra yang sudah dipilih; null selama masih dicarikan. */
  namaMitra: string | null;
  /** Keadaan pembayaran, sudah diformat untuk dibaca ("Belum dibayar · 20 jam lagi"). */
  labelBayar: string;
  /** Sudah diverifikasi lunas — hanya ini yang boleh dikonfirmasi. */
  lunas: boolean;
  /** Tautan WhatsApp siap tempel berisi pesan tagihan. Kosong bila belum ditagih. */
  tautanWa: string;
};

/**
 * Satu pilihan mitra, LENGKAP dengan jaraknya ke alamat permintaan ini.
 *
 * `jarak` sudah diformat di server ("4,2 km" atau "domisili belum diisi") —
 * komponen ini tidak menghitung apa pun. Bukan sekadar pembagian tugas:
 * `urutkanMitraMenurutJarak()` dan `formatKm()` adalah fungsi yang diuji tanpa
 * DOM, dan memindahkannya ke sini akan menukar uji murni dengan uji render.
 */
export type MitraPilihan = { id: string; nama: string; jarak: string };

/**
 * Satu blok permintaan jadwal di antrean admin.
 *
 * TIGA LANGKAH, bukan satu (spec C1 J7):
 *   diminta       -> tombol "Cari bidan"
 *   mencari_mitra -> daftar mitra terurut jarak + "Tetapkan bidan"
 *   mitra_siap    -> nama bidan terpilih + "Konfirmasi" + "Ganti bidan"
 *
 * Langkahnya dipisah karena tarif transport berasal dari domisili MITRA ke
 * alamat KLIEN: transport tidak bisa dihitung sebelum mitranya diketahui, dan
 * itulah alasan struktural C2 kelak menyisipkan pembayaran SESUDAH mitra_siap.
 *
 * Keadaan tujuan tidak pernah menyeberang batas server sebagai data — tiap
 * langkah punya action sendiri dengan status tertulis mati di dalamnya. Yang
 * dikirim hanyalah "permintaan yang mana" dan, untuk satu langkah, "mitra yang
 * mana".
 *
 * TOMBOL "TOLAK" SENGAJA TIDAK ADA (spec J8). Admin tidak menolak pengajuan;
 * klien yang membatalkan miliknya sendiri dari Passport. Action
 * `tolakPermintaan` masih hidup di aksi.ts — nilai enum `ditolak` dan
 * penjaganya tetap di tempatnya, hanya tidak lagi terjangkau dari layar, persis
 * pola saklar paket.
 */
export function BlokPermintaan({
  permintaan,
  mitra,
}: {
  permintaan: PermintaanAntre;
  mitra: MitraPilihan[];
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
    <article
      className="mb-3 rounded-2xl border-[1.6px] border-dashed border-gold bg-[#FDFAF1] px-4 py-3.5"
      data-permintaan={permintaan.id}
      data-status={permintaan.status}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <b className="text-[13.5px] text-ink">Permintaan jadwal — {permintaan.namaKlien}</b>
          <span className="mt-0.5 block text-[11.5px] text-ink-soft">
            {permintaan.namaLayanan} · {permintaan.tanggal} · <b>{permintaan.jam}</b> · alternatif{" "}
            {permintaan.waktu}
            {permintaan.catatan ? ` · “${permintaan.catatan}”` : ""}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {permintaan.status === PERMINTAAN_AWAL && (
            <button
              type="button"
              disabled={pending}
              onClick={() => jalankan(() => cariMitra(permintaan.id))}
              className="rounded-lg bg-gold px-3 py-1.5 text-[12px] font-bold text-night disabled:opacity-60"
            >
              {pending ? "Memproses…" : "Cari bidan"}
            </button>
          )}

          {permintaan.status === PERMINTAAN_DICARIKAN && (
            <>
              <label className="sr-only" htmlFor={`mitra-${permintaan.id}`}>
                Bidan untuk permintaan {permintaan.namaKlien}
              </label>
              <select
                id={`mitra-${permintaan.id}`}
                value={partnerId}
                onChange={(e) => setPartnerId(e.target.value)}
                className="min-h-[38px] rounded-lg border border-black/15 bg-white px-2.5 py-1.5 text-[12.5px]"
              >
                {/* Terurut jarak ke alamat permintaan INI — daftar yang sama
                    untuk seluruh antrean akan salah untuk semua kecuali satu. */}
                {mitra.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nama} · {m.jarak}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={pending || tanpaMitra}
                onClick={() => jalankan(() => pilihMitra(permintaan.id, partnerId))}
                className="rounded-lg bg-gold px-3 py-1.5 text-[12px] font-bold text-night disabled:opacity-60"
              >
                {pending ? "Memproses…" : "Tetapkan bidan"}
              </button>
            </>
          )}

          {permintaan.status === PERMINTAAN_SIAP_KONFIRMASI && (
            <>
              <span className="text-[12.5px] font-semibold text-ink">
                Bidan: {permintaan.namaMitra ?? "—"}
              </span>
              {/* TERBITKAN TAGIHAN menggantikan konfirmasi langsung (spec C2).
                  Tagihan terbit TEPAT di sini, tidak lebih awal: tarif transport
                  berasal dari domisili bidan ke alamat klien, jadi totalnya baru
                  bisa diketahui sesudah bidannya dipilih. */}
              <button
                type="button"
                disabled={pending}
                onClick={() => jalankan(() => terbitkanTagihan(permintaan.id))}
                className="rounded-lg bg-gold px-3 py-1.5 text-[12px] font-bold text-night disabled:opacity-60"
              >
                {pending ? "Memproses…" : "Terbitkan tagihan"}
              </button>
              {/* JALAN MUNDUR. Tanpa tombol ini, permintaan yang bidannya
                  berhalangan — atau dinonaktifkan sesudah ditetapkan —
                  tersangkut permanen: konfirmasi menolaknya, dan sejak J8 admin
                  tidak lagi punya tombol tolak. Peta perpindahan status memang
                  sudah menyahkan `mitra_siap -> mencari_mitra`; yang hilang
                  hanyalah jalan menuju ke sana. */}
              <button
                type="button"
                disabled={pending}
                onClick={() => jalankan(() => cariMitra(permintaan.id))}
                className="rounded-lg border border-black/15 px-3 py-1.5 text-[12px] font-bold text-ink-soft disabled:opacity-60"
              >
                Ganti bidan
              </button>
            </>
          )}
        </div>
      </div>

      {permintaan.status === PERMINTAAN_MENUNGGU_BAYAR && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] font-semibold text-ink">
            Bidan: {permintaan.namaMitra ?? "—"} · {permintaan.labelBayar}
          </span>
          {/* Konfirmasi hanya muncul ketika pembayaran SUDAH diverifikasi.
              Menampilkannya lebih awal berarti menawarkan tombol yang akan
              ditolak basis data — dan tombol yang berbohong adalah cara
              tercepat membuat admin berhenti memercayai layarnya. */}
          {/* KANAL PERTAMA dari dua (spec C2 P7): pesan siap-salin, bukan
              kiriman otomatis. PADMA belum punya jalur kirim WhatsApp, dan
              menambahkannya berarti satu penyedia baru beserta jalur
              kegagalannya — sementara admin memang sudah punya percakapan
              berjalan dengan klien itu. */}
          {permintaan.tautanWa ? (
            <a
              href={permintaan.tautanWa}
              target="_blank"
              rel="noopener"
              className="rounded-lg border border-black/15 px-3 py-1.5 text-[12px] font-bold text-ink-soft"
            >
              Kirim tagihan via WA
            </a>
          ) : (
            /* Tombolnya HILANG ketika nomor klien tidak sah, dan kalimat ini
               yang membuat hilangnya terlihat. Tanpa kalimat, admin membaca
               layar yang sama persis seperti layar yang benar dan menyimpulkan
               tagihannya sudah terkirim — sementara tenggat 24 jam berjalan.
               Nomornya disunting di Klien; menagih ke nomor cadangan klinik
               adalah cacat yang justru sedang ditutup di sini. */
            <span className="text-[12px] font-semibold text-clay">
              Nomor WhatsApp klien belum sah — lengkapi di menu Klien.
            </span>
          )}
          {permintaan.lunas && (
            <button
              type="button"
              disabled={pending}
              onClick={() => jalankan(() => konfirmasiPermintaan(permintaan.id))}
              className="rounded-lg bg-gold px-3 py-1.5 text-[12px] font-bold text-night disabled:opacity-60"
            >
              {pending ? "Memproses…" : "Konfirmasi jadwal"}
            </button>
          )}
        </div>
      )}

      {permintaan.status === PERMINTAAN_DICARIKAN && tanpaMitra && (
        <p className="mt-2 text-[12px] font-semibold text-clay">
          Belum ada mitra aktif — daftarkan mitra dulu di menu Mitra.
        </p>
      )}
      {pesan && <p className="mt-2 text-[12px] font-semibold text-clay">{pesan}</p>}
    </article>
  );
}
