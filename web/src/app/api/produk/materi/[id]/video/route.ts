import { createServerSupabase } from "@/lib/supabase/server";
import { urlTontonVideo } from "@/lib/r2";
import { ambilKlien } from "@/lib/passport/data";

export const runtime = "nodejs";

/**
 * Tonton satu materi video. Hak diputuskan RLS `boleh_buka_materi` atas
 * `digital_product_files` lewat SESI pengguna: pemilik aktif, atau materi
 * pratinjau produk tayang. Selain itu 404 — tidak pernah 401/403, supaya
 * keberadaan materi tidak bocor.
 *
 * Urutannya mengikat, sama dengan penyaji halaman e-book: identitas dulu,
 * lalu RLS sebagai hakim hak, baru objeknya disentuh — dan path objek diambil
 * dari BARIS, tidak pernah dari parameter URL.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Tidak ada klien -> 404, bukan 401: rute ini tidak boleh mengonfirmasi
  // bahwa materinya ada kepada yang tidak berhak membukanya.
  const klien = await ambilKlien();
  if (!klien) return new Response(null, { status: 404 });

  const supabase = await createServerSupabase();

  // Jenis materi DIPERIKSA, tidak diasumsikan. `digital_product_files` memuat
  // isi untuk KEDUA jenis (video di R2, PDF utuh di bucket `produk-berkas`),
  // jadi tanpa pagar ini rute ini menandatangani kunci objek PDF terhadap
  // bucket VIDEO — hari ini hasilnya tautan mati, tapi yang salah bukan
  // akibatnya melainkan sebabnya: rute ini memercayai invarian milik modul
  // lain tanpa pernah menagihnya sendiri. Rute penyaji adalah endpoint
  // MANDIRI; itu berlaku untuk jenis materi sama seperti untuk identitas.
  const { data: materi } = await supabase
    .from("digital_product_materials").select("jenis").eq("id", id).maybeSingle();
  if (!materi) return new Response(null, { status: 404 });
  if (materi.jenis !== "video") return new Response(null, { status: 404 });

  const { data: baris } = await supabase
    .from("digital_product_files").select("objek").eq("material_id", id).maybeSingle();
  if (!baris) return new Response(null, { status: 404 });

  return Response.redirect(await urlTontonVideo(baris.objek), 302);
}
