import { redirect } from "next/navigation";
import { PanggungAuth } from "@/app/_auth/panggung";
import { JANGKAR_PERSETUJUAN } from "@/app/_dokumen/bagian";
import { requireRole } from "@/lib/auth/require-role";
import { statusPersetujuan } from "@/lib/persetujuan/status";
import { tujuanPersetujuanAman } from "@/lib/persetujuan/tujuan";
import { setujuiDokumen } from "./aksi";

export const metadata = { title: "Persetujuan" };

const TAUTAN = "font-semibold text-leaf underline";

/**
 * GERBANG PERSETUJUAN S&K + KEBIJAKAN PRIVASI (spec 2026-10-06).
 *
 * Menangkap setiap akun klien yang belum punya catatan untuk VERSI_DOKUMEN:
 * pendaftar Google dari /masuk, klien undangan admin, klien lama sebelum
 * dokumen ini ada, revisi versi, dan email yang dikonfirmasi di perangkat lain.
 *
 * Di LUAR /passport supaya layout passport tidak berputar ke dirinya sendiri.
 * Selalu ada jalan keluar (form /auth/keluar): klien yang tidak setuju tidak
 * boleh terkunci di layar ini. `TombolKeluar` tidak dipakai — ia `sm:hidden`
 * karena dirancang untuk Profil Passport, dan di sini ia harus tampil di
 * semua lebar layar.
 */
export default async function PersetujuanPage({
  searchParams,
}: {
  searchParams: Promise<{ lanjut?: string | string[]; gagal?: string }>;
}) {
  const { userId } = await requireRole(["klien"]);
  const sp = await searchParams;
  const tujuan = tujuanPersetujuanAman(sp.lanjut);
  const { sudahSetuju, pernahSetuju } = await statusPersetujuan(userId);
  // Tombol kembali, markah, atau tab lama: yang sudah setuju tidak ditanya lagi.
  if (sudahSetuju) redirect(tujuan);

  return (
    <PanggungAuth
      judul="Satu langkah sebelum lanjut."
      kalimat={
        pernahSetuju
          ? "Kami memperbarui Syarat & Ketentuan dan Kebijakan Privasi PADMA. Mohon baca dan setujui versi terbarunya sebelum melanjutkan."
          : "Sebelum memakai Digital Passport, mohon baca dan setujui Syarat & Ketentuan serta Kebijakan Privasi PADMA."
      }
    >
      {/* h2, bukan h1 — lihat komentar hierarki judul di panggung.tsx. */}
      <h2 className="font-serif text-2xl text-night mb-1">Persetujuan Anda</h2>
      <p className="mb-3 text-sm text-ink-soft">Ringkasnya, dengan menyetujui Anda memahami bahwa:</p>
      <ul className="mb-6 list-disc space-y-2 pl-5 text-sm text-ink-soft">
        <li>
          PADMA memproses{" "}
          <a href={JANGKAR_PERSETUJUAN.dataKesehatan} target="_blank" rel="noopener noreferrer" className={TAUTAN}>
            data kesehatan
          </a>{" "}
          dari skrining Anda untuk menilai keselamatan layanan.
        </li>
        <li>
          Data Anda disimpan dan diproses oleh{" "}
          <a href={JANGKAR_PERSETUJUAN.pihakKetiga} target="_blank" rel="noopener noreferrer" className={TAUTAN}>
            penyedia layanan pihak ketiga
          </a>
          , sebagian di luar Indonesia.
        </li>
        <li>
          Anda dapat mengakses, membetulkan, meminta penghapusan, dan menarik persetujuan. Lihat{" "}
          <a href={JANGKAR_PERSETUJUAN.hakAnda} target="_blank" rel="noopener noreferrer" className={TAUTAN}>
            hak Anda
          </a>
          .
        </li>
      </ul>

      {sp.gagal === "1" && (
        <p role="alert" className="mb-4 text-sm text-clay">
          Persetujuan belum tersimpan. Coba lagi sebentar lagi.
        </p>
      )}

      <form action={setujuiDokumen} className="space-y-4">
        <input type="hidden" name="lanjut" value={tujuan} />
        <label className="flex gap-3 rounded-xl border border-black/10 bg-paper-warm p-3.5 text-sm">
          <input type="checkbox" name="setuju" value="ya" required className="mt-0.5 h-[18px] w-[18px] shrink-0" />
          <span>
            Saya telah membaca dan menyetujui{" "}
            <a href="/syarat-ketentuan" target="_blank" rel="noopener noreferrer" className={TAUTAN}>
              Syarat & Ketentuan
            </a>{" "}
            dan{" "}
            <a href="/kebijakan-privasi" target="_blank" rel="noopener noreferrer" className={TAUTAN}>
              Kebijakan Privasi
            </a>{" "}
            PADMA, termasuk pemrosesan data kesehatan saya.
          </span>
        </label>
        <button type="submit" className="w-full rounded-lg bg-night py-3 font-bold text-gold-pale">
          Setuju & lanjutkan
        </button>
      </form>

      {/* Jalan keluar: <form method="post">, sama seperti TombolKeluar —
          navigasi dokumen penuh menghapus Client Cache. */}
      <form action="/auth/keluar" method="post" className="mt-3">
        <button type="submit" className="w-full rounded-lg border border-black/15 bg-white py-3 text-sm font-bold text-leaf">
          Keluar
        </button>
      </form>
    </PanggungAuth>
  );
}
