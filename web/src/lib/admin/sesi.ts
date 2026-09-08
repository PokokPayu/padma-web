import { createServerSupabase } from "@/lib/supabase/server";
import { hitungRentang, type ParamDaftar, type SaringSah } from "@/app/_shell/panel/daftar";
import { awalPekan, akhirPekan } from "@/lib/owner/pekan";
import type { JenjangTransport } from "@/lib/transport/jarak";
import type { StatusSesi } from "@/app/admin/sesi/status";

/**
 * Lapisan data daftar sesi.
 *
 * Sesi pengguna (`createServerSupabase`), bukan service role: policy
 * `sessions: staf` yang mengizinkan bacaan ini, dan di bawah service role
 * `user_role()` justru mengembalikan 'klien' sehingga tidak satu pun pagar
 * ikut diperiksa.
 *
 * NOL NOMINAL. Jenjang transport adalah data LOGISTIK — admin melihat
 * "5–10 km", tidak pernah rupiahnya. Berkas ini tidak pernah menyebut satu
 * pun tabel uang, dan itu diuji.
 */

/** Nilai saringan yang sah untuk daftar sesi — dipakai halaman DAN uji. */
export const SARING_SESI = {
  status: ["terjadwal", "selesai", "batal"],
  jenjang: ["kosong"],
  waktu: ["mendatang", "pekan_ini", "lampau"],
} as const satisfies SaringSah;

export type BarisSesiDaftar = {
  id: string;
  namaKlien: string;
  padmaId: string;
  namaLayanan: string;
  namaMitra: string;
  /** ISO `YYYY-MM-DD` mentah — pemformatannya milik halaman, bukan lapisan ini. */
  tanggal: string;
  status: StatusSesi;
  dalamPaket: boolean;
  catatan: string;
  rekomendasi: string;
  jenjang: JenjangTransport | null;
  jenjangSumber: "otomatis" | "admin" | null;
};

type BarisDb = {
  id: string;
  tanggal: string;
  status: StatusSesi;
  catatan: string;
  rekomendasi: string;
  client_package_id: string | null;
  jenjang: JenjangTransport | null;
  jenjang_sumber: "otomatis" | "admin" | null;
  clients: { nama: string; padma_id: string } | null;
  services: { nama: string } | null;
  partners: { nama: string } | null;
};

/**
 * Satu halaman daftar sesi beserta TOTAL baris yang cocok.
 *
 * `hariIni` dioper masuk, tidak dibaca dari jam sistem: server berjalan UTC
 * dan pada 17:00–24:00 UTC kalender Jakarta sudah berganti tanggal. Aturan
 * yang sama dipegang seluruh lapisan data proyek ini.
 */
export async function ambilDaftarSesi(
  param: ParamDaftar,
  hariIni: string,
): Promise<{ baris: BarisSesiDaftar[]; total: number }> {
  const supabase = await createServerSupabase();
  const { dari, sampai } = hitungRentang(param.hal);

  // `clients!inner`, bukan `clients`: pencarian di bawah menyaring lewat
  // kolom klien, dan tanpa `!inner` PostgREST hanya menyaring EMBED-nya —
  // barisnya tetap keluar dengan `clients: null`, sehingga "cari" tampak
  // tidak melakukan apa pun. Aman dijadikan inner: `sessions.client_id`
  // NOT NULL sejak init_schema.
  let q = supabase
    .from("sessions")
    .select(
      "id, tanggal, status, catatan, rekomendasi, client_package_id, jenjang, jenjang_sumber, " +
        "clients!inner(nama, padma_id), services(nama), partners(nama)",
      { count: "exact" },
    )
    // Terbaru di atas: yang baru saja dijalani bidan paling mungkin perlu
    // ditandai selesai. `id` sebagai tie-break supaya urutan dua sesi
    // bertanggal sama STABIL antar halaman — tanpa itu, satu baris bisa
    // muncul di halaman 1 dan 2 sekaligus sementara baris lain tidak pernah.
    .order("tanggal", { ascending: false })
    .order("id");

  if (param.saring.status) q = q.eq("status", param.saring.status);
  // Jenjang kosong = jarak tidak pernah diketahui. Inilah saringan yang
  // ditautkan StatTile "Sesi selesai tanpa jenjang" (Tugas 4).
  if (param.saring.jenjang === "kosong") q = q.is("jenjang", null);
  if (param.saring.waktu === "mendatang") q = q.gte("tanggal", hariIni);
  if (param.saring.waktu === "lampau") q = q.lt("tanggal", hariIni);
  if (param.saring.waktu === "pekan_ini") {
    q = q.gte("tanggal", awalPekan(hariIni)).lte("tanggal", akhirPekan(hariIni));
  }

  if (param.cari !== "") {
    // `%` dan `_` yang diketik manusia dicari sebagai HURUF, bukan wildcard.
    const aman = param.cari.replace(/[%_\\]/g, (c) => `\\${c}`);
    // Nama yang diingat admin ATAU PADMA ID yang dibacakan klien lewat
    // telepon — satu kotak cari harus menemukan keduanya.
    //
    // `padma_id` dikecualikan dari pagar identitas dengan alasan yang sama
    // persis seperti di `lib/admin/klien.ts`: kolom itu ditulis sekali lalu
    // hanya ditampilkan, tidak pernah menjadi kunci `.eq()` untuk otorisasi.
    q = q.or(`nama.ilike.%${aman}%,padma_id.ilike.%${aman}%`, { referencedTable: "clients" });
  }

  const { data, count } = await q.range(dari, sampai).returns<BarisDb[]>();

  return {
    baris: (data ?? []).map((s) => ({
      id: s.id,
      namaKlien: s.clients?.nama ?? "Klien",
      padmaId: s.clients?.padma_id ?? "—",
      namaLayanan: s.services?.nama ?? "Layanan",
      // Mitra dibaca dari tabel `partners` (hak staf), BUKAN dari view
      // `partner_publik` — view itu sengaja tidak menyaring ketersediaan, dan
      // memindahkan filter ke sana pernah mengubah nama bidan di riwayat
      // SELURUH klien menjadi "Tim PADMA" tanpa satu pun error.
      namaMitra: s.partners?.nama ?? "Tim PADMA",
      tanggal: s.tanggal,
      status: s.status,
      dalamPaket: s.client_package_id !== null,
      catatan: s.catatan,
      rekomendasi: s.rekomendasi,
      jenjang: s.jenjang,
      jenjangSumber: s.jenjang_sumber,
    })),
    total: count ?? 0,
  };
}
