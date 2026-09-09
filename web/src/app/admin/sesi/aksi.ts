"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { JENJANG_SAH, periksaAlasanPenimpaan } from "./status";
import { saranJenjang } from "@/lib/transport/saran";
import { bentukJamSah } from "@/lib/jadwal/jam";
import { bacaPengaturan } from "@/lib/settings";
import type { JenjangTransport } from "@/lib/transport/jarak";
import {
  PERMINTAAN_AWAL,
  PERMINTAAN_DICARIKAN,
  PERMINTAAN_MENUNGGU_BAYAR,
  PERMINTAAN_SIAP_KONFIRMASI,
  STATUS_ANTRE,
} from "@/lib/jadwal/status";
import { JAM_TENGGAT_BAYAR } from "@/lib/tagihan/tenggat";

/**
 * Jalur tulis panel admin untuk antrean permintaan jadwal.
 *
 * Empat aturan yang mengikat berkas ini:
 *
 *  1. Server action adalah ENDPOINT POST TERSENDIRI. Penjaga di
 *     `src/app/admin/layout.tsx` tidak pernah dilewati saat action dipanggil
 *     langsung, jadi `requireRole(["admin","owner"])` ditulis DI DALAM setiap
 *     action. Tanpa itu, klien yang login bisa menyetujui permintaan jadwalnya
 *     sendiri — celah yang pernah nyata di proyek ini.
 *
 *  2. KEADAAN TUJUAN TIDAK PERNAH MENJADI PARAMETER. Karena itu ada dua action
 *     terpisah, `konfirmasiPermintaan` dan `tolakPermintaan`, masing-masing
 *     dengan status tertulis mati di dalamnya.
 *
 *  3. IDENTITAS KLIEN DIBACA DARI BARIS PERMINTAAN, bukan dari pemanggil. Bila
 *     `client_id`/`service_id` datang dari payload, satu POST yang dikarang
 *     bisa melahirkan sesi atas nama klien lain — dan sesi itu akan tampil di
 *     passport orang tersebut sebagai janji yang tidak pernah ia minta.
 *
 *  4. Sesi pengguna, bukan service role. Di bawah service role `user_role()`
 *     mengembalikan 'klien' dan `auth.uid()` NULL: policy `booking: staf` dan
 *     `sessions: staf` tidak pernah ikut diperiksa.
 *
 * Berkas `"use server"` hanya boleh mengekspor fungsi async — label dan daftar
 * putih tinggal di `status.ts`.
 */
type Gagal = { ok: false; pesan: string };
type Berhasil = { ok: true };

// Tanggal divalidasi sebagai TEKS, bukan lewat `new Date(...)`: kolom `tanggal`
// bertipe `date` dan sudah berupa YYYY-MM-DD, sedangkan `new Date("2026-12-27")`
// adalah tengah malam UTC — di zona mana pun sebelah barat ia mundur sehari.
// Aturan yang sama berlaku di seluruh proyek (lihat `@/lib/passport/waktu`).
const POLA_TANGGAL = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

// Catatan bidan masuk ke `sessions.catatan` yang bertipe `text` tanpa batas.
// Batas ditegakkan di sini supaya satu tempelan raksasa tidak menjadi payload
// yang harus dirender ulang pada setiap kunjungan passport klien.
const BATAS_CATATAN = 2000;

/**
 * `diminta` -> `mencari_mitra`. Menandai bahwa permintaan ini sedang ditangani.
 *
 * Keadaannya berarti sesuatu bagi klien: passport menampilkan "sedang
 * dicarikan bidan" alih-alih diam. Itulah alasan ia keadaan tersendiri dan
 * bukan sekadar layar yang terbuka di sisi admin.
 */
export async function cariMitra(permintaanId: string): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();

  // DUA keadaan asal, bukan satu: `diminta` (mulai mencari) dan `mitra_siap`
  // (GANTI bidan). Tanpa yang kedua, permintaan yang bidannya berhalangan —
  // atau dinonaktifkan di sela-sela — tersangkut permanen: `konfirmasiPermintaan`
  // menyuruh "pilih mitra lain" sementara tidak ada satu pun layar yang bisa
  // melakukannya, dan admin tidak lagi punya tombol tolak (spec J8).
  //
  // `partner_id` DILEPAS bersamaan. Membiarkannya menempel akan membuat
  // `mencari_mitra` menyimpan nama bidan yang sudah tidak jadi datang — dan
  // CHECK `booking_requests_mitra_siap_bermitra` tidak menahannya, karena ia
  // hanya menuntut ADA-nya mitra pada dua status berikutnya.
  const { data } = await supabase
    .from("booking_requests")
    .update({ status: PERMINTAAN_DICARIKAN, partner_id: null })
    .eq("id", permintaanId)
    .in("status", [PERMINTAAN_AWAL, PERMINTAAN_SIAP_KONFIRMASI])
    .select("id");

  // UPDATE yang tidak mengenai baris mana pun dijawab PostgREST dengan 200 + []
  // — melaporkan "berhasil" tanpa memeriksa jumlah barisnya adalah kebohongan
  // senyap.
  if ((data ?? []).length === 0) {
    return { ok: false, pesan: "Permintaan sudah ditangani atau tidak ditemukan." };
  }
  revalidatePath("/admin/sesi");
  revalidatePath("/admin");
  revalidatePath("/passport");
  return { ok: true };
}

/**
 * `mencari_mitra` -> `mitra_siap`, sekaligus mencatat SIAPA mitranya.
 *
 * Status dan `partner_id` ditulis dalam SATU update, bukan dua: dua update
 * terpisah bisa meninggalkan 'mitra_siap' tanpa mitra bila yang kedua gagal,
 * dan itulah keadaan yang dicegah CHECK `booking_requests_mitra_siap_bermitra`.
 * Menulis keduanya sekaligus membuat CHECK itu tidak pernah perlu menyala.
 */
export async function pilihMitra(
  permintaanId: string,
  partnerId: string,
): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();

  // Mitra diperiksa SEBELUM permintaan digeser. Foreign key hanya menolak
  // partner_id yang TIDAK ADA, bukan mitra yang sudah pensiun — sedangkan
  // daftar pilihan di UI menyaring `aktif`, dan action ini tidak pernah
  // melewati UI itu.
  const { data: mitra } = await supabase
    .from("partners")
    .select("id")
    .eq("id", partnerId)
    .eq("aktif", true)
    .maybeSingle();

  if (!mitra) {
    return { ok: false, pesan: "Mitra tidak tersedia. Pilih mitra yang aktif." };
  }

  const { data } = await supabase
    .from("booking_requests")
    .update({ status: PERMINTAAN_SIAP_KONFIRMASI, partner_id: partnerId })
    .eq("id", permintaanId)
    .eq("status", PERMINTAAN_DICARIKAN)
    .select("id");

  if ((data ?? []).length === 0) {
    return { ok: false, pesan: "Permintaan sudah ditangani atau tidak ditemukan." };
  }
  revalidatePath("/admin/sesi");
  revalidatePath("/admin");
  revalidatePath("/passport");
  return { ok: true };
}

/**
 * `mitra_siap` -> `menunggu_bayar`: menerbitkan tagihan (spec C2 P1, P3).
 *
 * Terbit TEPAT di sini, tidak lebih awal, dan alasannya struktural: tarif
 * transport berasal dari domisili MITRA ke alamat KLIEN, jadi total tagihan
 * tidak bisa diketahui sebelum bidannya dipilih.
 *
 * `tenggat` diisi server, bukan diterima dari pemanggil — tenggat yang bisa
 * disebut peramban adalah tenggat yang bisa dipanjangkan sendiri.
 */
export async function terbitkanTagihan(permintaanId: string): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();

  const tenggat = new Date(Date.now() + JAM_TENGGAT_BAYAR * 3_600_000).toISOString();

  const { data } = await supabase
    .from("booking_requests")
    .update({ status: PERMINTAAN_MENUNGGU_BAYAR, tenggat })
    .eq("id", permintaanId)
    // Hanya dari `mitra_siap`. Memanggilnya dua kali karena itu TIDAK
    // memperpanjang tenggat — yang kedua tidak mengenai baris mana pun.
    .eq("status", PERMINTAAN_SIAP_KONFIRMASI)
    .select("id");

  if ((data ?? []).length === 0) {
    return { ok: false, pesan: "Permintaan sudah ditangani atau tidak ditemukan." };
  }

  revalidatePath("/admin/sesi");
  revalidatePath("/admin");
  revalidatePath("/passport");
  revalidatePath("/passport/bayar");
  return { ok: true };
}

/**
 * Mengubah satu permintaan jadwal menjadi sesi terjadwal.
 *
 * SATU nilai yang boleh datang dari luar: permintaan mana. Mitra dibaca dari
 * baris permintaan (dipilih lebih dulu lewat `pilihMitra`), dan tanggal, jam,
 * klien, layanan, serta alamat ikut dari sana.
 *
 * ===== KENAPA LEWAT RPC, BUKAN DUA TULISAN DARI SINI =====
 * Konfirmasi adalah dua tulisan yang harus berlaku sebagai satu keputusan:
 * status permintaan, lalu baris sesi. Dikerjakan dari sini keduanya adalah dua
 * round-trip terpisah, dan kegagalan di antaranya meninggalkan permintaan
 * terkonfirmasi tanpa sesi — hilang dari antrean admin sekaligus dari passport
 * klien, tanpa satu pun error. Versi sebelumnya menambal itu dengan
 * mengembalikan status secara manual; kompensasi seperti itu bisa gagal juga.
 *
 * `konfirmasi_permintaan()` menjadikannya satu transaksi, sehingga kegagalan
 * parsial lenyap sebagai KELAS masalah. Yang tinggal di sini adalah bagian yang
 * memang milik TypeScript: menghitung saran jenjang (rumus jaraknya hidup di
 * satu bahasa saja) dan menerjemahkan hasil menjadi kalimat untuk manusia.
 */
export async function konfirmasiPermintaan(permintaanId: string): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();

  // Koordinat dibaca lebih dulu supaya saran jenjang bisa dihitung di sini.
  // `partners` di-embed lewat `partner_id` pada baris permintaan — mitranya
  // sudah dipilih di langkah sebelumnya.
  const { data: p } = await supabase
    .from("booking_requests")
    .select("id, partners ( aktif )")
    .eq("id", permintaanId)
    .eq("status", PERMINTAAN_MENUNGGU_BAYAR)
    .maybeSingle<{ id: string; partners: { aktif: boolean } | null }>();

  if (!p) return { ok: false, pesan: "Permintaan sudah ditangani atau tidak ditemukan." };

  // Mitra bisa dinonaktifkan di sela-sela antara "tetapkan bidan" dan
  // "konfirmasi". Menolak di sini memberi admin kalimat yang bisa ditindak,
  // bukan sesi yang lahir untuk orang yang sudah pensiun. Tombol "Ganti bidan"
  // ada di layar yang sama, jadi kalimatnya menunjuk sesuatu yang nyata.
  if (!p.partners?.aktif) {
    return { ok: false, pesan: "Bidan sudah tidak aktif. Tekan “Ganti bidan” lebih dulu." };
  }

  // SATU argumen, dan tidak satu pun nilai turunan ikut menyeberang. Jenjang
  // jarak dihitung DI DALAM fungsi dari koordinat yang sudah tersimpan —
  // sebelumnya ia dihitung di sini lalu dioper, dan pemanggil yang menyodorkan
  // angka karangan tetap mendapatkannya tercatat sebagai hasil hitungan
  // otomatis. Kesetaraan rumus SQL dan TypeScript dijaga
  // tests/jarak-sql-vs-ts.test.ts.
  const { data: sesiId, error } = await supabase.rpc("konfirmasi_permintaan", {
    permintaan_id: permintaanId,
  });

  if (error) return { ok: false, pesan: "Gagal mengonfirmasi. Coba lagi." };
  // Fungsi memulangkan NULL ketika klaimnya tidak mengenai baris mana pun —
  // itu BUKAN galat, dan melaporkannya sebagai keberhasilan adalah kebohongan
  // senyap yang berbentuk sesi yang tidak pernah lahir.
  if (!sesiId) return { ok: false, pesan: "Permintaan sudah ditangani atau tidak ditemukan." };

  revalidatePath("/admin/sesi");
  revalidatePath("/admin");
  revalidatePath("/passport");
  return { ok: true };
}

/**
 * Menolak permintaan jadwal — TIDAK LAGI TERJANGKAU DARI LAYAR (spec C1 J8).
 *
 * Klien memutuskan admin untuk sementara tidak menolak pengajuan: yang
 * membatalkan adalah kliennya sendiri, lewat `batalkanPengajuan` di Passport.
 * Tombolnya sudah hilang dari layar permintaan admin, dan
 * tests/pembatalan-klien.test.ts menjaga agar tidak ada berkas di `src/` yang
 * memanggil fungsi ini.
 *
 * Fungsinya SENGAJA tidak dihapus, persis pola saklar paket
 * (`lib/paket-tampil.ts`): nilai enum `ditolak` dan penjaganya tetap di
 * tempatnya, hanya jalan menuju layar yang ditutup. Menghapusnya berarti
 * membongkar sesuatu yang keadaannya SEMENTARA.
 *
 * Permintaan yang sudah dikonfirmasi TIDAK bisa dibatalkan lewat sini: sesinya
 * sudah lahir, dan memutar status permintaan hanya akan membuat sesi itu
 * kehilangan asal-usulnya tanpa membatalkan apa pun. Pembatalan sesi adalah
 * status `batal` pada sesinya sendiri.
 */
export async function tolakPermintaan(permintaanId: string): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from("booking_requests")
    .update({ status: "ditolak" })
    .eq("id", permintaanId)
    .in("status", STATUS_ANTRE)
    .select("id");

  if (error || (data ?? []).length === 0) {
    return { ok: false, pesan: "Permintaan sudah ditangani atau tidak ditemukan." };
  }

  revalidatePath("/admin/sesi");
  revalidatePath("/admin");
  revalidatePath("/passport");
  return { ok: true };
}

/**
 * Menjadwalkan sesi LANGSUNG — tanpa melewati antrean permintaan.
 *
 * Jalur ini ada karena sebagian besar jadwal klinik lahir di telepon, bukan di
 * aplikasi. Bedanya dengan `konfirmasiPermintaan`: di sini memang admin yang
 * memilih kliennya, jadi `client_id` boleh datang dari formulir — yang
 * menjaganya adalah `requireRole` di atas, bukan asal-usul nilainya.
 *
 * Satu nilai yang TETAP tidak boleh datang dari formulir adalah
 * `client_package_id`. Paket dibaca dari klien yang dipilih: bila ia boleh
 * dikirim, satu POST yang dikarang bisa menempelkan sesi seorang klien pada
 * paket klien lain — progres orang itu bertambah tanpa ia pernah dikunjungi,
 * dan tidak ada foreign key yang keberatan karena paketnya memang ada.
 *
 * Status sesi tertulis mati: `terjadwal`. Sesi tidak pernah lahir "selesai" —
 * catatan bidannya belum ada, dan stempel passport akan terbit kosong.
 */
export async function jadwalkanSesi(formData: FormData): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);

  const clientId = String(formData.get("client_id") ?? "").trim();
  const serviceId = String(formData.get("service_id") ?? "").trim();
  const variantId = String(formData.get("variant_id") ?? "").trim();
  const partnerId = String(formData.get("partner_id") ?? "").trim();
  const tanggal = String(formData.get("tanggal") ?? "").trim();
  // Jam WAJIB (spec J2). Dua pemeriksaan, sama seperti jalur klien: BENTUK
  // lebih dulu, lalu KEANGGOTAAN pada daftar yang berlaku hari ini — dan
  // daftar itu dibaca di server, bukan dipercaya dari FormData.
  const jam = String(formData.get("jam") ?? "").trim();
  const pakaiPaket = formData.get("pakai_paket") !== null;

  if (!clientId || !serviceId || !variantId || !partnerId) {
    return { ok: false, pesan: "Klien, layanan, varian, dan mitra wajib dipilih." };
  }
  if (!POLA_TANGGAL.test(tanggal)) {
    return { ok: false, pesan: "Tanggal harus berformat YYYY-MM-DD." };
  }
  if (!bentukJamSah(jam)) {
    return { ok: false, pesan: "Pilih jam mulai sesi." };
  }
  const { jamLayanan } = await bacaPengaturan();
  if (!jamLayanan.includes(jam)) {
    return { ok: false, pesan: "Jam itu tidak tersedia. Pilih salah satu jam layanan." };
  }

  const supabase = await createServerSupabase();

  // Ketiganya diperiksa SEBELUM menulis. Foreign key memang menolak id yang
  // tidak ada, tetapi pesannya adalah kode Postgres — dan untuk mitra maupun
  // layanan ia sama sekali tidak menolong: yang sudah dipensiunkan tetap ada
  // barisnya. Formulir menyaring `aktif` di UI, dan server action adalah
  // endpoint POST tersendiri yang tidak pernah melewati UI itu.
  // `alamat_lat`/`alamat_lon` (klien) dan `lat`/`lon` (mitra) ikut dibaca di
  // sini (Ruling 11): inilah layar tempat mitra DITUGASKAN untuk sesi baru,
  // dan kedua koordinat sudah diketahui pada klik yang sama — jenjang
  // transport dihitung & disimpan langsung, bukan lewat action terpisah yang
  // tidak akan pernah dipanggil siapa pun untuk sesi yang lahir dari sini.
  // Alamat SESI ini sendiri belum ada (jalur langsung tidak mengumpulkannya),
  // jadi alamat DEFAULT klien dipakai sebagai perkiraan — persis keputusan
  // yang sama dipakai pratinjau di form-sesi.tsx.
  const [{ data: klien }, { data: layanan }, { data: varian }, { data: mitra }] =
    await Promise.all([
      supabase
        .from("clients")
        .select("id, alamat_lat, alamat_lon")
        .eq("id", clientId)
        .maybeSingle(),
      supabase
        .from("services")
        .select("id")
        .eq("id", serviceId)
        .eq("aktif", true)
        .maybeSingle(),
      // Varian AKTIF dan milik LAYANAN yang sama, disaring dalam satu query —
      // pola yang sama dengan `ajukanJadwal()` (`@/lib/passport/aksi`), supaya
      // "varian milik layanan lain" ditolak sebagai kalimat, bukan sekadar
      // kode Postgres dari FK gabungan (yang tetap menjadi lapisan terakhir).
      supabase
        .from("service_variants")
        .select("id")
        .eq("id", variantId)
        .eq("service_id", serviceId)
        .eq("aktif", true)
        .maybeSingle(),
      supabase
        .from("partners")
        .select("id, lat, lon")
        .eq("id", partnerId)
        .eq("aktif", true)
        .maybeSingle(),
    ]);

  if (!klien) return { ok: false, pesan: "Klien tidak ditemukan." };
  if (!layanan) {
    return { ok: false, pesan: "Layanan tidak tersedia. Pilih layanan yang aktif." };
  }
  if (!varian) {
    return { ok: false, pesan: "Varian tidak tersedia untuk layanan ini." };
  }
  if (!mitra) return { ok: false, pesan: "Mitra tidak tersedia. Pilih mitra yang aktif." };

  // Saran jenjang, dihitung dari koordinat AUTORITATIF yang baru dibaca di
  // atas — bukan dari nilai yang diklaim FormData. `null` berarti sistem
  // tidak punya pendapat (koordinat kosong), dan itu bukan galat: jenjang
  // tetap NULL, admin menetapkannya belakangan lewat `tetapkanJenjang`.
  const koordinatMitra =
    mitra.lat != null && mitra.lon != null ? { lat: mitra.lat, lon: mitra.lon } : null;
  const koordinatKlien =
    klien.alamat_lat != null && klien.alamat_lon != null
      ? { lat: klien.alamat_lat, lon: klien.alamat_lon }
      : null;
  const saran = saranJenjang(koordinatMitra, koordinatKlien);

  // Jenjang final: mengikuti saran ('otomatis') KECUALI admin memilih nilai
  // lain di pemilih ('admin', menuntut alasan). Perbandingannya dilakukan DI
  // SINI, terhadap saran yang dihitung server sendiri — bukan mempercayai
  // klaim FormData soal "ini penimpaan atau bukan". Tanpa saran, jenjang
  // TIDAK PERNAH ditulis dari sini sama sekali, apa pun isi FormData-nya:
  // pemilih di layar hanyalah perkiraan tanpa dasar untuk dibandingkan.
  let jenjangSimpan: JenjangTransport | null = null;
  let sumberSimpan: "otomatis" | "admin" | null = null;
  let alasanSimpan = "";

  if (saran) {
    const jenjangKirim = String(formData.get("jenjang") ?? "").trim();
    if (jenjangKirim && !JENJANG_SAH.includes(jenjangKirim as JenjangTransport)) {
      return { ok: false, pesan: "Jenjang tidak sah. Pilih salah satu jenjang yang tersedia." };
    }
    if (jenjangKirim && jenjangKirim !== saran.jenjang) {
      const alasanCek = periksaAlasanPenimpaan(String(formData.get("alasan") ?? ""));
      if (!alasanCek.ok) {
        return { ok: false, pesan: alasanCek.pesan };
      }
      jenjangSimpan = jenjangKirim as JenjangTransport;
      sumberSimpan = "admin";
      alasanSimpan = alasanCek.nilai;
    } else {
      jenjangSimpan = saran.jenjang;
      sumberSimpan = "otomatis";
    }
  }

  // Paket dibaca dari klien yang dipilih — tidak pernah dari formulir.
  let paketId: string | null = null;
  if (pakaiPaket) {
    const { data: paket } = await supabase
      .from("client_packages")
      .select("id")
      .eq("client_id", clientId)
      .eq("status", "aktif")
      .order("tanggal_mulai", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string }>();
    paketId = paket?.id ?? null;
  }

  const { error } = await supabase.from("sessions").insert({
    client_id: clientId,
    service_id: serviceId,
    variant_id: variantId,
    partner_id: partnerId,
    tanggal,
    jam_mulai: jam,
    status: "terjadwal",
    catatan: "",
    rekomendasi: "",
    client_package_id: paketId,
    jenjang: jenjangSimpan,
    jenjang_sumber: sumberSimpan,
    jenjang_alasan: alasanSimpan,
  });

  if (error) return { ok: false, pesan: "Gagal menyimpan jadwal sesi." };

  revalidatePath("/admin/sesi");
  revalidatePath("/admin");
  // Sesi baru langsung tampil di passport klien sebagai jadwal berikutnya.
  revalidatePath("/passport");
  return { ok: true };
}

/**
 * Menandai sesi SELESAI beserta catatan bidan.
 *
 * Inilah satu-satunya tempat catatan bidan masuk ke passport klien, dan karena
 * itu tiga hal dijaga ketat:
 *
 *  1. `eq("status","terjadwal")` bukan sekadar validasi. Tanpanya, sesi yang
 *     sudah dibatalkan bisa dihidupkan kembali, dan catatan sesi yang sudah
 *     selesai bisa ditimpa diam-diam oleh klik kedua — rekam medis kehilangan
 *     versi aslinya tanpa satu pun error.
 *
 *  2. Catatan wajib berisi. Sesi "selesai" tanpa catatan adalah stempel kosong
 *     di passport: klien melihat kunjungannya bertambah tetapi tidak menerima
 *     apa pun dari kunjungan itu.
 *
 *  3. Keadaan pembayaran TIDAK ikut disentuh — namanya pun tidak disebut di
 *     berkas ini. Keputusan uang punya tabel jejak audit tersendiri (lihat
 *     migration jejak keputusan pembayaran); membuatnya bergerak sebagai efek
 *     samping "tandai selesai" berarti jejak itu mencatat aktor yang benar
 *     untuk keputusan yang tidak pernah diambil siapa pun.
 */
export async function selesaikanSesi(
  sesiId: string,
  formData: FormData,
): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);

  const catatan = String(formData.get("catatan") ?? "").trim();
  const rekomendasi = String(formData.get("rekomendasi") ?? "").trim();

  if (catatan.length === 0) {
    return { ok: false, pesan: "Catatan wajib diisi — inilah yang dibaca klien." };
  }
  if (catatan.length > BATAS_CATATAN || rekomendasi.length > BATAS_CATATAN) {
    return {
      ok: false,
      pesan: `Catatan dan rekomendasi maksimal ${BATAS_CATATAN} karakter.`,
    };
  }

  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from("sessions")
    .update({ status: "selesai", catatan, rekomendasi })
    .eq("id", sesiId)
    .eq("status", "terjadwal")
    .select("id");

  // UPDATE yang tidak mengenai baris mana pun dijawab PostgREST 200 + [] —
  // sesi batal, sesi yang sudah selesai, dan sesi yang tidak ada semuanya
  // mendarat di sini, dan ketiganya bukan keberhasilan.
  if (error || (data ?? []).length === 0) {
    return { ok: false, pesan: "Sesi tidak ditemukan atau sudah ditangani." };
  }

  revalidatePath("/admin/sesi");
  revalidatePath("/admin");
  // Catatan bidan baru terbit di riwayat sesi klien.
  revalidatePath("/passport");
  return { ok: true };
}

/**
 * MENGOREKSI jenjang transport sebuah sesi yang SUDAH ADA.
 *
 * `jadwalkanSesi` dan `konfirmasiPermintaan` sudah menghitung & menyimpan
 * jenjang saat sesinya LAHIR (Ruling 11) — di sanalah mitra ditugaskan dan
 * kedua koordinat sudah diketahui pada klik yang sama, jadi penimpaan admin
 * SAAT MEMBUAT sesi pun ditangani di sana, bukan di sini. Fungsi inilah yang
 * dipakai belakangan: alamat ternyata meleset, geocoding-nya salah, atau
 * sesinya lahir tanpa koordinat sama sekali (`jenjang` masih NULL) dan admin
 * baru sekarang tahu jenjang yang benar. Dipanggil dari formulir "ubah
 * jenjang" di panel geser sesi (`panel-sesi.tsx`).
 *
 * Karena ia mengoreksi sesudah fakta, ia SELALU dianggap penimpaan admin:
 *
 *  1. `jenjang_sumber` ditulis MATI sebagai `'admin'` — keadaan tujuan tidak
 *     pernah datang dari FormData, pola yang sama dengan `status: "selesai"`
 *     di `selesaikanSesi` dan `status: "dikonfirmasi"` di `konfirmasiPermintaan`.
 *     Jenjang bersumber `'otomatis'` hanya lahir di `jadwalkanSesi`/
 *     `konfirmasiPermintaan`, tidak pernah lewat sini.
 *
 *  2. Alasan WAJIB dan divalidasi sebagai KALIMAT di `periksaAlasanPenimpaan`
 *     (status.ts) sebelum menyentuh basis data — CHECK
 *     `sessions_alasan_penimpaan` dari Task 2 tetap ada, tetapi sebagai
 *     lapisan TERAKHIR, bukan satu-satunya. Tanpa validasi di sini, penolakan
 *     yang sampai ke admin adalah kode galat Postgres, bukan kalimat yang bisa
 *     dibaca.
 *
 *  3. `jenjang` diperiksa terhadap `JENJANG_SAH` (daftar putih yang identik
 *     dengan enum `jenjang_transport`) SEBELUM menulis — nilai yang bukan
 *     anggota enum itu ditolak dengan kalimat, bukan menunggu error Postgres
 *     dari CHECK/enum di baris insert.
 *
 * Sengaja TIDAK memeriksa `status` sesi (beda dari `selesaikanSesi`): jenjang
 * adalah data logistik/tagihan yang bisa saja perlu dikoreksi bahkan sesudah
 * sesinya selesai atau batal — riwayat tarifnya tetap harus benar.
 *
 * TIDAK ADA satu rupiah pun di sini: sesi menyimpan JENJANG (data
 * operasional), dan rupiahnya baru diturunkan dari `transport_rates` di panel
 * owner menurut tanggal sesi (money firewall, spec T8/T9).
 */
export async function tetapkanJenjang(formData: FormData): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);

  const sesiId = String(formData.get("sesi") ?? "").trim();
  const jenjangMentah = String(formData.get("jenjang") ?? "").trim();

  if (!sesiId) {
    return { ok: false, pesan: "Sesi wajib dipilih." };
  }
  if (!JENJANG_SAH.includes(jenjangMentah as JenjangTransport)) {
    return { ok: false, pesan: "Jenjang tidak sah. Pilih salah satu jenjang yang tersedia." };
  }

  const alasanCek = periksaAlasanPenimpaan(String(formData.get("alasan") ?? ""));
  if (!alasanCek.ok) {
    return { ok: false, pesan: alasanCek.pesan };
  }

  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from("sessions")
    .update({
      jenjang: jenjangMentah,
      jenjang_sumber: "admin",
      jenjang_alasan: alasanCek.nilai,
    })
    .eq("id", sesiId)
    .select("id");

  // UPDATE yang tidak mengenai baris mana pun dijawab PostgREST 200 + [] —
  // sesi yang tidak ada mendarat di sini, bukan sebagai "berhasil" senyap.
  if (error || (data ?? []).length === 0) {
    return { ok: false, pesan: "Sesi tidak ditemukan." };
  }

  revalidatePath("/admin/sesi");
  revalidatePath("/admin");
  return { ok: true };
}
