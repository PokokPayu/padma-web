import type { SupabaseClient } from "@supabase/supabase-js";
import { hariIniJakarta } from "@/lib/passport/waktu";

// PADMA ID berbentuk `PAD-YYMM-NNNN`.
//
// Dua aturan yang mengikat bentuk ini:
//
//  1. Prefix memakai kalender Asia/Jakarta. Vercel berjalan UTC, dan antara
//     17:00–24:00 UTC tanggal di Jakarta sudah berganti — pada 31 Agustus
//     17:00 UTC klinik sudah berada di 1 September. Karena itu prefix
//     dihitung dari `hariIniJakarta()`, bukan dari kalender lokal mesin.
//
//  2. Nomor urut TIDAK boleh datang dari objek penghitung otomatis Postgres
//     (dilarang migration `fail_closed_sequence_fungsi`). Ia dihitung dari
//     nomor tertinggi yang sudah terpakai pada prefix bulan berjalan.
//     Konsekuensi jujur: dua admin yang menekan "simpan" pada detik yang sama
//     bisa memperoleh nomor yang sama. Yang menjadi penjaga terakhir adalah
//     indeks unik `clients_padma_id_key` — INSERT kedua gagal 23505, dan
//     pemanggilnya (server action klien) mengulang dengan nomor berikutnya.
//     Bentrok itu ditolak DB, bukan diam-diam menimpa klien lain.

const POLA = /^PAD-\d{4}-(\d+)$/;

export function buatPrefix(sekarang: Date = new Date()): string {
  const iso = hariIniJakarta(sekarang); // YYYY-MM-DD menurut Jakarta
  return `PAD-${iso.slice(2, 4)}${iso.slice(5, 7)}`;
}

export function formatPadmaId(tglIso: string, nomor: number): string {
  return `PAD-${tglIso.slice(2, 4)}${tglIso.slice(5, 7)}-${String(nomor).padStart(4, "0")}`;
}

export async function buatPadmaId(
  supabase: SupabaseClient,
  sekarang: Date = new Date(),
): Promise<string> {
  const prefix = buatPrefix(sekarang);

  // Seluruh id bulan berjalan diambil lalu nomornya diurai di sini: memesan
  // lewat `order` saja tidak cukup aman kalau ada id lama berpola lain
  // (mis. `PAD-UJI-…`) yang lolos filter. Volumenya sebulan klinik — kecil.
  const { data } = await supabase
    .from("clients")
    .select("padma_id")
    .like("padma_id", `${prefix}-%`);

  let tertinggi = 0;
  for (const baris of data ?? []) {
    const cocok = POLA.exec(String((baris as { padma_id: string }).padma_id));
    if (!cocok) continue;
    const nomor = Number(cocok[1]);
    if (Number.isFinite(nomor) && nomor > tertinggi) tertinggi = nomor;
  }

  return `${prefix}-${String(tertinggi + 1).padStart(4, "0")}`;
}
