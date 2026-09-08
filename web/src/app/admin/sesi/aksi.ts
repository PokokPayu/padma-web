"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { JENJANG_SAH, periksaAlasanPenimpaan } from "./status";
import { saranJenjang } from "@/lib/transport/saran";
import type { JenjangTransport } from "@/lib/transport/jarak";
import { PERMINTAAN_SIAP_KONFIRMASI, STATUS_ANTRE } from "@/lib/jadwal/status";

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
 * Mengubah satu permintaan jadwal menjadi sesi terjadwal.
 *
 * Hanya DUA nilai yang boleh datang dari luar: permintaan mana, dan mitra siapa
 * yang ditugaskan. Tanggal, klien, dan layanan dibaca dari baris permintaannya.
 */
export async function konfirmasiPermintaan(
  permintaanId: string,
  partnerId: string,
): Promise<Berhasil | Gagal> {
  await requireRole(["admin", "owner"]);
  const supabase = await createServerSupabase();

  // Mitra diperiksa SEBELUM permintaan diklaim. Dua alasan: (a) foreign key
  // hanya menolak partner_id yang TIDAK ADA, bukan mitra yang sudah pensiun,
  // sedangkan daftar pilihan di UI menyaring `aktif` — dan action ini tidak
  // pernah melewati UI itu; (b) memeriksanya belakangan berarti permintaan
  // sudah terlanjur keluar dari antrean untuk sesuatu yang pasti gagal.
  // `lat`/`lon` ikut dibaca di sini (Ruling 11): inilah jalur KEDUA yang
  // menugaskan mitra ke sebuah sesi, dan booking_requests sudah punya
  // koordinatnya sendiri (Task 6) — saran jenjang dihitung & disimpan
  // langsung bersama sesi yang terbit, bukan menunggu action terpisah yang
  // tidak akan pernah dipanggil siapa pun untuk sesi yang lahir dari sini.
  const { data: mitra } = await supabase
    .from("partners")
    .select("id, lat, lon")
    .eq("id", partnerId)
    .eq("aktif", true)
    .maybeSingle();

  if (!mitra) {
    return { ok: false, pesan: "Mitra tidak tersedia. Pilih mitra yang aktif." };
  }

  // KLAIM DULU, baru buat sesi. Urutan ini penting: bila sesi dibuat lebih dulu
  // lalu klaim gagal, tertinggal sesi yatim sementara permintaannya tetap di
  // antrean menunggu dikonfirmasi untuk kedua kalinya.
  //
  // `eq("status", PERMINTAAN_SIAP_KONFIRMASI)` bukan sekadar validasi: ia yang menyerialkan dua
  // konfirmasi paralel. Transaksi kedua menunggu kunci baris, lalu menilai
  // ulang syaratnya terhadap baris yang sudah berubah — dan tidak mengenai apa
  // pun. Index unik `sessions_booking_request_unik` adalah jaring keduanya.
  const { data: klaim } = await supabase
    .from("booking_requests")
    .update({ status: "dikonfirmasi" })
    .eq("id", permintaanId)
    .eq("status", PERMINTAAN_SIAP_KONFIRMASI)
    .select("id, client_id, service_id, variant_id, tanggal, alamat, alamat_lat, alamat_lon");

  // UPDATE yang tidak mengenai baris mana pun dijawab PostgREST dengan 200 + []
  // — melaporkan "berhasil" tanpa memeriksa jumlah barisnya adalah kebohongan
  // senyap, dan di sini kebohongannya berbentuk sesi yang tidak pernah lahir.
  if ((klaim ?? []).length === 0) {
    return { ok: false, pesan: "Permintaan sudah ditangani atau tidak ditemukan." };
  }
  const p = klaim![0];

  // Saran jenjang dihitung dari koordinat yang SUDAH ada di baris ini —
  // tidak ada pemilih untuk ditimpa admin di jalur konfirmasi (spec §5.2
  // hanya menyebut penimpaan di layar memilih mitra; di sini keputusan
  // "mitra mana" dan "jenjang berapa" jatuh bersamaan pada klik yang sama).
  // Koordinat kosong bukan galat — `saranJenjang()` memulangkan `null`, dan
  // jenjangnya tetap NULL: admin menetapkannya belakangan lewat
  // `tetapkanJenjang`.
  const koordinatMitra =
    mitra.lat != null && mitra.lon != null ? { lat: mitra.lat, lon: mitra.lon } : null;
  const koordinatSesi =
    p.alamat_lat != null && p.alamat_lon != null
      ? { lat: p.alamat_lat, lon: p.alamat_lon }
      : null;
  const saran = saranJenjang(koordinatMitra, koordinatSesi);

  const { error } = await supabase.from("sessions").insert({
    client_id: p.client_id,
    service_id: p.service_id,
    variant_id: p.variant_id,
    partner_id: partnerId,
    tanggal: p.tanggal,
    // Alamat & koordinat DISALIN dari baris permintaan ini, bukan diambil
    // ulang dari profil klien (spec T6) — persis pola `variant_id` di atas.
    // Klien boleh memesan untuk alamat lain; mengambil ulang dari profil akan
    // diam-diam mengubah ke mana mitra dikirim.
    alamat: p.alamat,
    alamat_lat: p.alamat_lat,
    alamat_lon: p.alamat_lon,
    // `jenjang_sumber` ditulis MATI sebagai 'otomatis' — atau `null` bersama
    // `jenjang` bila tidak ada saran — tidak pernah 'admin': jalur ini tidak
    // membaca FormData sama sekali (lihat dokblok atas), jadi tidak ada
    // klaim pemanggil untuk dipercaya atau ditolak.
    jenjang: saran?.jenjang ?? null,
    jenjang_sumber: saran ? "otomatis" : null,
    jenjang_alasan: "",
    status: "terjadwal",
    booking_request_id: p.id,
  });

  if (error) {
    // Kembalikan ke antrean supaya permintaan tidak hilang diam-diam. Syarat
    // `eq("status","dikonfirmasi")` menjaga agar pengembalian ini tidak pernah
    // menimpa keputusan orang lain yang sempat masuk di sela-selanya.
    await supabase
      .from("booking_requests")
      .update({ status: PERMINTAAN_SIAP_KONFIRMASI })
      .eq("id", p.id)
      .eq("status", "dikonfirmasi");
    return { ok: false, pesan: "Gagal membuat sesi. Coba lagi." };
  }

  revalidatePath("/admin/sesi");
  revalidatePath("/admin");
  // Sesi baru langsung tampil di passport klien sebagai jadwal berikutnya.
  revalidatePath("/passport");
  return { ok: true };
}

/**
 * Menolak permintaan jadwal — hanya dari antrean.
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
  const pakaiPaket = formData.get("pakai_paket") !== null;

  if (!clientId || !serviceId || !variantId || !partnerId) {
    return { ok: false, pesan: "Klien, layanan, varian, dan mitra wajib dipilih." };
  }
  if (!POLA_TANGGAL.test(tanggal)) {
    return { ok: false, pesan: "Tanggal harus berformat YYYY-MM-DD." };
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
