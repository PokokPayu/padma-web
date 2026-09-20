import { createServerSupabase } from "@/lib/supabase/server";
import { urlTontonVideo } from "@/lib/r2";
import { ambilKlien } from "@/lib/passport/data";

export const runtime = "nodejs";

/**
 * Mengalihkan ke presigned URL R2 untuk video produk.
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
  // bahwa produknya ada kepada yang tidak berhak membukanya.
  const klien = await ambilKlien();
  if (!klien) return new Response(null, { status: 404 });

  const supabase = await createServerSupabase();
  const { data: baris } = await supabase
    .from("digital_product_files")
    .select("objek")
    .eq("product_id", id)
    .maybeSingle();
  if (!baris) return new Response(null, { status: 404 });

  return Response.redirect(await urlTontonVideo(baris.objek), 302);
}
