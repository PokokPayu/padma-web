import { createServerSupabase } from "@/lib/supabase/server";
import { labelVarian, type FormatVarian } from "@/lib/varian";
import { awalPekan, rentangPekan } from "./pekan";
import {
  hitungRekap,
  tarifPadaTanggal,
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

export type TarifLayanan = TarifRingkas & { namaLayanan: string; labelVarian: string };

type BarisVarianEmbed = {
  id: string;
  label: string;
  durasi_menit: number | null;
  format: FormatVarian | null;
  service_id: string;
  services: { nama: string } | null;
};

type BarisTarif = {
  id: string;
  variant_id: string;
  harga_klien: number;
  harga_coret: number | null;
  honor_mitra: number;
  berlaku_sejak: string;
  service_variants: BarisVarianEmbed | null;
};

/**
 * SELURUH riwayat tarif, bukan hanya yang berlaku hari ini: rekap pekan lama
 * wajib memakai tarif yang berlaku PADA TANGGAL SESI, sehingga baris lama
 * tetap dibutuhkan selamanya.
 *
 * Dibaca dari `variant_rates` — harga menempel di VARIAN, bukan di layanan —
 * dengan varian & layanannya ikut ter-embed sekali jalan, supaya pemanggil
 * tidak perlu tarik terpisah untuk menampilkan nama layanan/labelnya.
 *
 * Admin & klien memanggil fungsi ini akan mendapat array kosong — itu RLS yang
 * menjawab, bukan penyaringan di sini.
 */
export async function ambilTarif(): Promise<TarifLayanan[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("variant_rates")
    .select(
      "id, variant_id, harga_klien, harga_coret, honor_mitra, berlaku_sejak, " +
        "service_variants(id, label, durasi_menit, format, service_id, services(nama))",
    )
    // `berlaku_sejak` bertipe date dan sudah berupa string YYYY-MM-DD:
    // urutannya diserahkan ke Postgres, tidak pernah ke aritmatika Date di JS.
    .order("berlaku_sejak", { ascending: false })
    .returns<BarisTarif[]>();

  return (data ?? []).map((r) => ({
    id: r.id,
    variantId: r.variant_id,
    namaLayanan: r.service_variants?.services?.nama ?? "Layanan",
    labelVarian: labelVarian({
      label: r.service_variants?.label ?? "",
      durasiMenit: r.service_variants?.durasi_menit ?? null,
      format: r.service_variants?.format ?? null,
    }),
    hargaKlien: r.harga_klien,
    hargaCoret: r.harga_coret,
    honorMitra: r.honor_mitra,
    berlakuSejak: r.berlaku_sejak,
  }));
}

// ---------------------------------------------------------------------------
// RATE CARD — tarif berlaku + riwayatnya, per layanan
// ---------------------------------------------------------------------------

export type TarifRiwayat = {
  id: string;
  hargaKlien: number;
  /** Harga PEMASARAN sebelum diskon soft launch, dicoret di layar. Diisi MANUAL. */
  hargaCoret: number | null;
  honorMitra: number;
  /** Angka PADMA per sesi. Dihitung di sini, TIDAK disimpan sebagai kolom. */
  margin: number;
  berlakuSejak: string;
  /** Baris inilah yang menghargai sesi bertanggal `hariIni`. */
  berlakuSekarang: boolean;
  /** Sudah ditetapkan, tetapi `berlaku_sejak`-nya masih di depan. */
  belumBerlaku: boolean;
};

export type BarisRateCard = {
  variantId: string;
  /** Dibawa untuk pengelompokan TAMPILAN — beberapa varian berbagi satu layanan. */
  serviceId: string;
  namaLayanan: string;
  /** String kosong untuk varian baku; layar yang menampilkan jatuh ke `namaLayanan`. */
  labelVarian: string;
  namaFase: string;
  aktif: boolean;
  /** Tarif yang berlaku pada `hariIni`; `null` bila varian belum bertarif. */
  berlaku: TarifRiwayat | null;
  /** SELURUH baris tarif varian ini, terbaru di atas. */
  riwayat: TarifRiwayat[];
};

type BarisFase = { id: string; nama: string; urutan: number };
type BarisLayananRate = { id: string; phase_id: string; nama: string; aktif: boolean };
type BarisVarianRate = {
  id: string;
  service_id: string;
  label: string;
  durasi_menit: number | null;
  format: FormatVarian | null;
  urutan: number;
};

/**
 * Rate card untuk `/owner/tarif`: setiap VARIAN beserta tarif yang berlaku
 * pada `hariIni` dan seluruh riwayatnya. Harga menempel di varian, bukan di
 * layanan, jadi baris tabelnya pun per varian — `serviceId`/`namaLayanan`
 * tetap ikut dibawa semata untuk mengelompokkan tampilan.
 *
 * `hariIni` WAJIB diberikan pemanggil (halaman meneruskan `hariIniJakarta()`),
 * dengan alasan yang sama seperti `ringkasanPekanIni`: fungsi yang membaca jam
 * sistem sendiri mustahil diuji pada tanggal tertentu, dan "tarif mana yang
 * berlaku" justru pertanyaan yang paling perlu diuji lintas tanggal.
 *
 * Varian yang BELUM bertarif tetap muncul dengan `berlaku: null` — bukan
 * disaring keluar. Varian yang hilang dari rate card adalah varian yang tidak
 * pernah bisa diberi tarif dari panel mana pun, dan sesinya akan terus muncul
 * di rekap sebagai "tak bertarif" tanpa satu pun jalan perbaikan.
 *
 * `berlaku` dipilih dengan `tarifPadaTanggal()` yang sama persis dengan yang
 * dipakai `hitungRekap()`. Menuliskan ulang aturan "berlaku_sejak terbesar yang
 * ≤ tanggal" di sini akan melahirkan dua definisi yang berpisah diam-diam pada
 * perubahan berikutnya — dan perpisahan itu berbentuk rate card yang
 * menampilkan satu angka sementara honor dibayarkan dengan angka lain.
 *
 * Admin & klien yang memanggil fungsi ini memperoleh `berlaku: null` dan
 * `riwayat: []` untuk SETIAP varian — itu RLS yang menjawab, bukan penyaringan
 * di sini.
 */
export async function ambilRateCard(hariIni: string): Promise<BarisRateCard[]> {
  const supabase = await createServerSupabase();

  const [{ data: fase }, { data: layanan }, { data: varian }, tarif] = await Promise.all([
    supabase.from("phases").select("id, nama, urutan").order("urutan").returns<BarisFase[]>(),
    supabase
      .from("services")
      .select("id, phase_id, nama, aktif")
      // Yang masih ditawarkan di atas: halaman ini dibaca dari atas ke bawah
      // untuk menjawab "berapa yang kami kenakan sekarang".
      .order("aktif", { ascending: false })
      .order("nama")
      .returns<BarisLayananRate[]>(),
    // Katalog varian (bukan tarifnya) — RLS "service_variants: baca
    // terautentikasi" menjawab TRUE untuk siapa pun yang login, jadi baris ini
    // tetap ada bagi admin & klien; hanya `tarif` di bawah yang disaring RLS
    // milik owner.
    supabase
      .from("service_variants")
      .select("id, service_id, label, durasi_menit, format, urutan")
      .order("urutan")
      .returns<BarisVarianRate[]>(),
    ambilTarif(),
  ]);

  const namaFase = new Map((fase ?? []).map((f) => [f.id, f.nama] as const));
  const urutanFase = new Map((fase ?? []).map((f) => [f.id, f.urutan] as const));

  const susun = (t: TarifRingkas, berlakuId: string | null): TarifRiwayat => ({
    id: t.id,
    hargaKlien: t.hargaKlien,
    hargaCoret: t.hargaCoret,
    honorMitra: t.honorMitra,
    margin: t.hargaKlien - t.honorMitra,
    berlakuSejak: t.berlakuSejak,
    berlakuSekarang: t.id === berlakuId,
    belumBerlaku: t.berlakuSejak > hariIni,
  });

  // Fase dulu (urutan perjalanan klien), lalu yang masih aktif, lalu abjad —
  // layanan dulu, lalu varian di dalamnya menurut `urutan` kolomnya sendiri.
  // Diurutkan di sini dan bukan lewat `.order()` PostgREST: urutan fase hidup
  // di kolom `phases.urutan`, tabel lain, yang tidak bisa dijadikan kunci urut
  // tanpa embed — dan embed-nya akan menyaring baris menurut RLS tabel itu.
  const terurut = [...(layanan ?? [])].sort((a, b) => {
    const selisih = (urutanFase.get(a.phase_id) ?? 99) - (urutanFase.get(b.phase_id) ?? 99);
    if (selisih !== 0) return selisih;
    if (a.aktif !== b.aktif) return a.aktif ? -1 : 1;
    return a.nama.localeCompare(b.nama, "id");
  });

  const varianPerLayanan = new Map<string, BarisVarianRate[]>();
  for (const v of varian ?? []) {
    const daftar = varianPerLayanan.get(v.service_id) ?? [];
    daftar.push(v);
    varianPerLayanan.set(v.service_id, daftar);
  }
  for (const daftar of varianPerLayanan.values()) daftar.sort((a, b) => a.urutan - b.urutan);

  return terurut.flatMap((l) =>
    (varianPerLayanan.get(l.id) ?? []).map((v) => {
      const berlaku = tarifPadaTanggal(tarif, v.id, hariIni);
      const riwayat = tarif
        .filter((t) => t.variantId === v.id)
        .map((t) => susun(t, berlaku?.id ?? null))
        // `ambilTarif()` sudah mengurutkan menurun, tetapi urutan itu milik
        // seluruh tabel; sesudah disaring per varian ia ditegaskan ulang di
        // sini supaya riwayat tidak pernah bergantung pada urutan baris
        // PostgREST.
        .sort((a, b) => (a.berlakuSejak > b.berlakuSejak ? -1 : a.berlakuSejak < b.berlakuSejak ? 1 : 0));

      return {
        variantId: v.id,
        serviceId: l.id,
        namaLayanan: l.nama,
        labelVarian: labelVarian({ label: v.label, durasiMenit: v.durasi_menit, format: v.format }),
        namaFase: namaFase.get(l.phase_id) ?? "Tanpa fase",
        aktif: l.aktif,
        berlaku: berlaku === null ? null : susun(berlaku, berlaku.id),
        riwayat,
      };
    }),
  );
}

type BarisSesi = {
  id: string;
  service_id: string;
  variant_id: string;
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
 * `variant_id` ikut ditarik: `hitungRekap()` mencocokkan tarif ke sesi lewat
 * VARIAN, bukan layanan — harga menempel di sana sejak Task 3.
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
      "id, service_id, variant_id, partner_id, tanggal, status, client_package_id, updated_at, services(nama), partners(nama)",
    )
    .order("tanggal", { ascending: false })
    .returns<BarisSesi[]>();

  return (data ?? []).map((r) => ({
    id: r.id,
    serviceId: r.service_id,
    variantId: r.variant_id,
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
 *
 * TIDAK ADA pemanggil produksi lagi — beranda owner kini menurunkan angkanya
 * dari elemen terakhir `deretPekanTerakhir()`. Fungsi ini tetap hidup sebagai
 * ORAKEL INDEPENDEN di `tests/owner-kerangka.test.ts`: angka yang tampil di
 * halaman wajib SAMA dengan yang dihitung fungsi ini, padahal keduanya
 * menempuh jalur kode yang berbeda sama sekali. Jangan dihapus saat
 * membereskan kode — menghapusnya berarti ikut menghapus satu-satunya
 * pemeriksaan silang yang membuktikan kedua jalur itu sepakat.
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
