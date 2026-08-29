import { requireRole } from "@/lib/auth/require-role";
import { hitungAntrean } from "@/lib/admin/antrean";
import { NavAdmin } from "./_shell/nav-admin";

// JEBAKAN: tiga berkas test mem-parse berkas ini — access-matrix-layouts,
// admin-inbox, dan admin-shell — dan semuanya menuntut penjaga peran dipanggil
// TEPAT SATU KALI dengan daftar peran persis ["admin","owner"]. Nama & peran
// pemakai diambil dari nilai kembalian panggilan itu; jangan menambah
// pemanggilan kedua hanya untuk memperoleh identitas.
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { nama, role } = await requireRole(["admin", "owner"]); // owner = superset admin

  // Antrean diambil di server lalu diturunkan sebagai prop: nav adalah client
  // component dan tidak boleh menyentuh data sendiri.
  const antrean = await hitungAntrean();

  return (
    <div className="min-h-screen bg-paper">
      <div className="mx-auto max-w-6xl px-4 pb-36 pt-6 sm:pb-10">
        <div className="mb-5 flex items-center justify-between gap-3">
          <span className="text-[13px] text-ink-soft">
            Masuk sebagai <b className="text-ink">{nama}</b> ·{" "}
            {role === "owner" ? "Owner" : "Admin"}
          </span>
          {/* Logout tetap <form method="post">: navigasi dokumen penuh
              menghapus Client Cache. Jangan diganti navigasi sisi klien —
              sisa data panel pemakai sebelumnya bisa ikut tertinggal. */}
          <form action="/auth/keluar" method="post">
            <button className="text-[13px] font-bold text-leaf underline underline-offset-4">
              Keluar
            </button>
          </form>
        </div>

        <NavAdmin antrean={antrean} />
        {children}

        <p className="mt-10 border-t border-black/10 pt-4 text-[11.5px] leading-relaxed text-ink-soft">
          <b className="text-ink">Money firewall</b> — tidak ada angka uang di
          panel ini. Nominal hanya hidup di panel Owner, dan penolakannya
          ditegakkan di level basis data.
        </p>
      </div>
    </div>
  );
}
