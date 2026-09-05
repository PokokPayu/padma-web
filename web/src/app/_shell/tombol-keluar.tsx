/**
 * Jalan keluar versi mobile — kini KHUSUS panel klien (/passport/profil).
 *
 * Alasan lahirnya masih sama: di layar kecil, `MenuAkun` tidak selalu punya
 * tempat, jadi Keluar tinggal di halaman yang memang bersifat "akun & setelan".
 * Untuk klien itu Profil.
 *
 * Panel admin dan owner TIDAK LAGI memakainya: `Topbar` (lewat `KerangkaPanel`)
 * kini merender `MenuAkun` di SETIAP lebar layar, bukan hanya di desktop —
 * jadi menu akun panel staf sudah selalu punya tempat, dan menambahkan tombol
 * ini di `/admin/pengaturan` atau `/owner` hanya menghasilkan dua jalan keluar
 * berdampingan di HP, persis yang ingin dicegah paragraf `sm:hidden` di bawah.
 *
 * `sm:hidden` masih disengaja untuk panel klien: di desktop jalan keluarnya
 * sudah ada di menu akun pada kartu nav, dan dua tombol keluar di satu layar
 * hanya membuat pemakai menebak mana yang benar.
 */
export function TombolKeluar({ label = "Keluar dari akun" }: { label?: string }) {
  return (
    // Logout tetap <form method="post">: navigasi dokumen penuh menghapus
    // Client Cache. Jangan diganti navigasi sisi klien — sisa data pemakai
    // sebelumnya bisa ikut tertinggal.
    <form action="/auth/keluar" method="post" className="mt-6 sm:hidden">
      <button className="min-h-[44px] w-full rounded-xl border border-black/10 bg-white px-4 py-2.5 text-sm font-bold text-leaf">
        {label}
      </button>
    </form>
  );
}
