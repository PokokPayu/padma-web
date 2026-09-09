"use client";

import { useState, useTransition } from "react";
import { selesaikanSesi, tetapkanJenjang } from "./aksi";
import { PanelPembatalan } from "./panel-pembatalan";
import { JENJANG_SAH, LABEL_STATUS_SESI } from "./status";
import { LABEL_JENJANG } from "@/lib/transport/jarak";
import type { BarisSesiDaftar } from "@/lib/admin/sesi";
import { PAKET_TAMPIL } from "@/lib/paket-tampil";

const KELAS_LABEL = "block text-[12.5px] font-bold text-panel-muted";
const KELAS_MEDAN =
  "mt-1 w-full rounded-lg border border-panel-border bg-panel-surface px-3 py-2 text-[13px] text-panel-ink";
const KELAS_UTAMA =
  "rounded-lg bg-panel-ink px-3.5 py-2 text-[12.5px] font-bold text-panel-surface disabled:opacity-60";

/**
 * Isi panel geser untuk SATU sesi.
 *
 * Sebelumnya dua laci di dalam sel tabel (`form-selesai.tsx`): baris memuai,
 * kolom lain melenceng, dan pada tabel panjang mata kehilangan baris mana yang
 * sedang diubah. Keduanya kini hidup berdampingan di panel selebar setengah
 * layar, dengan daftarnya tetap terlihat di belakang.
 *
 * Komponen KLIEN karena kedua formulirnya memanggil server action lalu
 * menampilkan pesan galatnya di tempat. Yang TIDAK ada di sini: pengambilan
 * data. Seluruh isinya datang sebagai prop `sesi` yang sudah dirender halaman
 * di server — memindahkan pengambilan data ke dalam sini akan membuat panel
 * ini berhenti bisa diuji sama sekali (suite berjalan tanpa jsdom).
 *
 * Nol rupiah: jenjang adalah data LOGISTIK, admin melihat "5–10 km".
 */
export function PanelSesi({
  sesi,
  hrefTutup,
  jamPilihan,
}: {
  sesi: BarisSesiDaftar;
  /**
   * Dihilangkan bila komponen ini bukan isi panel geser melainkan badan
   * halaman `/admin/sesi/[id]`: di sana tidak ada yang bisa "ditutup", dan
   * tautan "Tutup tanpa menyimpan" yang mengembalikan ke daftar justru
   * berbohong tentang apa yang barusan terjadi.
   */
  hrefTutup?: string;
  /**
   * Daftar `app_settings.jam_layanan`, dibaca di SERVER oleh halaman dan
   * dioper ke bawah. Panel ini komponen klien dan tidak boleh mengambil data
   * sendiri (lihat dokblok di atas).
   */
  jamPilihan: string[];
}) {
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);
  const [pesanJenjang, setPesanJenjang] = useState<string | null>(null);

  const adaCatatan = sesi.catatan.trim().length > 0;
  const labelJenjang = sesi.jenjang
    ? `${LABEL_JENJANG[sesi.jenjang]} · ${sesi.jenjangSumber === "admin" ? "ditetapkan admin" : "otomatis"}`
    : "belum ditetapkan";

  return (
    <div className="grid gap-4 text-[13px] text-panel-ink">
      <section>
        <p className="font-bold">{sesi.namaLayanan}</p>
        <p className="text-[12px] text-panel-muted">
          {sesi.namaKlien} · {sesi.padmaId} · {sesi.tanggal}
          {/* GERBANG SAKLAR (K11). Literal " · paket" ini datang dari
              `form-selesai.tsx` — berkas yang sapuan panel hapus dan isinya
              pindah ke sini — dan di sana ia SUDAH digerbang. Gerbangnya ikut
              dibawa: sesi lama yang `client_package_id`-nya sungguh terisi
              (mis. seed Ananda) akan membocorkan kata "paket" lewat literal
              ini terlepas dari empat gerbang data K11, karena `lib/admin/sesi.ts`
              membaca `client_package_id` LANGSUNG dari tabel `sessions`, bukan
              lewat salah satu fungsi yang digerbang. `dalamPaket` sendiri
              (data) TIDAK diubah — hanya tampilannya yang dicabut. */}
          {PAKET_TAMPIL && sesi.dalamPaket ? " · paket" : ""}
        </p>
        <p className="text-[12px] text-panel-muted">
          Mitra: {sesi.namaMitra} · Status: {LABEL_STATUS_SESI[sesi.status]}
        </p>
        <p className="text-[12px] text-panel-muted">Jenjang: {labelJenjang}</p>
      </section>

      {sesi.status === "terjadwal" && (
        <form
          action={(fd) =>
            mulai(async () => {
              const r = await selesaikanSesi(sesi.id, fd);
              setPesan(r.ok ? null : r.pesan);
            })
          }
          className="rounded-lg border border-panel-border p-3"
        >
          <h3 className="text-[12.5px] font-extrabold">
            Selesaikan sesi — catatan ini terbaca {sesi.namaKlien} di Passport-nya
          </h3>
          <label className="mt-2 block">
            <span className={KELAS_LABEL}>Catatan &amp; evaluasi (dari laporan bidan)</span>
            <textarea name="catatan" rows={3} required maxLength={2000} className={KELAS_MEDAN} />
          </label>
          <label className="mt-2 block">
            <span className={KELAS_LABEL}>Rekomendasi untuk klien</span>
            <textarea name="rekomendasi" rows={2} maxLength={2000} className={KELAS_MEDAN} />
          </label>
          {pesan && <p className="mt-2 text-[12px] font-semibold text-clay">{pesan}</p>}
          <button type="submit" disabled={pending} className={`mt-3 ${KELAS_UTAMA}`}>
            {pending ? "Menyimpan…" : "Simpan · sesi selesai"}
          </button>
        </form>
      )}

      {/* Koreksi jenjang TIDAK terikat status sesi — `tetapkanJenjang` sendiri
          tidak memeriksa status (lihat aksi.ts), karena jenjang adalah data
          logistik yang bisa perlu diperbaiki bahkan sesudah sesinya selesai. */}
      <form
        action={(fd) =>
          mulai(async () => {
            const r = await tetapkanJenjang(fd);
            setPesanJenjang(r.ok ? null : r.pesan);
          })
        }
        className="rounded-lg border border-panel-border p-3"
      >
        {/* Id ditulis di sini; `jenjang_sumber` ditulis MATI sebagai 'admin'
            oleh server action — yang boleh datang dari formulir hanyalah
            jenjang mana dan mengapa. */}
        <input type="hidden" name="sesi" value={sesi.id} />
        <h3 className="text-[12.5px] font-extrabold">Ubah jenjang transport</h3>
        <p className="text-[11.5px] text-panel-muted">
          Saat ini: {labelJenjang}. Ini data JENJANG untuk logistik — bukan rupiah.
        </p>
        <label className="mt-2 block">
          <span className={KELAS_LABEL}>Jenjang baru</span>
          <select name="jenjang" defaultValue={sesi.jenjang ?? JENJANG_SAH[0]} className={KELAS_MEDAN}>
            {JENJANG_SAH.map((j) => (
              <option key={j} value={j}>{LABEL_JENJANG[j]}</option>
            ))}
          </select>
        </label>
        <label className="mt-2 block">
          <span className={KELAS_LABEL}>Alasan (wajib)</span>
          <textarea
            name="alasan"
            rows={2}
            required
            placeholder="Mis. alamat di seberang sungai, memutar jauh…"
            className={KELAS_MEDAN}
          />
        </label>
        {pesanJenjang && (
          <p className="mt-2 text-[12px] font-semibold text-clay">{pesanJenjang}</p>
        )}
        <button type="submit" disabled={pending} className={`mt-3 ${KELAS_UTAMA}`}>
          {pending ? "Menyimpan…" : "Simpan jenjang"}
        </button>
      </form>

      {adaCatatan && (
        <section className="rounded-lg border border-panel-border bg-panel-bg p-3">
          <p><b>Catatan:</b> {sesi.catatan}</p>
          <p className="mt-1"><b>Rekomendasi:</b> {sesi.rekomendasi || "—"}</p>
        </section>
      )}

      {hrefTutup && (
        <a href={hrefTutup} className="text-[12px] font-bold text-panel-muted">
          Tutup tanpa menyimpan
        </a>
      )}

      {sesi.status === "terjadwal" && (
        <PanelPembatalan
          sesiId={sesi.id}
          tanggal={sesi.tanggal}
          jamMulai={sesi.jamMulai}
          jadwalUlangTerpakai={sesi.jadwalUlangTerpakai}
          jamPilihan={jamPilihan}
        />
      )}
    </div>
  );
}
