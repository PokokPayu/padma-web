"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { hapusObjekVideo } from "@/lib/r2";
import {
  LABEL_ISI,
  periksaDeskripsi,
  periksaJudul,
  periksaTipe,
  type TipeMateri,
} from "./status";

/**
 * Jalur tulis panel admin untuk materi panduan.
 *
 * Tujuh aturan yang mengikat berkas ini:
 *
 *  1. Server action adalah ENDPOINT POST TERSENDIRI. Penjaga di
 *     `src/app/admin/layout.tsx` tidak pernah dilewati saat action dipanggil
 *     langsung, jadi `requireRole(["admin","owner"])` ditulis DI DALAM setiap
 *     action — bukan sekali di puncak modul.
 *
 *  2. METADATA & ISI TIDAK PERNAH SATU AKSI, UNTUK KEDUA TIPE. Sejak Task 6,
 *     video juga berupa BERKAS yang diunggah ke R2 (lewat
 *     `<PengunggahVideo materiId=... />`, lihat `./unggah-video.ts`) — bukan
 *     lagi URL yang bisa disertakan langsung di sini. Isinya karena itu SAMA
 *     PERSIS dengan e-book (`<PengunggahPdf materiId=... />`, Task 11): kedua
 *     unggahan BUTUH `materiId` yang belum ada pada langkah "materi baru",
 *     jadi materi `ebook` MAUPUN `video` SELALU lahir tanpa isi. Jaminan
 *     GAGAL-TERTUTUP di bawah (3) yang menjaga tidak satu pun jalur di berkas
 *     ini bisa menerbitkan materi kosong.
 *
 *  3. MATERI LAHIR NONAKTIF. Insert `materials` dan unggahan isinya adalah
 *     dua permintaan yang benar-benar terpisah — bukan sekadar tanpa
 *     transaksi, isinya bahkan menunggu round-trip peramban admin lain
 *     (unggahan berkas) — dan hak DELETE atas `materials` sudah dicabut
 *     sehingga tidak ada jalan mundur. Jadi urutannya dibuat GAGAL-TERTUTUP:
 *     baris lahir `aktif = false` untuk KEDUA tipe, tanpa pengecualian, dan
 *     hanya menerbit lewat `aktifkanMateri` (4) sesudah isinya benar-benar
 *     ada — tidak terlihat klien sampai saat itu, dan bisa diperbaiki dari
 *     halaman ini, bukan kartu yang berbohong.
 *
 *  4. `aktifkanMateri` MENOLAK materi tanpa isi. Tanpa itu, pagar (2) & (3)
 *     bisa dilewati hanya dengan satu klik lanjutan.
 *
 *  5. TIDAK ADA PENGHAPUSAN LEWAT VERBA DELETE. Hak DELETE atas `materials`
 *     dan `material_videos` sudah dicabut dari peran API: jawabannya
 *     403/42501, bukan "0 baris". Video hanya bisa dilepas lewat RPC
 *     berparameter tunggal `lepas_video_materi(materi_id)` — nama argumennya
 *     MENGIKAT (salah nama menghasilkan 404 PGRST202, bukan 400), dan
 *     `data === null` berarti "tidak ada yang cocok", yaitu SUKSES. Halaman
 *     e-book memakai pola serupa tapi lewat RPC-nya SENDIRI
 *     (`ganti_halaman_materi`, lihat `./unggah.ts`) — bukan verba di berkas ini.
 *
 *  6. UPDATE yang tertahan dijawab PostgREST 200 + []. Melaporkan "berhasil"
 *     tanpa memeriksa panjangnya adalah kebohongan senyap.
 *
 *  7. Sesi pengguna, bukan service role. Di bawah service role `user_role()`
 *     mengembalikan 'klien' dan `auth.uid()` NULL: policy "materials: staf
 *     kelola", "materi-layanan: staf kelola", dan "video: staf" tidak pernah
 *     ikut diperiksa.
 *
 * Berkas `"use server"` hanya boleh mengekspor fungsi async — label, batas, dan
 * validator murni tinggal di `./status`.
 */
type Gagal = { ok: false; pesan: string };
type Dibuat = { ok: true; id: string };
type Berhasil = { ok: true };

/**
 * Kanal yang membaca materi. Daftar materi klien dan reader-nya membaca tabel
 * yang sama: materi baru yang tidak merambat ke sana adalah materi yang tidak
 * pernah ada bagi klien.
 */
function segarkanMateri(materiId?: string) {
  revalidatePath("/admin/materi");
  revalidatePath("/passport/materi");
  if (materiId) revalidatePath(`/passport/materi/${materiId}`);
}

async function layananAda(layananId: string): Promise<boolean> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("services")
    .select("id")
    // Operator setara, tidak pernah pola.
    .eq("id", layananId)
    .maybeSingle();
  return data !== null;
}

/**
 * Menulis ulang seluruh tautan layanan sebuah materi lewat hapus-lalu-sisip
 * yang RADIUSNYA TERIKAT `materiId` — parameter wajib, bukan filter yang bisa
 * dibuat tautologis. Repo ini pernah kehilangan SELURUH bab materi lewat satu
 * filter longgar (`?urutan=gte.0`); `.eq("material_id", materiId)` di bawah
 * adalah pelajaran itu diterapkan di sini.
 *
 * DELETE-nya diperiksa lewat jumlah baris SEBELUM vs SESUDAH, bukan sekadar
 * `error`. Tidak seperti INSERT (di bawah), tidak ada angka "seharusnya N
 * baris" yang diketahui lebih dulu untuk DELETE ini — materi boleh memang
 * tidak punya tautan sama sekali. PostgREST menjawab 200 + [] baik untuk
 * "tidak ada baris yang cocok" MAUPUN "ada baris tapi RLS menolaknya" — dua
 * keadaan yang tidak bisa dibedakan hanya dari respons DELETE itu sendiri.
 * Menghitung dulu (`sebelum`) lalu membandingkan dengan baris yang benar-
 * benar terhapus (`.select()`) membedakan keduanya: bila keduanya sama,
 * seluruh baris lama benar-benar hilang; bila lebih kecil, sebagian tertahan
 * diam-diam.
 */
async function gantiLayananMateri(
  materiId: string,
  idLayanan: string[],
): Promise<Berhasil | Gagal> {
  const supabase = await createServerSupabase();

  const { count: sebelum } = await supabase
    .from("material_services")
    .select("material_id", { count: "exact", head: true })
    .eq("material_id", materiId);

  const { data: terhapus, error: hapus } = await supabase
    .from("material_services")
    .delete()
    .eq("material_id", materiId) // radius terikat SATU materi
    .select("material_id");
  if (hapus || (terhapus ?? []).length !== (sebelum ?? 0)) {
    return { ok: false, pesan: "Gagal memperbarui layanan materi." };
  }

  if (idLayanan.length === 0) return { ok: true };

  const { data, error } = await supabase
    .from("material_services")
    .insert(idLayanan.map((service_id) => ({ material_id: materiId, service_id })))
    .select("material_id");
  // PostgREST menjawab 200 + [] untuk tulis yang ditolak RLS, bukan error.
  if (error || !data || data.length !== idLayanan.length) {
    return { ok: false, pesan: "Gagal menyimpan layanan materi." };
  }
  return { ok: true };
}

type Materi = { id: string; tipe: TipeMateri; aktif: boolean };

async function ambilMateri(id: string): Promise<Materi | null> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("materials")
    .select("id, tipe, aktif")
    .eq("id", id)
    .maybeSingle<Materi>();
  return data ?? null;
}

/** Apakah materi ini sudah punya isi yang sesuai tipenya? */
async function punyaIsi(id: string, tipe: TipeMateri): Promise<boolean> {
  const supabase = await createServerSupabase();
  if (tipe === "ebook") {
    // Isi e-book kini gambar halaman (material_pages), bukan bab teks.
    const { count } = await supabase
      .from("material_pages")
      .select("material_id", { count: "exact", head: true })
      .eq("material_id", id);
    return (count ?? 0) > 0;
  }
  const { data } = await supabase
    .from("material_videos")
    .select("material_id")
    .eq("material_id", id)
    .maybeSingle();
  return data !== null;
}

// ---------------------------------------------------------------------------
// Materi
// ---------------------------------------------------------------------------

/**
 * Mendaftarkan materi baru.
 *
 * Layanan: nol atau lebih. Kosong adalah pilihan SAH — admin wajar ingin
 * menumpuk bahan dulu, dan materi tanpa layanan tetap bisa dibuka lewat
 * penugasan. Daftar materi menandainya "Tanpa layanan · hanya lewat assign"
 * supaya keadaan itu terlihat, bukan tersembunyi.
 */
export async function simpanMateri(formData: FormData): Promise<Dibuat | Gagal> {
  await requireRole(["admin", "owner"]);

  const idLayanan = formData
    .getAll("service_id")
    .map((v) => String(v).trim())
    .filter((v) => v.length > 0);
  const judul = periksaJudul(String(formData.get("judul") ?? ""));
  const tipe = periksaTipe(String(formData.get("tipe") ?? ""));
  const deskripsi = periksaDeskripsi(String(formData.get("deskripsi") ?? ""));

  if (!judul.ok) return { ok: false, pesan: `Judul materi: ${judul.pesan}` };
  if (!tipe.ok) return { ok: false, pesan: tipe.pesan };
  if (!deskripsi.ok) return { ok: false, pesan: deskripsi.pesan };

  // Isi TIDAK diperiksa di sini untuk KEDUA tipe. E-book (gambar halaman) dan,
  // sejak Task 6, video (berkas R2) sama-sama diunggah lewat komponennya
  // sendiri (`PengunggahPdf`/`PengunggahVideo`), dan unggahan itu butuh
  // materiId yang belum ada di langkah ini: materi karena itu SELALU lahir
  // nonaktif tanpa isi, isinya menyusul lewat panel "Kelola isi" begitu id-nya
  // ada.

  // Setiap id layanan diperiksa keberadaannya. FK memang menolak yang tidak
  // ada, tetapi yang sampai ke layar admin dari FK hanyalah kode 23503.
  for (const id of idLayanan) {
    if (!(await layananAda(id))) {
      return { ok: false, pesan: "Layanan yang dipilih tidak ditemukan." };
    }
  }

  const supabase = await createServerSupabase();

  // `aktif: false` ditulis MATI di sini — kebalikan dari modul Layanan, dan
  // sengaja, untuk KEDUA tipe: isinya (halaman ebook atau berkas video)
  // menyusul lewat unggahan terpisah sesudah id ini ada.
  const { data, error } = await supabase
    .from("materials")
    .insert({
      judul: judul.nilai,
      tipe: tipe.nilai,
      deskripsi: deskripsi.nilai,
      aktif: false,
    })
    .select("id")
    .single();

  if (error || !data) return { ok: false, pesan: "Gagal menyimpan materi." };
  const id = data.id as string;

  const layananHasil = await gantiLayananMateri(id, idLayanan);
  if (!layananHasil.ok) {
    segarkanMateri(id);
    return {
      ok: false,
      pesan: "Materi tersimpan NONAKTIF karena layanannya gagal ditautkan. Atur layanannya, lalu lengkapi isinya.",
    };
  }

  // Materinya sengaja tetap nonaktif di sini, untuk KEDUA tipe. Isinya
  // diunggah lewat PengunggahPdf atau PengunggahVideo sesudah materiId ini
  // ada (panel "Kelola isi"), lalu diterbitkan lewat aktifkanMateri — yang
  // menolak menerbitkan materi tanpa satu pun halaman/video.

  segarkanMateri(id);
  return { ok: true, id };
}

/**
 * Mengubah identitas materi — dan, bila `tipe` berpindah, memastikan ISI
 * tipe barunya sudah ada sebelum perpindahan itu diizinkan.
 *
 * `ebook` → `video` tanpa berkas, atau `video` → `ebook` tanpa satu pun
 * halaman, adalah bentuk paling halus dari materi setengah jadi: tipe
 * berpindah, isi lama menjadi tidak terpakai, dan seluruh klien yang berhak
 * melihat kartu terkunci selamanya tanpa satu pun error.
 *
 * Sejak Task 6, `ebook` MAUPUN `video` sama-sama isinya berkas yang diunggah
 * lewat komponennya sendiri (`PengunggahPdf`/`PengunggahVideo`) — sesuatu
 * yang tidak bisa terjadi di dalam SATU permintaan server action. Karena itu
 * perpindahan ke tipe manapun hanya diterima bila materi ITU SENDIRI sudah
 * punya isi tipe tujuannya (sisa unggahan sebelumnya, atau baru saja
 * diunggah admin lewat panel "Kelola isi" SEBELUM formulir ini disimpan —
 * keduanya memakai `materiId` yang sama, jadi urutan itu sah): kedua cabang
 * di bawah memeriksa lewat `punyaIsi(id, ...)` yang bentuknya sama persis.
 * Isi lama yang tidak lagi cocok tipenya SENGAJA tidak disapu — penghapusannya
 * punya jalurnya sendiri, dan isi yang tertinggal tidak pernah terbaca karena
 * reader memilih bentuk tampilan menurut `tipe`.
 */
export async function perbaruiMateri(
  id: string,
  formData: FormData,
): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);

  const idLayanan = formData
    .getAll("service_id")
    .map((v) => String(v).trim())
    .filter((v) => v.length > 0);
  const judul = periksaJudul(String(formData.get("judul") ?? ""));
  const tipe = periksaTipe(String(formData.get("tipe") ?? ""));
  const deskripsi = periksaDeskripsi(String(formData.get("deskripsi") ?? ""));

  if (!judul.ok) return { ok: false, pesan: `Judul materi: ${judul.pesan}` };
  if (!tipe.ok) return { ok: false, pesan: tipe.pesan };
  if (!deskripsi.ok) return { ok: false, pesan: deskripsi.pesan };

  const materi = await ambilMateri(id);
  if (!materi) return { ok: false, pesan: "Materi tidak ditemukan." };

  for (const layananId of idLayanan) {
    if (!(await layananAda(layananId))) {
      return { ok: false, pesan: "Layanan yang dipilih tidak ditemukan." };
    }
  }

  const supabase = await createServerSupabase();
  const pindahTipe = tipe.nilai !== materi.tipe;

  if (pindahTipe) {
    // Kedua cabang memeriksa BENTUK YANG SAMA (`punyaIsi`): tidak ada lagi
    // jalur "isi disertakan langsung di aksi ini" untuk video sejak isinya
    // jadi berkas R2, bukan URL.
    if (tipe.nilai === "video") {
      if (!(await punyaIsi(id, "video"))) {
        return {
          ok: false,
          pesan: `Mengubah tipe ke Video wajib disertai ${LABEL_ISI.video}. Simpan tipenya di sini, lalu unggah videonya lewat "Kelola isi" sebelum menerbitkan materinya.`,
        };
      }
    } else if (!(await punyaIsi(id, "ebook"))) {
      return {
        ok: false,
        pesan: `Mengubah tipe ke E-Book wajib disertai ${LABEL_ISI.ebook}. Simpan tipenya di sini, lalu unggah PDF-nya lewat "Kelola isi" sebelum menerbitkan materinya.`,
      };
    }
  }

  const layananHasil = await gantiLayananMateri(id, idLayanan);
  if (!layananHasil.ok) {
    segarkanMateri(id);
    return layananHasil;
  }

  // Medan `aktif` yang ikut dikirim browser diabaikan tanpa pernah masuk
  // payload — keadaan materi punya action tersendiri.
  const { data, error } = await supabase
    .from("materials")
    .update({
      judul: judul.nilai,
      tipe: tipe.nilai,
      deskripsi: deskripsi.nilai,
    })
    .eq("id", id)
    .select("id");

  if (error || (data ?? []).length === 0) {
    return { ok: false, pesan: "Materi tidak ditemukan atau gagal diperbarui." };
  }

  segarkanMateri(id);
  return { ok: true };
}

/**
 * Menerbitkan materi.
 *
 * Penjaga isinya bukan kemewahan: tanpa itu, seluruh pemeriksaan di
 * `simpanMateri` dan `perbaruiMateri` bisa dilewati dengan satu klik lanjutan
 * pada materi yang isinya sudah dilepas.
 */
export async function aktifkanMateri(id: string): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);

  const materi = await ambilMateri(id);
  if (!materi) return { ok: false, pesan: "Materi tidak ditemukan." };
  if (!(await punyaIsi(id, materi.tipe))) {
    return {
      ok: false,
      pesan: `Materi ini belum punya isi (${LABEL_ISI[materi.tipe]}). Lengkapi isinya lebih dulu — materi kosong tampil sebagai kartu terkunci yang tidak akan pernah terbuka.`,
    };
  }

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("materials")
    .update({ aktif: true })
    .eq("id", id)
    .select("id");

  if (error || (data ?? []).length === 0) {
    return { ok: false, pesan: "Gagal mengaktifkan materi." };
  }

  segarkanMateri(id);
  return { ok: true };
}

/**
 * Menarik materi.
 *
 * Sejak migration `gating_materi_hormati_aktif`, ini benar-benar menutup
 * isinya: policy baca klien pada `material_pages` & `material_videos` ikut
 * mengevaluasi `materials.aktif`, jadi halamannya hilang dari jawaban
 * PostgREST — bukan sekadar dari kartu di UI. Baris `materials` sendiri
 * tetap terbaca, dan itu disengaja: menutupnya akan mengulangi bug
 * `partner_publik`.
 */
export async function nonaktifkanMateri(id: string): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from("materials")
    .update({ aktif: false })
    .eq("id", id)
    .select("id");

  if (error || (data ?? []).length === 0) {
    return { ok: false, pesan: "Gagal menonaktifkan materi." };
  }

  segarkanMateri(id);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Video
// ---------------------------------------------------------------------------

/**
 * Melepas video dari materi.
 *
 * Lewat RPC berparameter tunggal `lepas_video_materi(materi_id)` — verba DELETE
 * atas `material_videos` sudah dicabut, dan `material_videos.material_id`
 * adalah PRIMARY KEY sehingga satu panggilan mengunci tepat satu baris. Nama
 * argumen `materi_id` MENGIKAT.
 *
 * Ditolak selama materinya masih terbit: materi video tanpa barisnya adalah
 * kartu terkunci yang tidak akan pernah terbuka, tanpa satu pun error.
 *
 * Menggantikan video BUKAN lewat aksi ini — `PengunggahVideo` (Task 6) mencatat
 * objek barunya lewat `catatVideoMateri` (`./unggah-video.ts`), yang sudah
 * menimpa barisnya sendiri lewat upsert dan membereskan objek R2 lama. `lepasVideo`
 * ini hanya untuk melepas isi tanpa unggahan pengganti.
 *
 * Objek R2-nya kini ikut dihapus (fix F2, video-r2 fix wave) — sebelumnya
 * fungsi ini HANYA menghapus baris `material_videos` lewat RPC, dan baris itu
 * adalah SATU-SATUNYA catatan kunci objeknya: begitu baris lenyap, objeknya
 * tertinggal di bucket selamanya, tidak bisa ditemukan siapa pun lagi — persis
 * kelas kegagalan yang komentar `catatVideoMateri` (`./unggah-video.ts`)
 * sebut tidak bisa diterima. Urutannya mengikat, dan SIMETRIS dengan urutan
 * `catatVideoMateri`: kunci objek dibaca SEBELUM baris dihapus, objeknya baru
 * dihapus SESUDAH baris terbukti lenyap. Kebalikannya (hapus objek dulu) bisa
 * meninggalkan baris yang menunjuk objek yang sudah tidak ada bila RPC-nya
 * gagal sesudah itu — pasien mendapat pemutar yang menunjuk ke ketiadaan.
 * Kegagalan hapus objek dilaporkan lewat `objekTersisa`, tidak ditelan diam.
 */
export async function lepasVideo(
  materiId: string,
): Promise<{ ok: true; objekTersisa: boolean } | Gagal> {
  await requireRole(["admin", "owner"]);

  const materi = await ambilMateri(materiId);
  if (!materi) return { ok: false, pesan: "Materi tidak ditemukan." };
  if (materi.aktif) {
    return {
      ok: false,
      pesan: "Nonaktifkan materinya lebih dulu. Materi video yang terbit tanpa video tampil sebagai kartu terkunci yang tidak akan pernah terbuka.",
    };
  }

  const supabase = await createServerSupabase();

  // Kunci objek dibaca SEBELUM RPC menghapus barisnya — sesudah baris itu
  // lenyap, kunci objeknya lenyap bersamanya dan tidak ada lagi cara
  // menemukan objek mana yang harus dihapus dari R2.
  const { data: lama } = await supabase
    .from("material_videos").select("objek").eq("material_id", materiId).maybeSingle();

  const { error } = await supabase.rpc("lepas_video_materi", { materi_id: materiId });
  if (error) return { ok: false, pesan: "Gagal melepas video materi." };

  // Objek dihapus SESUDAH baris terbukti lenyap (lihat dokblok fungsi).
  let objekTersisa = false;
  if (lama?.objek) {
    try {
      await hapusObjekVideo(lama.objek);
    } catch {
      objekTersisa = true;
    }
  }

  segarkanMateri(materiId);
  return { ok: true, objekTersisa };
}
