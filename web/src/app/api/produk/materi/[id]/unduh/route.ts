import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { ambilKlien } from "@/lib/passport/data";
import { urlUnduhBerkas, UMUR_UNDUH_DETIK } from "@/lib/r2";
import { namaObjekPdfMateri } from "@/lib/produk/objek";
import { slugDariJudul } from "@/lib/produk/status";
import { ekstensiDariMime } from "@/lib/materi/video";
import { objekPdfPembeli, capPdfPembeli } from "@/lib/produk/cap-pdf";

// `pdf-lib`, `@aws-sdk`, dan `@supabase/supabase-js` storage butuh Node.
export const runtime = "nodejs";

const BUCKET_BERKAS = "produk-berkas";

type Materi = { id: string; product_id: string; judul: string; jenis: "video" | "pdf"; boleh_unduh: boolean };

/**
 * Unduh berkas utuh satu materi — KHUSUS PEMILIK AKTIF.
 *
 * Berbeda dari tonton/baca, RLS `boleh_buka_materi` TIDAK cukup di sini:
 * predikat itu juga membuka materi pratinjau bagi non-pembeli, sedangkan
 * pratinjau tidak pernah boleh diunduh (spec 2026-10-16). Karena itu
 * `punya_produk` dipanggil eksplisit.
 *
 * Menerbitkan tanda tangan UNDUH — berumur `UMUR_UNDUH_DETIK` (15 menit),
 * jauh lebih pendek dari umur tanda tangan tonton: lihat komentar di
 * `@/lib/r2`.
 *
 * Rute ini MANDIRI seperti dua rute penyaji lainnya: seluruh pemeriksaan ada
 * di sini, bukan di layout `/passport`.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // 1. Tidak ada klien -> 404, bukan 401: rute ini tidak boleh mengonfirmasi
  //    bahwa materinya ada kepada yang tidak berhak.
  const klien = await ambilKlien();
  if (!klien) return new Response(null, { status: 404 });

  const supabase = await createServerSupabase();

  // 2. Materi itu sendiri, DAN pagar `boleh_unduh` — terpisah dari
  //    entitlement langkah berikutnya: materi yang dimiliki tetap tidak boleh
  //    diunduh bila memang tidak diizinkan.
  const { data: materi } = await supabase
    .from("digital_product_materials")
    .select("id, product_id, judul, jenis, boleh_unduh")
    .eq("id", id)
    .maybeSingle<Materi>();
  if (!materi) return new Response(null, { status: 404 });
  if (!materi.boleh_unduh) return new Response(null, { status: 404 });

  // 3. Entitlement aktif, eksplisit (lihat komentar rute). Tidak boleh
  //    dibedakan dari "materi ini tidak punya berkas" di jawaban rute.
  const { data: punya } = await supabase.rpc("punya_produk", { p_product_id: materi.product_id });
  if (punya !== true) return new Response(null, { status: 404 });

  // 4. Baris berkas — RLS `boleh_buka_materi` juga berlaku di sini.
  const { data: berkas } = await supabase
    .from("digital_product_files").select("objek, mime").eq("material_id", id).maybeSingle();
  if (!berkas) return new Response(null, { status: 404 });

  // 5. Baru sesudah gerbang-gerbang itu lolos, service role menyentuh
  //    storage — dan path objeknya selalu dari BARIS, tidak pernah dari
  //    parameter URL.
  const namaDasar = slugDariJudul(materi.judul) || id;

  if (materi.jenis === "video") {
    const ekstensi = ekstensiDariMime(berkas.mime) ?? "mp4";
    return Response.redirect(await urlUnduhBerkas(berkas.objek, `${namaDasar}.${ekstensi}`), 302);
  }

  // ===== PDF: cap sekali per pembeli, lalu simpan dan pakai ulang =====
  const admin = createAdminSupabase();
  const objekTercap = objekPdfPembeli(materi.product_id, materi.id, klien.id);

  const sudahAda = await admin.storage
    .from(BUCKET_BERKAS)
    .createSignedUrl(objekTercap, UMUR_UNDUH_DETIK, { download: `${namaDasar}.pdf` });
  if (!sudahAda.error && sudahAda.data) return Response.redirect(sudahAda.data.signedUrl, 302);

  // Belum pernah diunduh pembeli ini — cap dari sumbernya, unggah hasilnya,
  // lalu terbitkan tanda tangannya. `namaObjekPdfMateri` (bukan `berkas.objek`
  // dari query di atas) sengaja dipakai untuk sumbernya: keduanya selalu sama
  // untuk materi PDF, tapi memanggil fungsi murni ini membuat sumbernya tidak
  // bergantung pada isi baris yang bisa diubah.
  const { data: sumber } = await admin.storage
    .from(BUCKET_BERKAS)
    .download(namaObjekPdfMateri(materi.product_id, materi.id));
  if (!sumber) return new Response(null, { status: 404 });

  let tercap: Uint8Array;
  try {
    tercap = await capPdfPembeli(new Uint8Array(await sumber.arrayBuffer()), klien.nama, klien.email, klien.padmaId);
  } catch (e) {
    const nama = e instanceof Error ? e.name : "GalatTidakDikenal";
    const pesan = e instanceof Error ? e.message : String(e);
    console.error(`mencap PDF pembeli gagal: ${nama}: ${pesan}`);
    return new Response(null, { status: 500 });
  }

  const { error: unggahError } = await admin.storage
    .from(BUCKET_BERKAS)
    .upload(objekTercap, Buffer.from(tercap), { contentType: "application/pdf", upsert: true });
  if (unggahError) {
    console.error(`mengunggah PDF tercap gagal: ${unggahError.message}`);
    return new Response(null, { status: 500 });
  }

  const { data: signed, error: signError } = await admin.storage
    .from(BUCKET_BERKAS)
    .createSignedUrl(objekTercap, UMUR_UNDUH_DETIK, { download: `${namaDasar}.pdf` });
  if (signError || !signed) {
    console.error(`menandatangani PDF tercap gagal: ${signError?.message ?? "tidak diketahui"}`);
    return new Response(null, { status: 500 });
  }
  return Response.redirect(signed.signedUrl, 302);
}
