import { requireRole } from "@/lib/auth/require-role";
import { NavOwner } from "./_shell/nav-owner";

// JEBAKAN: `tests/access-matrix-layouts.test.ts` dan
// `tests/owner-kerangka.test.ts` mem-parse berkas ini dan menuntut penjaga
// peran dipanggil TEPAT SATU KALI dengan daftar peran PERSIS ["owner"].
//
// Menyalin shell admin membawa serta daftar peran admin+owner miliknya — dan
// itu bukan kelonggaran kecil: seluruh nominal PADMA (rate card, honor, margin)
// akan terbuka untuk admin dalam satu karakter perubahan. Nama pemakai diambil
// dari nilai kembalian panggilan yang sama; jangan menambah pemanggilan kedua
// hanya untuk memperoleh identitas.
//
// Perlu diingat pula bahwa layout ini TIDAK menjaga server action: dibuktikan
// dengan mem-POST action panel admin dari rute lain sebagai admin, dan
// mutasinya berhasil. Karena itu SETIAP server action di bawah /owner wajib
// memanggil penjaga peran yang sama sendiri di baris pertamanya.
export default async function OwnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { nama } = await requireRole(["owner"]);

  // Kerangka panel (sidebar, topbar, bar bawah) hidup di dalam NavOwner, yang
  // kini MEMBUNGKUS isi halaman. Catatan money firewall ikut pindah ke sana.
  return <NavOwner nama={nama}>{children}</NavOwner>;
}
