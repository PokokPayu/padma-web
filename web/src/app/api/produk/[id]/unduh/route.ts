import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { ambilKlien } from "@/lib/passport/data";
import { urlUnduhBerkas, UMUR_UNDUH_DETIK } from "@/lib/r2";
import { namaObjekPdfProduk } from "@/lib/produk/objek";
import { slugDariJudul } from "@/lib/produk/status";
import { ekstensiDariMime } from "@/lib/materi/video";
import { objekPdfPembeli, capPdfPembeli } from "@/lib/produk/cap-pdf";

// `pdf-lib`, `@aws-sdk`, dan `@supabase/supabase-js` storage butuh Node.
export const runtime = "nodejs";

const BUCKET_BERKAS = "produk-berkas";

/**
 * Menerbitkan tanda tangan UNDUH — berumur `UMUR_UNDUH_DETIK` (15 menit),
 * jauh lebih pendek dari umur tanda tangan tonton: lihat komentar di
 * `@/lib/r2`.
 *
 * Rute ini MANDIRI seperti dua rute penyaji lainnya: seluruh pemeriksaan ada
 * di sini, bukan di layout `/passport`.
 *
 * Urutannya mengikat:
 *   1. Identitas pembaca.
 *   2. Sesi pengguna membaca `digital_products` — RLS yang menjawab, lewat
 *      "produk: baca publik yang aktif" ATAU "produk: pemilik entitlement
 *      baca". Yang kedua itulah yang membuat produk yang sudah DITARIK dari
 *      etalase tetap bisa diunduh pemiliknya: `aktif = false` berarti berhenti
 *      dijual, bukan mencabut akses (migration `produk_akses_pemilik`).
 *      `boleh_unduh` mati adalah PAGAR TERPISAH dari entitlement: produk yang
 *      dimiliki tetap tidak boleh diunduh bila memang tidak diizinkan.
 *   3. Sesi pengguna membaca `digital_product_files` — inilah yang menegakkan
 *      ENTITLEMENT lewat policy "berkas produk: pemilik baca".
 *   4/5. Baru sesudah kedua gerbang itu lolos, service role menyentuh
 *      storage — dan path objeknya selalu dari BARIS, tidak pernah dari
 *      parameter URL.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // 1. Tidak ada klien -> 404, bukan 401: rute ini tidak boleh mengonfirmasi
  //    bahwa produknya ada kepada yang tidak berhak.
  const klien = await ambilKlien();
  if (!klien) return new Response(null, { status: 404 });

  const supabase = await createServerSupabase();

  // 2. Produk itu sendiri, DAN pagar `boleh_unduh` — terpisah dari
  //    entitlement langkah berikutnya.
  const { data: produk } = await supabase
    .from("digital_products")
    .select("id, judul, jenis, boleh_unduh")
    .eq("id", id)
    .maybeSingle();
  if (!produk) return new Response(null, { status: 404 });
  if (!produk.boleh_unduh) return new Response(null, { status: 404 });

  // 3. Entitlement — RLS "berkas produk: pemilik baca" yang memutuskan.
  //    Nol baris berarti tidak berhak, dan itu tidak boleh dibedakan dari
  //    "produk ini tidak punya berkas" di jawaban rute.
  const { data: berkas } = await supabase
    .from("digital_product_files")
    .select("objek, mime")
    .eq("product_id", id)
    .maybeSingle();
  if (!berkas) return new Response(null, { status: 404 });

  const namaDasar = slugDariJudul(produk.judul) || id;

  if (produk.jenis === "video") {
    const ekstensi = ekstensiDariMime(berkas.mime) ?? "mp4";
    const url = await urlUnduhBerkas(berkas.objek, `${namaDasar}.${ekstensi}`);
    return Response.redirect(url, 302);
  }

  // ===== PDF: cap sekali per pembeli, lalu simpan dan pakai ulang =====
  const admin = createAdminSupabase();
  const objekTercap = objekPdfPembeli(id, klien.id);

  const sudahAda = await admin.storage
    .from(BUCKET_BERKAS)
    .createSignedUrl(objekTercap, UMUR_UNDUH_DETIK, { download: `${namaDasar}.pdf` });

  if (!sudahAda.error && sudahAda.data) {
    return Response.redirect(sudahAda.data.signedUrl, 302);
  }

  // Belum pernah diunduh pembeli ini — cap dari sumbernya, unggah hasilnya,
  // lalu terbitkan tanda tangannya. `namaObjekPdfProduk` (bukan `berkas.objek`
  // dari query di atas) sengaja dipakai untuk sumbernya: keduanya selalu sama
  // untuk produk PDF (lihat `catatPdfProduk`), tapi memanggil fungsi murni
  // ini membuat sumbernya tidak bergantung pada isi baris yang bisa diubah.
  const { data: sumber } = await admin.storage
    .from(BUCKET_BERKAS)
    .download(namaObjekPdfProduk(id));
  if (!sumber) return new Response(null, { status: 404 });

  const asli = new Uint8Array(await sumber.arrayBuffer());
  let tercap: Uint8Array;
  try {
    tercap = await capPdfPembeli(asli, klien.nama, klien.email, klien.padmaId);
  } catch (e) {
    const nama = e instanceof Error ? e.name : "GalatTidakDikenal";
    const pesan = e instanceof Error ? e.message : String(e);
    console.error(`mencap PDF pembeli gagal: ${nama}: ${pesan}`);
    return new Response(null, { status: 500 });
  }

  const { error: unggahError } = await admin.storage
    .from(BUCKET_BERKAS)
    .upload(objekTercap, Buffer.from(tercap), {
      contentType: "application/pdf",
      upsert: true,
    });
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
