/**
 * Pagar target `npm run seed:master`.
 *
 * Skripnya menulis lewat service role ke tabel katalog, storage, dan alamat
 * klien. Satu salah arah ke produksi berarti produk contoh tayang di etalase
 * sungguhan dan alamat klien sungguhan tertimpa. Karena itu target ditentukan
 * DAFTAR PUTIH: instans lokal, atau proyek Supabase dev. Proyek lain apa pun
 * ditolak, termasuk proyek baru yang belum dikenal, bukan hanya produksi.
 */

/** Proyek Supabase dev ("dev-padma-web"). Produksi: `vtprvvwslclyqlunzuvj`. */
export const REF_DEV = "mdtzrzwapuaalmsxomkm";

const HOST_LOKAL = new Set(["127.0.0.1", "localhost"]);

export type HasilTarget =
  | { ok: true; jenis: "lokal" | "dev" }
  | { ok: false; alasan: string };

export function targetSeedMasterSah(url: string): HasilTarget {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, alasan: `NEXT_PUBLIC_SUPABASE_URL bukan URL: "${url}".` };
  }
  if (HOST_LOKAL.has(u.hostname)) return { ok: true, jenis: "lokal" };
  // Host dibandingkan UTUH, bukan `includes`/`endsWith(REF_DEV)`: keduanya
  // meloloskan `…supabase.co.penipu.example` atau ref yang hanya ada di path.
  if (u.protocol === "https:" && u.hostname === `${REF_DEV}.supabase.co`) {
    return { ok: true, jenis: "dev" };
  }
  return {
    ok: false,
    alasan:
      `Target ${u.host} tidak ada di daftar putih. seed:master hanya untuk instans ` +
      `lokal atau proyek dev (${REF_DEV}). Produksi tidak pernah diisi data contoh.`,
  };
}
