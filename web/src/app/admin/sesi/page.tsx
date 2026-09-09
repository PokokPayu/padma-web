import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { ambilDaftarSesi, SARING_SESI } from "@/lib/admin/sesi";
import { pilihanMitra } from "@/lib/admin/mitra";
import { pilihanLayanan, pilihanVarian } from "@/lib/admin/katalog-admin";
import { formatTanggalID, hariIniJakarta } from "@/lib/passport/waktu";
import { uraikanParamDaftar, bangunQuery, type ParamMentah } from "@/app/_shell/panel/daftar";
import { BilahDaftar } from "@/app/_shell/panel/bilah-daftar";
import { Paginasi } from "@/app/_shell/panel/paginasi";
import { PanelGeser } from "@/app/_shell/panel/panel-geser";
import { Bantuan } from "@/app/_shell/panel/bantuan";
import { Tabel, Th, Td } from "@/app/_shell/panel/tabel";
import { PanelPermintaan } from "./panel-permintaan";
import type { MitraPilihan as MitraPilihanPanel } from "./aksi-permintaan";
import {
  ambilDaftarPermintaan,
  SARING_PERMINTAAN,
  SARING_MENUNGGU,
  SARING_RIWAYAT,
  TAB_SESI,
} from "@/lib/admin/permintaan";
import { FormJadwalSesi, type PilihanKlien } from "./form-sesi";
import { PanelSesi } from "./panel-sesi";
import { LABEL_WAKTU, LABEL_STATUS_SESI, KELAS_PILL_SESI } from "./status";
import { LABEL_JENJANG } from "@/lib/transport/jarak";
import { PAKET_TAMPIL } from "@/lib/paket-tampil";
import {
  STATUS_SESI,
  LABEL_SESI,
  STATUS_PERMINTAAN,
  LABEL_PERMINTAAN,
} from "@/lib/jadwal/status";
import { formatJam, jamDariDb } from "@/lib/jadwal/jam";
import { labelSisaWaktu } from "@/lib/tagihan/tenggat";
import { pesanTagihan, tautanWaTagihan, tautanWaPercakapan } from "@/lib/tagihan/pesan-tagihan";
import { daftarTagihanPengajuanAdmin } from "@/lib/admin/tagihan-pengajuan";
import { PERMINTAAN_MENUNGGU_BAYAR } from "@/lib/jadwal/status";
import { urutkanMitraMenurutJarak, labelJarak } from "@/lib/jadwal/urutan-mitra";
import { bacaPengaturan } from "@/lib/settings";
import { nomorWaKlien } from "@/lib/pengaturan/bentuk";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: "Sesi" };

const BASIS = "/admin/sesi";

/**
 * Keadaan pembayaran sebuah permintaan, sebagai satu kalimat.
 *
 * Diformat DI SERVER dengan sengaja: sisa waktu yang dihitung di peramban
 * berbeda antara render server dan render klien, dan ketidakcocokan hidrasinya
 * muncul acak — tidak sebagai galat, melainkan sebagai angka yang sesekali
 * berubah sendiri.
 */
function labelBayarPermintaan(p: {
  statusBayar: "belum" | "menunggu_verifikasi" | "lunas";
  tenggat: string | null;
}): string {
  if (p.statusBayar === "lunas") return "sudah dibayar & diverifikasi";
  if (p.statusBayar === "menunggu_verifikasi") return "bukti masuk, menunggu verifikasi";
  return `belum dibayar · ${labelSisaWaktu(p.tenggat)}`;
}


export default async function SesiPage({
  searchParams,
}: {
  searchParams: Promise<ParamMentah>;
}) {
  await requireRole(["admin", "owner"]);

  const sp = await searchParams;

  // `ubah` MEMAKSA tab `sesi`, apa pun bawaannya. Panel itu milik daftar sesi,
  // dan tautan `?ubah=<id>` yang tersimpan di riwayat browser seseorang harus
  // tetap membuka panelnya — bukan mendarat di tab permintaan dengan panel yang
  // tidak punya daftar induk.
  //
  // `ubah` sengaja TIDAK lewat `uraikanParamDaftar`: ia bukan saringan
  // berdaftar-putih melainkan sebuah id, dan kesahihannya dibuktikan dengan
  // menemukan barisnya di bawah.
  const ubah = typeof sp.ubah === "string" ? sp.ubah : "";
  const tab = ubah !== "" ? "sesi" : sp.tab === "sesi" ? "sesi" : "permintaan";

  const param = uraikanParamDaftar(
    { ...sp, tab },
    tab === "sesi" ? SARING_SESI : SARING_PERMINTAAN,
    TAB_SESI,
  );

  // "Hari ini" menurut Jakarta, bukan menurut jam server (Vercel berjalan UTC).
  const hariIni = hariIniJakarta();
  const supabase = await createServerSupabase();

  // HANYA daftar tab yang aktif yang dimuat — memuat keduanya berarti membayar
  // dua query untuk satu layar, dan yang satu lagi pasti dibuang.
  const [{ jamLayanan }, daftarSesi, daftarPermintaan] = await Promise.all([
    bacaPengaturan(),
    tab === "sesi"
      ? ambilDaftarSesi(param, hariIni)
      : Promise.resolve({ baris: [], total: 0 }),
    tab === "permintaan"
      ? ambilDaftarPermintaan(param)
      : Promise.resolve({ baris: [], total: 0 }),
  ]);

  const barisUbah = ubah === "baru" ? undefined : daftarSesi.baris.find((s) => s.id === ubah);
  const panelTerbuka = ubah === "baru" || barisUbah !== undefined;
  const hrefTutup = `${BASIS}${bangunQuery(param, { ubah: null })}`;

  // `mitra` ditarik untuk SELURUH tab Permintaan, bukan hanya saat panelnya
  // terbuka: panel geser dirender di render yang sama dengan daftarnya, dan
  // `PanelPermintaan` punya cabang sendiri yang menuliskan "Belum ada mitra
  // aktif" bila `mitra.length === 0`. Menariknya lebih sempit membuat kalimat
  // itu berbohong. `klien`/`layanan`/`varian` TETAP bersyarat `ubah === "baru"`
  // saja — ketiganya cuma dipakai formulir "Sesi baru".
  const butuhMitra = ubah === "baru" || tab === "permintaan";
  const [klien, layanan, varian, mitra] = await Promise.all([
    ubah === "baru"
      ? supabase
          .from("clients")
          .select("id, nama, padma_id, alamat_lat, alamat_lon")
          .order("nama")
          .returns<
            { id: string; nama: string; padma_id: string; alamat_lat: number | null; alamat_lon: number | null }[]
          >()
          .then(({ data }) => data ?? [])
      : Promise.resolve([]),
    ubah === "baru" ? pilihanLayanan() : Promise.resolve([]),
    ubah === "baru" ? pilihanVarian() : Promise.resolve([]),
    butuhMitra ? pilihanMitra() : Promise.resolve([]),
  ]);

  // Nominal per pengajuan dipakai SATU tempat: pesan WhatsApp tagihan di panel
  // permintaan. Karena itu ia diambil persis ketika tab Permintaan aktif —
  // bukan selalu (query yang hasilnya dibuang di tab Sesi), dan bukan hanya
  // saat `?lihat=` terisi. Melewatkannya TIDAK terlihat sebagai galat: pesan
  // WhatsApp tetap tersusun rapi, hanya saja nominalnya hilang, dan klien
  // menerima tagihan tanpa angka.
  const tagihanAdmin = tab === "permintaan" ? await daftarTagihanPengajuanAdmin() : [];
  // Barisnya UTUH, bukan hanya totalnya: panel detail kini menampilkan rincian
  // dan sebab, dan pesan WhatsApp merangkai dari medan yang sama. Dua peta
  // untuk satu baris hanya menambah tempat keduanya bisa berselisih.
  const tagihanPerPermintaan = new Map(tagihanAdmin.map((t) => [t.permintaanId, t]));

  // KESAHIHAN `lihat` DIBUKTIKAN DENGAN MENEMUKAN BARISNYA, bukan dengan
  // mempercayai URL — persis pola `ubah` di atas.
  const lihat = typeof sp.lihat === "string" ? sp.lihat : "";
  const barisLihat = daftarPermintaan.baris.find((p) => p.id === lihat);

  // Bidan diurutkan terhadap alamat PERMINTAAN INI. Daftar bersama untuk
  // seluruh antrean akan benar untuk paling banyak satu baris. Diurutkan &
  // diberi label di SERVER: mengoper fungsi penghitung ke komponen klien
  // melanggar batas yang dijaga tests/pagar-batas-server-klien.test.ts.
  const mitraUntukLihat: MitraPilihanPanel[] = barisLihat
    ? urutkanMitraMenurutJarak(
        mitra,
        barisLihat.alamatLat != null && barisLihat.alamatLon != null
          ? { lat: barisLihat.alamatLat, lon: barisLihat.alamatLon }
          : null,
      ).map((m) => ({ id: m.id, nama: m.nama, jarak: labelJarak(m) }))
    : [];

  // Pesannya dirakit DI SERVER: `pesanTagihan` murni, tetapi nominal dan sisa
  // waktunya butuh tarif & jam server.
  //
  // Tujuannya nomor KLIEN, bukan setelan `nomor_wa` klinik. Versi sebelumnya
  // memakai yang kedua, dan bentuk kegagalannya tidak terlihat sebagai galat:
  // WhatsApp terbuka dengan pesan tagihan yang rapi, hanya saja lawan
  // bicaranya PADMA sendiri. Klien tidak pernah ditagih dan tenggat 24 jamnya
  // tetap berjalan. `nomorWaKlien` sengaja TANPA nomor cadangan — lihat
  // alasannya di `@/lib/pengaturan/bentuk`.
  const tagihanLihat = barisLihat ? (tagihanPerPermintaan.get(barisLihat.id) ?? null) : null;

  const tautanWaUntukLihat =
    barisLihat &&
    barisLihat.status === PERMINTAAN_MENUNGGU_BAYAR &&
    nomorWaKlien(barisLihat.noHpKlien)
      ? tautanWaTagihan(
          nomorWaKlien(barisLihat.noHpKlien),
          pesanTagihan({
            namaKlien: barisLihat.namaKlien,
            namaLayanan: barisLihat.namaLayanan,
            tanggal: formatTanggalID(barisLihat.tanggal),
            jam: formatJam(jamDariDb(barisLihat.jamMulai)),
            hargaLayanan: tagihanLihat?.hargaLayanan ?? null,
            hargaTransport: tagihanLihat?.hargaTransport ?? null,
            labelJenjang: tagihanLihat?.labelJenjang ?? null,
            total: tagihanLihat?.total ?? null,
            sisaWaktu: labelSisaWaktu(barisLihat.tenggat),
          }),
        )
      : "";

  // Tersedia di SEMUA status, termasuk permintaan yang sudah batal — menghubungi
  // klien tidak pernah berbahaya, dan justru permintaan yang batal karena tenggat
  // itulah yang paling perlu dijelaskan.
  //
  // Nomornya lewat `nomorWaKlien`, yang sengaja TANPA nomor cadangan klinik:
  // versi sebelumnya memakai setelan `nomor_wa` dan bentuk kegagalannya tidak
  // terlihat sebagai galat — WhatsApp terbuka rapi, hanya saja lawan bicaranya
  // PADMA sendiri.
  const tautanWaKosongUntukLihat =
    barisLihat && nomorWaKlien(barisLihat.noHpKlien)
      ? tautanWaPercakapan(nomorWaKlien(barisLihat.noHpKlien))
      : "";

  const pilihanKlien: PilihanKlien[] = klien.map((k) => ({
    id: k.id,
    nama: k.nama,
    padmaId: k.padma_id,
    alamatLat: k.alamat_lat,
    alamatLon: k.alamat_lon,
  }));

  return (
    <main>
      <header className="mb-4">
        <h1 className="text-[18px] font-bold text-panel-ink">Sesi</h1>
        {/* Kalimat kedua ("Konfirmasi mengubah…") adalah panduan yang dulu menempel
            di bawah antrean blok emas. Ia nyaris ikut terhapus bersama antreannya,
            padahal akibat konfirmasi dan kewajiban mengabari klien tidak berubah sedikit
            pun — dan keduanya tidak terbaca dari tombolnya sendiri. Tempatnya sekarang di
            sini karena blok ini tergambar pada KEDUA tab. */}
        <Bantuan judul="Tentang halaman ini">
          Tab <b>Permintaan</b> memuat pengajuan jadwal dari klien yang menunggu keputusan; klik
          satu baris untuk membukanya. Konfirmasi mengubah permintaan menjadi sesi Terjadwal
          pada Passport kliennya — yang tampil di tab <b>Sesi</b> — jadi kabari juga klien via
          WhatsApp. Catatan &amp; rekomendasi yang ditulis saat menandai sesi selesai{" "}
          <b>terbaca klien</b> di Passport-nya — tulislah untuk dibaca klien, bukan sebagai
          catatan internal.
        </Bantuan>
      </header>

      {/* Href BERSIH, tanpa mewarisi cari/status/hal: saringan tab sebelah
          tidak punya arti di sini, dan halaman 3 daftar sesi bukan halaman 3
          daftar permintaan. */}
      <nav aria-label="Bagian halaman Sesi" className="mb-4 flex gap-2">
        {[
          { nilai: "permintaan", label: "Permintaan" },
          { nilai: "sesi", label: "Sesi" },
        ].map((t) => (
          <Link
            key={t.nilai}
            href={t.nilai === "permintaan" ? BASIS : `${BASIS}?tab=sesi`}
            aria-current={tab === t.nilai ? "page" : undefined}
            className={`rounded-lg px-3 py-2 text-[12.5px] font-bold ${
              tab === t.nilai
                ? "bg-panel-ink text-panel-surface"
                : "border border-panel-border bg-panel-surface text-panel-muted"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "permintaan" && (
        <>
          <BilahDaftar
            basis={BASIS}
            param={param}
            kelompok={[
              {
                nama: "status",
                label: "Status",
                // Tanpa `?status` di URL, `ambilDaftarPermintaan` (lewat
                // `statusUntukSaring("")`) SUDAH menyaring ke STATUS_ANTRE —
                // persis seperti chip "Menunggu" dipilih. `bawaan` di sini
                // hanya membuat chipnya IKUT menyala saat itu terjadi, supaya
                // "Menampilkan 3 dari 3" tidak terbaca sebagai "seluruh
                // permintaan" padahal riwayat batal/tolak sengaja disaring
                // keluar.
                bawaan: SARING_MENUNGGU,
                pilihan: [
                  { nilai: SARING_MENUNGGU, label: "Menunggu", menuntut: true },
                  { nilai: SARING_RIWAYAT, label: "Riwayat" },
                  // Diturunkan dari SATU sumber: daftar dan labelnya tidak
                  // pernah bisa berselisih dengan enum basis data.
                  ...STATUS_PERMINTAAN.map((s) => ({ nilai: s, label: LABEL_PERMINTAAN[s] })),
                ],
              },
            ]}
            jumlah={daftarPermintaan.baris.length}
            total={daftarPermintaan.total}
            aksi={null}
          />

          {daftarPermintaan.baris.length === 0 ? (
            <p className="rounded-lg border border-panel-border bg-panel-surface p-8 text-center text-[13px] italic text-panel-muted">
              Tidak ada permintaan jadwal yang cocok.
            </p>
          ) : (
            /* Dibungkus kartu yang SAMA dengan tabel sesi: tanpa pembungkus
               ini daftar berisi tampil tanpa latar maupun garis, sedangkan
               kalimat "tidak ada permintaan" di atas justru berkartu — dua
               keadaan daftar yang sama terlihat seperti dua komponen. */
            <div className="rounded-lg border border-panel-border bg-panel-surface">
              <Tabel label="Daftar permintaan jadwal">
                <thead>
                  <tr>
                    <Th>Klien</Th>
                    <Th>Layanan</Th>
                    <Th>Tanggal &amp; jam</Th>
                    <Th>Status</Th>
                    <Th>Pembayaran</Th>
                  </tr>
                </thead>
                <tbody>
                  {daftarPermintaan.baris.map((p) => {
                    // Href SATU kali per baris, dipakai lagi di kelima sel —
                    // spec K5 & kalimat Bantuan ("klik satu baris") menjanjikan
                    // seluruh baris bisa dibuka, bukan cuma nama klien. `<tr>`
                    // sendiri tidak bisa jadi tautan, jadi tiap `<Td>` dapat
                    // tautannya sendiri yang MEMENUHI selnya (margin negatif
                    // menutup padding `Td`) supaya target kliknya area sel,
                    // bukan cuma glyph teksnya.
                    const href = `${BASIS}${bangunQuery(param, { lihat: p.id })}`;
                    const kelasTautanSel = "-mx-3 -my-2.5 block px-3 py-2.5";
                    return (
                      <tr key={p.id} data-permintaan={p.id} data-status={p.status}>
                        <Td>
                          <Link
                            href={href}
                            className={`${kelasTautanSel} font-bold text-panel-ink underline-offset-2 hover:underline`}
                          >
                            {p.namaKlien}
                          </Link>
                        </Td>
                        <Td>
                          <Link href={href} className={kelasTautanSel}>
                            {p.namaLayanan}
                          </Link>
                        </Td>
                        <Td>
                          <Link href={href} className={kelasTautanSel}>
                            {formatTanggalID(p.tanggal)} · {formatJam(jamDariDb(p.jamMulai))}
                          </Link>
                        </Td>
                        <Td>
                          <Link href={href} className={kelasTautanSel}>
                            {LABEL_PERMINTAAN[p.status]}
                          </Link>
                        </Td>
                        <Td>
                          <Link href={href} className={kelasTautanSel}>
                            {labelBayarPermintaan(p)}
                          </Link>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Tabel>
            </div>
          )}

          <Paginasi basis={BASIS} param={param} total={daftarPermintaan.total} />
        </>
      )}

      {tab === "sesi" && (
        <>
          <BilahDaftar
            basis={BASIS}
            param={param}
            kelompok={[
              {
                nama: "status",
                label: "Status",
                pilihan: [
                  // Diturunkan dari SATU sumber: daftar dan labelnya tidak
                  // pernah bisa berselisih dengan enum basis data.
                  ...STATUS_SESI.map((s) => ({ nilai: s, label: LABEL_SESI[s] })),
                ],
              },
              {
                nama: "jenjang",
                label: "Jenjang",
                // `menuntut` menyalakan warna clay: ini saringan yang menunjuk
                // PEKERJAAN (jarak yang belum diketahui), bukan sekadar kabar.
                pilihan: [{ nilai: "kosong", label: "Tanpa jenjang", menuntut: true }],
              },
              {
                nama: "waktu",
                label: "Waktu",
                pilihan: [
                  { nilai: "mendatang", label: "Mendatang" },
                  { nilai: "pekan_ini", label: "Pekan ini" },
                  { nilai: "lampau", label: "Sudah lewat" },
                ],
              },
            ]}
            jumlah={daftarSesi.baris.length}
            total={daftarSesi.total}
            aksi={
              <Link
                href={`${BASIS}?ubah=baru`}
                className="rounded-lg bg-panel-ink px-3 py-2 text-[12px] font-bold text-panel-surface"
              >
                + Sesi baru
              </Link>
            }
          />

          {/* Kolom "Jenjang" adalah hasil geocoding Nominatim (OSM) — lisensi
              ODbL mewajibkan atribusi tampak persis di LAYAR yang
              menampilkannya. Ditaruh di sini, di atas tabel, karena inilah
              bagian tab Sesi yang SELALU tampak begitu ia dimuat — tidak
              menunggu klik apa pun. (Tab Permintaan punya atribusinya sendiri
              di dalam panel geser, satu-satunya tempat jaraknya muncul.) Nol
              rupiah di baris ini (money firewall). */}
          <p className="mb-2 text-[11px] text-panel-muted">
            Jenjang jarak pada tiap baris dihitung dari data lokasi © OpenStreetMap contributors.
          </p>

          {daftarSesi.baris.length === 0 ? (
            <p className="rounded-lg border border-panel-border bg-panel-surface p-8 text-center text-[13px] italic text-panel-muted">
              {/* Dua sebab, dua kalimat — hanya `page.tsx` tahu bedanya karena
                  hanya di sini `param` (cari + saring) terlihat sekaligus. */}
              {param.cari === "" && Object.keys(param.saring).length === 0 ? (
                <>Belum ada sesi. Mulai dari tombol &ldquo;+ Sesi baru&rdquo;.</>
              ) : (
                "Tidak ada sesi yang cocok dengan pencarian ini."
              )}
            </p>
          ) : (
            <div className="rounded-lg border border-panel-border bg-panel-surface">
              <Tabel label="Daftar sesi">
                <thead>
                  <tr>
                    <Th>Klien</Th><Th>Layanan</Th><Th>Mitra</Th><Th>Jenjang</Th>
                    <Th>Status</Th><Th>Aksi</Th>
                  </tr>
                </thead>
                <tbody>
                  {daftarSesi.baris.map((s) => (
                    <tr key={s.id}>
                      <Td>
                        <b>{s.namaKlien}</b>
                        <span className="mt-0.5 block font-mono text-[11px] text-panel-muted">
                          {s.padmaId}
                        </span>
                      </Td>
                      <Td>
                        {s.namaLayanan}
                        <span className="mt-0.5 block text-[11.5px] text-panel-muted">
                          {formatTanggalID(s.tanggal)}
                          <span className="ml-1.5 text-panel-muted">{formatJam(jamDariDb(s.jamMulai))}</span>
                          {/* GERBANG SAKLAR (K11). Baris tabel ini dulu hidup di
                              `form-selesai.tsx`, tempat literalnya SUDAH digerbang;
                              sapuan panel memindahkannya ke tabel halaman ini.
                              Gerbangnya ikut pindah — `ambilDaftarSesi()`
                              (lib/admin/sesi.ts) membaca `client_package_id`
                              LANGSUNG dari `sessions`, jadi empat gerbang data K11
                              tidak menyentuhnya sama sekali. Datanya
                              (`dalamPaket`) tetap utuh; hanya tampilannya
                              dicabut. */}
                          {PAKET_TAMPIL && s.dalamPaket ? " · paket" : ""}
                        </span>
                      </Td>
                      <Td>{s.namaMitra}</Td>
                      <Td>{s.jenjang ? LABEL_JENJANG[s.jenjang] : "—"}</Td>
                      <Td>
                        <span
                          className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${KELAS_PILL_SESI[s.status]}`}
                        >
                          {LABEL_STATUS_SESI[s.status]}
                        </span>
                      </Td>
                      <Td>
                        {/* DUA aksi, dan yang kedua bukan hiasan: halaman
                            `/admin/sesi/[id]` memuat skrining, catatan bidan,
                            dan — untuk sesi yang selesai — pengunggah
                            sertifikat. Sebelum tautan ini ada, satu-satunya
                            jalan ke sana adalah lewat Klien lalu memilih
                            sesinya, sehingga pengunggah sertifikat praktis
                            tidak bisa ditemukan dari daftar sesi. */}
                        <div className="flex flex-wrap gap-x-3 gap-y-1">
                          <Link
                            href={`/admin/sesi/${s.id}`}
                            className="text-[12px] font-bold text-panel-ink underline"
                          >
                            Detail
                          </Link>
                          <Link
                            href={`${BASIS}${bangunQuery(param, { ubah: s.id })}`}
                            className="text-[12px] font-bold text-panel-ink underline"
                          >
                            Ubah
                          </Link>
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Tabel>
            </div>
          )}

          <Paginasi basis={BASIS} param={param} total={daftarSesi.total} />
        </>
      )}

      {panelTerbuka && (
        <PanelGeser
          judul={barisUbah ? `Sesi ${barisUbah.namaKlien}` : "Jadwalkan sesi"}
          hrefTutup={hrefTutup}
        >
          {barisUbah ? (
            <PanelSesi sesi={barisUbah} hrefTutup={hrefTutup} jamPilihan={jamLayanan} />
          ) : (
            <FormJadwalSesi
              klien={pilihanKlien}
              layanan={layanan}
              varian={varian}
              mitra={mitra}
              // Tanggal awal = hari ini menurut kalender Jakarta, bukan jam
              // server: pada 17:00–24:00 UTC keduanya sudah berbeda tanggal.
              tanggalAwal={hariIni}
              jamPilihan={jamLayanan}
              hrefTutup={hrefTutup}
            />
          )}
        </PanelGeser>
      )}

      {barisLihat && (
        <PanelGeser
          judul={`Permintaan — ${barisLihat.namaKlien}`}
          hrefTutup={`${BASIS}${bangunQuery(param, { lihat: null })}`}
        >
          <PanelPermintaan
            permintaan={barisLihat}
            mitra={mitraUntukLihat}
            tanggal={formatTanggalID(barisLihat.tanggal)}
            jam={formatJam(jamDariDb(barisLihat.jamMulai))}
            waktu={LABEL_WAKTU[barisLihat.preferensiWaktu] ?? barisLihat.preferensiWaktu}
            labelBayar={labelBayarPermintaan(barisLihat)}
            lunas={barisLihat.statusBayar === "lunas"}
            tautanWa={tautanWaUntukLihat}
            tautanWaKosong={tautanWaKosongUntukLihat}
            jamPilihan={jamLayanan}
            tanggalIso={barisLihat.tanggal}
            tagihan={tagihanLihat}
            emailTerkirim={barisLihat?.emailTagihanPada != null}
          />
        </PanelGeser>
      )}
    </main>
  );
}
