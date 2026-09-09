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
import { LABEL_WAKTU, LABEL_STATUS_SESI, type StatusSesi } from "./status";
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
import { pesanTagihan, tautanWaTagihan } from "@/lib/tagihan/pesan-tagihan";
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

const KELAS_PILL: Record<StatusSesi, string> = {
  terjadwal: "bg-gold/15 text-[#8A6A16]",
  // `berjalan` memakai hijau daun MUDA, bukan gold: ia keadaan yang sedang
  // terjadi sekarang, dan admin perlu membedakannya sekilas dari yang baru
  // dijadwalkan.
  berjalan: "bg-leaf/15 text-leaf",
  selesai: "bg-leaf-soft text-leaf",
  // `tidak_hadir` DAN `dibatalkan_klien` memakai clay (warna yang menuntut
  // perhatian) sementara `dibatalkan_padma` memakai abu netral: dua yang
  // pertama meninggalkan pekerjaan bagi admin — `tidak_hadir` menghubungi
  // klien dan memutuskan tagihannya, `dibatalkan_klien` memastikan akibat
  // uangnya sudah benar (refund penuh, hak sesi, atau hangus, tergantung
  // jenjang saat dibatalkan) — sedangkan `dibatalkan_padma` sudah tuntas:
  // refund penuh, tanpa keputusan susulan. Warnanya SENGAJA beda dari
  // `dibatalkan_padma` walau labelnya sama-sama "batal": admin yang menyamakan
  // pilnya bisa salah menangani refund.
  tidak_hadir: "bg-clay/10 text-clay",
  dibatalkan_padma: "bg-black/5 text-ink-soft",
  dibatalkan_klien: "bg-clay/10 text-clay",
};

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
  const totalPerPermintaan = new Map(tagihanAdmin.map((t) => [t.permintaanId, t.total]));

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
            total: totalPerPermintaan.get(barisLihat.id) ?? null,
            sisaWaktu: labelSisaWaktu(barisLihat.tenggat),
          }),
        )
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
        <Bantuan judul="Tentang halaman ini">
          Tab <b>Permintaan</b> memuat pengajuan jadwal dari klien yang menunggu keputusan; klik
          satu baris untuk membukanya, dan yang dikonfirmasi langsung menjadi sesi pada Passport
          kliennya — yang tampil di tab <b>Sesi</b>. Catatan &amp; rekomendasi yang ditulis saat
          menandai sesi selesai <b>terbaca klien</b> di Passport-nya — tulislah untuk dibaca klien,
          bukan sebagai catatan internal.
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
                  {daftarPermintaan.baris.map((p) => (
                    <tr key={p.id} data-permintaan={p.id} data-status={p.status}>
                      <Td>
                        <Link
                          href={`${BASIS}${bangunQuery(param, { lihat: p.id })}`}
                          className="font-bold text-panel-ink underline-offset-2 hover:underline"
                        >
                          {p.namaKlien}
                        </Link>
                      </Td>
                      <Td>{p.namaLayanan}</Td>
                      <Td>
                        {formatTanggalID(p.tanggal)} · {formatJam(jamDariDb(p.jamMulai))}
                      </Td>
                      <Td>{LABEL_PERMINTAAN[p.status]}</Td>
                      <Td>{labelBayarPermintaan(p)}</Td>
                    </tr>
                  ))}
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
                          className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${KELAS_PILL[s.status]}`}
                        >
                          {LABEL_STATUS_SESI[s.status]}
                        </span>
                      </Td>
                      <Td>
                        <Link
                          href={`${BASIS}${bangunQuery(param, { ubah: s.id })}`}
                          className="text-[12px] font-bold text-panel-ink underline"
                        >
                          Ubah
                        </Link>
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
          />
        </PanelGeser>
      )}
    </main>
  );
}
