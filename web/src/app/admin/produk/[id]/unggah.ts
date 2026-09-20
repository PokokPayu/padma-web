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
import { prefiksPdfPembeli } from "@/lib/produk/cap-pdf";

const BUCKET_HALAMAN = "produk-halaman";
const BUCKET_BERKAS = "produk-berkas";
const MIME_PDF = "application/pdf";

type Gagal = { ok: false; pesan: string };
export type UnggahanHalaman = { halaman: number; objek: string; token: string };

/** Sebanyak yang dipulangkan satu halaman `.list()` — lihat komentar di bawah. */
const BATAS_LIST = 1000;

/**
 * Mengosongkan SELURUH salinan PDF tercap milik para pembeli satu produk.
 *
 * Salinan tercap (`<produk>/pembeli/<klien>.pdf`) adalah TURUNAN dari PDF
 * sumber, dan rute unduh memakainya ulang begitu ia ada — tanpa pernah
 * membandingkannya dengan sumbernya. Karena itu siapa pun yang MENGGANTI atau
 * MELEPAS sumbernya wajib menghapus folder ini; kalau tidak, admin yang
 * mengunggah PDF perbaikan tidak akan PERNAH bisa mengirimkannya kepada orang
 * yang sudah pernah mengunduh — permanen, tanpa satu pun galat di layar — dan
 * "Lepas isi" meninggalkan objek yatim, kelas kebocoran yang sama yang sudah
 * ditutup untuk objek halaman.
 *
 * `.list()` DIPAGINASI, tidak dipanggil sekali: tanpa opsi, Supabase memulangkan
 * 100 objek pertama saja — pemotongan diam yang dulu membuat unggah ulang
 * e-book >100 halaman gagal permanen di modul materi. Produk laris punya lebih
 * dari 100 pembeli, dan sisa yang tidak terhapus adalah sisa yang tetap
 * disajikan rute unduh.
 *
 * Memulangkan `true` bila ADA yang tidak terhapus — mode gagal LUNAK yang
 * dilaporkan ke pemanggil, bukan ditelan diam.
 */
async function hapusSalinanPembeli(
  admin: ReturnType<typeof createAdminSupabase>,
  productId: string,
): Promise<boolean> {
  const prefiks = prefiksPdfPembeli(productId);
  for (;;) {
    const { data, error } = await admin.storage
      .from(BUCKET_BERKAS)
      .list(prefiks, { limit: BATAS_LIST });
    if (error) return true;
    if (!data || data.length === 0) return false;

    const { error: hapus } = await admin.storage
      .from(BUCKET_BERKAS)
      .remove(data.map((o) => `${prefiks}/${o.name}`));
    if (hapus) return true;
    // Halaman terakhir: berhenti di sini, bukan memanggil `.list()` sekali lagi
    // hanya untuk mendapat jawaban kosong.
    if (data.length < BATAS_LIST) return false;
  }
}

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
 * Pembersihan baris lama memakai RPC `ganti_halaman_produk`
 * (`security definer`, radius terkunci `p_product_id`), BUKAN DELETE
 * langsung lewat sesi staf: `digital_product_pages` mencabut SELURUH hak
 * tabelnya dari `authenticated` (migration `produk_hapus_isi`) — persis
 * `material_pages` (migration `materi_halaman_pdf`) — karena policy
 * "halaman produk: staf" yang `for all` tidak pernah menyempit ke SATU
 * produk, dan filter PostgREST adalah pilihan pemanggil, bukan pembatas
 * baris. Lihat komentar panjang di migration itu untuk kejadian nyatanya.
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
  //
  // `p_halaman: []` berarti "kosongkan, jangan isi apa pun" — RPC yang sama
  // dipakai `catatHalamanProduk` di bawah untuk MENGISI, persis pola
  // `ganti_halaman_materi` dipakai dua kali (kosongkan, lalu isi) oleh
  // `admin/materi/unggah.ts`.
  const { data: lama, error: bersih } = await supabase.rpc("ganti_halaman_produk", {
    p_product_id: productId,
    p_halaman: [],
  });
  if (bersih) {
    return {
      ok: false,
      pesan: "Gagal mengosongkan halaman lama. Produk belum berubah — coba lagi.",
    };
  }

  const admin = createAdminSupabase();

  // Objek lama dibersihkan SESUDAH barisnya kosong (lihat urutan di atas),
  // dari nama yang dikembalikan RPC langsung — TIDAK dibaca lewat
  // `.list()` bucket: RPC sudah memulangkan tepat objek yang barisnya
  // barusan dihapus lewat `returning`, jadi tidak ada lagi potensi
  // pemotongan 100-objek-pertama (`.list()` tanpa opsi) yang pernah
  // membuat unggah ulang e-book >100 halaman gagal permanen di materi.
  const objekLama = (lama ?? []).map((r: { objek: string }) => r.objek);
  if (objekLama.length > 0) {
    const { error: hapus } = await admin.storage.from(BUCKET_HALAMAN).remove(objekLama);
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

  // Lewat RPC `ganti_halaman_produk` yang sama dengan
  // `terbitkanUrlUnggahHalamanProduk` — kali ini dengan `p_halaman` TERISI,
  // jadi mengosongkan (yang seharusnya sudah kosong dari langkah
  // sebelumnya) lalu mengisi set yang baru. `digital_product_pages` tidak
  // punya hak INSERT langsung lagi (migration `produk_hapus_isi`), jadi ini
  // satu-satunya jalur tulis yang tersisa.
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("ganti_halaman_produk", {
    p_product_id: productId,
    p_halaman: halaman.map((h) => ({ halaman: h.halaman, objek: h.objek })),
  });
  // Otorisasi RPC gagal lewat EXCEPTION (`raise exception`), bukan lewat
  // baris kosong — beda dari tulisan langsung ke tabel (PostgREST 200 + []
  // untuk RLS yang menolak), jadi tidak ada lagi "panjang data === 0" yang
  // perlu diperiksa terpisah di sini.
  if (error) return { ok: false, pesan: `Gagal menyimpan halaman (${error.code}).` };

  revalidatePath(`/admin/produk/${productId}`);
  return { ok: true, jumlah: halaman.length };
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

  // Salinan tercap para pembeli dikosongkan DI SINI — SEBELUM sumbernya
  // tertimpa, bukan sesudah. Dua alasan, dan keduanya soal kegagalan:
  //
  //   1. Kegagalannya INERT. Kalau unggahan yang diizinkan URL ini tidak pernah
  //      terjadi (admin membatalkan, koneksi putus), yang hilang cuma salinan
  //      yang bisa dicap ulang dari sumber lama — tidak ada yang rusak.
  //   2. Menempatkannya di `catatPdfProduk` justru MELUBANGI pagarnya:
  //      unggahan ke storage sudah selesai saat action itu dipanggil, dan
  //      peramban yang tidak pernah memanggilnya (tab ditutup di detik yang
  //      salah) meninggalkan sumber BARU berdampingan dengan salinan tercap
  //      LAMA — persis keadaan yang perbaikan ini ada untuk mencegah.
  if (await hapusSalinanPembeli(admin, productId)) {
    return {
      ok: false,
      pesan:
        "Gagal membersihkan salinan unduhan pembeli yang lama. Unggahan dibatalkan supaya pembeli tidak menerima berkas versi lama — coba lagi.",
    };
  }

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
 * (`admin/materi/aksi.ts`). Kedua tabel di sini tidak lagi terhapus lewat
 * DELETE langsung (lihat migration `produk_hapus_isi`): baris dihapus lewat
 * RPC (`lepas_berkas_produk` / `ganti_halaman_produk`), yang MEMULANGKAN
 * kunci objeknya lewat `returning` — bukan dibaca via SELECT terpisah
 * sebelum RPC dipanggil, yang adalah balapan dengan dirinya sendiri (baris
 * bisa berubah di antara SELECT dan DELETE). Kegagalan menghapus objek
 * SESUDAH baris lenyap adalah mode gagal LUNAK (objek yatim), dilaporkan
 * lewat `objekTersisa`, bukan ditelan diam.
 *
 * Untuk PDF, cabang ini menyentuh DUA baris (`digital_product_pages` DAN
 * `digital_product_files`) dan DUA bucket storage. Pembersihan objek
 * halaman dijalankan SEGERA sesudah `digital_product_pages` kosong, TIDAK
 * ditunda sampai `digital_product_files` juga selesai dihapus — lihat
 * komentar di titik itu untuk alasan lengkap: dua penghapusan itu independen,
 * dan menyandera satu pada suksesnya yang lain membuka kembali persis
 * kegagalan yang urutan "baris dulu, objek belakangan" ada untuk mencegah.
 *
 * Untuk PDF, dibersihkan juga SELURUH salinan tercap pembeli
 * (`<produk>/pembeli/**`) — objek yang tidak punya baris sama sekali, jadi
 * tidak ada yang akan mengingatnya bila dilewatkan di sini.
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
    // `returning objek` di dalam RPC memulangkan kunci objek lama LANGSUNG
    // dari pernyataan DELETE-nya sendiri — tidak ada SELECT terpisah di sini
    // yang bisa balapan dengan DELETE-nya.
    const { data: lama, error: delError } = await supabase.rpc("lepas_berkas_produk", {
      p_product_id: productId,
    });
    if (delError) return { ok: false, pesan: `Gagal melepas video (${delError.code}).` };

    let objekTersisa = false;
    const objek = lama?.[0]?.objek;
    if (objek) {
      try {
        await hapusObjekVideo(objek);
      } catch {
        objekTersisa = true;
      }
    }
    revalidatePath(`/admin/produk/${productId}`);
    return { ok: true, objekTersisa };
  }

  // jenis === "pdf": halaman terasterisasi DAN berkas PDF utuh (bila ada).
  // `p_halaman: []` mengosongkan tanpa mengisi ulang — sama pemakaian
  // dengan `terbitkanUrlUnggahHalamanProduk` — dan memulangkan objek baris
  // yang barusan lenyap lewat `returning`.
  const { data: halamanLama, error: delHalaman } = await supabase.rpc("ganti_halaman_produk", {
    p_product_id: productId,
    p_halaman: [],
  });
  if (delHalaman) return { ok: false, pesan: `Gagal mengosongkan halaman (${delHalaman.code}).` };

  const admin = createAdminSupabase();
  let objekTersisa = false;

  // Objek halaman dibersihkan DI SINI — SEGERA sesudah barisnya kosong, TIDAK
  // digantungkan pada sukses-tidaknya penghapusan `digital_product_files` di
  // bawah. Nama objeknya sudah di tangan (dipulangkan RPC lewat `returning`,
  // BUKAN dibaca via SELECT terpisah); begitu barisnya lenyap, itu
  // satu-satunya kesempatan untuk membersihkannya — percobaan berikutnya
  // memanggil RPC yang sama dan menemukan NOL baris untuk dihapus, sehingga
  // blok pembersihan storage tidak pernah jalan lagi. Dua penghapusan
  // (baris `digital_product_files` dan objek halaman) adalah dua hal yang
  // TIDAK SALING BERGANTUNG — JANGAN menyandera satu pada suksesnya yang
  // lain. Inilah persis mode gagal yang urutan "baris dulu, objek
  // belakangan" di seluruh berkas ini ada untuk mencegah, dan menggabungkan
  // dua tabel dalam satu urutan gagal-berhenti diam-diam membukanya kembali.
  const objekHalamanLama = (halamanLama ?? []).map((r: { objek: string }) => r.objek);
  if (objekHalamanLama.length > 0) {
    const { error: hapusHalaman } = await admin.storage
      .from(BUCKET_HALAMAN)
      .remove(objekHalamanLama);
    if (hapusHalaman) objekTersisa = true;
  }

  const { data: berkasLama, error: delBerkas } = await supabase.rpc("lepas_berkas_produk", {
    p_product_id: productId,
  });
  if (delBerkas) {
    return {
      ok: false,
      pesan: objekTersisa
        ? `Halaman dilepas, tetapi sebagian objek halaman DAN baris berkas PDF gagal dihapus (${delBerkas.code}). Beri tahu tim teknis agar tidak menumpuk.`
        : `Halaman sudah kosong, tetapi berkas PDF gagal dilepas (${delBerkas.code}).`,
    };
  }

  const objekPdf = berkasLama?.[0]?.objek;
  if (objekPdf) {
    const { error: hapusBerkas } = await admin.storage
      .from(BUCKET_BERKAS)
      .remove([objekPdf]);
    if (hapusBerkas) objekTersisa = true;
  }

  // Salinan tercap pembeli dibersihkan TANPA SYARAT, tidak digantungkan pada
  // `objekPdf` di atas: barisnya sudah lenyap sejak `lepas_berkas_produk`, jadi
  // nama-nama itu tidak akan pernah tercatat lagi di mana pun. Kalau ia hanya
  // dijalankan saat berkas sumbernya masih ada, produk yang barisnya sudah
  // terlanjur hilang (mis. percobaan lepas sebelumnya yang gagal separuh)
  // menyimpan salinan tercapnya selamanya, tak terjangkau siapa pun.
  if (await hapusSalinanPembeli(admin, productId)) objekTersisa = true;

  revalidatePath(`/admin/produk/${productId}`);
  return { ok: true, objekTersisa };
}
