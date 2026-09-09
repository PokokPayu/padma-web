import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { ambilKlien } from "@/lib/passport/data";
import { HeaderMobile } from "./header-mobile";
import { NavPassport } from "./nav";

// JEBAKAN: tests/access-matrix-layouts.test.ts mem-parse berkas ini dan
// menuntut penjaga peran dipanggil TEPAT SATU KALI, dengan daftar peran persis
// ["klien"]. Identitas klien diambil lewat ambilKlien() — jangan menambah
// pemanggilan penjaga kedua hanya untuk memperoleh nama pemakai.
export default async function PassportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole(["klien"]);

  // User berperan klien yang belum tertaut ke baris clients bukan error —
  // arahkan ke halaman ramah, jangan biarkan query meledak PGRST116.
  const klien = await ambilKlien();
  if (!klien) redirect("/akun-belum-terhubung");

  return (
    <div className="min-h-screen bg-paper">
      {/* Kepala khusus ponsel — di layar lebar kartu tab di bawah yang jadi
          kepala halaman. Berdiri DI LUAR wadah berpadding supaya garis
          bawahnya melintasi lebar penuh layar, bukan berhenti di tepi teks. */}
      <HeaderMobile nama={klien.nama} />
      {/* `pt` mengecil di ponsel karena kepala di atas sudah menyumbang
          ruangnya sendiri. */}
      <div className="mx-auto max-w-3xl px-4 pb-36 pt-4 sm:pb-16 sm:pt-8">
        {/* Identitas & jalan keluar kini di dalam kartu nav (MenuAkun), bukan
            strip terpisah di atasnya. Di mobile jalan keluarnya ada di Profil. */}
        <NavPassport nama={klien.nama} />
        {children}
      </div>
    </div>
  );
}
