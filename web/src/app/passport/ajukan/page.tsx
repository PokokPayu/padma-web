import Link from "next/link";
import { notFound } from "next/navigation";
import { ambilKlien } from "@/lib/passport/data";
import { hariIniJakarta } from "@/lib/passport/waktu";
import { createServerSupabase } from "@/lib/supabase/server";
import { bacaPengaturan } from "@/lib/settings";
import { labelVarian, type FormatVarian } from "@/lib/varian";
import { formatRupiah } from "@/lib/rupiah-publik";
import { FormAjukan } from "./form";
import type { LayananKatalogAjukan } from "./katalog";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: "Ajukan Jadwal" };

/**
 * DIRENDER PER PERMINTAAN, TANPA PENGECUALIAN.
 *
 * Halaman ini memutuskan hal yang berubah dari detik ke detik: apakah klien
 * punya skrining hijau yang belum terpakai. Skrining bisa lahir semenit yang
 * lalu (dari corong publik lalu tersambung saat login, atau dari
 * `/passport/skrining`), dan sebuah skrining HANGUS begitu dipakai.
 *
 * Ditemukan lewat E2E yang gagal BERSELANG-SELING: halaman menampilkan
 * "Isi skrining keselamatan dulu" padahal skrining hijaunya ada di basis data.
 * Bagi klien sungguhan kalimat itu berbohong — ia baru saja menyelesaikan
 * skrining dan disuruh mengulanginya.
 *
 * Penandaan DINAMIS, bukan penandaan revalidasi maupun pembungkus cache manual:
 * keduanya dilarang di seluruh `src/app/passport/**` (dijaga
 * tests/passport-shell.test.ts) karena respons satu klien tidak boleh pernah
 * dibagikan ke klien lain. Yang dipakai di sini justru kebalikannya — ia
 * memastikan TIDAK ADA yang dibagikan.
 */
export const dynamic = "force-dynamic";

type BarisVarian = {
  id: string;
  service_id: string;
  label: string;
  durasi_menit: number | null;
  format: FormatVarian | null;
};

type BarisLayanan = { id: string; nama: string; phase_id: string; deskripsi: string };

type BarisFase = { id: string; nama_sanskrit: string; nama: string; urutan: number };

/** Baris view `harga_publik` — proyeksi berkolom sempit, TANPA `honor_mitra`. */
type BarisHargaPublik = {
  variant_id: string;
  harga_klien: number;
  harga_coret: number | null;
  berlaku_sejak: string;
};

export default async function HalamanAjukan() {
  const klien = await ambilKlien();
  if (!klien) notFound(); // layout sudah menangani; ini penjaga tipe

  // Daftar layanan DAN varian dibaca dengan SESI PENGGUNA (bukan bacaKatalog
  // yang memakai anon key untuk halaman publik) supaya klien melihat katalog
  // yang sama seperti yang boleh ia minta — RLS tetap yang menyaring. Dua
  // query terpisah (bukan embed): FK `service_variants` ke `services` bukan
  // yang dipakai relasi sesi (gabungan service_id+id), dan pola dua-query yang
  // sama sudah dipakai di seluruh proyek untuk katalog varian.
  //
  // Alamat profil dibaca lewat jalur SESI PENGGUNA yang sama (bukan service
  // role, bukan `ambilKlien()` yang di-cache lintas-halaman) — Ruling 9 T6:
  // hanya untuk MENGISI AWAL medan alamat di formulir (spec T7 desain), klien
  // tetap bebas mengubahnya. `ajukanJadwal` sendiri TIDAK PERNAH membaca
  // kolom ini — nilai yang tersimpan selalu apa yang ada di FormData saat
  // submit, prefilled atau tidak.
  const supabase = await createServerSupabase();
  // Daftar jam dibaca dari `app_settings` (spec J2): jam operasional klinik akan
  // berubah, dan perubahan seperti itu tidak boleh menuntut deploy. Dibaca di
  // SERVER — nilai yang sama dipakai ulang sebagai pagar di `ajukanJadwal`,
  // sehingga apa yang ditawarkan layar dan apa yang diterima server tidak
  // pernah bisa berselisih.
  const [
    { jamLayanan, nomorWaLink },
    { data: layanan },
    { data: varian },
    { data: profil },
    { data: fase },
    { data: harga },
  ] = await Promise.all([
    bacaPengaturan(),
    supabase
      .from("services")
      // `deskripsi` ikut dibaca sejak katalog klien menampilkannya. Kolomnya
      // `not null default ''`, jadi layanan yang belum dideskripsikan
      // memulangkan string kosong — bukan null — dan katalog tinggal
      // melewatinya.
      .select("id, nama, phase_id, deskripsi")
      .eq("aktif", true)
      .order("nama")
      .returns<BarisLayanan[]>(),
    supabase
      .from("service_variants")
      .select("id, service_id, label, durasi_menit, format")
      .eq("aktif", true)
      .order("urutan")
      .returns<BarisVarian[]>(),
    supabase
      .from("clients")
      .select("alamat")
      .eq("id", klien.id) // operator setara, tidak pernah pola
      .maybeSingle<{ alamat: string }>(),
    supabase
      .from("phases")
      .select("id, nama_sanskrit, nama, urutan")
      .order("urutan")
      .returns<BarisFase[]>(),
    // View `harga_publik` — SUDAH ADA dan sudah dipakai landing sejak spec V4
    // §4.4 memutuskan harga klien tampil publik. Nol permukaan data baru, nol
    // pelonggaran money firewall: `honor_mitra` tidak pernah diproyeksikan
    // view ini, dan daftar kolomnya dikunci tests/harga-publik.test.ts.
    //
    // Dibaca lewat SESI PENGGUNA, bukan `bacaKatalog()` yang memakai anon key:
    // halaman ini berautentikasi, dan mencampur dua jenis klien Supabase dalam
    // satu halaman hanya menambah satu jalur yang bisa berselisih.
    supabase
      .from("harga_publik")
      .select("variant_id, harga_klien, harga_coret, berlaku_sejak")
      .returns<BarisHargaPublik[]>(),
  ]);

  // LAPIS PERTAMA GERBANG SKRINING (spec J3, K5).
  //
  // Tanpa skrining hijau yang belum terpakai, yang tampil adalah AJAKAN, bukan
  // formulir. Ini lapis pertama dari tiga — server action menolak dengan
  // kalimat, dan `guard_booking_skrining` menolak barisnya. Lapis ini yang
  // paling ramah dan paling mudah dilewati; dua lainnya yang mengikat.
  //
  // Perhitungan "belum terpakai" sama persis dengan yang dipakai `ajukanJadwal`
  // — disengaja: layar yang menawarkan formulir lalu ditolak server adalah
  // layar yang berbohong.
  const [{ data: skriningKlien }, { data: pengajuanKlien }] = await Promise.all([
    supabase
      .from("screenings")
      .select("id")
      .eq("client_id", klien.id)
      .eq("hasil", "hijau"),
    supabase.from("booking_requests").select("screening_id").eq("client_id", klien.id),
  ]);

  const terpakai = new Set((pengajuanKlien ?? []).map((b) => b.screening_id as string));
  const punyaSkriningHijau = (skriningKlien ?? []).some((s) => !terpakai.has(s.id as string));

  if (!punyaSkriningHijau) {
    return (
      <section className="rounded-2xl border border-black/10 bg-white p-7 text-center">
        <h1 className="font-serif text-xl text-night">Isi skrining keselamatan dulu</h1>
        <p className="mx-auto mt-2 max-w-sm text-[13.5px] text-[#415247]">
          Setiap pemesanan berdiri di atas satu skrining. Isinya singkat, dan jawabannya membantu
          tim menyiapkan layanan yang aman untuk kondisi Anda hari ini.
        </p>
        <Link
          href="/passport/skrining"
          className="mt-5 inline-block rounded-xl bg-gold px-6 py-3 font-bold text-night"
        >
          Mulai skrining
        </Link>
      </section>
    );
  }

  // Harga yang BERLAKU HARI INI: `berlaku_sejak` terbesar yang masih ≤ hari
  // ini menurut kalender Jakarta. Aturannya sama persis dengan
  // `tarifPadaTanggal()` dan `tarifTransportPadaTanggal()`; ditulis di sini
  // karena bentuk barisnya berbeda (view, bukan tabel tarif) dan karena yang
  // dikunci di sini adalah HARI INI, bukan tanggal sesi — katalog memperlihatkan
  // harga saat memesan, sementara tagihan dikunci tanggal sesinya.
  const hariIni = hariIniJakarta();
  const hargaPerVarian = new Map<string, { harga: number; coret: number | null; sejak: string }>();
  for (const h of harga ?? []) {
    const sejak = h.berlaku_sejak;
    if (sejak > hariIni) continue;
    const ada = hargaPerVarian.get(h.variant_id);
    if (ada && ada.sejak >= sejak) continue;
    hargaPerVarian.set(h.variant_id, {
      harga: h.harga_klien,
      coret: h.harga_coret ?? null,
      sejak,
    });
  }

  const fasePerId = new Map((fase ?? []).map((f) => [f.id, f]));

  // Urutan tampil per LAYANAN, dicatat saat fasenya masih diketahui. Layanan
  // yang fasenya tak terbaca jatuh ke belakang, bukan ke depan — halaman tetap
  // memesan, cuma kelompoknya yang tak bertajuk.
  const urutanPerLayanan = new Map<string, number>(
    (layanan ?? []).map((l) => [
      l.id,
      fasePerId.get(l.phase_id)?.urutan ?? Number.MAX_SAFE_INTEGER,
    ]),
  );

  const katalog: LayananKatalogAjukan[] = (layanan ?? []).map((l) => {
    const f = fasePerId.get(l.phase_id);
    return {
      id: l.id,
      nama: l.nama,
      namaFase: f ? `${f.nama_sanskrit} · ${f.nama}` : "",
      // Id fase, BUKAN namanya: ia yang memilih ikon dan yang dicocokkan
      // dengan `clients.phase_id` saat menentukan chip mana yang terbuka
      // lebih dulu. Nama fase bisa diganti klien lewat panel; idnya tidak.
      faseId: l.phase_id,
      deskripsi: l.deskripsi,
      varian: (varian ?? [])
        .filter((v) => v.service_id === l.id)
        .map((v) => {
          const h = hargaPerVarian.get(v.id);
          return {
            id: v.id,
            serviceId: v.service_id,
            // `labelVarian()` — SATU-SATUNYA perangkai label varian di proyek
            // ini. Varian baku memulangkan string kosong, dan itu SAH; katalog
            // menampilkannya sebagai "Standar", persis seperti <select> yang
            // digantikannya. Dipakai di sini supaya pilihan di wizard klien
            // terbaca sama persis dengan yang admin dan landing tampilkan
            // untuk varian yang sama.
            label: labelVarian({ label: v.label, durasiMenit: v.durasi_menit, format: v.format }),
            hargaKlien: h ? formatRupiah(h.harga) : null,
            hargaCoret: h?.coret != null ? formatRupiah(h.coret) : null,
            // Angka mentah ikut dikirim HANYA untuk menghitung rentang harga
            // di baris layanan yang tertutup. Formatnya tetap satu pintu:
            // yang tampil sebagai harga selalu hasil `formatRupiah()`.
            hargaAngka: h ? h.harga : null,
          };
        }),
    };
  });

  // Kelompok fase tampil dalam URUTAN PERJALANAN yang sama dengan landing
  // (`phases.urutan`), bukan urutan abjad nama layanan: klien yang sudah
  // melihat lini layanan di landing menemukan kembali susunan yang sama.
  // `Array.prototype.sort` stabil, jadi di DALAM satu fase urutan abjad dari
  // `.order("nama")` tetap terjaga.
  katalog.sort(
    (a, b) =>
      (urutanPerLayanan.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
      (urutanPerLayanan.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );

  // `min` hanyalah kenyamanan pemakai — penolakan tanggal lampau yang sungguh
  // mengikat ada di server action dan di trigger basis data. Atribut HTML bisa
  // dihapus siapa saja lewat devtools.
  return (
    <FormAjukan
      katalog={katalog}
      faseKlien={klien.faseId}
      // Nomor PADMA sendiri, jadi `nomorWaTerpakai()` (yang punya nomor
      // cadangan) memang yang benar di sini — bukan `nomorWaKlien()` yang
      // sengaja tanpa cadangan karena tujuannya orang lain.
      waLink={nomorWaLink}
      namaKlien={klien.nama}
      jamPilihan={jamLayanan}
      tanggalPalingAwal={hariIniJakarta()}
      alamatDefault={profil?.alamat ?? ""}
    />
  );
}
