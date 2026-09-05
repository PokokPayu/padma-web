import { requireRole } from "@/lib/auth/require-role";
import { daftarSetelanAdmin } from "@/lib/admin/pengaturan";
import { KartuSetelan } from "./form-pengaturan";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: "Pengaturan" };

export default async function PengaturanPage() {
  await requireRole(["admin", "owner"]);

  // Daftarnya berasal dari REGISTRI, bukan dari baris `app_settings` yang
  // kebetulan sudah ada: kunci yang belum pernah diisi tetap harus punya medan,
  // kalau tidak kunci baru yang lahir lewat migration tidak akan pernah bisa
  // diisi siapa pun.
  const setelan = await daftarSetelanAdmin();

  return (
    <main>
      <header className="mb-5">
        <h1 className="font-serif text-2xl text-night">Pengaturan</h1>
        <p className="mt-1 max-w-2xl text-[13px] text-ink-soft">
          Teks dan nomor kontak yang dipakai halaman publik. Perubahannya
          langsung berlaku untuk pengunjung berikutnya — tidak perlu menunggu
          rilis aplikasi.
        </p>
      </header>

      <p className="mb-4 rounded-2xl border-[1.5px] border-dashed border-gold bg-[#FDFAF1] p-4 text-[13px] text-ink">
        ✦ Nomor WhatsApp di bawah ini dipakai <b>beranda</b>, wizard{" "}
        <b>skrining</b>, dan halaman pembayaran klien. Mengubahnya berarti
        mengubah nomor yang dihubungi <b>seluruh</b> calon klien, jadi periksa
        pratinjau tautannya sebelum menyimpan.
      </p>

      <div className="grid gap-3.5 sm:grid-cols-2">
        {setelan.map((s) => (
          <KartuSetelan key={s.key} setelan={s} />
        ))}
      </div>

      <p className="mt-3 text-[12px] text-ink-soft">
        Daftar pengaturan ini tertutup: kunci baru lahir lewat{" "}
        <b>migration</b>, bersama keterangan dan aturan nilainya. Itu disengaja
        — halaman ini menyimpan pasangan kunci/nilai, sehingga tanpa daftar
        tertutup ia akan menjadi tempat paling mudah menyelundupkan data yang
        seharusnya tidak pernah tampil di panel admin.
      </p>
    </main>
  );
}
