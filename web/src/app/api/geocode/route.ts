import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/require-role";
import { geocodeAlamat } from "@/lib/transport/geocode";

/**
 * Pencarian alamat untuk pemilih lokasi di panel staf.
 *
 * Kenapa route handler, bukan `fetch` langsung ke Nominatim dari browser —
 * tiga alasan yang semuanya sudah tertulis di `lib/transport/geocode.ts`:
 *   1. `server-only` di berkas itu bukan hiasan. Dari browser, pemakaian kita
 *      terhadap layanan pihak ketiga menjadi tak terkendali.
 *   2. Browser tidak bisa menyetel `User-Agent`, yang dituntut kebijakan
 *      Nominatim. Permintaan tanpa itu berhak ditolak — dan penolakannya akan
 *      terlihat persis seperti "alamat tidak ditemukan".
 *   3. Cache `geocode_cache` dan jeda 1 permintaan/detik hidup di server.
 *      Memindahkan pemanggilannya ke browser membuang keduanya.
 *
 * Hasilnya HANYA menggeser peta. Tidak ada apa pun yang tersimpan dari sini —
 * koordinat baru tersimpan ketika formulirnya di-submit.
 */

/** Alamat terpanjang yang masuk akal; di atas ini pasti bukan alamat. */
const MAKS_PANJANG_ALAMAT = 300;

export async function POST(request: Request) {
  // Gerbang peran DI DALAM handler: route handler adalah endpoint tersendiri
  // yang tidak pernah melewati guard layout /admin.
  await requireRole(["admin", "owner"]);

  let mentah: unknown;
  try {
    mentah = await request.json();
  } catch {
    return NextResponse.json({ pesan: "Format tidak valid." }, { status: 400 });
  }

  const alamat = String((mentah as { alamat?: unknown } | null)?.alamat ?? "").trim();

  // Alamat kosong atau raksasa dijawab tanpa menyentuh Nominatim sama sekali:
  // jatah 1 permintaan/detik tidak boleh terbakar untuk sesuatu yang jawabannya
  // sudah diketahui.
  if (alamat === "" || alamat.length > MAKS_PANJANG_ALAMAT) {
    return NextResponse.json({ koordinat: null }, { status: 200 });
  }

  const koordinat = await geocodeAlamat(alamat);
  return NextResponse.json({ koordinat }, { status: 200 });
}
