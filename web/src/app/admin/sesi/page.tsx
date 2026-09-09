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
import {
  BlokPermintaan,
  type PermintaanAntre,
  type MitraPilihan as MitraPilihanBlok,
} from "./antrean-permintaan";
import { FormJadwalSesi, type PilihanKlien } from "./form-sesi";
import { PanelSesi } from "./panel-sesi";
import { LABEL_WAKTU, LABEL_STATUS_SESI, type PreferensiWaktu, type StatusSesi } from "./status";
import { LABEL_JENJANG } from "@/lib/transport/jarak";
import { PAKET_TAMPIL } from "@/lib/paket-tampil";
import { STATUS_ANTRE, STATUS_SESI, LABEL_SESI } from "@/lib/jadwal/status";
import { formatJam, jamDariDb } from "@/lib/jadwal/jam";
import { labelSisaWaktu } from "@/lib/tagihan/tenggat";
import { pesanTagihan, tautanWaTagihan } from "@/lib/tagihan/pesan-tagihan";
import { daftarTagihanPengajuanAdmin } from "@/lib/admin/tagihan-pengajuan";
import { PERMINTAAN_MENUNGGU_BAYAR } from "@/lib/jadwal/status";
import { urutkanMitraMenurutJarak, formatKm } from "@/lib/jadwal/urutan-mitra";
import { bacaPengaturan } from "@/lib/settings";
import { nomorWaKlien } from "@/lib/pengaturan/bentuk";
import type { StatusPermintaan } from "@/lib/jadwal/status";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: "Sesi" };

const BASIS = "/admin/sesi";

type BarisPermintaan = {
  id: string;
  tanggal: string;
  preferensi_waktu: PreferensiWaktu;
  catatan: string;
  jam_mulai: string;
  status: StatusPermintaan;
  status_bayar: "belum" | "menunggu_verifikasi" | "lunas";
  tenggat: string | null;
  alamat_lat: number | null;
  alamat_lon: number | null;
  clients: { nama: string; no_hp: string } | null;
  services: { nama: string } | null;
  partners: { nama: string } | null;
};

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
  const param = uraikanParamDaftar(sp, SARING_SESI);
  // "Hari ini" menurut Jakarta, bukan menurut jam server (Vercel berjalan UTC).
  const hariIni = hariIniJakarta();

  const supabase = await createServerSupabase();
  const [{ jamLayanan }, { baris, total }, { data: permintaan }] = await Promise.all([
    bacaPengaturan(),
    ambilDaftarSesi(param, hariIni),
    supabase
      .from("booking_requests")
      .select(
        "id, tanggal, jam_mulai, preferensi_waktu, catatan, status, status_bayar, tenggat, " +
          "alamat_lat, alamat_lon, " +
          "clients ( nama, no_hp ), services ( nama ), partners ( nama )",
      )
      .in("status", STATUS_ANTRE)
      // Yang paling dekat tanggalnya paling mendesak dijawab.
      .order("tanggal", { ascending: true })
      .order("created_at", { ascending: true })
      .returns<BarisPermintaan[]>(),
  ]);

  // `ubah` sengaja TIDAK lewat `uraikanParamDaftar`: ia bukan saringan
  // berdaftar-putih melainkan sebuah id, dan kesahihannya dibuktikan dengan
  // menemukan barisnya di bawah.
  const ubah = typeof sp.ubah === "string" ? sp.ubah : "";
  const barisUbah = ubah === "baru" ? undefined : baris.find((s) => s.id === ubah);
  const panelTerbuka = ubah === "baru" || barisUbah !== undefined;
  const hrefTutup = `${BASIS}${bangunQuery(param, { ubah: null })}`;

  // RULING (menggantikan draf awal rencana Task 3 yang mengambilnya bersyarat
  // `ubah === "baru"` saja): `mitra` TIDAK BOLEH ditarik hanya saat
  // `ubah === "baru"`. `BlokPermintaan`
  // di bawah — antrean permintaan, tampil di ATAS bilah daftar — juga
  // menerima prop `mitra` yang sama, dan punya cabang sendiri yang
  // menampilkan "Belum ada mitra aktif" bila `mitra.length === 0`. Menariknya
  // bersyarat murni `ubah === "baru"` membuat kalimat itu salah setiap kali
  // panel tertutup padahal antrean sedang menunggu keputusan dan mitra aktif
  // sungguhan ada. `klien`/`layanan`/`varian` TETAP bersyarat `ubah==="baru"`
  // saja — ketiganya cuma dipakai formulir "Sesi baru", tidak oleh antrean.
  const butuhMitra = ubah === "baru" || (permintaan ?? []).length > 0;
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

  // Total per pengajuan dirakit sekali, dipakai dua kali (label & pesan WA).
  const tagihanAdmin = await daftarTagihanPengajuanAdmin();
  const totalPerPermintaan = new Map(tagihanAdmin.map((t) => [t.permintaanId, t.total]));

  const antre: PermintaanAntre[] = (permintaan ?? []).map((p) => ({
    id: p.id,
    // Nama, bukan UUID: antrean ini dibaca manusia yang akan menelepon orangnya.
    namaKlien: p.clients?.nama ?? "Klien",
    namaLayanan: p.services?.nama ?? "Layanan",
    // Diformat lewat kalender Asia/Jakarta — `new Date(tgl)` bisa mundur sehari.
    tanggal: formatTanggalID(p.tanggal),
    jam: formatJam(jamDariDb(p.jam_mulai)),
    waktu: LABEL_WAKTU[p.preferensi_waktu] ?? p.preferensi_waktu,
    catatan: p.catatan,
    status: p.status,
    namaMitra: p.partners?.nama ?? null,
    // Keadaan pembayaran diformat DI SERVER: `BlokPermintaan` adalah komponen
    // klien, dan sisa waktu yang dihitung di sana akan berbeda antara render
    // server dan render peramban — ketidakcocokan hidrasi yang munculnya acak.
    labelBayar:
      p.status_bayar === "lunas"
        ? "sudah dibayar & diverifikasi"
        : p.status_bayar === "menunggu_verifikasi"
          ? "bukti masuk, menunggu verifikasi"
          : `belum dibayar · ${labelSisaWaktu(p.tenggat)}`,
    lunas: p.status_bayar === "lunas",
    // Pesannya dirakit DI SERVER: `pesanTagihan` murni, tetapi nominal dan
    // sisa waktunya butuh tarif & jam server. Merakitnya di komponen klien
    // berarti angka yang berbeda antara render server dan peramban.
    // Tujuannya nomor KLIEN, bukan setelan `nomor_wa` klinik. Versi
    // sebelumnya memakai yang kedua, dan bentuk kegagalannya tidak terlihat
    // sebagai galat: WhatsApp terbuka dengan pesan tagihan yang rapi, hanya
    // saja lawan bicaranya PADMA sendiri. Klien tidak pernah ditagih dan
    // tenggat 24 jamnya tetap berjalan. `nomorWaKlien` sengaja TANPA nomor
    // cadangan — lihat alasannya di `@/lib/pengaturan/bentuk`.
    tautanWa:
      p.status === PERMINTAAN_MENUNGGU_BAYAR && nomorWaKlien(p.clients?.no_hp)
        ? tautanWaTagihan(
            nomorWaKlien(p.clients?.no_hp),
            pesanTagihan({
              namaKlien: p.clients?.nama ?? "Ibu",
              namaLayanan: p.services?.nama ?? "Layanan",
              tanggal: formatTanggalID(p.tanggal),
              jam: formatJam(jamDariDb(p.jam_mulai)),
              total: totalPerPermintaan.get(p.id) ?? null,
              sisaWaktu: labelSisaWaktu(p.tenggat),
            }),
          )
        : "",
  }));

  // Mitra diurutkan PER PERMINTAAN, bukan sekali untuk seluruh antrean:
  // jaraknya dihitung ke alamat permintaan itu sendiri, jadi satu daftar
  // bersama akan benar untuk paling banyak satu baris. Diurutkan & diformat di
  // SERVER — `BlokPermintaan` adalah komponen klien, dan mengoper fungsi
  // penghitung ke sana melanggar batas server/klien yang dijaga
  // tests/pagar-batas-server-klien.test.ts.
  const mitraPerPermintaan = new Map<string, MitraPilihanBlok[]>(
    (permintaan ?? []).map((p) => [
      p.id,
      urutkanMitraMenurutJarak(
        mitra,
        p.alamat_lat != null && p.alamat_lon != null
          ? { lat: p.alamat_lat, lon: p.alamat_lon }
          : null,
      ).map((m) => ({ id: m.id, nama: m.nama, jarak: formatKm(m.km) })),
    ]),
  );

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
          Permintaan jadwal dari klien menunggu keputusan di blok bergaris di bawah; yang
          dikonfirmasi langsung menjadi sesi pada Passport kliennya. Catatan &amp; rekomendasi yang
          ditulis saat menandai sesi selesai <b>terbaca klien</b> di Passport-nya — tulislah untuk
          dibaca klien, bukan sebagai catatan internal.
        </Bantuan>
      </header>

      <section aria-label="Permintaan jadwal menunggu" className="mb-4">
        {antre.length === 0 ? (
          <p className="rounded-lg border border-panel-border bg-panel-surface p-8 text-center text-[13px] italic text-panel-muted">
            Tidak ada permintaan jadwal yang menunggu.
          </p>
        ) : (
          <>
            {antre.map((p) => (
              <BlokPermintaan key={p.id} permintaan={p} mitra={mitraPerPermintaan.get(p.id) ?? []} />
            ))}
            <p className="mt-0.5 text-[12px] text-panel-muted">
              Konfirmasi mengubah permintaan menjadi sesi Terjadwal — kabari juga klien via WhatsApp.
            </p>
          </>
        )}
      </section>

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
        jumlah={baris.length}
        total={total}
        aksi={
          <Link
            href={`${BASIS}?ubah=baru`}
            className="rounded-lg bg-panel-ink px-3 py-2 text-[12px] font-bold text-panel-surface"
          >
            + Sesi baru
          </Link>
        }
      />

      {/* Kolom "Jenjang" adalah hasil geocoding Nominatim (OSM) — lisensi ODbL
          mewajibkan atribusi tampak persis di LAYAR yang menampilkannya.
          Ditaruh di sini, di atas tabel, karena inilah bagian halaman yang
          SELALU tampak begitu /admin/sesi dimuat — tidak menunggu klik apa pun.
          Nol rupiah di baris ini (money firewall). */}
      <p className="mb-2 text-[11px] text-panel-muted">
        Jenjang jarak pada tiap baris dihitung dari data lokasi © OpenStreetMap contributors.
      </p>

      {baris.length === 0 ? (
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
              {baris.map((s) => (
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

      <Paginasi basis={BASIS} param={param} total={total} />

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
    </main>
  );
}
