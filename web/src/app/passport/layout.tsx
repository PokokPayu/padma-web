import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { ambilKlien } from "@/lib/passport/data";
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
      <div className="mx-auto max-w-3xl px-4 pb-36 pt-8 sm:pb-16">
        {/* Identitas & jalan keluar kini di dalam kartu nav (MenuAkun), bukan
            strip terpisah di atasnya. Di mobile jalan keluarnya ada di Profil. */}
        <NavPassport nama={klien.nama} />
        {children}
      </div>
    </div>
  );
}
