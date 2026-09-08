"use client";

import { useState, useTransition } from "react";
import { tukarHakAdmin } from "./aksi-hak";
import type { HakKlien } from "@/lib/admin/hak";
import { formatJam } from "@/lib/jadwal/jam";

const KELAS_LABEL = "block text-[12.5px] font-bold text-panel-muted";
const KELAS_MEDAN =
  "mt-1 w-full rounded-lg border border-panel-border bg-panel-surface px-3 py-2 text-[13px] text-panel-ink";

/**
 * KREDIT SESI (HAK) MILIK SATU KLIEN, DAN SATU FORMULIR UNTUK MENUKARNYA.
 *
 * ===== KENAPA DI HALAMAN KLIEN, BUKAN DI /admin/sesi =====
 * Sebuah hak MILIK ORANG, bukan milik baris sesi: ia lahir justru ketika sebuah
 * sesi berhenti ada, dan ia belum punya baris sesi untuk ditumpangi. Di
 * /admin/sesi tidak ada baris tempatnya menggantung. Alurnya pun berangkat dari
 * orangnya: klien menelepon, admin membuka kliennya, dan pertanyaan yang
 * dijawab layar ini — "apa yang masih dipegang orang ini, dan sampai kapan" —
 * adalah pertanyaan yang sama yang sudah dijawab halaman ini untuk sesi dan
 * aktivasi. Kartunya duduk tepat di sebelah "Sesi terakhir" supaya kredit yang
 * belum terpakai terbaca bersamaan dengan riwayatnya.
 *
 * Komponen KLIEN karena formulirnya memanggil server action lalu menampilkan
 * hasilnya di tempat. Yang TIDAK ada di sini: pengambilan data. Seluruh isinya
 * datang sebagai prop yang sudah dirender halaman di server.
 *
 * Nol rupiah, dan itu struktural: kredit PADMA berbentuk HAK SATU SESI untuk
 * layanan yang sama — `hak_sesi` memang tidak punya kolom nominal sama sekali.
 */
export function KartuHak({
  hak,
  mitra,
  jamPilihan,
  tanggalAwal,
  formatTanggal,
}: {
  hak: HakKlien[];
  mitra: { id: string; nama: string }[];
  /** Daftar `app_settings.jam_layanan` — sumber yang SAMA dengan yang dibaca RPC. */
  jamPilihan: string[];
  /** Hari ini menurut kalender Jakarta; batas bawah medan tanggal. */
  tanggalAwal: string;
  /**
   * Tanggal yang SUDAH diformat di server, dipetakan dari `YYYY-MM-DD`.
   * Fungsi pemformat tidak bisa dikirim melewati batas Server → Client
   * (`tests/pagar-batas-server-klien.test.ts`), jadi yang menyeberang adalah
   * hasilnya.
   */
  formatTanggal: Record<string, string>;
}) {
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);

  return (
    <section className="rounded-lg border border-panel-border bg-panel-surface p-5">
      <h2 className="mb-1 font-serif text-lg text-panel-ink">Kredit sesi (hak)</h2>
      <p className="mb-3 text-[12px] text-panel-muted">
        Terbit saat sesi dibatalkan 2–24 jam sebelum jadwalnya. Berlaku untuk layanan yang sama
        saja, dan hangus setelah tanggal kedaluwarsanya.
      </p>

      {hak.length === 0 ? (
        <p className="text-[13px] italic text-panel-muted">
          Klien ini tidak punya kredit sesi yang masih berlaku.
        </p>
      ) : (
        <form
          action={(fd) =>
            mulai(async () => {
              const r = await tukarHakAdmin(fd);
              setPesan(r.pesan);
            })
          }
          className="grid gap-2.5"
        >
          <fieldset className="grid gap-1">
            <legend className={KELAS_LABEL}>Kredit yang mau ditukar</legend>
            {hak.map((h, i) => (
              <label key={h.id} className="flex items-start gap-2 text-[13px] text-panel-ink">
                <input
                  type="radio"
                  name="hak"
                  value={h.id}
                  required
                  defaultChecked={i === 0}
                  className="mt-1"
                />
                <span>
                  <b>{h.namaLayanan}</b>
                  <span className="mt-0.5 block text-[11.5px] text-panel-muted">
                    Berlaku sampai {formatTanggal[h.kedaluwarsa] ?? h.kedaluwarsa}
                    {h.tanggalAsal
                      ? ` · dari sesi ${formatTanggal[h.tanggalAsal] ?? h.tanggalAsal}`
                      : ""}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          <label className={KELAS_LABEL}>
            Tanggal sesi pengganti
            <input
              type="date"
              name="tanggal"
              required
              min={tanggalAwal}
              className={KELAS_MEDAN}
            />
          </label>

          <label className={KELAS_LABEL}>
            Jam
            {/* PILIHAN, bukan medan waktu bebas: basis data menuntut keanggotaan
                `app_settings.jam_layanan` DAN kelipatan 30 menit, jadi medan
                bebas menawarkan pilihan yang pasti ditolak sesudah ditekan. */}
            <select name="jam" required defaultValue="" className={KELAS_MEDAN}>
              <option value="" disabled>
                Pilih jam layanan…
              </option>
              {jamPilihan.map((j) => (
                <option key={j} value={j}>
                  {formatJam(j)}
                </option>
              ))}
            </select>
          </label>

          <label className={KELAS_LABEL}>
            Bidan
            <select name="mitra" required defaultValue="" className={KELAS_MEDAN}>
              <option value="" disabled>
                Pilih bidan…
              </option>
              {mitra.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nama}
                </option>
              ))}
            </select>
          </label>

          <button
            type="submit"
            disabled={pending}
            className="justify-self-start rounded-lg bg-panel-ink px-3.5 py-2 text-[12.5px] font-bold text-panel-surface disabled:opacity-60"
          >
            {pending ? "Memproses…" : "Tukar jadi sesi"}
          </button>
          {pesan && <p className="text-[12px] font-semibold text-panel-ink">{pesan}</p>}
        </form>
      )}
    </section>
  );
}
