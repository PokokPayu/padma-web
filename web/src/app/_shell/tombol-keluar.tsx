/**
 * Jalan keluar versi mobile.
 *
 * Di layar kecil, nav berupa bottom bar gelap yang sudah penuh (panel admin
 * memuat sembilan tujuan), jadi menu akun di kartu nav desktop tidak punya
 * tempat di sana. Karena itu Keluar tinggal di dalam halaman yang memang
 * bersifat "akun & setelan": Profil untuk klien, Setelan untuk admin, Beranda
 * untuk owner.
 *
 * `sm:hidden` disengaja: di desktop jalan keluarnya sudah ada di menu akun pada
 * kartu nav, dan dua tombol keluar di satu layar hanya membuat pemakai menebak
 * mana yang benar. Salah satu dari keduanya SELALU tampil, di lebar berapa pun.
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
