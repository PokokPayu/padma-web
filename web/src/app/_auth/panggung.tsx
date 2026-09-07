import Image from "next/image";

/**
 * PANGGUNG HALAMAN AUTH — dipakai /masuk, /daftar, /lupa-sandi, /atur-sandi,
 * /periksa-email, dan /akun-belum-terhubung.
 *
 * Angka-angkanya dari prototipe yang sudah disetujui klien
 * (padma-prototype.html baris 326-348): kartu 900px, kolom 1fr 1.1fr, sudut
 * 26px.
 *
 * Breakpoint kolomnya `min-[860px]`, BUKAN breakpoint bawaan Tailwind `md`
 * (768px) — proyek ini tidak menimpa breakpoint di globals.css, jadi `md`
 * beneran 768px. Antara 768px dan 860px, dua kolom sudah kesempitan untuk
 * menampung kartu 900px yang dirancang untuk lebar itu. Di bawah 860px kolom
 * menumpuk dan sisi hijau TETAP ADA sebagai kepala pendek, bukan
 * disembunyikan — ia yang membawa logo, dan halaman auth tanpa lambang di
 * layar sempit terasa seperti halaman orang lain (formulir generik tanpa
 * identitas PADMA sama sekali).
 *
 * Logo PNG dipasang di sini, di panel gelap — bukan di panel putih kanan.
 * Emas bergradasi logo dirancang di atas latar gelap; di atas krem
 * `paper-warm` gradasinya kehilangan kontras dan terlihat pudar.
 *
 * HIERARKI JUDUL — mengikat untuk lima halaman yang memakai panggung ini:
 * `judul` di sini adalah `<h1>` karena panel kiri datang lebih dulu di DOM.
 * Pembaca layar menuruni halaman dari atas ke bawah; kalau elemen yang
 * muncul duluan bukan pemegang tingkat tertinggi, urutannya melompat mundur.
 * Konsekuensinya: judul apa pun yang dipasang di kolom kanan (`children`)
 * WAJIB `<h2>` atau lebih rendah, tidak boleh `<h1>` lagi.
 */
export function PanggungAuth({
  judul,
  kalimat,
  children,
}: {
  judul: string;
  kalimat: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-paper-warm px-4 py-10">
      <div className="grid w-full max-w-[900px] overflow-hidden rounded-[26px] border border-black/10 bg-white min-[860px]:grid-cols-[1fr_1.1fr]">
        <div className="flex flex-col justify-center bg-night bg-[radial-gradient(500px_400px_at_20%_0%,rgba(47,106,72,.55),transparent_60%)] p-9 md:p-12">
          <Image
            src="/logo-padma.png"
            alt="PADMA"
            width={72}
            height={72}
            className="mb-6 h-16 w-16"
            priority
          />
          <h1 className="font-serif text-[30px] leading-tight text-gold-pale">{judul}</h1>
          <p className="mt-3 max-w-[24em] text-sm text-[#A9BBAA]">{kalimat}</p>
        </div>
        <div className="p-8 md:p-11">{children}</div>
      </div>
    </main>
  );
}
