/**
 * Penanda tujuan aktif — satu untuk kedua panel.
 *
 * `pathname.startsWith(akar)` cocok untuk SELURUH sub-rute, jadi tujuan akar
 * ("Beranda") diperiksa dengan kesamaan persis. Tanpa itu, seluruh menu
 * menyala di setiap halaman dan penanda "kamu di sini" berhenti berarti.
 *
 * Perbandingan sub-rute memakai batas segmen (`${href}/`), bukan awalan
 * string: tanpa itu `/admin/klienbaru` akan menyalakan tab `/admin/klien`.
 */
export function aktifkan(pathname: string, href: string, akar: string): boolean {
  if (href === akar) return pathname === akar;
  return pathname === href || pathname.startsWith(`${href}/`);
}
