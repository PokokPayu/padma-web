import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { kunciBukti, jenisBuktiSah, MAKS_BYTE_BUKTI } from "@/lib/bukti/kunci";
import { PERMINTAAN_MENUNGGU_BAYAR } from "@/lib/jadwal/status";

/**
 * UNGGAH BUKTI BAYAR (spec C2 P3).
 *
 * Rute, bukan policy INSERT untuk klien, dan alasannya sama dengan rute
 * skrining: bucket ini SENGAJA tidak punya satu pun policy, sehingga hanya
 * service role yang bisa menulis — sesudah rute ini memutuskan haknya.
 *
 * Yang diperiksa, berurutan dari yang paling murah:
 *   1. sesi ada, dan ada baris klien untuknya;
 *   2. pengajuannya MILIK klien itu dan sedang `menunggu_bayar`;
 *   3. jenis berkas & ukurannya;
 *   4. baru menulis.
 *
 * Status berpindah ke `menunggu_verifikasi`, TIDAK PERNAH langsung `lunas`.
 * Bukti bisa dipalsukan — gambar hasil sunting sama meyakinkannya dengan yang
 * asli — jadi yang memutuskan tetap admin yang membuka mutasi rekening.
 * Unggahan ini mempercepat pencocokan dan meninggalkan jejak; ia bukan bukti.
 */
export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ pesan: "Silakan masuk dulu." }, { status: 401 });

  const { data: klien } = await supabase
    .from("clients")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle<{ id: string }>();
  if (!klien) return NextResponse.json({ pesan: "Akun belum terhubung." }, { status: 403 });

  const form = await request.formData();
  const permintaanId = String(form.get("permintaan") ?? "").trim();
  const berkas = form.get("bukti");

  if (!permintaanId || !(berkas instanceof File)) {
    return NextResponse.json({ pesan: "Pilih berkas buktinya." }, { status: 400 });
  }

  // KEPEMILIKAN dibaca dengan SESI PENGGUNA: policy "booking: klien baca
  // miliknya" yang memutuskan, bukan perbandingan yang ditulis di sini.
  const { data: pengajuan } = await supabase
    .from("booking_requests")
    .select("id, status")
    .eq("id", permintaanId)
    .eq("client_id", klien.id)
    .maybeSingle<{ id: string; status: string }>();

  if (!pengajuan || pengajuan.status !== PERMINTAAN_MENUNGGU_BAYAR) {
    return NextResponse.json(
      { pesan: "Pengajuan ini tidak sedang menunggu pembayaran." },
      { status: 403 },
    );
  }

  if (!jenisBuktiSah(berkas.type)) {
    return NextResponse.json(
      { pesan: "Unggah gambar (JPG, PNG, atau WEBP)." },
      { status: 415 },
    );
  }
  if (berkas.size > MAKS_BYTE_BUKTI) {
    return NextResponse.json({ pesan: "Berkas terlalu besar (maks 2 MB)." }, { status: 413 });
  }

  const admin = createAdminSupabase();
  const kunci = kunciBukti(permintaanId, berkas.type);

  const { error: eUnggah } = await admin.storage
    .from("bukti-bayar")
    .upload(kunci, berkas, { contentType: berkas.type, upsert: true });
  if (eUnggah) {
    return NextResponse.json({ pesan: "Gagal mengunggah." }, { status: 500 });
  }

  // Status ditulis SESUDAH berkasnya benar-benar tersimpan. Urutan sebaliknya
  // menghasilkan pengajuan yang mengaku punya bukti yang tidak ada.
  const { error: eStatus } = await admin
    .from("booking_requests")
    .update({ bukti_objek: kunci, status_bayar: "menunggu_verifikasi" })
    .eq("id", permintaanId);
  if (eStatus) {
    return NextResponse.json({ pesan: "Gagal menyimpan." }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
