"use client";

// ============================================================================
// RINGKASAN BIAYA — blok "Perkiraan", bukan "Total"
// ============================================================================
// KENAPA "PERKIRAAN" DAN TANDA "+", DAN KENAPA ITU BUKAN SELERA:
//
// Ongkos transport dihitung dari domisili BIDAN ke alamat KLIEN — dan bidannya
// BELUM DIPILIH saat memesan; penetapannya baru terjadi di panel admin, sesudah
// permintaan masuk. Artinya angka yang bisa ditampilkan di layar ini hanyalah
// harga layanan, dan angka itu PASTI berubah sebelum tagihan terbit.
//
// Menyebutnya "Total" berarti menuliskan janji yang kita tahu akan kita
// langgar: klien membaca "Total Rp 395.000", lalu menerima tagihan yang lebih
// besar, dan yang rusak bukan angkanya melainkan kepercayaannya. Kata
// "Perkiraan" beserta tanda "+" mengatakan hal yang sama dengan jujur — ini
// lantai harga, bukan harga akhir. Jangan mengganti keduanya menjadi "Total"
// selama transport masih dihitung sesudah bidan ditetapkan.

export function Ringkasan({
  hargaLayanan,
  namaTerpilih,
}: {
  /** Harga varian terpilih, sudah diformat rupiah. `null` = belum ditetapkan. */
  hargaLayanan: string | null;
  /** Nama layanan (dan variannya bila bukan varian baku) yang sedang dipilih. */
  namaTerpilih: string;
}) {
  return (
    <div className="rounded-2xl border border-black/10 bg-paper px-4 py-3.5">
      <dl className="space-y-2.5 text-[13px]">
        <div className="flex items-start justify-between gap-4">
          <dt className="min-w-0 text-ink-soft">
            Layanan
            {namaTerpilih !== "" && (
              <span className="mt-0.5 block text-[11.5px] text-ink-soft/80">{namaTerpilih}</span>
            )}
          </dt>
          <dd className="shrink-0 font-semibold text-night">
            {hargaLayanan ?? "Tarif menyusul"}
          </dd>
        </div>

        <div className="flex items-start justify-between gap-4">
          <dt className="text-ink-soft">Transport</dt>
          <dd className="shrink-0 text-right text-[11.5px] text-ink-soft">
            dihitung setelah bidan ditetapkan
          </dd>
        </div>

        {/* Garis emas memisahkan dua rincian dari baris kesimpulan. Ia satu-
            satunya aksen di blok ini: yang harus menarik mata adalah angkanya. */}
        <div className="flex items-baseline justify-between gap-4 border-t border-gold/35 pt-2.5">
          <dt className="font-serif text-[15px] text-night">Perkiraan</dt>
          <dd className="shrink-0 font-serif text-[18px] text-night">
            {hargaLayanan === null ? (
              "—"
            ) : (
              <span aria-label={`perkiraan ${hargaLayanan}, belum termasuk transport`}>
                {hargaLayanan} <span className="text-gold">+</span>
              </span>
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}
