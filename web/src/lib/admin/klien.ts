import { createServerSupabase } from "@/lib/supabase/server";
import { hitungRentang, type ParamDaftar } from "@/app/_shell/panel/daftar";

/** Nilai saringan yang sah untuk daftar klien — dipakai halaman DAN uji. */
export const SARING_KLIEN = {
  aktivasi: ["aktif", "belum"],
  paket: ["ada"],
} as const;

export type BarisKlienDaftar = {
  id: string;
  padmaId: string;
  nama: string;
  email: string;
  namaFase: string;
  /** `user_id` sudah terisi — tautan aktivasi sudah ditukarkan. */
  aktif: boolean;
  paketAktif: string | null;
  sesiSelesai: number;
};

type BarisKlien = {
  id: string;
  padma_id: string;
  nama: string;
  email: string;
  phase_id: string | null;
  user_id: string | null;
};
type BarisPaket = {
  client_id: string;
  packages: { nama: string; jumlah_sesi: number } | null;
};

/**
 * Satu halaman daftar klien.
 *
 * Dipindah keluar dari `page.tsx` supaya saringan dan paginasinya bisa diuji
 * tanpa merender halaman — saringan yang memulangkan baris yang salah adalah
 * cacat DATA, dan menguji cacat data lewat markup berarti membuktikannya
 * dengan cara yang paling tidak langsung.
 *
 * Sesi pengguna, bukan service role: policy `clients: staf` yang mengizinkan
 * daftar ini terbaca, dan itulah yang ingin ikut teruji.
 */
export async function ambilDaftarKlien(
  param: ParamDaftar,
): Promise<{ baris: BarisKlienDaftar[]; total: number }> {
  const supabase = await createServerSupabase();
  const { dari, sampai } = hitungRentang(param.hal);

  let q = supabase
    .from("clients")
    .select("id, padma_id, nama, email, phase_id, user_id", { count: "exact" })
    .order("created_at", { ascending: false });

  if (param.saring.aktivasi === "aktif") q = q.not("user_id", "is", null);
  if (param.saring.aktivasi === "belum") q = q.is("user_id", null);

  if (param.cari !== "") {
    const aman = param.cari.replace(/[%_\\]/g, (c) => `\\${c}`);
    // PADMA ID dibacakan klien lewat telepon; nama yang diingat admin. Satu
    // kotak cari harus menemukan keduanya, jadi `or` — bukan dua kotak.
    //
    // `padma_id` DIKECUALIKAN dari pagar identitas (lihat
    // `admin-klien.test.ts`, "pagar identitas — pencocokan pola TERLARANG
    // pada kolom identitas"): kolom ini ditulis sekali saat klien dibuat lalu
    // hanya ditampilkan, tidak pernah dipakai sebagai kunci `.eq()` untuk
    // otorisasi (`grep -r '.eq("padma_id"' src/` tidak menemukan satu pun
    // pemakaian). Mencocokkannya dengan pola karena itu tidak bisa
    // meloloskan baris milik orang lain ke dalam perbandingan identitas —
    // dan PADMA ID justru dirancang untuk DICARI: itulah yang dibacakan
    // klien lewat telepon saat admin tidak ingat namanya.
    q = q.or(`nama.ilike.%${aman}%,padma_id.ilike.%${aman}%`);
  }

  const [{ data: klien, count }, { data: fase }, { data: paket }, { data: sesiSelesai }] =
    await Promise.all([
      q.range(dari, sampai).returns<BarisKlien[]>(),
      supabase.from("phases").select("id, nama").returns<{ id: string; nama: string }[]>(),
      // Hanya paket yang masih berjalan yang menjadi identitas baris klien;
      // paket lama tidak menggantikan gambaran "sedang menjalani apa".
      supabase
        .from("client_packages")
        .select("client_id, status, packages ( nama, jumlah_sesi )")
        .eq("status", "aktif")
        .returns<BarisPaket[]>(),
      // Sesi dihitung di sini, bukan lewat agregat tertanam PostgREST: filter
      // pada sumber tertanam mengubah arti gabungannya dan gampang menghitung
      // sesi milik klien lain tanpa error apa pun.
      supabase
        .from("sessions")
        .select("client_id")
        .eq("status", "selesai")
        .returns<{ client_id: string }[]>(),
    ]);

  const labelFase = new Map((fase ?? []).map((f) => [f.id, f.nama]));
  // Formatnya dibakukan DI SINI, bukan disimpan sebagai nama polos: `page.tsx`
  // lama menampilkan "nama · N sesi" (lihat `admin-klien.test.ts`, "Sankalpa
  // Prima · 8 sesi"), dan `BarisKlienDaftar.paketAktif` bertipe `string | null`
  // tunggal — tidak ada medan terpisah untuk `jumlah_sesi` di sisi pemanggil.
  // Menyimpan nama polos di sini akan membuang informasi itu secara SENYAP.
  const paketAktif = new Map(
    (paket ?? []).map((p) => [
      p.client_id,
      p.packages ? `${p.packages.nama} · ${p.packages.jumlah_sesi} sesi` : null,
    ]),
  );
  const selesaiPer = new Map<string, number>();
  for (const s of sesiSelesai ?? []) {
    selesaiPer.set(s.client_id, (selesaiPer.get(s.client_id) ?? 0) + 1);
  }

  let baris = (klien ?? []).map((k) => ({
    id: k.id,
    padmaId: k.padma_id,
    nama: k.nama,
    email: k.email,
    namaFase: k.phase_id ? (labelFase.get(k.phase_id) ?? "—") : "—",
    aktif: k.user_id !== null,
    paketAktif: paketAktif.get(k.id) ?? null,
    sesiSelesai: selesaiPer.get(k.id) ?? 0,
  }));

  // Saringan "punya paket berjalan" dikerjakan di JS, bukan SQL, dan itu
  // disengaja: paket hidup di tabel lain, dan menyaringnya lewat `in` atas
  // daftar id akan pecah begitu daftar klien melewati batas panjang URL
  // PostgREST. Konsekuensinya jujur dan disebut di sini: total tidak ikut
  // menyempit, jadi saringan ini menyaring HALAMAN, bukan seluruh daftar.
  // Menutupnya menuntut view SQL sendiri — pekerjaan rencana berikutnya.
  if (param.saring.paket === "ada") baris = baris.filter((k) => k.paketAktif !== null);

  return { baris, total: count ?? 0 };
}
