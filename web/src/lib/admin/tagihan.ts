import { createServerSupabase } from "@/lib/supabase/server";
import { formatTanggalID } from "@/lib/passport/waktu";
import { labelVarian, type FormatVarian } from "@/lib/varian";
import type { PayStatus } from "@/lib/passport/turunan";
import { LABEL_JENJANG, type JenjangTransport } from "@/lib/transport/jarak";

export type ItemTagihanAdmin = {
  jenis: "paket" | "sesi";
  id: string;
  namaKlien: string;
  padmaId: string;
  label: string;
  /**
   * Rincian transport (Task 9, Ruling 16 — fix round 1). `null` untuk setiap
   * item paket, dan untuk item sesi yang tidak berjenjang, atau berjenjang
   * `di_atas_20` tapi tarif per-kasusnya BELUM ditetapkan owner (lihat
   * gerbang di `daftarTagihanAdmin()`).
   *
   * SENGAJA sebuah MEDAN pada item sesi yang sudah ada — BUKAN item kedua
   * ber-`id` yang sama. Draf pertama Task 9 menambahkan item transport KEDUA
   * dengan `id` sama seperti sesinya, dan itu bug: `hitungKlaimMenunggu()`
   * menghitung baris `sessions` (satu per sesi) sementara daftar ini
   * menghitung ITEM (dua per sesi berjenjang) — badge dan tabel berselisih
   * persis pada sesi yang paling sering terjadi (jenjang diisi OTOMATIS saat
   * sesi lahir, `app/admin/sesi/aksi.ts`). Satu sesi punya SATU
   * `status_bayar`, jadi ia wajib menghasilkan SATU item.
   */
  rincianTransport: string | null;
  status: PayStatus;
};

type BarisPaket = {
  id: string;
  status_bayar: PayStatus;
  clients: { nama: string; padma_id: string } | null;
  packages: { nama: string; jumlah_sesi: number } | null;
};

type BarisSesi = {
  id: string;
  status_bayar: PayStatus;
  tanggal: string;
  variant_id: string | null;
  jenjang: JenjangTransport | null;
  clients: { nama: string; padma_id: string } | null;
  services: { nama: string } | null;
};

type BarisVarian = {
  id: string;
  label: string;
  durasi_menit: number | null;
  format: FormatVarian | null;
};

type BarisMenungguTransport = { id: string };

// Yang menunggu verifikasi naik ke atas — itulah pekerjaan admin hari ini.
const URUT: Record<PayStatus, number> = {
  menunggu_verifikasi: 0,
  belum: 1,
  lunas: 2,
};

/**
 * Seluruh tagihan klinik yang bisa diputuskan admin, satu daftar untuk semua
 * klien.
 *
 * SARINGANNYA WAJIB IDENTIK dengan `susunTagihan()` di `@/lib/passport/turunan`
 * + `ambilPaket()` di `@/lib/passport/data` — yaitu daftar yang benar-benar
 * dilihat KLIEN:
 *   - paket: hanya yang berstatus 'aktif';
 *   - sesi: hanya yang LEPAS (`client_package_id is null`) dan tidak batal.
 *
 * Saringan naif (`status_bayar <> 'lunas'`) mengembalikan tujuh baris tambahan
 * pada data seed, semuanya sesi anggota paket yang SUDAH lunas. Karena
 * transisi `belum -> lunas` diizinkan basis data, admin benar-benar bisa
 * "melunasi" tujuh tagihan hantu itu — dan menulis tujuh baris jejak audit
 * untuk keputusan yang tidak pernah ada uangnya. Sesi di dalam paket mengikuti
 * status paketnya; `sessions.status_bayar` hanya relevan untuk sesi lepas, dan
 * sejak `sessions_bayar_hanya_lepas` itu ditegakkan constraint.
 *
 * Sesi pengguna, bukan service role: RLS staf yang mengizinkan bacaan ini, dan
 * di bawah service role `user_role()` justru mengembalikan 'klien'.
 *
 * Nominal tidak pernah ikut: tabel tarif & honor mengembalikan [] untuk admin
 * (HTTP 200, kosong senyap), dan besaran uang disampaikan tim PADMA lewat
 * WhatsApp (keputusan #10). Berkas ini karena itu tidak pernah menyebut satu
 * pun tabel uang — dan itu diuji.
 *
 * Label sesi menyertakan LABEL varian sejak layanan punya lebih dari satu
 * harga (Task 1-6): dua sesi layanan yang sama bisa berbeda harga bila
 * variannya berbeda (mis. 60 menit vs 90 menit), dan label yang hanya
 * menyebut nama layanan membuat admin — atau klien lewat WhatsApp — menagih
 * varian yang salah tanpa satu pun jalan untuk sadar. Dirangkai lewat
 * `labelVarian()` (`@/lib/varian`), SATU-SATUNYA perangkai label varian di
 * proyek ini; jangan menulis perangkai kedua di sini.
 */
export async function daftarTagihanAdmin(): Promise<ItemTagihanAdmin[]> {
  const supabase = await createServerSupabase();

  // Embed `clients`/`packages`/`services` aman: ketiganya foreign key sungguhan.
  // (Embed ke `jejak_status_bayar` atau `profiles` yang GAGAL — PGRST200 —
  // adalah embed ke tabel tanpa FK; keduanya sengaja tidak dipakai di sini.)
  //
  // `service_variants` TIDAK di-embed langsung dari `sessions`: FK-nya
  // gabungan (service_id, variant_id), dan PostgREST butuh hint constraint
  // untuk embed semacam itu. Pola yang sudah dipakai `ambilSesiRekap()`
  // (`@/lib/owner/data`) diikuti di sini — tarik `variant_id` mentah, lalu
  // cocokkan ke katalog varian yang ditarik terpisah.
  const [{ data: paket }, { data: sesi }, { data: varian }, { data: menunggu }] =
    await Promise.all([
      supabase
        .from("client_packages")
        .select("id, status_bayar, clients(nama, padma_id), packages(nama, jumlah_sesi)")
        .eq("status", "aktif")
        .returns<BarisPaket[]>(),
      supabase
        .from("sessions")
        .select(
          "id, status_bayar, tanggal, variant_id, jenjang, clients(nama, padma_id), services(nama)",
        )
        .is("client_package_id", null)
        .neq("status", "batal")
        // `tanggal` bertipe date dan sudah berupa YYYY-MM-DD: urutannya
        // diserahkan ke Postgres, tidak pernah ke aritmatika Date di JS.
        .order("tanggal", { ascending: false })
        .returns<BarisSesi[]>(),
      // Katalog varian saja (bukan tarifnya) — RLS "service_variants: baca
      // terautentikasi" menjawab TRUE untuk siapa pun yang login, jadi baris
      // ini tetap ada bagi admin.
      supabase
        .from("service_variants")
        .select("id, label, durasi_menit, format")
        .returns<BarisVarian[]>(),
      // (Task 9, Ruling 17) Sesi `di_atas_20` yang BELUM punya tarif per-kasus
      // — dibaca dari VIEW `sesi_menunggu_tarif_transport` (Task 8, migrasi
      // `20260907140000`), BUKAN dengan mencoba membaca tabel nominalnya
      // langsung: RLS tabel itu ("hanya owner") akan memulangkan `[]` untuk
      // admin tanpa error, dan `[]` yang dibaca naif sebagai "tidak ada yang
      // menunggu" akan membuat SETIAP sesi >20 km lolos seolah sudah
      // bertarif. View ini sudah jadi satu-satunya definisi "menunggu tarif
      // khusus" untuk badge (`hitungMenungguTarifTransport`) & daftar owner
      // (`ambilSesiMenungguTarif`, `lib/owner/data.ts`) — dipakai ULANG di
      // sini, bukan predikat ketiga yang bisa berpisah diam-diam. Proyeksinya
      // NOL NOMINAL (id, nama_klien, tanggal); hanya `id` yang diambil.
      supabase
        .from("sesi_menunggu_tarif_transport")
        .select("id")
        .returns<BarisMenungguTransport[]>(),
    ]);

  const varianPerId = new Map((varian ?? []).map((v) => [v.id, v] as const));
  const menungguTransportId = new Set((menunggu ?? []).map((m) => m.id));

  const item: ItemTagihanAdmin[] = [];

  for (const p of paket ?? []) {
    item.push({
      jenis: "paket",
      id: p.id,
      namaKlien: p.clients?.nama ?? "—",
      padmaId: p.clients?.padma_id ?? "—",
      label: `${p.packages?.nama ?? "Paket"} · ${p.packages?.jumlah_sesi ?? 0} sesi`,
      // Paket tidak pernah punya rincian transport sendiri: harganya tetap/
      // pre-paid per paket, bukan per sesi — lihat Ruling 18 di `hitungRekap()`
      // (lib/owner/rekap.ts) untuk keputusan uang yang sama pada sisi owner.
      rincianTransport: null,
      status: p.status_bayar,
    });
  }

  for (const s of sesi ?? []) {
    const namaLayanan = s.services?.nama ?? "Layanan";
    const v = s.variant_id ? varianPerId.get(s.variant_id) : undefined;
    // Varian baku (label kosong, durasi & format NULL) memulangkan string
    // kosong dari `labelVarian()` — label lama (hanya nama layanan) sengaja
    // dipertahankan apa adanya untuk kasus itu, bukan diberi akhiran kosong.
    const varLabel = v
      ? labelVarian({ label: v.label, durasiMenit: v.durasi_menit, format: v.format })
      : "";

    // Rincian TRANSPORT (Task 9) — TANPA NOMINAL sama sekali (money
    // firewall), teksnya IDENTIK huruf demi huruf dengan `susunTagihan()`
    // (`@/lib/passport/turunan`): keduanya merangkai dari `LABEL_JENJANG`
    // (`@/lib/transport/jarak`), SATU-SATUNYA sumber. Dikunci lewat uji
    // parity di tests/admin-bayar.test.ts.
    //
    // `di_atas_20` yang MASIH di `sesi_menunggu_tarif_transport` (Ruling 17)
    // TIDAK mendapat rincian: view itu adalah satu-satunya definisi "tarif
    // per-kasusnya belum ditetapkan", dan menampilkan rincian untuk sesi yang
    // nominalnya belum pernah ditetapkan siapa pun berarti menagih admin
    // untuk sesuatu yang tidak ada. Begitu owner menetapkannya, sesi itu
    // lenyap dari view — dan rincian ini muncul, TETAP tanpa nominal apa pun
    // (hanya label ">20 km").
    const rincianTransport =
      s.jenjang !== null && !(s.jenjang === "di_atas_20" && menungguTransportId.has(s.id))
        ? `Transport · ${LABEL_JENJANG[s.jenjang]} · ${formatTanggalID(s.tanggal)}`
        : null;

    item.push({
      jenis: "sesi",
      id: s.id,
      namaKlien: s.clients?.nama ?? "—",
      padmaId: s.clients?.padma_id ?? "—",
      // Label ini IDENTIK huruf demi huruf dengan yang dibaca klien di
      // `susunTagihan()` (`@/lib/passport/turunan`) — sejak Ruling 13 (Task 9)
      // keduanya merangkai lewat `labelVarian()` yang SAMA persis, dari medan
      // varian yang sama, dengan komposisi "<layanan> · <varian?> · <tanggal>"
      // yang sama. Dikunci lewat uji parity di
      // `tests/admin-bayar.test.ts` ("label klien dan label admin IDENTIK
      // huruf demi huruf untuk sesi ber-varian yang sama") — bila salah satu
      // sisi berubah tanpa yang lain, uji itu yang harus merah duluan, bukan
      // komentar ini yang dibiarkan berbohong.
      label:
        varLabel === ""
          ? `${namaLayanan} · ${formatTanggalID(s.tanggal)}`
          : `${namaLayanan} · ${varLabel} · ${formatTanggalID(s.tanggal)}`,
      rincianTransport,
      status: s.status_bayar,
    });
  }

  // Komparator mengembalikan 0 untuk peringkat kembar: komparator yang
  // mengembalikan 1 untuk elemen setara melanggar kontrak Array#sort.
  return item.sort((a, b) => URUT[a.status] - URUT[b.status]);
}
