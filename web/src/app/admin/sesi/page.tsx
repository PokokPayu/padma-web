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
import { BlokPermintaan, type PermintaanAntre } from "./antrean-permintaan";
import { FormJadwalSesi, type PilihanKlien } from "./form-sesi";
import { PanelSesi } from "./panel-sesi";
import { LABEL_WAKTU, LABEL_STATUS_SESI, type PreferensiWaktu, type StatusSesi } from "./status";
import { LABEL_JENJANG } from "@/lib/transport/jarak";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: "Sesi" };

const BASIS = "/admin/sesi";

type BarisPermintaan = {
  id: string;
  tanggal: string;
  preferensi_waktu: PreferensiWaktu;
  catatan: string;
  clients: { nama: string } | null;
  services: { nama: string } | null;
};

const KELAS_PILL: Record<StatusSesi, string> = {
  terjadwal: "bg-gold/15 text-[#8A6A16]",
  selesai: "bg-leaf-soft text-leaf",
  batal: "bg-clay/10 text-clay",
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
  const [{ baris, total }, { data: permintaan }] = await Promise.all([
    ambilDaftarSesi(param, hariIni),
    supabase
      .from("booking_requests")
      .select("id, tanggal, preferensi_waktu, catatan, clients ( nama ), services ( nama )")
      .eq("status", "menunggu")
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

  const antre: PermintaanAntre[] = (permintaan ?? []).map((p) => ({
    id: p.id,
    // Nama, bukan UUID: antrean ini dibaca manusia yang akan menelepon orangnya.
    namaKlien: p.clients?.nama ?? "Klien",
    namaLayanan: p.services?.nama ?? "Layanan",
    // Diformat lewat kalender Asia/Jakarta — `new Date(tgl)` bisa mundur sehari.
    tanggal: formatTanggalID(p.tanggal),
    waktu: LABEL_WAKTU[p.preferensi_waktu] ?? p.preferensi_waktu,
    catatan: p.catatan,
  }));

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
              <BlokPermintaan key={p.id} permintaan={p} mitra={mitra} />
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
              { nilai: "terjadwal", label: "Terjadwal" },
              { nilai: "selesai", label: "Selesai" },
              { nilai: "batal", label: "Batal" },
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
                      {s.dalamPaket ? " · paket" : ""}
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
            <PanelSesi sesi={barisUbah} hrefTutup={hrefTutup} />
          ) : (
            <FormJadwalSesi
              klien={pilihanKlien}
              layanan={layanan}
              varian={varian}
              mitra={mitra}
              // Tanggal awal = hari ini menurut kalender Jakarta, bukan jam
              // server: pada 17:00–24:00 UTC keduanya sudah berbeda tanggal.
              tanggalAwal={hariIni}
              hrefTutup={hrefTutup}
            />
          )}
        </PanelGeser>
      )}
    </main>
  );
}
