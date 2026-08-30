import { createServerSupabase } from "@/lib/supabase/server";
import { awalPekan, rentangPekan } from "./pekan";
import {
  hitungRekap,
  type RekapPekan,
  type SesiRekap,
  type TandaBayar,
  type TarifRingkas,
} from "./rekap";

// ============================================================================
// LAPISAN DATA PANEL OWNER
// ============================================================================
// SELURUH pembacaan di berkas ini memakai `createServerSupabase()` — SESI
// PENGGUNA, bukan service role. Itu bukan preferensi gaya:
//
//   • Di bawah service role, `user_role()` mengembalikan 'klien' dan
//     `auth.uid()` NULL. Query tetap berhasil (service role melewati RLS),
//     sehingga halaman owner akan terlihat benar — untuk SIAPA PUN yang
//     berhasil memanggilnya. Policy "rates: hanya owner" tidak pernah ikut
//     diperiksa, dan money firewall berhenti menjadi pertahanan.
//   • Dengan sesi pengguna, RLS-lah yang menjawab: owner mendapat baris tarif,
//     admin dan klien mendapat `[]`. Kebocoran menjadi mustahil di lapisan
//     basis data, bukan sekadar tidak terjadi di lapisan UI.
//
// Agregasinya sendiri TIDAK dihitung di SQL. Sebuah view `rekap_honor`
// dimiliki `postgres` dan berjalan dengan hak pemilik, jadi ia MELEWATI RLS
// (terbukti: admin membaca 10 baris rate card lengkap lewat view biasa
// sementara SELECT langsung memulangkan 0). Penjumlahannya hidup di
// `./rekap.ts` sebagai fungsi murni.

export type TarifLayanan = TarifRingkas & { namaLayanan: string };

type BarisTarif = {
  id: string;
  service_id: string;
  harga_klien: number;
  honor_mitra: number;
  berlaku_sejak: string;
  services: { nama: string } | null;
};

/**
 * SELURUH riwayat tarif, bukan hanya yang berlaku hari ini: rekap pekan lama
 * wajib memakai tarif yang berlaku PADA TANGGAL SESI, sehingga baris lama
 * tetap dibutuhkan selamanya.
 *
 * Admin & klien memanggil fungsi ini akan mendapat array kosong — itu RLS yang
 * menjawab, bukan penyaringan di sini.
 */
export async function ambilTarif(): Promise<TarifLayanan[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("service_rates")
    .select("id, service_id, harga_klien, honor_mitra, berlaku_sejak, services(nama)")
    // `berlaku_sejak` bertipe date dan sudah berupa string YYYY-MM-DD:
    // urutannya diserahkan ke Postgres, tidak pernah ke aritmatika Date di JS.
    .order("berlaku_sejak", { ascending: false })
    .returns<BarisTarif[]>();

  return (data ?? []).map((r) => ({
    id: r.id,
    serviceId: r.service_id,
    namaLayanan: r.services?.nama ?? "Layanan",
    hargaKlien: r.harga_klien,
    honorMitra: r.honor_mitra,
    berlakuSejak: r.berlaku_sejak,
  }));
}

type BarisSesi = {
  id: string;
  service_id: string;
  partner_id: string;
  tanggal: string;
  status: SesiRekap["status"];
  client_package_id: string | null;
  updated_at: string | null;
  services: { nama: string } | null;
  partners: { nama: string } | null;
};

/**
 * Sesi mentah untuk rekap. Penyaringan `status = 'selesai'` SENGAJA tidak
 * dilakukan di sini melainkan di `hitungRekap()`: aturan "hanya sesi selesai
 * yang berhonor" adalah aturan UANG, dan aturan uang yang tersebar di dua
 * lapisan akan berpisah diam-diam pada perubahan berikutnya.
 *
 * `partners` di-embed langsung (bukan lewat view `partner_publik`): owner
 * memang berhak membaca tabelnya, dan `partner_publik` menyaring `aktif =
 * true` — mitra yang sudah dinonaktifkan tetap harus muncul di rekap pekan
 * saat ia masih bekerja, kalau tidak honornya lenyap dari riwayat.
 */
export async function ambilSesiRekap(): Promise<SesiRekap[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("sessions")
    .select(
      "id, service_id, partner_id, tanggal, status, client_package_id, updated_at, services(nama), partners(nama)",
    )
    .order("tanggal", { ascending: false })
    .returns<BarisSesi[]>();

  return (data ?? []).map((r) => ({
    id: r.id,
    serviceId: r.service_id,
    namaLayanan: r.services?.nama ?? "Layanan",
    partnerId: r.partner_id,
    namaMitra: r.partners?.nama ?? "Mitra PADMA",
    tanggal: r.tanggal,
    status: r.status,
    clientPackageId: r.client_package_id,
    selesaiPada: r.updated_at,
  }));
}

type BarisTanda = {
  partner_id: string;
  week_start: string;
  dibayar_pada: string;
};

export async function ambilTandaBayar(): Promise<TandaBayar[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("honor_marks")
    .select("partner_id, week_start, dibayar_pada")
    .returns<BarisTanda[]>();

  return (data ?? []).map((r) => ({
    partnerId: r.partner_id,
    senin: r.week_start,
    dibayarPada: r.dibayar_pada,
  }));
}

/** Rekap seluruh pekan, terbaru di atas. Tiga bacaan sejajar + satu fungsi murni. */
export async function ambilRekap(): Promise<RekapPekan[]> {
  const [sesi, tarif, tanda] = await Promise.all([
    ambilSesiRekap(),
    ambilTarif(),
    ambilTandaBayar(),
  ]);
  return hitungRekap({ sesi, tarif, tanda });
}

export type RingkasanPekan = {
  senin: string;
  rentang: string;
  jumlahSesi: number;
  jumlahMitra: number;
  totalHonor: number;
  totalHarga: number;
  margin: number;
  /** Sesi selesai yang tidak bisa dihargai. Nol pada keadaan sehat. */
  jumlahTakBertarif: number;
};

/**
 * Ringkasan satu pekan untuk beranda owner.
 *
 * `hariIni` WAJIB diberikan pemanggil (halaman meneruskan `hariIniJakarta()`).
 * Membaca jam sistem di dalam sini akan membuat fungsinya mustahil diuji pada
 * pekan tertentu — dan pengelompokan pekan justru pagar yang paling perlu
 * diuji: sesi pekan lalu yang bocor ke kartu "pekan ini" tidak menghasilkan
 * satu pun error, hanya honor yang salah dibayarkan.
 *
 * Pekan tanpa sesi TIDAK muncul di hasil `hitungRekap`, jadi ketiadaannya
 * dijawab dengan ringkasan bernilai nol — bukan `null` yang memaksa setiap
 * pemanggil menulis cabang kosongnya sendiri.
 */
export async function ringkasanPekanIni(hariIni: string): Promise<RingkasanPekan> {
  const senin = awalPekan(hariIni);
  const rekap = await ambilRekap();
  const pekan = rekap.find((p) => p.senin === senin);

  if (!pekan) {
    return {
      senin,
      rentang: rentangPekan(senin),
      jumlahSesi: 0,
      jumlahMitra: 0,
      totalHonor: 0,
      totalHarga: 0,
      margin: 0,
      jumlahTakBertarif: 0,
    };
  }

  return {
    senin: pekan.senin,
    rentang: pekan.rentang,
    jumlahSesi: pekan.jumlahSesi,
    jumlahMitra: pekan.perMitra.length,
    totalHonor: pekan.totalHonor,
    totalHarga: pekan.totalHarga,
    margin: pekan.margin,
    jumlahTakBertarif: pekan.sesiTakBertarif.length,
  };
}
