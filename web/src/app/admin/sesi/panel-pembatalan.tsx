"use client";

import { useState, useTransition } from "react";
import { batalkanSesiAdmin, jadwalUlangSesiAdmin } from "./aksi-pembatalan";
import { ringkasanPembatalan } from "@/lib/admin/pembatalan";
import { jamDariDb } from "@/lib/jadwal/jam";

const KELAS_LABEL = "block text-[12.5px] font-bold text-panel-muted";
const KELAS_MEDAN =
  "mt-1 w-full rounded-lg border border-panel-border bg-panel-surface px-3 py-2 text-[13px] text-panel-ink";

/**
 * PEMBATALAN & JADWAL ULANG di panel sesi (spec C3 P1, P7).
 *
 * Jenjangnya DITAMPILKAN, tidak diketik. Admin yang mengetik jenjang adalah
 * admin yang salah mengetik jenjang — dan yang salah bukan angkanya melainkan
 * uang klien.
 *
 * Hitungan di sini hanya MENERANGKAN; yang MEMUTUSKAN adalah fungsi Postgres.
 * Keduanya memakai ambang yang sama, dan bila keduanya berselisih, yang
 * berlaku adalah basis data — layar ini hanya akan terlihat salah, tidak bisa
 * membuat keputusan yang salah.
 */
export function PanelPembatalan({
  sesiId,
  tanggal,
  jamMulai,
  jadwalUlangTerpakai,
}: {
  sesiId: string;
  tanggal: string;
  jamMulai: string;
  jadwalUlangTerpakai: boolean;
}) {
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);
  const [darurat, setDarurat] = useState(false);

  // `jamDariDb` WAJIB di sini. `BarisSesiDaftar.jamMulai` bernilai 'HH:MM:SS'
  // apa adanya dari Postgres, sedangkan `instanSesi` di balik
  // `ringkasanPembatalan` hanya menerima 'HH:MM' dan MELEMPAR untuk selainnya —
  // sengaja, supaya tanggal yang diam-diam menjadi NaN tidak merambat menjadi
  // pagar waktu yang terbuka tanpa galat. Mengopernya apa adanya membuat panel
  // ini mati saat dirender untuk SETIAP sesi terjadwal.
  const r = ringkasanPembatalan(tanggal, jamDariDb(jamMulai));

  return (
    <section className="grid gap-3 rounded-lg border border-panel-border p-3.5">
      <div>
        <p className="text-[13px] font-bold text-panel-ink">
          Jenjang {r.jenjang} — {r.label}
        </p>
        <p className="text-[12.5px] text-panel-muted">{r.kalimat}</p>
        {jadwalUlangTerpakai && (
          <p className="mt-1 text-[12px] font-semibold text-clay">
            Jatah jadwal ulang gratis untuk pemesanan ini sudah terpakai.
          </p>
        )}
      </div>

      <form
        action={(fd) =>
          mulai(async () => {
            fd.set("sesi", sesiId);
            const hasil = await batalkanSesiAdmin(fd);
            setPesan(hasil.ok ? null : hasil.pesan);
          })
        }
        className="grid gap-2"
      >
        <label className={KELAS_LABEL}>
          Alasan
          {/* WAJIB saat darurat dicentang — pengecualian tanpa catatan tidak
              bisa ditinjau siapa pun setelahnya. Basis data menolaknya juga,
              tapi pagar yang hanya di basis data memberi galat SESUDAH admin
              menekan. */}
          <input name="alasan" required={darurat} className={KELAS_MEDAN} />
        </label>
        <label className="flex items-center gap-2 text-[12.5px] text-panel-ink">
          <input
            type="checkbox"
            name="darurat"
            checked={darurat}
            onChange={(e) => setDarurat(e.target.checked)}
          />
          Darurat medis — perlakukan sebagai jenjang 1
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg border border-clay/40 px-3 py-1.5 text-[12.5px] font-bold text-clay disabled:opacity-60"
        >
          {pending ? "Memproses…" : "Batalkan sesi"}
        </button>
      </form>

      <form
        action={(fd) =>
          mulai(async () => {
            fd.set("sesi", sesiId);
            const hasil = await jadwalUlangSesiAdmin(fd);
            setPesan(hasil.ok ? null : hasil.pesan);
          })
        }
        className="grid gap-2 border-t border-panel-border pt-3"
      >
        <label className={KELAS_LABEL}>
          Tanggal baru
          <input type="date" name="tanggal" required className={KELAS_MEDAN} />
        </label>
        <label className={KELAS_LABEL}>
          Jam baru
          <input type="time" name="jam" required step={900} className={KELAS_MEDAN} />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-panel-ink px-3.5 py-2 text-[12.5px] font-bold text-panel-surface disabled:opacity-60"
        >
          {pending ? "Memproses…" : "Jadwal ulang"}
        </button>
      </form>

      {pesan && <p className="text-[12px] font-semibold text-clay">{pesan}</p>}
    </section>
  );
}
