"use client";

import { useState, useTransition } from "react";
import { terbitkanUndangan } from "../aksi";
import { tautanAktivasi, teksUndanganWhatsApp } from "@/lib/auth/pesan-undangan";

/**
 * Kartu aktivasi pada halaman detail klien.
 *
 * Alur yang dilayani: admin menekan "Terbitkan tautan aktivasi" → server
 * menerbitkan token sekali-pakai dan mengembalikan nilainya SEKALI → kartu ini
 * menyusun pesan sambutan WhatsApp siap salin. Yang tersimpan di basis data
 * hanya sidik SHA-256 token, jadi tidak ada halaman mana pun (termasuk ini,
 * sesudah disegarkan) yang bisa menampilkannya kembali.
 *
 * Pesan & tautan disusun `@/lib/auth/pesan-undangan` — berkas MURNI tanpa impor.
 * Modul token (`@/lib/auth/link-client`) memuat `node:crypto` dan klien service
 * role; satu impor dari komponen `"use client"` seperti berkas ini sudah cukup
 * untuk menyeretnya ke bundel browser.
 *
 * `origin` diambil dari `window.location` — bukan dari server — supaya tautan
 * yang disalin selalu menunjuk ke asal yang sedang dipakai admin (localhost saat
 * pengembangan, domain klinik saat produksi) tanpa satu pun variabel lingkungan
 * yang bisa lupa disetel.
 */
export function KartuAktivasi({
  clientId,
  nama,
  nomorWa,
}: {
  clientId: string;
  nama: string;
  /**
   * Nomor WhatsApp klinik dalam format tampilan, DITURUNKAN DARI SERVER.
   *
   * Ia tidak dibaca di sini: `app_settings` hanya bisa dibaca lewat modul yang
   * memuat klien Supabase, dan komponen ini berjalan di browser. Karena nomor
   * itu kini bisa diubah admin lewat /admin/pengaturan, mengambilnya per
   * permintaan di server component induk adalah satu-satunya cara agar pesan
   * sambutan tidak menyebut nomor yang sudah tidak dipakai lagi.
   */
  nomorWa: string;
}) {
  const [pending, mulai] = useTransition();
  const [teks, setTeks] = useState<string | null>(null);
  const [pesan, setPesan] = useState<string | null>(null);
  const [disalin, setDisalin] = useState(false);

  function terbitkan() {
    mulai(async () => {
      setPesan(null);
      setDisalin(false);
      const r = await terbitkanUndangan(clientId);
      if (!r.ok) {
        setTeks(null);
        setPesan(r.pesan);
        return;
      }
      setTeks(
        teksUndanganWhatsApp({
          nama: r.nama,
          email: r.email,
          tautan: tautanAktivasi(window.location.origin, r.token),
          nomorWa,
        }),
      );
    });
  }

  async function salin() {
    if (!teks) return;
    try {
      await navigator.clipboard.writeText(teks);
      setDisalin(true);
    } catch {
      // Papan klip ditolak browser (izin, atau bukan konteks aman). Teksnya
      // tetap ada di layar dan bisa disalin manual — jangan biarkan admin
      // mengira tautannya gagal terbit.
      setPesan("Salin manual dari kotak di atas — papan klip tidak diizinkan.");
    }
  }

  return (
    <section className="mb-4 rounded-lg border-[1.5px] border-panel-border bg-panel-bg p-5">
      <h2 className="font-serif text-lg text-panel-ink">Aktivasi akun</h2>
      <p className="mt-1 text-[13px] text-panel-muted">
        {nama} belum bisa masuk. Terbitkan tautan sekali-pakai, lalu kirimkan
        lewat WhatsApp bersama pesan sambutan di bawah.
      </p>

      <button
        type="button"
        onClick={terbitkan}
        disabled={pending}
        className="mt-3.5 rounded-xl bg-panel-ink px-4 py-2.5 text-[13px] font-bold text-panel-surface disabled:opacity-60"
      >
        {pending
          ? "Menerbitkan…"
          : teks
            ? "Terbitkan tautan baru"
            : "Terbitkan tautan aktivasi"}
      </button>

      {pesan && <p className="mt-3 text-[13px] font-semibold text-clay">{pesan}</p>}

      {teks && (
        <div className="mt-4">
          <label
            htmlFor="pesan-aktivasi"
            className="block text-[12.5px] font-bold text-panel-muted"
          >
            Pesan WhatsApp siap salin
          </label>
          <textarea
            id="pesan-aktivasi"
            readOnly
            rows={9}
            value={teks}
            className="mt-1 w-full rounded-lg border border-panel-border bg-panel-surface px-3 py-2 font-mono text-[12.5px] leading-relaxed"
          />

          <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={salin}
              className="rounded-xl border border-panel-border bg-panel-surface px-4 py-2.5 text-[13px] font-bold text-panel-ink"
            >
              Salin pesan
            </button>
            {disalin && (
              <span className="text-[13px] font-semibold text-leaf">Tersalin.</span>
            )}
          </div>

          <p className="mt-3 rounded-xl bg-panel-surface/70 p-3 text-[12.5px] leading-relaxed text-panel-muted">
            <b className="text-panel-ink">Tautan ini hanya tampil sekali.</b> Yang
            tersimpan di sistem cuma sidik jarinya, jadi halaman ini tidak bisa
            menampilkannya lagi setelah ditutup. Menerbitkan tautan baru akan
            membatalkan tautan yang sudah terkirim.
          </p>
        </div>
      )}
    </section>
  );
}
