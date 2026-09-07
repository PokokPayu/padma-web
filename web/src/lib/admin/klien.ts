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
    .select("id, padma_id, nama, phase_id, user_id", { count: "exact" })
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
      //
      // Query ini TIDAK dipaginasi — ia menutupi paket aktif SELURUH klien,
      // bukan hanya klien di halaman ini. Batas yang tidak dicegah: PostgREST
      // memotong SETIAP hasil pada `max_rows = 1000` baris tanpa galat, jadi
      // begitu jumlah baris `client_packages` berstatus "aktif" di SELURUH
      // sistem melewati 1000, sebagian klien yang sebenarnya berpaket akan
      // tampil seolah tidak berpaket — diam-diam, tanpa satu error pun.
      // Menutupnya butuh agregat/lookup per-klien di sisi database (view atau
      // RPC), bukan penarikan penuh lalu `Map` di JS seperti di bawah — itu
      // pekerjaan rencana tersendiri.
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
    namaFase: k.phase_id ? (labelFase.get(k.phase_id) ?? "—") : "—",
    aktif: k.user_id !== null,
    paketAktif: paketAktif.get(k.id) ?? null,
    sesiSelesai: selesaiPer.get(k.id) ?? 0,
  }));

  // Saringan "punya paket berjalan" dikerjakan di JS, bukan SQL, dan itu
  // disengaja: paket hidup di tabel lain, dan menyaringnya lewat `in` atas
  // daftar id akan pecah begitu daftar klien melewati batas panjang URL
  // PostgREST. Konsekuensinya: saringan ini menyaring HALAMAN yang sudah
  // ditarik, bukan seluruh daftar sebelum paginasi — klien berpaket di
  // halaman lain tidak pernah terhitung di sini. Menutupnya menuntut view SQL
  // sendiri (hitung "punya paket aktif" per klien di database) — pekerjaan
  // rencana berikutnya.
  const saringPaketMenyala = param.saring.paket === "ada";
  if (saringPaketMenyala) baris = baris.filter((k) => k.paketAktif !== null);

  // `total` TIDAK BOLEH dibiarkan sebagai `count` mentah selagi saringan di
  // atas menyala: `count` menghitung SELURUH klien sebelum saringan paket
  // diterapkan, sedangkan `baris` sudah tersaring. Memulangkan keduanya
  // sebagaimana adanya membuat `BilahDaftar` menulis total yang tidak pernah
  // benar-benar bisa dilihat, dan `Paginasi` menawarkan halaman berikutnya
  // yang — bila halaman itu kebetulan tidak punya klien berpaket sama
  // sekali — tampil kosong tanpa satu kalimat penjelasan padahal paginasi
  // masih bilang "halaman sekian dari sekian".
  //
  // Perbaikan JUJUR, bukan perbaikan LENGKAP: kita tidak tahu (dan tidak
  // menghitung) berapa total klien berpaket di SELURUH daftar, jadi kita
  // hanya melaporkan yang benar-benar kita tahu — jumlah baris yang lolos
  // saringan pada HALAMAN INI — dan berhenti menawarkan halaman lain sebagai
  // konsekuensinya (`jumlahHalaman(baris.length)` dengan `baris.length` di
  // bawah `PER_HAL` selalu jatuh ke 1 halaman). Itu tetap TIDAK SAMA dengan
  // "total klien berpaket sungguhan" — itu tetap pekerjaan view SQL di atas.
  const total = saringPaketMenyala ? baris.length : (count ?? 0);

  return { baris, total };
}
