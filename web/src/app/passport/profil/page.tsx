import { notFound } from "next/navigation";
import { ambilKlien } from "@/lib/passport/data";
import { TombolKeluar } from "@/app/_shell/tombol-keluar";
import { FormProfil } from "./form-profil";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: "Profil" };

// Halaman ini punya SATU jalur tulis, dan batasnya adalah keputusan keamanan.
//
// Yang boleh disunting klien: nama, no. WhatsApp, alamat — data operasional.
// Yang TIDAK, dan tetap ditampilkan sebagai bacaan: email (dasar penautan akun
// — `linkClientByInvite` menuntutnya cocok persis), PADMA ID, dan fase
// perjalanan (penentu materi yang terbuka). Ketiganya keputusan identitas.
//
// Penegakannya bukan di layar ini. `clients` tetap tanpa policy UPDATE untuk
// klien — dibuktikan `tests/passport-profil.test.ts` lewat UPDATE sungguhan
// yang harus tetap nol baris — dan satu-satunya pintu adalah RPC
// `perbarui_profil_klien`, yang hanya menerima tiga kolom itu. Menambah medan
// ke formulir di bawah TIDAK cukup untuk melebarkan apa yang bisa ditulis;
// migration-nya harus diubah lebih dulu, dan di sanalah alasannya tertulis.
export default async function HalamanProfil() {
  const klien = await ambilKlien();
  if (!klien) notFound(); // layout sudah menangani; ini penjaga tipe

  // Fase HANYA muncul bila memang sudah ditentukan. Tanpa penjaga ini, klien
  // yang mendaftar sendiri (fasenya belum ditanyakan — datang dari skrining,
  // migration `fase_klien_boleh_kosong`) melihat baris "Fase perjalanan" berisi
  // titik-tengah telanjang: bentuk yang terbaca sebagai data rusak, bukan
  // sebagai keadaan yang memang belum diisi.
  const bacaan: Array<[string, string]> = [
    ["PADMA ID", klien.padmaId],
    ["Email", klien.email],
    ...(klien.faseId
      ? ([["Fase perjalanan", `${klien.faseSanskrit} · ${klien.faseNama}`]] as Array<
          [string, string]
        >)
      : []),
  ];

  return (
    <section className="rounded-2xl border border-black/10 bg-white p-6">
      <h1 className="mb-4 font-serif text-xl text-night">Profil</h1>

      <FormProfil
        nama={klien.nama}
        email={klien.email}
        noHp={klien.noHp}
        alamat={klien.alamat}
      />

      <div className="mt-6 border-t border-dashed border-black/10 pt-4">
        {bacaan.map(([k, v]) => (
          <div
            key={k}
            className="flex items-center justify-between gap-3 border-b border-dashed border-black/10 py-2.5 text-[13.5px] last:border-0"
          >
            <span className="text-ink-soft">{k}</span>
            <b className={k === "PADMA ID" ? "font-mono font-medium" : ""}>{v}</b>
          </div>
        ))}
        <p className="mt-4 text-xs text-ink-soft">
          Email, PADMA ID, dan fase perjalanan hanya bisa diubah tim PADMA —
          ketiganya menentukan akun mana yang berhak membaca data Anda dan
          materi apa yang terbuka. Hubungi kami via WhatsApp bila ada yang
          keliru.
        </p>
      </div>

      <TombolKeluar />
    </section>
  );
}
