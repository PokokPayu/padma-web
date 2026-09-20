// src/app/api/produk/[id]/halaman/[n]/route.ts
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { ambilKlien } from "@/lib/passport/data";
import { bakarWatermark } from "@/lib/materi/watermark";

/** `sharp` adalah modul native: Edge runtime tidak bisa memuatnya. */
export const runtime = "nodejs";

const BUCKET = "produk-halaman";

/**
 * Menyajikan satu halaman e-book produk, ber-watermark identitas pembacanya.
 *
 * Route handler adalah endpoint MANDIRI: layout `/passport` tidak menjaganya,
 * dan itu sudah dibuktikan di repo ini dengan mem-POST server action panel
 * admin dari rute lain. Karena itu seluruh pemeriksaan ada di sini.
 *
 * Urutannya mengikat: hak diputuskan RLS memakai SESI PEMBACA (policy
 * "halaman produk: pemilik baca"), dan service role baru menyentuh storage
 * sesudah basis data mengembalikan barisnya.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; n: string }> },
) {
  const { id, n } = await params;
  const halaman = Number(n);
  if (!Number.isInteger(halaman) || halaman < 1) {
    return new Response(null, { status: 404 });
  }

  // 1. Identitas pembaca. Tidak ada -> 404, bukan 401: route ini tidak boleh
  //    mengonfirmasi bahwa produknya ada.
  const klien = await ambilKlien();
  if (!klien) return new Response(null, { status: 404 });

  // 2. RLS-lah hakim haknya, bukan `if` di sini.
  const supabase = await createServerSupabase();
  const { data: baris } = await supabase
    .from("digital_product_pages")
    .select("objek")
    .eq("product_id", id)
    .eq("halaman", halaman)
    .maybeSingle();
  if (!baris) return new Response(null, { status: 404 });

  // 3. Hak sudah terbukti. Path diambil dari BARIS, tidak pernah dari parameter.
  const admin = createAdminSupabase();
  const { data: objek } = await admin.storage.from(BUCKET).download(baris.objek);
  if (!objek) return new Response(null, { status: 404 });

  const asli = Buffer.from(await objek.arrayBuffer());
  const bertanda = await bakarWatermark(asli, klien.nama, klien.padmaId);

  return new Response(new Uint8Array(bertanda), {
    status: 200,
    headers: {
      "Content-Type": "image/webp",
      // `private` MENGIKAT: watermark-nya per-pasien, sementara CDN menyimpan
      // berdasarkan URL. `s-maxage` atau `public` di sini akan membuat CDN
      // Vercel menyajikan halaman ber-watermark pembeli A kepada pembeli B —
      // itu kebocoran identitas, bukan bug tampilan.
      //
      // `max-age` disengaja ADA, bukan `no-store`: peramban pembeli sendiri
      // boleh memakai ulang halaman yang sudah ia unduh. Pola yang sama
      // dipakai `/api/materi/[id]/halaman/[n]` — lihat komentar di sana.
      "Cache-Control": "private, max-age=900",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
