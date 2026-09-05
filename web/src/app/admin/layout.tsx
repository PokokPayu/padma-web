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

  // Kerangka panel (sidebar, topbar, bar bawah) hidup di dalam NavAdmin, yang
  // kini MEMBUNGKUS isi halaman alih-alih berdiri di atasnya. Catatan money
  // firewall ikut pindah ke sana supaya ia selalu berada di kaki area kerja.
  return (
    <NavAdmin
      antrean={antrean}
      nama={nama}
      peran={role === "owner" ? "Owner" : "Admin"}
    >
      {children}
    </NavAdmin>
  );
}
