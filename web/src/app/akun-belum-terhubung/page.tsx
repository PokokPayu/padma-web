import { PanggungAuth } from "@/app/_auth/panggung";

export const metadata = { title: "Akun belum terhubung" };

/**
 * JALAN BUNTU YANG JUJUR — dan sejak pendaftaran mandiri hidup, jalan buntu
 * yang ARTINYA BERUBAH.
 *
 * Dulu halaman ini adalah tujuan yang WAJAR: penautan hanya mungkin lewat
 * tautan undangan WhatsApp, jadi siapa pun yang masuk tanpa membukanya berakhir
 * di sini, dan menyuruhnya mencari tautan itu adalah nasihat yang benar.
 *
 * Sekarang tidak lagi. Gerbang `@/lib/auth/pastikan-klien` menautkan (atau
 * menerbitkan) baris klien untuk setiap akun yang emailnya sudah terkonfirmasi,
 * dan yang belum terkonfirmasi dipulangkan ke `/periksa-email`. Yang tersisa
 * untuk halaman ini hanya keadaan yang benar-benar tidak bisa diselesaikan
 * sendiri oleh pemakainya:
 *
 *   - langkah 5 menabrak `clients_email_key` — SUDAH ADA baris klien beremail
 *     ini, dan pemiliknya akun lain. Alamat email yang sama dipakai dua akun;
 *     hanya PADMA yang bisa memutuskan mana yang benar.
 *   - ia datang membawa token undangan yang GAGAL (kedaluwarsa, sudah dipakai,
 *     atau emailnya meleset dari yang diketik admin) dan tidak ada baris
 *     beremail sama untuk ditautkan. Menerbitkan baris baru di sini justru
 *     yang dicegah — lihat langkah 5 di gerbang.
 *
 * Ditambah satu kedatangan yang bukan dari gerbang: `/aktivasi` tanpa parameter
 * `token` (tautan WhatsApp yang terpotong) mengarah ke sini juga, dan
 * pengunjung itu belum tentu sudah login. Karena itu kalimatnya tidak boleh
 * mengaku tahu bahwa pembacanya punya sesi.
 *
 * Semuanya berujung pada satu tindakan yang sama: hubungi tim PADMA.
 * Karena itu kalimatnya TIDAK lagi menyuruh mencari tautan aktivasi di
 * WhatsApp — di kedua keadaan itu tautan seperti itu tidak ada, atau sudah
 * dicoba dan gagal, dan menyuruh orang mencarinya adalah mengirimnya berputar.
 *
 * Yang SENGAJA tidak dilakukan: memberi tahu YANG MANA dari dua keadaan itu.
 * Membedakannya berarti halaman ini menjawab "alamat email ini sudah punya akun
 * di PADMA" kepada siapa pun yang bisa mendaftar — dan PADMA melayani perempuan
 * yang sedang hamil, nifas, atau menjalani program kehamilan. Alasan yang sama
 * membuat `/lupa-sandi` selalu menjawab sama (K6).
 *
 * Kalimat panel kirinya tetap berbeda dari `/periksa-email`: dua keadaan yang
 * berbeda dengan kalimat identik membuat pembacanya mengira ia masih di halaman
 * yang sama.
 */
export default function AkunBelumTerhubungPage() {
  return (
    <PanggungAuth
      judul="Kami perlu memeriksanya lebih dulu."
      kalimat="Kami belum bisa memastikan rekam klien mana yang menjadi milik Anda. Ini bukan sesuatu yang perlu Anda perbaiki sendiri — tim PADMA bisa membereskannya."
    >
      <div className="text-center">
        {/* h2, bukan h1 — panel kiri panggung memegang h1. Lihat komentar
            hierarki judul di panggung.tsx. */}
        <h2 className="font-serif text-2xl text-night mb-3">
          Akun Anda belum terhubung
        </h2>
        <p className="text-sm text-ink-soft mb-4">
          Akun ini belum tersambung ke rekam klien mana pun. Biasanya itu berarti
          alamat email Anda tercatat sedikit berbeda di data kami, atau sudah
          dipakai akun lain.
        </p>
        <p className="text-sm text-ink-soft mb-6">
          Hubungi tim PADMA lewat WhatsApp dan sebutkan alamat email yang Anda
          pakai untuk masuk. Kami menyambungkannya untuk Anda — tidak ada yang
          perlu Anda daftarkan ulang, dan tidak ada data Anda yang hilang.
        </p>
        <form action="/auth/keluar" method="post">
          <button className="rounded-lg border border-black/15 px-5 py-2.5 font-bold">
            Keluar
          </button>
        </form>
      </div>
    </PanggungAuth>
  );
}
