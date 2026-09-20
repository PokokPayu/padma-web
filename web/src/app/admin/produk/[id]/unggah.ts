"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { urlUnggahVideo, hapusObjekVideo } from "@/lib/r2";
import { periksaBerkasVideo } from "@/lib/materi/video";
import { MAKS_HALAMAN, MAKS_BYTE_PDF } from "@/lib/materi/rasterisasi";
import {
  namaObjekVideoProduk, namaObjekHalamanProduk, namaObjekPdfProduk,
} from "@/lib/produk/objek";

const BUCKET_HALAMAN = "produk-halaman";
const BUCKET_BERKAS = "produk-berkas";
const MIME_PDF = "application/pdf";

type Gagal = { ok: false; pesan: string };
export type UnggahanHalaman = { halaman: number; objek: string; token: string };

// ===========================================================================
// VIDEO
// ===========================================================================

/**
 * Berkasnya TIDAK menumpang server kita: Vercel membatasi body request 4,5 MB,
 * sementara satu video produk bisa 200 MB. Peramban admin mengunggah langsung
 * ke R2 memakai presigned PUT yang mengikat path, MIME, DAN ukuran — tanda
 * tangan yang hanya mengikat host menerima unggahan ber-MIME apa pun.
 */
export async function terbitkanUrlUnggahVideoProduk(
  productId: string,
  mime: string,
  byte: number,
): Promise<{ ok: true; url: string; objek: string } | Gagal> {
  await requireRole(["admin", "owner"]);

  // Memagari MIME DAN ukuran dalam satu panggilan, dan memulangkan MIME yang
  // sudah BERTIPE `MimeVideo` — jadi tidak ada `as MimeVideo` di bawah yang
  // menyatakan sesuatu yang belum benar-benar diperiksa.
  const periksa = periksaBerkasVideo(mime, byte);
  if (!periksa.ok) return { ok: false, pesan: periksa.pesan };

  // Produk harus ada, dan pemeriksaannya lewat SESI PENGGUNA supaya RLS staf
  // yang memutuskan — bukan service role.
  const supabase = await createServerSupabase();
  const { data: produk, error } = await supabase
    .from("digital_products").select("id, jenis").eq("id", productId).maybeSingle();
  if (error) return { ok: false, pesan: `Gagal membaca produk (${error.code}).` };
  if (!produk) return { ok: false, pesan: "Produk tidak ditemukan." };
  if (produk.jenis !== "video") return { ok: false, pesan: "Produk ini bukan produk video." };

  const objek = namaObjekVideoProduk(productId, periksa.nilai);
  return { ok: true, url: await urlUnggahVideo(objek, periksa.nilai, byte), objek };
}

/** Dicatat SESUDAH unggahan R2 selesai; sebelum itu tidak ada baris apa pun. */
export async function catatVideoProduk(
  productId: string,
  objek: string,
  mime: string,
  byte: number,
): Promise<{ ok: true } | Gagal> {
  await requireRole(["admin", "owner"]);

  // MIME divalidasi ULANG di sini, tidak dipercaya begitu saja: action ini
  // adalah endpoint POST tersendiri, dan pemanggilnya tidak harus action
  // penerbit URL di atas.
  const periksa = periksaBerkasVideo(mime, byte);
  if (!periksa.ok) return { ok: false, pesan: periksa.pesan };

  // Objek yang dicatat WAJIB objek yang kita sendiri namai untuk produk ini —
  // browser mengirimkannya kembali, dan browser yang memilih path adalah
  // browser yang bisa menautkan produk ini ke berkas produk lain.
  if (objek !== namaObjekVideoProduk(productId, periksa.nilai)) {
    return { ok: false, pesan: "Nama objek tidak sah." };
  }

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("digital_product_files")
    .upsert({ product_id: productId, objek, mime, byte }, { onConflict: "product_id" })
    .select("id");
  if (error) return { ok: false, pesan: `Gagal mencatat berkas (${error.code}).` };
  // PostgREST menjawab 200 + [] untuk tulisan yang ditolak RLS.
  if ((data ?? []).length === 0) return { ok: false, pesan: "Berkas tidak tersimpan." };

  revalidatePath(`/admin/produk/${productId}`);
  return { ok: true };
}

// ===========================================================================
// PDF — HALAMAN TERASTERISASI
// ===========================================================================

/**
 * Menerbitkan signed upload URL untuk seluruh halaman sekaligus.
 *
 * Berbeda dari `admin/materi/unggah.ts`, pembersihan baris lama di sini
 * memakai DELETE LANGSUNG lewat sesi staf, bukan RPC: `digital_product_pages`
 * (migration produk_digital, Task 1) tidak pernah mencabut hak tabel dari
 * `authenticated` seperti `material_pages` (migration materi_halaman_pdf)
 * pernah dipaksa lakukan sesudah insiden `?urutan=gte.0`) — policy "halaman
 * produk: staf" sudah `for all` dan menyempit ke baris milik staf lewat
 * `user_role()`, jadi RPC security-definer tidak dibutuhkan di sini untuk
 * mengembalikan hak tulis yang memang belum pernah dicabut.
 */
export async function terbitkanUrlUnggahHalamanProduk(
  productId: string,
  jumlahHalaman: number,
): Promise<{ ok: true; unggahan: UnggahanHalaman[] } | Gagal> {
  await requireRole(["admin", "owner"]);

  if (!Number.isInteger(jumlahHalaman) || jumlahHalaman < 1) {
    return { ok: false, pesan: "Jumlah halaman tidak sah." };
  }
  if (jumlahHalaman > MAKS_HALAMAN) {
    return { ok: false, pesan: `PDF maksimal ${MAKS_HALAMAN} halaman.` };
  }

  // Produk harus ada, dan pemeriksaannya lewat SESI PENGGUNA supaya RLS staf
  // yang memutuskan — bukan service role.
  const supabase = await createServerSupabase();
  const { data: produk, error } = await supabase
    .from("digital_products").select("id, jenis").eq("id", productId).maybeSingle();
  if (error) return { ok: false, pesan: `Gagal membaca produk (${error.code}).` };
  if (!produk) return { ok: false, pesan: "Produk tidak ditemukan." };
  if (produk.jenis !== "pdf") return { ok: false, pesan: "Produk ini bukan produk PDF." };

  // Baris dikosongkan LEBIH DULU, baru objek storage-nya — sengaja dibalik
  // dari urutan yang terasa wajar. Alasannya sama persis dengan komentar
  // panjang di `admin/materi/unggah.ts`: bila penghapusan baris ini yang
  // gagal, belum satu objek pun tersentuh, keadaan lama utuh, dan mengulang
  // percobaan ini bersih tanpa sisa — kegagalannya INERT. Urutan sebaliknya
  // (objek dihapus dulu) membuat kegagalan berarti objek sudah lenyap
  // sementara baris lama masih menunjuknya, dan pembeli melihat halaman
  // rusak sementara panel admin menyatakan produk ini berisi.
  const { error: bersih } = await supabase
    .from("digital_product_pages").delete().eq("product_id", productId);
  if (bersih) {
    return {
      ok: false,
      pesan: "Gagal mengosongkan halaman lama. Produk belum berubah — coba lagi.",
    };
  }

  const admin = createAdminSupabase();

  // Objek lama dibersihkan SESUDAH barisnya kosong (lihat urutan di atas).
  // `.list()` TANPA opsi hanya menjawab 100 objek pertama (default
  // storage-js) — di-loop pakai `offset` supaya SELURUH objek ditemukan
  // berapa pun jumlah halamannya, persis pola `admin/materi/unggah.ts`.
  const LIMIT_LIST = 1000;
  const lama: Array<{ name: string }> = [];
  for (let offset = 0; ; offset += LIMIT_LIST) {
    const { data: potongan } = await admin.storage
      .from(BUCKET_HALAMAN)
      .list(productId, { limit: LIMIT_LIST, offset });
    if (!potongan || potongan.length === 0) break;
    lama.push(...potongan);
    if (potongan.length < LIMIT_LIST) break;
  }
  if (lama.length > 0) {
    const { error: hapus } = await admin.storage
      .from(BUCKET_HALAMAN)
      .remove(lama.map((o) => `${productId}/${o.name}`));
    if (hapus) {
      return {
        ok: false,
        pesan:
          "Halaman lama sudah kosong, tetapi sebagian objek lama gagal dihapus. Aman diunggah ulang.",
      };
    }
  }

  const unggahan: UnggahanHalaman[] = [];
  for (let halaman = 1; halaman <= jumlahHalaman; halaman++) {
    const objek = namaObjekHalamanProduk(productId, halaman);
    // `{ upsert: true }` WAJIB di sini — path objeknya tetap ditentukan
    // server (lihat dokblok fungsi ini): `upsert` hanya mengizinkan
    // penimpaan path yang KITA sendiri namai, dan `catatHalamanProduk`
    // menolak `objek` apa pun yang tidak sama dengan nama turunan server itu.
    const { data, error: e } = await admin.storage
      .from(BUCKET_HALAMAN)
      .createSignedUploadUrl(objek, { upsert: true });
    if (e || !data) {
      return { ok: false, pesan: "Gagal menyiapkan unggahan. Coba lagi." };
    }
    unggahan.push({ halaman, objek, token: data.token });
  }
  return { ok: true, unggahan };
}

/**
 * Mencatat seluruh halaman SEKALIGUS, sesudah semua unggahan sukses.
 *
 * Dipanggil sekali di akhir, bukan per halaman: bila unggahan gagal di
 * tengah, fungsi ini tidak pernah jalan dan produknya tampak "belum ada isi"
 * di panel — bukan setengah terisi, yang jauh lebih sulit disadari.
 */
export async function catatHalamanProduk(
  productId: string,
  halaman: Array<{ halaman: number; objek: string }>,
): Promise<{ ok: true; jumlah: number } | Gagal> {
  await requireRole(["admin", "owner"]);

  if (halaman.length === 0) return { ok: false, pesan: "Tidak ada halaman." };
  if (halaman.length > MAKS_HALAMAN) {
    return { ok: false, pesan: `PDF maksimal ${MAKS_HALAMAN} halaman.` };
  }
  // Objek yang dicatat harus objek yang KITA namai. Nama lain berarti browser
  // menunjuk objek yang bukan miliknya.
  for (const h of halaman) {
    if (h.objek !== namaObjekHalamanProduk(productId, h.halaman)) {
      return { ok: false, pesan: "Nama objek halaman tidak sah." };
    }
  }

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("digital_product_pages")
    .insert(halaman.map((h) => ({ product_id: productId, halaman: h.halaman, objek: h.objek })))
    .select("halaman");
  if (error) return { ok: false, pesan: `Gagal menyimpan halaman (${error.code}).` };
  if ((data ?? []).length === 0) return { ok: false, pesan: "Halaman tidak tersimpan." };

  revalidatePath(`/admin/produk/${productId}`);
  return { ok: true, jumlah: data.length };
}

// ===========================================================================
// PDF — BERKAS UTUH (unduhan, hanya bila `boleh_unduh` menyala)
// ===========================================================================

/**
 * Menerbitkan signed upload URL untuk PDF UTUH ke `produk-berkas`.
 *
 * Hanya dipanggil (dari `pengunggah-produk.tsx`) bila `boleh_unduh` produk
 * menyala — PDF utuh adalah satu-satunya jalur unduhan berkas mentah, dan
 * produk yang tidak mengizinkan unduhan tidak perlu menyimpannya sama sekali.
 */
export async function terbitkanUrlUnggahPdfProduk(
  productId: string,
  byte: number,
): Promise<{ ok: true; objek: string; token: string } | Gagal> {
  await requireRole(["admin", "owner"]);

  if (!Number.isFinite(byte) || byte <= 0) return { ok: false, pesan: "Berkas PDF kosong." };
  if (byte > MAKS_BYTE_PDF) {
    const mb = Math.round(MAKS_BYTE_PDF / (1024 * 1024));
    return { ok: false, pesan: `PDF maksimal ${mb} MB.` };
  }

  const supabase = await createServerSupabase();
  const { data: produk, error } = await supabase
    .from("digital_products").select("id, jenis, boleh_unduh").eq("id", productId).maybeSingle();
  if (error) return { ok: false, pesan: `Gagal membaca produk (${error.code}).` };
  if (!produk) return { ok: false, pesan: "Produk tidak ditemukan." };
  if (produk.jenis !== "pdf") return { ok: false, pesan: "Produk ini bukan produk PDF." };
  if (!produk.boleh_unduh) {
    return { ok: false, pesan: "Produk ini tidak mengizinkan unduhan PDF utuh." };
  }

  const admin = createAdminSupabase();
  const objek = namaObjekPdfProduk(productId);
  const { data, error: e } = await admin.storage
    .from(BUCKET_BERKAS)
    .createSignedUploadUrl(objek, { upsert: true });
  if (e || !data) return { ok: false, pesan: "Gagal menyiapkan unggahan. Coba lagi." };

  return { ok: true, objek, token: data.token };
}

/** Dicatat SESUDAH unggahan PDF utuh selesai; sebelum itu tidak ada baris apa pun. */
export async function catatPdfProduk(
  productId: string,
  byte: number,
): Promise<{ ok: true } | Gagal> {
  await requireRole(["admin", "owner"]);

  if (!Number.isFinite(byte) || byte <= 0) return { ok: false, pesan: "Berkas PDF kosong." };
  if (byte > MAKS_BYTE_PDF) {
    const mb = Math.round(MAKS_BYTE_PDF / (1024 * 1024));
    return { ok: false, pesan: `PDF maksimal ${mb} MB.` };
  }

  const supabase = await createServerSupabase();
  const { data: produk, error: pError } = await supabase
    .from("digital_products").select("id, boleh_unduh").eq("id", productId).maybeSingle();
  if (pError) return { ok: false, pesan: `Gagal membaca produk (${pError.code}).` };
  if (!produk) return { ok: false, pesan: "Produk tidak ditemukan." };
  if (!produk.boleh_unduh) {
    return { ok: false, pesan: "Produk ini tidak mengizinkan unduhan PDF utuh." };
  }

  // Objek yang dicatat selalu objek yang KITA namai — tidak ada parameter
  // `objek` di sini sama sekali untuk dipalsukan; namanya deterministik dari
  // id produk.
  const objek = namaObjekPdfProduk(productId);
  const { data, error } = await supabase
    .from("digital_product_files")
    .upsert({ product_id: productId, objek, mime: MIME_PDF, byte }, { onConflict: "product_id" })
    .select("id");
  if (error) return { ok: false, pesan: `Gagal mencatat berkas (${error.code}).` };
  if ((data ?? []).length === 0) return { ok: false, pesan: "Berkas tidak tersimpan." };

  revalidatePath(`/admin/produk/${productId}`);
  return { ok: true };
}

// ===========================================================================
// LEPAS ISI
// ===========================================================================

/**
 * Melepas seluruh isi produk (video ATAU halaman + berkas PDF), tanpa
 * unggahan pengganti.
 *
 * Ditolak selama produknya masih terbit: produk tanpa isi yang terpajang di
 * etalase adalah kartu terkunci yang tidak akan pernah terbuka.
 *
 * Baris dihapus LEBIH DULU, objek storage BELAKANGAN — simetris dengan
 * urutan di `terbitkanUrlUnggahHalamanProduk` dan dengan `lepasVideo`
 * (`admin/materi/aksi.ts`): kunci objek dibaca sebelum barisnya lenyap,
 * kegagalan menghapus objek sesudah itu adalah mode gagal LUNAK (objek
 * yatim), dilaporkan lewat `objekTersisa`, bukan ditelan diam.
 *
 * Untuk PDF, cabang ini menyentuh DUA baris (`digital_product_pages` DAN
 * `digital_product_files`) dan DUA bucket storage. Pembersihan objek
 * halaman dijalankan SEGERA sesudah `digital_product_pages` kosong, TIDAK
 * ditunda sampai `digital_product_files` juga selesai dihapus — lihat
 * komentar di titik itu untuk alasan lengkap: dua penghapusan itu independen,
 * dan menyandera satu pada suksesnya yang lain membuka kembali persis
 * kegagalan yang urutan "baris dulu, objek belakangan" ada untuk mencegah.
 */
export async function lepasIsiProduk(
  productId: string,
): Promise<{ ok: true; objekTersisa: boolean } | Gagal> {
  await requireRole(["admin", "owner"]);

  const supabase = await createServerSupabase();
  const { data: produk, error } = await supabase
    .from("digital_products").select("id, jenis, aktif").eq("id", productId).maybeSingle();
  if (error) return { ok: false, pesan: `Gagal membaca produk (${error.code}).` };
  if (!produk) return { ok: false, pesan: "Produk tidak ditemukan." };
  if (produk.aktif) {
    return {
      ok: false,
      pesan:
        "Nonaktifkan produk lebih dulu. Produk terbit tanpa isi adalah kartu terkunci yang tidak akan pernah terbuka.",
    };
  }

  if (produk.jenis === "video") {
    const { data: berkas } = await supabase
      .from("digital_product_files").select("objek").eq("product_id", productId).maybeSingle();

    const { error: delError } = await supabase
      .from("digital_product_files").delete().eq("product_id", productId);
    if (delError) return { ok: false, pesan: `Gagal melepas video (${delError.code}).` };

    let objekTersisa = false;
    if (berkas?.objek) {
      try {
        await hapusObjekVideo(berkas.objek);
      } catch {
        objekTersisa = true;
      }
    }
    revalidatePath(`/admin/produk/${productId}`);
    return { ok: true, objekTersisa };
  }

  // jenis === "pdf": halaman terasterisasi DAN berkas PDF utuh (bila ada).
  const { data: halaman } = await supabase
    .from("digital_product_pages").select("objek").eq("product_id", productId);
  const { data: berkasPdf } = await supabase
    .from("digital_product_files").select("objek").eq("product_id", productId).maybeSingle();

  const { error: delHalaman } = await supabase
    .from("digital_product_pages").delete().eq("product_id", productId);
  if (delHalaman) return { ok: false, pesan: `Gagal mengosongkan halaman (${delHalaman.code}).` };

  const admin = createAdminSupabase();
  let objekTersisa = false;

  // Objek halaman dibersihkan DI SINI — SEGERA sesudah barisnya kosong, TIDAK
  // digantungkan pada sukses-tidaknya penghapusan `digital_product_files` di
  // bawah. Nama objeknya sudah di tangan (`halaman`, dibaca sebelum baris
  // dihapus); begitu barisnya lenyap, itu satu-satunya kesempatan untuk
  // membersihkannya — percobaan berikutnya membaca `digital_product_pages`
  // dan menemukan NOL baris, sehingga blok pembersihan storage tidak pernah
  // jalan lagi. Dua penghapusan (baris `digital_product_files` dan objek
  // halaman) adalah dua hal yang TIDAK SALING BERGANTUNG — JANGAN
  // menyandera satu pada suksesnya yang lain. Inilah persis mode gagal yang
  // urutan "baris dulu, objek belakangan" di seluruh berkas ini ada untuk
  // mencegah, dan menggabungkan dua tabel dalam satu urutan gagal-berhenti
  // diam-diam membukanya kembali.
  if ((halaman ?? []).length > 0) {
    const { error: hapusHalaman } = await admin.storage
      .from(BUCKET_HALAMAN)
      .remove((halaman ?? []).map((h) => h.objek));
    if (hapusHalaman) objekTersisa = true;
  }

  const { error: delBerkas } = await supabase
    .from("digital_product_files").delete().eq("product_id", productId);
  if (delBerkas) {
    return {
      ok: false,
      pesan: objekTersisa
        ? `Halaman dilepas, tetapi sebagian objek halaman DAN baris berkas PDF gagal dihapus (${delBerkas.code}). Beri tahu tim teknis agar tidak menumpuk.`
        : `Halaman sudah kosong, tetapi berkas PDF gagal dilepas (${delBerkas.code}).`,
    };
  }

  if (berkasPdf?.objek) {
    const { error: hapusBerkas } = await admin.storage
      .from(BUCKET_BERKAS)
      .remove([berkasPdf.objek]);
    if (hapusBerkas) objekTersisa = true;
  }

  revalidatePath(`/admin/produk/${productId}`);
  return { ok: true, objekTersisa };
}
