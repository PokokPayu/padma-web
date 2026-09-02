"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { namaObjekHalaman, MAKS_HALAMAN } from "@/lib/materi/rasterisasi";

const BUCKET = "materi-halaman";

type Gagal = { ok: false; pesan: string };

export type Unggahan = { halaman: number; objek: string; token: string };

/**
 * Menerbitkan signed upload URL untuk seluruh halaman sekaligus.
 *
 * Berkasnya TIDAK menumpang server kita: Vercel membatasi body request 4,5 MB,
 * dan satu ebook bisa ratusan halaman. Browser admin mengunggah langsung ke
 * Storage memakai token di bawah.
 *
 * Path setiap objek ditentukan DI SINI, bukan dikirim browser. Browser yang
 * memilih path adalah browser yang bisa menimpa objek materi lain.
 */
export async function terbitkanUrlUnggahHalaman(
  materiId: string,
  jumlahHalaman: number,
): Promise<{ ok: true; unggahan: Unggahan[] } | Gagal> {
  await requireRole(["admin", "owner"]);

  if (!Number.isInteger(jumlahHalaman) || jumlahHalaman < 1) {
    return { ok: false, pesan: "Jumlah halaman tidak sah." };
  }
  if (jumlahHalaman > MAKS_HALAMAN) {
    return { ok: false, pesan: `PDF maksimal ${MAKS_HALAMAN} halaman.` };
  }

  // Materi harus ada, dan pemeriksaannya lewat sesi pengguna supaya RLS staf
  // yang memutuskan — bukan service role.
  const supabase = await createServerSupabase();
  const { data: materi } = await supabase
    .from("materials").select("id").eq("id", materiId).maybeSingle();
  if (!materi) return { ok: false, pesan: "Materi tidak ditemukan." };

  const admin = createAdminSupabase();

  // Baris dikosongkan LEBIH DULU, baru objek storage-nya — sengaja dibalik
  // dari urutan yang terasa wajar ("hapus objek dulu, baru barisnya"). Kedua
  // urutan berakhir sama saat SUKSES; bedanya ada di jalur GAGAL.
  //
  // Bila RPC pengosongan ini yang gagal (blip PostgREST, timeout, koneksi
  // habis), belum satu objek pun tersentuh — keadaan lama utuh, dan mengulang
  // percobaan ini bersih tanpa sisa. Kegagalannya jadi INERT.
  //
  // Urutan LAMA (objek dihapus dulu, baris belakangan) membuat kegagalan di
  // titik ini berarti objek sudah lenyap sementara baris lama masih
  // menunjuknya: pasien melihat halaman rusak sementara panel admin
  // menyatakan materi ini berisi — dan pesan galatnya saat itu tidak bisa
  // dibedakan dari kegagalan yang aman. Membalik urutan menutup keadaan itu
  // sepenuhnya: satu-satunya mode gagal yang tersisa sesudah baris ini adalah
  // penghapusan objek di bawah gagal SESUDAH baris sudah kosong — lunak,
  // karena materi sudah jujur terbaca "belum ada isi" dan objek yatimnya
  // dibersihkan sendiri oleh percobaan berikutnya (lihat komentar di bawah).
  const { error: bersih } = await supabase.rpc("ganti_halaman_materi", {
    p_material_id: materiId,
    p_halaman: [],
  });
  if (bersih) {
    return {
      ok: false,
      pesan: "Gagal mengosongkan halaman lama. Materi belum berubah — coba lagi.",
    };
  }

  // Objek lama dibersihkan SESUDAH barisnya kosong (lihat urutan di atas).
  // Tujuannya tidak berubah dari semula: unggahan sebelumnya yang gagal di
  // tengah meninggalkan sampah, dan halaman lama yang tersisa akan bercampur
  // dengan yang baru bila PDF penggantinya lebih pendek.
  //
  // `.list()` TANPA opsi hanya menjawab 100 objek pertama (default
  // storage-js: `{ limit: 100, offset: 0 }`) — pernah ditemukan lewat e-book
  // 300 halaman yang diunggah ulang: objek `0001..0100` tersapu, `0101..0300`
  // selamat, dan setiap percobaan ulang mengulang persis itu (urutan menaik
  // selalu mengembalikan seratus PERTAMA yang sama). Di-loop pakai `offset`
  // supaya SELURUH objek ditemukan berapa pun jumlah halamannya — jangan
  // berasumsi jumlah halaman muat dalam satu panggilan.
  //
  // Hasil `.remove()` WAJIB ditangkap (dulu dibuang total, tanpa
  // destructure). Kegagalannya di titik ini adalah mode gagal LUNAK — tapi
  // lunak tidak berarti boleh senyap. Admin dan pemantauan berhak tahu objek
  // yatim mungkin tersisa, lewat pesan yang berbeda dari kegagalan di atas,
  // bukan sekadar diam seolah tidak terjadi apa-apa.
  const LIMIT_LIST = 1000;
  const lama: Array<{ name: string }> = [];
  for (let offset = 0; ; offset += LIMIT_LIST) {
    const { data: potongan } = await admin.storage
      .from(BUCKET)
      .list(materiId, { limit: LIMIT_LIST, offset });
    if (!potongan || potongan.length === 0) break;
    lama.push(...potongan);
    if (potongan.length < LIMIT_LIST) break;
  }
  if (lama.length > 0) {
    const { error: hapus } = await admin.storage
      .from(BUCKET)
      .remove(lama.map((o) => `${materiId}/${o.name}`));
    if (hapus) {
      return {
        ok: false,
        pesan:
          "Halaman lama sudah kosong, tetapi sebagian objek lama gagal dihapus. Aman diunggah ulang.",
      };
    }
  }

  const unggahan: Unggahan[] = [];
  for (let halaman = 1; halaman <= jumlahHalaman; halaman++) {
    const objek = namaObjekHalaman(materiId, halaman);
    // `{ upsert: true }` WAJIB di sini, dan penolakannya terjadi LEBIH AWAL
    // daripada yang mungkin diduga: bukan saat browser mem-PUT, melainkan saat
    // `createSignedUploadUrl` ini dipanggil. Tanpa upsert, memintanya untuk
    // path yang objeknya masih ada mengembalikan `error` — jadi fungsi ini
    // berhenti di `return { ok: false }` di bawah dan tidak pernah melempar
    // exception. (Dibuktikan empiris di tests/materi-unggah-lib.test.ts.)
    //
    // Itulah kombinasi yang dulu membuat unggah ulang e-book >100 halaman
    // gagal permanen: baris sudah dikosongkan di atas, tetapi objek lama di
    // luar seratus pertama selamat dari `.remove()` (sebelum `.list()`
    // dipaginasi), sehingga penerbitan URL untuk halaman 101 ditolak,
    // `catatHalamanMateri` tidak pernah jalan, dan materi berakhir NOL
    // halaman — dengan setiap ulangan berperilaku sama.
    //
    // Path objeknya tetap ditentukan server (lihat dokblok fungsi ini):
    // `upsert` hanya mengizinkan penimpaan path yang KITA sendiri namai, dan
    // `catatHalamanMateri` menolak `objek` apa pun yang tidak sama dengan nama
    // turunan server itu.
    const { data, error } = await admin.storage
      .from(BUCKET)
      .createSignedUploadUrl(objek, { upsert: true });
    if (error || !data) {
      return { ok: false, pesan: "Gagal menyiapkan unggahan. Coba lagi." };
    }
    unggahan.push({ halaman, objek, token: data.token });
  }
  return { ok: true, unggahan };
}

/**
 * Mencatat seluruh halaman SEKALIGUS, sesudah semua unggahan sukses.
 *
 * Dipanggil sekali di akhir, bukan per halaman: bila unggahan gagal di tengah,
 * fungsi ini tidak pernah jalan dan materinya tampak "belum ada isi" di panel —
 * bukan setengah terisi, yang jauh lebih sulit disadari.
 */
export async function catatHalamanMateri(
  materiId: string,
  halaman: Array<{ halaman: number; objek: string; lebar: number; tinggi: number }>,
): Promise<{ ok: true; jumlah: number } | Gagal> {
  await requireRole(["admin", "owner"]);

  if (halaman.length === 0) return { ok: false, pesan: "Tidak ada halaman." };
  if (halaman.length > MAKS_HALAMAN) {
    return { ok: false, pesan: `PDF maksimal ${MAKS_HALAMAN} halaman.` };
  }
  // Objek yang dicatat harus objek yang KITA namai. Nama lain berarti browser
  // menunjuk objek yang bukan miliknya.
  for (const h of halaman) {
    if (h.objek !== namaObjekHalaman(materiId, h.halaman)) {
      return { ok: false, pesan: "Nama objek halaman tidak sah." };
    }
  }

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("ganti_halaman_materi", {
    p_material_id: materiId,
    p_halaman: halaman,
  });
  if (error) return { ok: false, pesan: "Gagal menyimpan halaman materi." };

  revalidatePath("/admin/materi");
  return { ok: true, jumlah: (data as number) ?? 0 };
}
