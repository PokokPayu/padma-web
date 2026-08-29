"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  LABEL_ISI,
  periksaDeskripsi,
  periksaIsiBab,
  periksaJudul,
  periksaTipe,
  periksaUrlVideo,
  periksaUrutan,
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
 *  2. METADATA DAN ISI DISIMPAN DALAM SATU AKSI. Materi bertipe `video` tanpa
 *     baris `material_videos` — atau `ebook` tanpa satu pun bab — terkunci
 *     SELAMANYA bagi setiap klien yang sebenarnya berhak, tanpa satu pun error,
 *     sementara kartunya berbunyi "Terbuka setelah layanan terkait selesai"
 *     padahal layanannya sudah selesai. Karena itu isinya divalidasi SEBELUM
 *     baris apa pun lahir, dan mengubah `tipe` wajib disertai isi tipe barunya.
 *
 *  3. MATERI LAHIR NONAKTIF. Insert `materials` dan insert isinya adalah dua
 *     permintaan; tidak ada transaksi yang membungkusnya, dan hak DELETE atas
 *     `materials` sudah dicabut sehingga tidak ada jalan mundur. Jadi urutannya
 *     dibuat GAGAL-TERTUTUP: baris lahir `aktif = false`, isinya dipasang, dan
 *     hanya sesudah isi mendarat materinya diterbitkan. Kegagalan di tengah
 *     menyisakan materi nonaktif — tidak terlihat klien, dan bisa diperbaiki
 *     dari halaman ini — bukan kartu yang berbohong.
 *
 *  4. `aktifkanMateri` MENOLAK materi tanpa isi. Tanpa itu, pagar (2) & (3)
 *     bisa dilewati hanya dengan satu klik lanjutan.
 *
 *  5. TIDAK ADA PENGHAPUSAN LEWAT VERBA DELETE. Hak DELETE atas `materials`,
 *     `material_chapters`, dan `material_videos` sudah dicabut dari peran API:
 *     jawabannya 403/42501, bukan "0 baris". Penghapusan isi hanya lewat RPC
 *     berparameter tunggal `hapus_bab_materi(bab_id)` dan
 *     `lepas_video_materi(materi_id)` — nama argumennya MENGIKAT (salah nama
 *     menghasilkan 404 PGRST202, bukan 400), dan `data === null` berarti "tidak
 *     ada yang cocok", yaitu SUKSES: bab yang sudah lebih dulu dihapus rekan
 *     sekerja tidak perlu memunculkan layar merah.
 *
 *  6. UPDATE yang tertahan dijawab PostgREST 200 + []. Melaporkan "berhasil"
 *     tanpa memeriksa panjangnya adalah kebohongan senyap.
 *
 *  7. Sesi pengguna, bukan service role. Di bawah service role `user_role()`
 *     mengembalikan 'klien' dan `auth.uid()` NULL: policy "materials: staf
 *     kelola", "chapters: staf", dan "video: staf" tidak pernah ikut diperiksa.
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
    const { count } = await supabase
      .from("material_chapters")
      .select("id", { count: "exact", head: true })
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
 * Mendaftarkan materi baru BESERTA isinya.
 *
 * Formulirnya satu, dan itu bukan pilihan tata letak: materi yang tersimpan
 * tanpa isi adalah materi yang terkunci permanen dan berbohong di kartunya.
 */
export async function simpanMateri(formData: FormData): Promise<Dibuat | Gagal> {
  await requireRole(["admin", "owner"]);

  const layananId = String(formData.get("service_id") ?? "").trim();
  const judul = periksaJudul(String(formData.get("judul") ?? ""));
  const tipe = periksaTipe(String(formData.get("tipe") ?? ""));
  const deskripsi = periksaDeskripsi(String(formData.get("deskripsi") ?? ""));

  if (!judul.ok) return { ok: false, pesan: `Judul materi: ${judul.pesan}` };
  if (!tipe.ok) return { ok: false, pesan: tipe.pesan };
  if (!deskripsi.ok) return { ok: false, pesan: deskripsi.pesan };

  // Isi diperiksa SEBELUM satu baris pun lahir. Hak DELETE atas `materials`
  // sudah dicabut dari peran API, jadi "simpan dulu, batalkan kalau gagal"
  // bukan pilihan yang tersedia — dan tidak seharusnya menjadi pilihan.
  let babJudul = "";
  let babIsi = "";
  let videoUrl = "";
  if (tipe.nilai === "ebook") {
    const j = periksaJudul(String(formData.get("bab_judul") ?? ""));
    const i = periksaIsiBab(String(formData.get("bab_isi") ?? ""));
    if (!j.ok) return { ok: false, pesan: `Bab pertama: ${j.pesan}` };
    if (!i.ok) return { ok: false, pesan: `Bab pertama: ${i.pesan}` };
    babJudul = j.nilai;
    babIsi = i.nilai;
  } else {
    const u = periksaUrlVideo(String(formData.get("video_url") ?? ""));
    if (!u.ok) return { ok: false, pesan: u.pesan };
    videoUrl = u.nilai;
  }

  // Foreign key memang menolak `service_id` yang tidak ada, tetapi pesannya
  // adalah kode Postgres — bukan kalimat yang boleh dibaca admin klinik.
  if (!(await layananAda(layananId))) {
    return { ok: false, pesan: "Layanan tidak dikenal. Pilih layanan induk materi ini." };
  }

  const supabase = await createServerSupabase();

  // `aktif: false` ditulis MATI di sini — kebalikan dari modul Layanan, dan
  // sengaja. Insert materi dan insert isinya adalah dua permintaan tanpa
  // transaksi yang membungkusnya; bila yang kedua gagal, satu-satunya keadaan
  // yang boleh tersisa adalah keadaan yang tidak terlihat klien.
  const { data, error } = await supabase
    .from("materials")
    .insert({
      service_id: layananId,
      judul: judul.nilai,
      tipe: tipe.nilai,
      deskripsi: deskripsi.nilai,
      aktif: false,
    })
    .select("id")
    .single();

  if (error || !data) return { ok: false, pesan: "Gagal menyimpan materi." };
  const id = data.id as string;

  if (tipe.nilai === "ebook") {
    const { error: eBab } = await supabase
      .from("material_chapters")
      .insert({ material_id: id, urutan: 1, judul: babJudul, isi: babIsi });
    if (eBab) {
      segarkanMateri(id);
      return {
        ok: false,
        pesan: "Materi tersimpan NONAKTIF karena bab pertamanya gagal disimpan. Tambahkan babnya, lalu aktifkan materi ini.",
      };
    }
  } else {
    const { error: eVideo } = await supabase
      .from("material_videos")
      .insert({ material_id: id, url: videoUrl });
    if (eVideo) {
      segarkanMateri(id);
      return {
        ok: false,
        pesan: "Materi tersimpan NONAKTIF karena URL videonya gagal disimpan. Pasang URL-nya, lalu aktifkan materi ini.",
      };
    }
  }

  const { data: terbit } = await supabase
    .from("materials")
    .update({ aktif: true })
    .eq("id", id)
    .select("id");
  if ((terbit ?? []).length === 0) {
    return {
      ok: false,
      pesan: "Isi materi tersimpan, tetapi materinya belum bisa diterbitkan. Aktifkan dari daftar.",
    };
  }

  segarkanMateri(id);
  return { ok: true, id };
}

/**
 * Mengubah identitas materi — dan, bila `tipe` berpindah, ISI tipe barunya
 * dalam permintaan yang sama.
 *
 * `ebook` → `video` tanpa URL adalah bentuk paling halus dari materi setengah
 * jadi: tipe berpindah, isi lama menjadi tidak terpakai, dan seluruh klien yang
 * berhak melihat kartu terkunci selamanya tanpa satu pun error. Isi lama
 * SENGAJA tidak disapu — penghapusannya punya action tersendiri, satu baris
 * sekali panggil, dan bab yang tertinggal tidak pernah terbaca karena reader
 * memilih bentuk tampilan menurut `tipe`.
 */
export async function perbaruiMateri(
  id: string,
  formData: FormData,
): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);

  const layananId = String(formData.get("service_id") ?? "").trim();
  const judul = periksaJudul(String(formData.get("judul") ?? ""));
  const tipe = periksaTipe(String(formData.get("tipe") ?? ""));
  const deskripsi = periksaDeskripsi(String(formData.get("deskripsi") ?? ""));

  if (!judul.ok) return { ok: false, pesan: `Judul materi: ${judul.pesan}` };
  if (!tipe.ok) return { ok: false, pesan: tipe.pesan };
  if (!deskripsi.ok) return { ok: false, pesan: deskripsi.pesan };

  const materi = await ambilMateri(id);
  if (!materi) return { ok: false, pesan: "Materi tidak ditemukan." };

  if (!(await layananAda(layananId))) {
    return { ok: false, pesan: "Layanan tidak dikenal. Pilih layanan induk materi ini." };
  }

  const supabase = await createServerSupabase();
  const pindahTipe = tipe.nilai !== materi.tipe;

  if (pindahTipe) {
    if (tipe.nilai === "video") {
      const u = periksaUrlVideo(String(formData.get("video_url") ?? ""));
      if (!u.ok) {
        return { ok: false, pesan: `Mengubah tipe ke Video wajib disertai ${LABEL_ISI.video}. ${u.pesan}` };
      }
      // Isi dipasang LEBIH DULU, tipenya menyusul: bila urutannya dibalik dan
      // permintaan kedua gagal, materi aktif langsung berdiri tanpa isi.
      const { error } = await supabase
        .from("material_videos")
        .upsert({ material_id: id, url: u.nilai }, { onConflict: "material_id" })
        .select("material_id");
      if (error) return { ok: false, pesan: "Gagal menyimpan URL video materi." };
    } else {
      const j = periksaJudul(String(formData.get("bab_judul") ?? ""));
      const i = periksaIsiBab(String(formData.get("bab_isi") ?? ""));
      if (!j.ok || !i.ok) {
        return {
          ok: false,
          pesan: `Mengubah tipe ke E-Book wajib disertai ${LABEL_ISI.ebook}.`,
        };
      }
      if (!(await punyaIsi(id, "ebook"))) {
        const { error } = await supabase
          .from("material_chapters")
          .insert({ material_id: id, urutan: 1, judul: j.nilai, isi: i.nilai })
          .select("id");
        if (error) return { ok: false, pesan: "Gagal menyimpan bab pertama materi." };
      }
    }
  }

  // Medan `aktif` yang ikut dikirim browser diabaikan tanpa pernah masuk
  // payload — keadaan materi punya action tersendiri.
  const { data, error } = await supabase
    .from("materials")
    .update({
      service_id: layananId,
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
 * isinya: policy baca klien pada `material_chapters` & `material_videos` ikut
 * mengevaluasi `materials.aktif`, jadi babnya hilang dari jawaban PostgREST —
 * bukan sekadar dari kartu di UI. Baris `materials` sendiri tetap terbaca, dan
 * itu disengaja: menutupnya akan mengulangi bug `partner_publik`.
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
// Bab e-book
// ---------------------------------------------------------------------------

export async function tambahBab(
  materiId: string,
  formData: FormData,
): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);

  const judul = periksaJudul(String(formData.get("judul") ?? ""));
  const isi = periksaIsiBab(String(formData.get("isi") ?? ""));
  if (!judul.ok) return { ok: false, pesan: `Judul bab: ${judul.pesan}` };
  if (!isi.ok) return { ok: false, pesan: isi.pesan };

  const materi = await ambilMateri(materiId);
  if (!materi) return { ok: false, pesan: "Materi tidak ditemukan." };
  if (materi.tipe !== "ebook") {
    return { ok: false, pesan: "Bab hanya berlaku untuk materi bertipe E-Book." };
  }

  const supabase = await createServerSupabase();

  // Urutan dihitung server, tidak pernah diterima dari formulir: dua bab
  // beruntutan yang lahir dengan urutan sama akan tampil dengan susunan yang
  // berubah-ubah tiap kali halaman dimuat.
  const { data: terakhir } = await supabase
    .from("material_chapters")
    .select("urutan")
    .eq("material_id", materiId)
    .order("urutan", { ascending: false })
    .limit(1);
  const urutan = ((terakhir ?? [])[0]?.urutan ?? 0) + 1;

  const { data, error } = await supabase
    .from("material_chapters")
    .insert({ material_id: materiId, urutan, judul: judul.nilai, isi: isi.nilai })
    .select("id");

  if (error || (data ?? []).length === 0) {
    return { ok: false, pesan: "Gagal menyimpan bab." };
  }

  segarkanMateri(materiId);
  return { ok: true };
}

export async function perbaruiBab(
  babId: string,
  formData: FormData,
): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);

  const judul = periksaJudul(String(formData.get("judul") ?? ""));
  const isi = periksaIsiBab(String(formData.get("isi") ?? ""));
  const urutan = periksaUrutan(String(formData.get("urutan") ?? ""));
  if (!judul.ok) return { ok: false, pesan: `Judul bab: ${judul.pesan}` };
  if (!isi.ok) return { ok: false, pesan: isi.pesan };
  if (!urutan.ok) return { ok: false, pesan: urutan.pesan };

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("material_chapters")
    .update({ judul: judul.nilai, isi: isi.nilai, urutan: urutan.nilai })
    .eq("id", babId)
    .select("id, material_id");

  if (error || (data ?? []).length === 0) {
    return { ok: false, pesan: "Bab tidak ditemukan atau gagal diperbarui." };
  }

  segarkanMateri((data ?? [])[0].material_id as string);
  return { ok: true };
}

/**
 * Menghapus SATU bab.
 *
 * Lewat RPC berparameter tunggal, bukan verba DELETE: hak DELETE atas
 * `material_chapters` sudah dicabut dari peran API karena filter PostgREST
 * adalah pilihan pemanggil, bukan pembatas baris — satu permintaan
 * `DELETE ...?urutan=gte.0` pernah menyapu seluruh bab seluruh materi klinik.
 * Nama argumen `bab_id` MENGIKAT: salah nama menghasilkan 404 PGRST202.
 *
 * Bab terakhir sebuah e-book yang sedang TERBIT ditolak: menghapusnya membuat
 * materi aktif tanpa isi — terkunci permanen bagi seluruh klien yang berhak,
 * tanpa error, dengan kartu yang berbohong.
 */
export async function hapusBab(babId: string): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();

  const { data: bab } = await supabase
    .from("material_chapters")
    .select("id, material_id")
    .eq("id", babId)
    .maybeSingle<{ id: string; material_id: string }>();

  if (bab) {
    const materi = await ambilMateri(bab.material_id);
    const { count } = await supabase
      .from("material_chapters")
      .select("id", { count: "exact", head: true })
      .eq("material_id", bab.material_id);

    if (materi?.tipe === "ebook" && materi.aktif && (count ?? 0) <= 1) {
      return {
        ok: false,
        pesan: "Ini bab terakhir materi yang sedang terbit. Nonaktifkan materinya lebih dulu bila hendak menarik seluruh isinya.",
      };
    }
  }

  const { error } = await supabase.rpc("hapus_bab_materi", { bab_id: babId });
  if (error) return { ok: false, pesan: "Gagal menghapus bab." };

  // `data === null` berarti "tidak ada yang cocok" — bab yang sudah lebih dulu
  // dihapus rekan sekerja tidak perlu memunculkan layar merah.
  segarkanMateri(bab?.material_id);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Video
// ---------------------------------------------------------------------------

export async function gantiVideo(
  materiId: string,
  formData: FormData,
): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);

  const url = periksaUrlVideo(String(formData.get("video_url") ?? ""));
  if (!url.ok) return { ok: false, pesan: url.pesan };

  const materi = await ambilMateri(materiId);
  if (!materi) return { ok: false, pesan: "Materi tidak ditemukan." };
  if (materi.tipe !== "video") {
    return { ok: false, pesan: "URL video hanya berlaku untuk materi bertipe Video." };
  }

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("material_videos")
    .upsert({ material_id: materiId, url: url.nilai }, { onConflict: "material_id" })
    .select("material_id");

  if (error || (data ?? []).length === 0) {
    return { ok: false, pesan: "Gagal menyimpan URL video." };
  }

  segarkanMateri(materiId);
  return { ok: true };
}

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
 */
export async function lepasVideo(materiId: string): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);

  const materi = await ambilMateri(materiId);
  if (!materi) return { ok: false, pesan: "Materi tidak ditemukan." };
  if (materi.aktif) {
    return {
      ok: false,
      pesan: "Nonaktifkan materinya lebih dulu. Materi video yang terbit tanpa URL tampil sebagai kartu terkunci yang tidak akan pernah terbuka.",
    };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("lepas_video_materi", { materi_id: materiId });
  if (error) return { ok: false, pesan: "Gagal melepas video materi." };

  segarkanMateri(materiId);
  return { ok: true };
}
