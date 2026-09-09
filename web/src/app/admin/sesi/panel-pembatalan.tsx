"use client";

import { useState, useTransition } from "react";
import { batalkanSesiAdmin, jadwalUlangSesiAdmin } from "./aksi-pembatalan";
import { ringkasanPembatalan } from "@/lib/admin/pembatalan";
import {
  AKTOR_PEMBATALAN,
  LABEL_AKTOR_PEMBATALAN,
  type AktorPembatalan,
} from "@/lib/pembatalan/jenjang";
import { jamDariDb, formatJam } from "@/lib/jadwal/jam";

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
 * ===== AKTOR DIPILIH, TIDAK DISEBABKAN TANPA SADAR =====
 * Versi pertama layar ini merender `alasan` sebagai catatan biasa yang
 * opsional, sementara basis data diam-diam membaca kotak itu sebagai
 * pernyataan "PADMA yang membatalkan" (jenjang 4, refund penuh). Admin yang
 * mengetik "klien minta batal" di sana mengubah kredit 30 hari menjadi refund
 * atas nama PADMA; admin yang membiarkannya kosong saat bidan sakit membuat
 * klien kehilangan seluruh uangnya. Karena itu aktor kini menjadi PILIHAN yang
 * harus ditekan lebih dulu, dan ringkasan jenjang di bawahnya MENGIKUTI
 * pilihan itu.
 *
 * Dipilih bentuk "pilih aktor lalu satu tombol yang menyebut akibatnya",
 * BUKAN dua tombol tanpa pilihan: ringkasan jenjang hanya bisa mengikuti
 * pilihan bila pilihannya sudah diketahui sebelum tombol ditekan. Label
 * tombolnya sendiri tetap menyebut aktor yang dipilih, sehingga dua tindakan
 * yang berbeda tetap terbaca berbeda pada saat ditekan.
 *
 * Hitungan di sini hanya MENERANGKAN; yang MEMUTUSKAN adalah fungsi Postgres —
 * dan sesudah tombol ditekan, yang ditampilkan adalah kalimat yang dirakit
 * dari nilai kembalian RPC, bukan dari hitungan layar ini.
 */
export function PanelPembatalan({
  sesiId,
  tanggal,
  jamMulai,
  jadwalUlangTerpakai,
  jamPilihan,
}: {
  sesiId: string;
  tanggal: string;
  jamMulai: string;
  jadwalUlangTerpakai: boolean;
  /** Daftar `app_settings.jam_layanan` — sumber yang SAMA dengan yang dibaca RPC. */
  jamPilihan: string[];
}) {
  const [pending, mulai] = useTransition();
  // DUA pesan, bukan satu: dua formulir yang berbagi satu kotak pesan membuat
  // galat jadwal ulang muncul di bawah tombol batalkan (dan sebaliknya), dan
  // admin membaca kegagalan sebagai milik tindakan yang salah.
  const [pesanBatal, setPesanBatal] = useState<string | null>(null);
  const [pesanUlang, setPesanUlang] = useState<string | null>(null);
  const [darurat, setDarurat] = useState(false);
  // Tanpa nilai bawaan: aktor adalah keputusan, dan keputusan berbawaan adalah
  // keputusan yang tidak pernah benar-benar diambil.
  const [oleh, setOleh] = useState<AktorPembatalan | "">("");

  // `jamDariDb` WAJIB di sini. `BarisSesiDaftar.jamMulai` bernilai 'HH:MM:SS'
  // apa adanya dari Postgres, sedangkan `instanSesi` di balik
  // `ringkasanPembatalan` hanya menerima 'HH:MM' dan MELEMPAR untuk selainnya —
  // sengaja, supaya tanggal yang diam-diam menjadi NaN tidak merambat menjadi
  // pagar waktu yang terbuka tanpa galat. Mengopernya apa adanya membuat panel
  // ini mati saat dirender untuk SETIAP sesi terjadwal.
  const r =
    oleh === ""
      ? null
      : ringkasanPembatalan(tanggal, jamDariDb(jamMulai), { oleh, darurat });

  // Alasan wajib untuk DUA hal, dan keduanya sama alasannya: tindakan yang
  // mengeluarkan uang atau melewati aturan harus bisa ditinjau setelahnya.
  const alasanWajib = darurat || oleh === "padma";

  return (
    <section className="grid gap-3 rounded-lg border border-panel-border p-3.5">
      <form
        action={(fd) =>
          mulai(async () => {
            fd.set("sesi", sesiId);
            const hasil = await batalkanSesiAdmin(fd);
            setPesanBatal(hasil.pesan);
          })
        }
        className="grid gap-2"
      >
        <fieldset className="grid gap-1">
          <legend className={KELAS_LABEL}>Siapa yang membatalkan?</legend>
          {AKTOR_PEMBATALAN.map((a) => (
            <label key={a} className="flex items-center gap-2 text-[12.5px] text-panel-ink">
              <input
                type="radio"
                name="oleh"
                value={a}
                required
                checked={oleh === a}
                onChange={() => {
                  setOleh(a);
                  // Darurat medis adalah pengecualian atas pembatalan KLIEN;
                  // basis data menolaknya bila digabung dengan PADMA.
                  if (a === "padma") setDarurat(false);
                }}
              />
              {LABEL_AKTOR_PEMBATALAN[a]}
            </label>
          ))}
        </fieldset>

        {r === null ? (
          <p className="text-[12.5px] text-panel-muted">
            Pilih dulu siapa yang membatalkan — jenjang dan akibatnya mengikuti pilihan itu.
          </p>
        ) : (
          <div>
            <p className="text-[13px] font-bold text-panel-ink">
              Jenjang {r.jenjang} — {r.label}
            </p>
            <p className="text-[12.5px] text-panel-muted">{r.kalimat}</p>
          </div>
        )}

        <label className={KELAS_LABEL}>
          Alasan{alasanWajib ? " (wajib)" : " (opsional)"}
          {/* WAJIB saat darurat dicentang DAN saat PADMA yang membatalkan —
              keduanya tindakan yang harus bisa ditinjau setelahnya. Basis data
              menolaknya juga, tapi pagar yang hanya di basis data memberi galat
              SESUDAH admin menekan. */}
          <input
            name="alasan"
            required={alasanWajib}
            className={KELAS_MEDAN}
          />
        </label>

        {oleh !== "padma" && (
          <label className="flex items-center gap-2 text-[12.5px] text-panel-ink">
            <input
              type="checkbox"
              name="darurat"
              checked={darurat}
              onChange={(e) => setDarurat(e.target.checked)}
            />
            Darurat medis — perlakukan sebagai jenjang 1
          </label>
        )}

        <button
          type="submit"
          disabled={pending}
          className="rounded-lg border border-clay/40 px-3 py-1.5 text-[12.5px] font-bold text-clay disabled:opacity-60"
        >
          {pending
            ? "Memproses…"
            : oleh === "padma"
              ? "Batalkan — PADMA berhalangan"
              : "Batalkan — atas permintaan klien"}
        </button>
        {pesanBatal && (
          <p className="text-[12px] font-semibold text-panel-ink">{pesanBatal}</p>
        )}
      </form>

      <form
        action={(fd) =>
          mulai(async () => {
            fd.set("sesi", sesiId);
            const hasil = await jadwalUlangSesiAdmin(fd);
            setPesanUlang(hasil.pesan);
          })
        }
        className="grid gap-2 border-t border-panel-border pt-3"
      >
        {jadwalUlangTerpakai && (
          <p className="text-[12px] font-semibold text-clay">
            Jatah jadwal ulang gratis untuk pemesanan ini sudah terpakai.
          </p>
        )}
        <label className={KELAS_LABEL}>
          Tanggal baru
          <input type="date" name="tanggal" required className={KELAS_MEDAN} />
        </label>
        <label className={KELAS_LABEL}>
          Jam baru
          {/* PILIHAN, bukan medan waktu bebas. Medan waktu bebas menawarkan
              kelipatan 15 menit, padahal basis data menuntut keanggotaan
              `app_settings.jam_layanan` DAN kelipatan 30 menit — jadi tiga dari
              empat pilihan yang ditawarkan peramban pasti ditolak sesudah
              admin menekan. Daftar di bawah adalah daftar yang SAMA yang
              dibaca RPC lewat `jam_layanan_terpakai()`. */}
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
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-panel-ink px-3.5 py-2 text-[12.5px] font-bold text-panel-surface disabled:opacity-60"
        >
          {pending ? "Memproses…" : "Jadwal ulang"}
        </button>
        {pesanUlang && (
          <p className="text-[12px] font-semibold text-panel-ink">{pesanUlang}</p>
        )}
      </form>
    </section>
  );
}
