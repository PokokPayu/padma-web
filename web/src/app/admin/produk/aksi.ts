"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  periksaJudul,
  periksaSlug,
  periksaJenis,
  slugDariJudul,
  punyaIsi,
  PANJANG_DESKRIPSI_MAKS,
  type JenisProduk,
} from "@/lib/produk/status";

/**
 * Jalur tulis panel admin untuk master produk digital.
 *
 * Aturan yang mengikat berkas ini, sama seperti `admin/materi/aksi.ts`:
 *
 *  1. Server action adalah ENDPOINT POST TERSENDIRI. Penjaga di
 *     `src/app/admin/layout.tsx` tidak pernah dilewati saat action dipanggil
 *     langsung, jadi `requireRole(["admin","owner"])` ditulis DI DALAM setiap
 *     action.
 *
 *  2. PRODUK LAHIR NONAKTIF. Berkasnya (Task 6) diunggah lewat komponen
 *     tersendiri SESUDAH `productId` ini ada, jadi `simpanProduk` TIDAK
 *     PERNAH mengirim `aktif` — default basis data (false) yang berlaku.
 *
 *  3. `aktifkanProduk` MENOLAK produk tanpa berkas. Tanpa itu, pagar (2) bisa
 *     dilewati hanya dengan satu klik lanjutan pada produk yang isinya belum
 *     ada.
 *
 *  4. HARGA TIDAK PERNAH DISENTUH DI SINI. `digital_product_prices` adalah
 *     wilayah owner (Task 7) — RLS-nya sendiri sudah menolak admin menulis,
 *     tapi berkas ini juga tidak pernah mencoba: medan harga tidak muncul di
 *     satu pun `FormData` yang dibaca di bawah.
 *
 *  5. UPDATE/INSERT yang tertahan RLS dijawab PostgREST 200 + []. Melaporkan
 *     "berhasil" tanpa memeriksa panjangnya adalah kebohongan senyap.
 *
 *  6. Sesi pengguna, bukan service role. Di bawah service role `user_role()`
 *     mengembalikan 'klien' dan policy "produk: staf" tidak pernah ikut
 *     diperiksa.
 */
type Gagal = { ok: false; pesan: string };
type Dibuat = { ok: true; id: string };
type Berhasil = { ok: true };

function segarkanProduk() {
  revalidatePath("/admin/produk");
  revalidatePath("/produk");
}

/** Medan bersama `simpanProduk` dan `perbaruiProduk`, sudah tervalidasi. */
function periksaMedanProduk(formData: FormData): Gagal | {
  ok: true;
  judul: string;
  slug: string;
  jenis: "video" | "pdf";
  deskripsi: string;
  bolehUnduh: boolean;
} {
  const judul = periksaJudul(String(formData.get("judul") ?? ""));
  if (!judul.ok) return { ok: false, pesan: judul.pesan };

  const jenis = periksaJenis(String(formData.get("jenis") ?? ""));
  if (!jenis.ok) return { ok: false, pesan: jenis.pesan };

  // Slug diambil dari medan bila diisi, kalau tidak diturunkan dari judul.
  const mentahSlug = String(formData.get("slug") ?? "").trim();
  const slug = periksaSlug(mentahSlug || slugDariJudul(judul.nilai));
  if (!slug.ok) return { ok: false, pesan: slug.pesan };

  const deskripsi = String(formData.get("deskripsi") ?? "").trim();
  if (deskripsi.length > PANJANG_DESKRIPSI_MAKS) {
    return { ok: false, pesan: `Deskripsi maksimal ${PANJANG_DESKRIPSI_MAKS} karakter.` };
  }

  const bolehUnduh = formData.get("boleh_unduh") === "on";

  return { ok: true, judul: judul.nilai, slug: slug.nilai, jenis: jenis.nilai, deskripsi, bolehUnduh };
}

/**
 * Mendaftarkan produk baru.
 *
 * `aktif` sengaja TIDAK dikirim: default basis data (false) yang berlaku.
 * Produk tanpa berkas tidak boleh terpajang, dan berkasnya baru bisa
 * diunggah sesudah barisnya ada (Task 6).
 */
export async function simpanProduk(formData: FormData): Promise<Dibuat | Gagal> {
  await requireRole(["admin", "owner"]);

  const medan = periksaMedanProduk(formData);
  if (!medan.ok) return medan;

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("digital_products")
    .insert({
      judul: medan.judul,
      slug: medan.slug,
      deskripsi: medan.deskripsi,
      jenis: medan.jenis,
      boleh_unduh: medan.bolehUnduh,
    })
    .select("id");

  if (error?.code === "23505") {
    return { ok: false, pesan: `Alamat "${medan.slug}" sudah dipakai produk lain.` };
  }
  if (error) return { ok: false, pesan: `Produk gagal disimpan (${error.code}).` };
  // 200 + [] berarti RLS menahan barisnya tanpa melempar galat apa pun.
  if ((data ?? []).length === 0) {
    return { ok: false, pesan: "Produk tidak tersimpan — hak akses ditolak." };
  }

  segarkanProduk();
  return { ok: true, id: data![0].id };
}

/**
 * Mengubah identitas produk (judul/slug/deskripsi/boleh_unduh/urutan).
 *
 * `aktif` dan harga sengaja tidak muncul di sini — keadaan tayang punya
 * action tersendiri (`aktifkanProduk`/`nonaktifkanProduk`), dan harga adalah
 * wilayah owner (Task 7).
 *
 * `jenis` boleh diubah hanya SELAMA produknya belum berisi — lihat pagar di
 * dalam badan fungsi.
 */
export async function perbaruiProduk(id: string, formData: FormData): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);

  const medan = periksaMedanProduk(formData);
  if (!medan.ok) return medan;

  const urutanMentah = String(formData.get("urutan") ?? "0").trim();
  const urutan = /^-?\d+$/.test(urutanMentah) ? Number(urutanMentah) : 0;

  const supabase = await createServerSupabase();

  // `jenis` TERKUNCI begitu isinya ada. Video dan PDF menyimpan isinya di
  // tempat yang berbeda (`digital_product_files` vs `digital_product_pages`),
  // dan setiap pembaca isi bercabang pada kolom ini: membalik jenis produk PDF
  // yang sudah terisi membuat halamannya terlantar tanpa pembaca, `punyaIsi`
  // memeriksa tabel yang salah, dan reader 404 untuk pemilik yang SUDAH
  // membayar — sementara etalase tetap memajangnya seperti tidak terjadi apa
  // pun. Salah ketik satu dropdown tidak boleh berakibat sebesar itu; yang
  // benar-benar ingin mengubah jenis melepas isinya lebih dulu, dan itu
  // tindakan yang sadar.
  const { data: kini, error: kiniError } = await supabase
    .from("digital_products").select("jenis").eq("id", id).maybeSingle();
  if (kiniError) return { ok: false, pesan: `Gagal membaca produk (${kiniError.code}).` };
  if (!kini) return { ok: false, pesan: "Produk tidak ditemukan atau hak akses ditolak." };

  if (kini.jenis !== medan.jenis) {
    const isi = await hitungIsi(supabase, id, kini.jenis as JenisProduk);
    if (!isi.ok) return isi;
    if (punyaIsi(kini.jenis as JenisProduk, isi.berkas, isi.halaman)) {
      return {
        ok: false,
        pesan:
          "Jenis produk tidak bisa diubah setelah isinya diunggah. Lepas isi produk lebih dulu.",
      };
    }
  }

  const { data, error } = await supabase
    .from("digital_products")
    .update({
      judul: medan.judul,
      slug: medan.slug,
      deskripsi: medan.deskripsi,
      jenis: medan.jenis,
      boleh_unduh: medan.bolehUnduh,
      urutan,
    })
    .eq("id", id)
    .select("id");

  if (error?.code === "23505") {
    return { ok: false, pesan: `Alamat "${medan.slug}" sudah dipakai produk lain.` };
  }
  if (error) return { ok: false, pesan: `Produk gagal diperbarui (${error.code}).` };
  if ((data ?? []).length === 0) {
    return { ok: false, pesan: "Produk tidak ditemukan atau hak akses ditolak." };
  }

  segarkanProduk();
  return { ok: true };
}

/**
 * Menghitung isi produk menurut JENISNYA — satu pembaca untuk dua pemakai
 * (`aktifkanProduk` dan pagar `jenis` di `perbaruiProduk`), supaya "apa yang
 * dianggap berisi" hidup di satu tempat saja.
 *
 * Galat query DIKEMBALIKAN, tidak ditelan: "0 karena tidak ada isi" dan "0
 * karena kueri gagal" adalah dua keadaan berbeda, dan yang kedua tidak boleh
 * menyamar sebagai yang pertama — di `perbaruiProduk` ia akan berarti pagar
 * yang diam-diam terbuka.
 */
async function hitungIsi(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  id: string,
  jenis: JenisProduk,
): Promise<{ ok: true; berkas: number; halaman: number } | Gagal> {
  if (jenis === "video") {
    const { data, error } = await supabase
      .from("digital_product_files")
      .select("id")
      .eq("product_id", id);
    if (error) return { ok: false, pesan: `Gagal memeriksa isi (${error.code}).` };
    return { ok: true, berkas: (data ?? []).length, halaman: 0 };
  }

  const { count, error } = await supabase
    .from("digital_product_pages")
    .select("halaman", { count: "exact", head: true })
    .eq("product_id", id);
  if (error) return { ok: false, pesan: `Gagal memeriksa isi (${error.code}).` };
  return { ok: true, berkas: 0, halaman: count ?? 0 };
}

/**
 * Menayangkan produk.
 *
 * Produk tanpa isi yang terpajang di etalase adalah janji yang tidak bisa
 * ditepati: pengunjung membuka halamannya dan tidak menemukan apa pun.
 *
 * "Punya isi" adalah predikat JENIS-SADAR (`punyaIsi`, `@/lib/produk/status`),
 * BUKAN sekadar "ada baris `digital_product_files`". Video menyimpan isinya
 * SELALU di situ, tapi PDF menyimpan isinya di `digital_product_pages` —
 * `digital_product_files` untuk PDF hanya terisi bila `boleh_unduh` menyala
 * (Task 6, `admin/produk/[id]/unggah.ts`). Memeriksa `digital_product_files`
 * saja di sini dulu berarti produk PDF yang tidak mengizinkan unduhan TIDAK
 * PERNAH bisa ditayangkan walau halamannya sudah lengkap — jalan buntu, bukan
 * sekadar ketidaknyamanan, dan justru lewat jalur unggahan yang jadi tugas
 * modul ini sendiri untuk mengisi.
 */
export async function aktifkanProduk(id: string): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();

  const { data: produk, error: produkError } = await supabase
    .from("digital_products").select("jenis").eq("id", id).maybeSingle();
  if (produkError) return { ok: false, pesan: `Gagal membaca produk (${produkError.code}).` };
  if (!produk) return { ok: false, pesan: "Produk tidak ditemukan." };

  const isi = await hitungIsi(supabase, id, produk.jenis as JenisProduk);
  if (!isi.ok) return isi;

  if (!punyaIsi(produk.jenis as JenisProduk, isi.berkas, isi.halaman)) {
    return {
      ok: false,
      pesan: "Produk belum punya berkas — unggah isinya dulu sebelum ditayangkan.",
    };
  }

  const { data, error } = await supabase
    .from("digital_products")
    .update({ aktif: true })
    .eq("id", id)
    .select("id");
  if (error) return { ok: false, pesan: `Gagal menayangkan (${error.code}).` };
  if ((data ?? []).length === 0) return { ok: false, pesan: "Produk tidak ditemukan." };

  segarkanProduk();
  return { ok: true };
}

/**
 * Menarik produk dari etalase — BERHENTI DIJUAL, bukan mencabut akses.
 *
 * Pemegang entitlement yang belum dicabut TETAP membuka produk ini: kartunya
 * tetap ada di "Pembelian saya", readernya tetap terbuka, unduhannya tetap
 * jalan. Itu bukan sekadar niat yang ditulis di komentar ini — yang
 * menegakkannya adalah policy "produk: pemilik entitlement baca" (migration
 * `20260921160000_produk_akses_pemilik.sql`), karena spec menjanjikan masa
 * akses "Selamanya; admin tetap bisa mencabut" dan pencabutan punya tombolnya
 * SENDIRI: `digital_entitlements.dicabut_pada`. Satu action yang dipakai admin
 * untuk merapikan etalase tidak boleh diam-diam menjadi pencabutan massal.
 *
 * Yang berubah hanyalah etalase publik: `/produk`, `/produk/[slug]`, dan seksi
 * landing berhenti memajangnya, dan produk gratisnya tidak bisa diambil lagi.
 */
export async function nonaktifkanProduk(id: string): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from("digital_products")
    .update({ aktif: false })
    .eq("id", id)
    .select("id");
  if (error) return { ok: false, pesan: `Gagal menonaktifkan (${error.code}).` };
  if ((data ?? []).length === 0) return { ok: false, pesan: "Produk tidak ditemukan." };

  segarkanProduk();
  return { ok: true };
}
