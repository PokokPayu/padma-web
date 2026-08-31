import { notFound } from "next/navigation";
import { ambilKlien } from "@/lib/passport/data";
import { TombolKeluar } from "@/app/_shell/tombol-keluar";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: "Profil" };

// Halaman ini READ-ONLY, dan itu keputusan keamanan, bukan kemalasan: `clients`
// menyimpan penautan akun (`user_id`, `linked_at`), sehingga satu jalur tulis
// milik klien di tabel ini akan membuka kembali celah yang ditutup migration
// kunci_kolom_penautan_klien. Klien memang tidak punya policy UPDATE di sana —
// perubahan data ditempuh lewat admin, dan tests/passport-profil.test.ts
// membuktikan janji itu ditegakkan basis data, bukan hanya ditulis di layar.
export default async function HalamanProfil() {
  const klien = await ambilKlien();
  if (!klien) notFound(); // layout sudah menangani; ini penjaga tipe

  const baris: Array<[string, string]> = [
    ["Nama lengkap", klien.nama],
    ["PADMA ID", klien.padmaId],
    ["Email", klien.email],
    ["No. WhatsApp", klien.noHp],
    ["Fase perjalanan", `${klien.faseSanskrit} · ${klien.faseNama}`],
  ];

  return (
    <section className="rounded-2xl border border-black/10 bg-white p-6">
      <h1 className="mb-4 font-serif text-xl text-night">Profil</h1>
      {baris.map(([k, v]) => (
        <div
          key={k}
          className="flex items-center justify-between gap-3 border-b border-dashed border-black/10 py-2.5 text-[13.5px] last:border-0"
        >
          <span className="text-ink-soft">{k}</span>
          <b className={k === "PADMA ID" ? "font-mono font-medium" : ""}>{v}</b>
        </div>
      ))}
      <p className="mt-4 text-xs text-ink-soft">
        Ada data yang berubah? Hubungi tim PADMA via WhatsApp — demi keamanan,
        perubahan data dilakukan oleh admin.
      </p>
      <TombolKeluar />
    </section>
  );
}
