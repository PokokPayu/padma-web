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
        <div className="mb-5 flex items-center justify-between">
          <span className="text-[13px] text-ink-soft">
            Masuk sebagai <b className="text-ink">{klien.nama}</b> · Klien
          </span>
          {/* Logout tetap <form method="post">: navigasi dokumen penuh
              menghapus Client Cache. Jangan diganti navigasi sisi klien —
              sisa data passport pemakai sebelumnya bisa ikut tertinggal. */}
          <form action="/auth/keluar" method="post">
            <button className="text-[13px] font-bold text-leaf underline underline-offset-4">
              Keluar
            </button>
          </form>
        </div>
        <NavPassport />
        {children}
      </div>
    </div>
  );
}
