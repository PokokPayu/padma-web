"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { penggunaSaatIni } from "@/lib/auth/sesi";
import { createServerSupabase } from "@/lib/supabase/server";
import { geocodeAlamat } from "@/lib/transport/geocode";
import { normalkanAlamat } from "@/lib/transport/alamat";
import { BATAS_PERMINTAAN_MENUNGGU } from "./batas";
import { periksaAlamat } from "./status";
import { hariIniJakarta } from "./waktu";
import { bentukJamSah } from "@/lib/jadwal/jam";
import { bacaPengaturan } from "@/lib/settings";
import {
  PERMINTAAN_AWAL,
  PERMINTAAN_DIBATALKAN_KLIEN,
  STATUS_ANTRE,
} from "@/lib/jadwal/status";

/**
 * SATU-SATUNYA jalur tulis milik klien.
 *
 * Server action adalah endpoint POST tersendiri: ia dapat dipanggil tanpa
 * melewati UI, sehingga penjaga di `src/app/passport/layout.tsx` TIDAK berlaku
 * di sini. `requireRole(["klien"])` karena itu ditulis di dalam action.
 *
 * Parameter action sengaja TIDAK memuat status tujuan. Begitu status datang
 * dari browser, seluruh rancangan runtuh: verifikasi manual admin bisa
 * dilompati klien sendiri. Nilai tujuan selalu hardcoded di berkas ini.
 */
type Gagal = { ok: false; pesan: string };
type Berhasil = { ok: true };

async function klienSaatIni(): Promise<string | null> {
  await requireRole(["klien"]);

  const user = await penggunaSaatIni();
  if (!user) return null;

  const supabase = await createServerSupabase();

  // Identitas klien selalu diturunkan dari SESI, tidak pernah dari parameter —
  // itulah yang membuat filter kepemilikan di bawah bermakna.
  const { data } = await supabase
    .from("clients")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

export async function klaimSudahBayar(
  jenis: "paket" | "sesi",
  id: string,
): Promise<Berhasil | Gagal> {
  const clientId = await klienSaatIni();
  if (!clientId) return { ok: false, pesan: "Akun belum terhubung." };

  // SESI PENGGUNA, bukan service role. Di bawah service role `auth.uid()`
  // NULL dan `user_role()` jatuh ke 'klien', sehingga trigger jejak audit
  // mencatat `peran_aktor='service_role'` tanpa aktor — tepat kebalikan dari
  // alasan tabel jejak itu dibuat (sengketa "saya sudah transfer" vs "belum
  // masuk"). Karena klien memang tidak punya policy UPDATE atas dua tabel itu,
  // tulisannya lewat fungsi `security definer` yang JWT-nya ikut terbawa:
  // kepemilikan (auth.uid() -> clients) dan syarat status asal dijaga DI DALAM
  // fungsi, dan tujuannya hardcoded di sana — tidak ada argumen status di sini
  // maupun di sana.
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("klaim_sudah_bayar", {
    jenis,
    sasaran_id: id,
  });

  if (error) return { ok: false, pesan: "Gagal memproses." };
  // UPDATE yang tertahan menghasilkan 0 baris TANPA error — jangan melaporkan
  // "berhasil" tanpa memeriksa jumlah barisnya.
  const terpengaruh = (data ?? []) as string[];
  if (terpengaruh.length === 0) {
    return { ok: false, pesan: "Item tidak ditemukan atau statusnya sudah berubah." };
  }

  revalidatePath("/passport/bayar");
  return { ok: true };
}

const WAKTU_SAH = ["pagi", "siang", "sore"];

export async function ajukanJadwal(formData: FormData): Promise<Berhasil | Gagal> {
  const clientId = await klienSaatIni();
  if (!clientId) return { ok: false, pesan: "Akun belum terhubung." };

  const serviceId = String(formData.get("layanan") ?? "");
  const variantId = String(formData.get("varian") ?? "");
  const tanggal = String(formData.get("tanggal") ?? "");
  const waktu = String(formData.get("waktu") ?? "");
  const catatan = String(formData.get("catatan") ?? "").slice(0, 300);

  // Kolom `tanggal` bertipe date dan hidup sebagai string YYYY-MM-DD di
  // seluruh aplikasi — bentuknya diperiksa apa adanya, tanpa aritmatika Date
  // (server berjalan UTC, mesin dev WIB).
  if (!serviceId || !variantId || !/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) {
    return { ok: false, pesan: "Lengkapi layanan, varian, dan tanggal." };
  }
  if (!WAKTU_SAH.includes(waktu)) {
    return { ok: false, pesan: "Preferensi waktu tidak sah." };
  }

  // JAM MULAI (spec J2) — dua pemeriksaan, bukan satu.
  //
  // BENTUK ditolak lebih dulu supaya masukan sampah tidak pernah sampai ke
  // query pengaturan. Lalu KEANGGOTAAN diperiksa terhadap daftar yang
  // benar-benar berlaku hari ini, dan daftar itu dibaca DI SERVER — tidak
  // pernah dipercaya dari FormData. `<select>` di layar bisa disunting siapa
  // saja lewat devtools, dan server action adalah endpoint POST tersendiri yang
  // tidak pernah melewati layar itu.
  //
  // Kenapa jam WAJIB, bukan opsional: seluruh kebijakan pembatalan C3
  // bersandar pada "≥ 24 jam sebelum sesi" dan "< 2 jam". Pengajuan tanpa jam
  // adalah pengajuan yang tenggatnya tidak bisa dihitung sama sekali.
  const jam = String(formData.get("jam") ?? "");
  if (!bentukJamSah(jam)) {
    return { ok: false, pesan: "Pilih jam mulai layanan." };
  }
  const { jamLayanan } = await bacaPengaturan();
  if (!jamLayanan.includes(jam)) {
    return { ok: false, pesan: "Jam itu tidak tersedia. Pilih salah satu jam yang ditawarkan." };
  }

  // Alamat WAJIB di sini (spec T6) — beda dari profil klien/domisili mitra
  // yang boleh kosong. Mitra harus tahu ke mana ia datang; format diperiksa
  // sebagai fungsi murni di `./status`, terpisah dari geocoding di bawah.
  const cekAlamat = periksaAlamat(String(formData.get("alamat") ?? ""));
  if (!cekAlamat.ok) return { ok: false, pesan: cekAlamat.pesan };

  // Perbandingan STRING, bukan aritmatika Date: kolom `tanggal` bertipe date
  // dan hidup sebagai 'YYYY-MM-DD'. "Hari ini" diambil dari kalender Jakarta —
  // server berjalan UTC, jadi jam mesin akan salah hari selama 7 jam setiap
  // hari. Regex di atas hanya memeriksa RUPA tanggal; ini yang memeriksa NILAI
  // (red team meloloskan 2020-01-01 lewat celah itu).
  if (tanggal < hariIniJakarta()) {
    return { ok: false, pesan: "Tanggal sudah lewat. Pilih tanggal mulai hari ini." };
  }

  const supabase = await createServerSupabase();

  // Layanan harus AKTIF. Foreign key hanya menolak service_id yang TIDAK ADA,
  // sedangkan formulir menyaring `aktif` di UI — dan server action adalah
  // endpoint POST tersendiri yang tidak pernah melewati UI itu.
  const { data: layanan } = await supabase
    .from("services")
    .select("id")
    .eq("id", serviceId)
    .eq("aktif", true)
    .maybeSingle();
  if (!layanan) {
    return { ok: false, pesan: "Layanan tidak tersedia untuk saat ini." };
  }

  // Varian harus AKTIF dan milik LAYANAN yang sama — keduanya disaring dalam
  // satu query, bukan hanya `id`, supaya "varian milik layanan lain" ditolak
  // dengan kalimat yang bisa dibaca, bukan sekadar kode Postgres dari FK
  // gabungan (yang tetap menjadi lapisan terakhir, tidak dilepas di sini).
  const { data: varian } = await supabase
    .from("service_variants")
    .select("id")
    .eq("id", variantId)
    .eq("service_id", serviceId)
    .eq("aktif", true)
    .maybeSingle();
  if (!varian) {
    return { ok: false, pesan: "Varian tidak tersedia untuk layanan ini." };
  }

  // Pembatas antrean. Penegak sebenarnya ada di basis data (trigger
  // guard_booking_pembatas + unique index booking_requests_antrean_unik),
  // karena klien memegang policy INSERT dan bisa memanggil PostgREST langsung.
  // Dua pemeriksaan di bawah ada untuk PESAN yang bisa dibaca manusia, bukan
  // sebagai pagar — pagarnya sudah dipasang sebelum lapisan ini.
  const { count } = await supabase
    .from("booking_requests")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .in("status", STATUS_ANTRE);
  if ((count ?? 0) >= BATAS_PERMINTAAN_MENUNGGU) {
    return {
      ok: false,
      pesan: `Masih ada ${BATAS_PERMINTAAN_MENUNGGU} permintaan yang menunggu jawaban tim PADMA. Tunggu kabarnya dulu, ya.`,
    };
  }

  const { data: kembar } = await supabase
    .from("booking_requests")
    .select("id")
    .eq("client_id", clientId)
    .eq("service_id", serviceId)
    .eq("tanggal", tanggal)
    .eq("preferensi_waktu", waktu)
    .in("status", STATUS_ANTRE)
    .limit(1);
  if ((kembar ?? []).length > 0) {
    return { ok: false, pesan: "Permintaan yang sama sudah terkirim dan sedang diproses." };
  }

  // Geocoding TIDAK PERNAH menggagalkan penyimpanan (spec T6). `geocodeAlamat`
  // sudah menelan setiap galatnya dan memulangkan null; yang tersisa di sini
  // hanyalah menyimpan apa adanya, termasuk ketika koordinatnya tidak ada.
  // Dipanggil SESUDAH seluruh pemeriksaan lain lolos — supaya permintaan yang
  // pasti ditolak (layanan mati, tanggal lampau, dst.) tidak ikut membakar
  // jatah 1 permintaan/detik Nominatim untuk sesuatu yang tidak akan tersimpan.
  // Alamat yang TIDAK diubah klien mewarisi koordinat profilnya — titik yang
  // sudah dijatuhkan dan dibenarkan admin di peta. Formulir ini terisi otomatis
  // dari profil, jadi mayoritas pengajuan lewat jalur ini, dan mewarisi jawaban
  // manusia jelas lebih baik daripada menanyakan ulang kepada OSM yang untuk
  // alamat Malang sebagian besar tidak tahu (26 dari 32 gagal; lihat §1 spec
  // pemilih-lokasi).
  //
  // Ini TIDAK melanggar spec T6 ("jangan ambil ulang alamat dari profil"). Yang
  // T6 cegah adalah berubahnya ALAMAT tujuan mitra ketika klien memesan untuk
  // tempat lain. Di sini perbandingannya menuntut teks yang IDENTIK, sehingga
  // tidak ada alamat yang berubah — yang diwarisi hanyalah jawaban atas
  // pertanyaan yang sudah pernah dijawab manusia. MELONGGARKAN perbandingan ini
  // (mis. mencocokkan sebagian, atau mengabaikan nomor rumah) mengembalikan
  // persis bahaya yang T6 cegah.
  const { data: profil } = await supabase
    .from("clients")
    .select("alamat, alamat_lat, alamat_lon")
    .eq("id", clientId)
    .maybeSingle();

  const warisan =
    profil &&
    profil.alamat_lat !== null &&
    profil.alamat_lon !== null &&
    normalkanAlamat(String(profil.alamat ?? "")) === normalkanAlamat(cekAlamat.nilai)
      ? { lat: profil.alamat_lat as number, lon: profil.alamat_lon as number }
      : null;

  const koordinat = warisan ?? (await geocodeAlamat(cekAlamat.nilai));

  // SKRINING WAJIB (spec J3). Id-nya TIDAK datang dari formulir — ia dicari di
  // sini, dari skrining HIJAU milik klien yang belum dipakai pengajuan mana
  // pun. Menerimanya dari FormData berarti mempercayai peramban menyebut
  // skrining mana yang menopang pengajuannya, dan satu-satunya yang menahan
  // penyalahgunaannya tinggal trigger basis data.
  //
  // "Belum dipakai" cukup disaring terhadap pengajuan MILIK KLIEN INI:
  // `guard_booking_skrining` sudah menjamin sebuah skrining hanya bisa
  // menopang pengajuan pemiliknya sendiri, jadi tidak ada pengajuan orang lain
  // yang bisa memegangnya.
  const { data: skriningTerpakai } = await supabase
    .from("booking_requests")
    .select("screening_id")
    .eq("client_id", clientId);
  const sudahDipakai = new Set(
    (skriningTerpakai ?? []).map((b) => b.screening_id as string),
  );

  const { data: skriningHijau } = await supabase
    .from("screenings")
    .select("id, created_at")
    .eq("client_id", clientId)
    .eq("hasil", "hijau")
    // Yang TERBARU lebih dulu: bila klien skrining dua kali karena kondisinya
    // berubah, yang menopang pemesanannya harus jawaban terakhirnya.
    .order("created_at", { ascending: false });

  const kandidat = (skriningHijau ?? [])
    .map((s) => s.id as string)
    .filter((id) => !sudahDipakai.has(id));

  const skriningPakai = kandidat[0] ? { id: kandidat[0] } : undefined;

  if (!skriningPakai) {
    return {
      ok: false,
      pesan:
        "Isi skrining keselamatan dulu sebelum mengajukan jadwal — satu skrining untuk satu pengajuan.",
    };
  }

  // Insert memakai SESI PENGGUNA, bukan service role: RLS + trigger
  // guard_booking_status menjadi lapis kedua di belakang nilai hardcoded ini.
  // Nilai apa pun yang ikut dikirim browser di FormData diabaikan — hanya
  // medan di bawah yang pernah menyentuh basis data.
  // PEMILIHAN SKRINING ADALAH BACA-LALU-TULIS, dan itu bisa kalah balapan.
  //
  // Dua pengiriman bersamaan dari klien yang sama membaca daftar "belum
  // terpakai" yang identik, lalu keduanya menulis skrining yang sama — yang
  // kedua ditolak indeks unik `booking_requests_skrining_unik` dengan 23505,
  // dan klien membaca "Gagal mengirim permintaan" untuk pengajuan yang
  // sebenarnya sah.
  //
  // Yang membatasi berapa banyak pengajuan boleh hidup adalah KUOTA ANTREAN,
  // bukan siapa yang menang balapan. Karena itu bentrok skrining dicoba ulang
  // dengan kandidat berikutnya, bukan dilaporkan sebagai kegagalan.
  //
  // Ditemukan oleh uji 50-pengiriman-serentak, bukan oleh pembacaan kode:
  // hasilnya berselang-seling 3, 4, lalu 5 baris untuk kuota yang sama.
  // Nilai yang sudah lolos penyempitan tipe diikat SEBELUM perulangan: di
  // dalam blok, TypeScript kehilangan penyempitan atas union `cekAlamat`.
  const alamatFinal = cekAlamat.nilai;

  let error: { code?: string } | null = null;
  for (const idSkrining of kandidat) {
    const { error: e } = await supabase.from("booking_requests").insert({
      client_id: clientId,
      service_id: serviceId,
      variant_id: variantId,
      tanggal,
      jam_mulai: jam,
      preferensi_waktu: waktu,
      catatan,
      alamat: alamatFinal,
      alamat_lat: koordinat?.lat ?? null,
      alamat_lon: koordinat?.lon ?? null,
      screening_id: idSkrining,
      status: PERMINTAAN_AWAL, // hardcoded; trigger DB menolak nilai lain dari klien
    });
    error = e;
    // 23505 = bentrok indeks unik. Satu-satunya yang unik pada baris ini selain
    // id adalah `screening_id` dan dedup antrean — dan dedup antrean sudah
    // ditolak lebih awal dengan kalimatnya sendiri, jadi sampai di sini 23505
    // berarti skriningnya keburu dipakai pengiriman lain.
    if (e?.code !== "23505") break;
  }

  if (error) return { ok: false, pesan: "Gagal mengirim permintaan." };

  revalidatePath("/passport");
  return { ok: true };
}

/**
 * Klien membatalkan pengajuannya sendiri (spec J8).
 *
 * Ada karena admin berhenti menolak pengajuan. Tanpa jalan keluar ini, klien
 * yang mengajukan lima tanggal yang tidak bisa dilayani terkunci selamanya:
 * `BATAS_PERMINTAAN_MENUNGGU` penuh, dan tidak seorang pun punya cara
 * membereskannya. Kendali atas antrean berpindah ke pemiliknya.
 *
 * Penegaknya ada di basis data — policy "booking: klien membatalkan miliknya"
 * plus tiga trigger yang mempersempitnya ke "barisnya sendiri, dari keadaan
 * antrean, tanpa menyentuh medan apa pun". Yang dilakukan di sini hanyalah
 * memulangkan KALIMAT yang bisa dibaca manusia; ia bukan pagar.
 */
export async function batalkanPengajuan(permintaanId: string): Promise<Berhasil | Gagal> {
  const clientId = await klienSaatIni();
  if (!clientId) return { ok: false, pesan: "Akun belum terhubung." };

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("booking_requests")
    .update({ status: PERMINTAAN_DIBATALKAN_KLIEN })
    .eq("id", permintaanId)
    .eq("client_id", clientId) // pagar kedua; yang pertama policy RLS
    .in("status", STATUS_ANTRE)
    .select("id");

  if (error) return { ok: false, pesan: "Gagal membatalkan. Coba lagi." };
  // UPDATE yang tertahan menghasilkan 0 baris TANPA error — jangan melaporkan
  // "berhasil" tanpa memeriksa jumlah barisnya.
  if ((data ?? []).length === 0) {
    return {
      ok: false,
      pesan: "Pengajuan ini sudah dikonfirmasi atau sudah dibatalkan sebelumnya.",
    };
  }

  revalidatePath("/passport");
  return { ok: true };
}

/**
 * Klien menilai satu sesi yang sudah selesai (spec C1 J10).
 *
 * DUA angka, bukan satu: layanan dan bidan dinilai terpisah. Dilebur, layanan
 * yang salah rancang akan terbaca sebagai bidan yang buruk — sesi 90 menit yang
 * sebenarnya butuh 120 menit menghasilkan klien kecewa, dan bintangnya jatuh ke
 * orang yang mengerjakannya dengan benar.
 *
 * `partner_id` dan `variant_id` TIDAK dikirim dari sini: trigger
 * `guard_penilaian_sesi` menulis ulang keduanya dari baris sesi, sehingga
 * "salinan keadaan saat itu" menjadi fakta basis data dan bukan janji kode.
 * Yang dikirim hanyalah sesi mana, dua bintang, dan komentar.
 *
 * `upsert` pada `session_id`: orang berhak berubah pikiran tentang bintangnya,
 * tetapi tidak boleh menggandakan penilaiannya. Indeks unik yang menegakkannya.
 */
export async function nilaiSesi(formData: FormData): Promise<Berhasil | Gagal> {
  const clientId = await klienSaatIni();
  if (!clientId) return { ok: false, pesan: "Akun belum terhubung." };

  const sesiId = String(formData.get("sesi") ?? "").trim();
  const layanan = Number(formData.get("bintang_layanan"));
  const bidan = Number(formData.get("bintang_bidan"));
  const komentar = String(formData.get("komentar") ?? "").trim().slice(0, 1000);

  if (!sesiId) return { ok: false, pesan: "Sesi tidak dikenali." };

  // Dua pemeriksaan terpisah supaya kalimatnya menyebut YANG MANA yang belum
  // diisi. "Beri bintang dulu" untuk dua baris bintang adalah pesan yang
  // menyuruh orang menebak.
  const sah = (n: number) => Number.isInteger(n) && n >= 1 && n <= 5;
  if (!sah(layanan)) return { ok: false, pesan: "Beri bintang untuk sesinya (1–5)." };
  if (!sah(bidan)) return { ok: false, pesan: "Beri bintang untuk bidannya (1–5)." };

  const supabase = await createServerSupabase();
  const { error } = await supabase.from("session_ratings").upsert(
    {
      session_id: sesiId,
      // Ketiganya ditulis ulang trigger dari baris sesi; dikirim di sini hanya
      // karena kolomnya NOT NULL. Nilai apa pun yang lolos dari peramban tidak
      // pernah sampai tersimpan.
      client_id: clientId,
      bintang_layanan: layanan,
      bintang_bidan: bidan,
      komentar,
    },
    { onConflict: "session_id" },
  );

  if (error) {
    // Kalimat yang bisa ditindak, bukan kode Postgres. Penyebab yang paling
    // mungkin: sesinya belum selesai, atau bukan miliknya — keduanya ditolak
    // `guard_penilaian_sesi`.
    return { ok: false, pesan: "Penilaian tidak bisa disimpan untuk sesi ini." };
  }

  revalidatePath("/passport");
  return { ok: true };
}
