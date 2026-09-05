"use client";

import { GrafikGaris } from "@/app/_shell/panel/grafik-garis";
import { formatRupiah } from "@/lib/owner/rupiah";

/**
 * Grafik tren pekan milik panel owner.
 *
 * Ada DUA alasan pembungkus ini hidup di sini alih-alih halamannya memanggil
 * `GrafikGaris` langsung:
 *
 *  1. Fungsi tidak bisa menyeberang dari server component ke client
 *     component. `format={formatRupiah}` akan melempar saat render.
 *  2. Money firewall. `GrafikGaris` wajib tetap buta terhadap mata uang —
 *     ia dipakai juga oleh panel admin kelak. Yang tahu bahwa angka ini
 *     rupiah adalah berkas di bawah `src/app/owner/`, persis tempat nominal
 *     memang boleh hidup.
 *
 * Serinya diterima sebagai tiga array terpisah, bukan satu array objek:
 * urutan seri menentukan warna mana yang menempel pada seri mana, dan urutan
 * itu sudah ikut divalidasi bersama paletnya.
 */
export function GrafikPekan({
  label,
  hargaKlien,
  honorMitra,
  margin,
}: {
  label: string[];
  hargaKlien: number[];
  honorMitra: number[];
  margin: number[];
}) {
  return (
    <GrafikGaris
      judul="Harga klien, honor mitra, dan margin per pekan"
      label={label}
      seri={[
        { nama: "Harga klien", nilai: hargaKlien },
        { nama: "Honor mitra", nilai: honorMitra },
        { nama: "Margin PADMA", nilai: margin },
      ]}
      format={formatRupiah}
    />
  );
}
