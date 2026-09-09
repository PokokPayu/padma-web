import { formatTanggalPendek } from "@/lib/passport/waktu";

/**
 * Satu baris agenda di beranda: sesi yang sudah pasti, atau permintaan yang
 * masih menunggu tim PADMA.
 *
 * KENAPA TANGGAL BERDIRI SEBAGAI BLOK, BUKAN SEBAGAI KALIMAT. Sebelum ini
 * seluruh isi baris adalah satu untai teks — "15 September 2026 · 08.00 WIB ·
 * Bidan Dewi Lestari · datang ke rumah Anda" — dan tanggal, yang justru
 * pertanyaan pertama setiap orang yang membuka beranda ("kapan?"), terkubur di
 * antara empat keterangan lain dengan ukuran huruf yang sama. Blok tanggal
 * memindahkannya ke tempat yang bisa dibaca tanpa membaca: satu angka besar,
 * satu bulan pendek, selalu di titik yang sama pada tiap baris.
 *
 * `nada` membedakan yang PASTI dari yang MENUNGGU lewat bobot warna, bukan
 * lewat jenis garis tepi seperti sebelumnya. Garis putus-putus lawan garis
 * titik-titik menuntut orang menghitung titik untuk tahu bedanya; blok hijau
 * tua lawan blok krem terbaca dari jarak satu lengan.
 */
export function BarisAgenda({
  tanggal,
  judul,
  detail,
  pill,
  nada,
  aksi,
}: {
  /** 'YYYY-MM-DD' apa adanya dari basis data. */
  tanggal: string;
  judul: string;
  detail: string;
  /** Label status kecil, mis. "Menunggu pembayaran". */
  pill?: string;
  nada: "pasti" | "menunggu";
  /**
   * Elemen aksi opsional (tombol batalkan). Dioper sebagai ELEMEN yang sudah
   * jadi, bukan callback: berkas ini dirender di server, dan prop bernilai
   * fungsi yang menyeberang ke komponen klien adalah kelas cacat yang sudah
   * beberapa kali menggigit repo ini — dijaga
   * tests/pagar-batas-server-klien.test.ts.
   */
  aksi?: React.ReactNode;
}) {
  const { hari, bulan } = formatTanggalPendek(tanggal);
  const pasti = nada === "pasti";
  return (
    <div
      className={`mb-2.5 flex items-center gap-3.5 rounded-2xl border bg-white p-3 ${
        pasti ? "border-gold/45" : "border-black/10"
      }`}
    >
      <span
        className={`flex h-14 w-[52px] flex-none flex-col items-center justify-center rounded-xl leading-none ${
          pasti ? "bg-night text-paper" : "bg-paper-warm text-night"
        }`}
      >
        <b className="font-serif text-[19px] font-normal">{hari}</b>
        <span
          className={`mt-1 text-[9.5px] font-semibold tracking-[0.12em] ${
            pasti ? "text-gold-bright" : "text-ink-soft"
          }`}
        >
          {bulan}
        </span>
      </span>

      <span className="min-w-0 flex-1">
        <b className="block font-serif text-[15.5px] font-normal leading-snug text-night">
          {judul}
        </b>
        <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-soft">{detail}</span>
        {pill && (
          <span className="mt-1.5 inline-block rounded-full bg-paper-warm px-2.5 py-1 text-[11px] font-semibold text-ink-soft">
            {pill}
          </span>
        )}
        {aksi}
      </span>
    </div>
  );
}
