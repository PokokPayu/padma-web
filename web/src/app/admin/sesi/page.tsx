import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { pilihanMitra } from "@/lib/admin/mitra";
import { pilihanLayanan, pilihanVarian } from "@/lib/admin/katalog-admin";
import { formatTanggalID, hariIniJakarta } from "@/lib/passport/waktu";
import { BlokPermintaan, type PermintaanAntre } from "./antrean-permintaan";
import { FormJadwalSesi, type PilihanKlien } from "./form-sesi";
import { BarisSesi, type BarisSesiTampil } from "./form-selesai";
import { LABEL_WAKTU, type PreferensiWaktu, type StatusSesi } from "./status";
import type { JenjangTransport } from "@/lib/transport/jarak";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: "Sesi" };

type BarisPermintaan = {
  id: string;
  tanggal: string;
  preferensi_waktu: PreferensiWaktu;
  catatan: string;
  clients: { nama: string } | null;
  services: { nama: string } | null;
};

type BarisSesiDb = {
  id: string;
  tanggal: string;
  status: StatusSesi;
  catatan: string;
  rekomendasi: string;
  client_package_id: string | null;
  jenjang: JenjangTransport | null;
  jenjang_sumber: "otomatis" | "admin" | null;
  clients: { nama: string; padma_id: string } | null;
  services: { nama: string } | null;
  partners: { nama: string } | null;
};

// Panel operasional, bukan arsip. Riwayat lengkap satu klien dibaca di halaman
// klien; daftar ini hanya perlu memuat yang masih relevan dikerjakan hari ini.
const BATAS_BARIS = 100;

export default async function SesiPage() {
  await requireRole(["admin", "owner"]);

  // Sesi pengguna, bukan service role: policy `booking: staf` dan `sessions:
  // staf` yang mengizinkan halaman ini terbaca, dan itulah yang ingin ikut
  // diperiksa Postgres.
  const supabase = await createServerSupabase();

  const [{ data: permintaan }, { data: sesi }, { data: klien }, layanan, varian, mitra] =
    await Promise.all([
      supabase
        .from("booking_requests")
        .select("id, tanggal, preferensi_waktu, catatan, clients ( nama ), services ( nama )")
        .eq("status", "menunggu")
        // Yang paling dekat tanggalnya paling mendesak dijawab.
        .order("tanggal", { ascending: true })
        .order("created_at", { ascending: true })
        .returns<BarisPermintaan[]>(),
      // Sesi terbaru di atas: yang baru saja dijalani bidan adalah yang paling
      // mungkin perlu ditandai selesai.
      // `jenjang`/`jenjang_sumber` ikut dibaca supaya baris sesi bisa
      // menampilkan jenjang saat ini dan menawarkan koreksinya lewat
      // `tetapkanJenjang` (Ruling 11) — data OPERASIONAL, bukan rupiah.
      supabase
        .from("sessions")
        .select(
          "id, tanggal, status, catatan, rekomendasi, client_package_id, jenjang, jenjang_sumber, clients ( nama, padma_id ), services ( nama ), partners ( nama )",
        )
        .order("tanggal", { ascending: false })
        .limit(BATAS_BARIS)
        .returns<BarisSesiDb[]>(),
      // `alamat_lat`/`alamat_lon` ikut dibaca untuk saran jenjang (Task 7):
      // alamat DEFAULT klien dipakai sebagai perkiraan lokasi sesi baru, satu
      // sisi jarak garis lurus terhadap domisili mitra yang dipilih.
      supabase
        .from("clients")
        .select("id, nama, padma_id, alamat_lat, alamat_lon")
        .order("nama")
        .returns<
          { id: string; nama: string; padma_id: string; alamat_lat: number | null; alamat_lon: number | null }[]
        >(),
      // Hanya layanan AKTIF yang boleh ditawarkan untuk sesi baru — alasan yang
      // sama persis dengan mitra di bawah. Daftar NAMA untuk riwayat tidak
      // menyaring apa pun; itu dua kebutuhan berbeda dari satu tabel.
      pilihanLayanan(),
      // Varian AKTIF seluruh layanan — disaring per layanan terpilih di
      // klien, sama seperti wizard `/passport/ajukan`.
      pilihanVarian(),
      // Hanya mitra AKTIF yang boleh ditawarkan untuk sesi baru. Daftar NAMA
      // untuk riwayat (view `partner_publik`) sengaja tidak menyaring apa pun —
      // dua kebutuhan berbeda dari satu tabel yang sama.
      pilihanMitra(),
    ]);

  const antre: PermintaanAntre[] = (permintaan ?? []).map((p) => ({
    id: p.id,
    // Nama, bukan UUID: antrean ini dibaca manusia yang akan menelepon orangnya.
    namaKlien: p.clients?.nama ?? "Klien",
    namaLayanan: p.services?.nama ?? "Layanan",
    // Tanggal diformat lewat kalender Asia/Jakarta — server berjalan UTC, dan
    // `new Date(tgl)` di zona mana pun bisa mundur sehari.
    tanggal: formatTanggalID(p.tanggal),
    waktu: LABEL_WAKTU[p.preferensi_waktu] ?? p.preferensi_waktu,
    catatan: p.catatan,
  }));

  const daftarSesi: BarisSesiTampil[] = (sesi ?? []).map((s) => ({
    id: s.id,
    namaKlien: s.clients?.nama ?? "Klien",
    padmaId: s.clients?.padma_id ?? "—",
    namaLayanan: s.services?.nama ?? "Layanan",
    tanggal: formatTanggalID(s.tanggal),
    // Mitra dibaca dari tabel `partners` (hak staf), bukan dari view publik.
    namaMitra: s.partners?.nama ?? "Tim PADMA",
    status: s.status,
    dalamPaket: s.client_package_id !== null,
    catatan: s.catatan,
    rekomendasi: s.rekomendasi,
    jenjang: s.jenjang,
    jenjangSumber: s.jenjang_sumber,
  }));

  const pilihanKlien: PilihanKlien[] = (klien ?? []).map((k) => ({
    id: k.id,
    nama: k.nama,
    padmaId: k.padma_id,
    alamatLat: k.alamat_lat,
    alamatLon: k.alamat_lon,
  }));

  return (
    <main>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl text-night">Sesi</h1>
          <p className="mt-1 max-w-xl text-[13px] text-ink-soft">
            Permintaan jadwal dari klien menunggu keputusan di sini. Yang
            dikonfirmasi langsung menjadi sesi pada Passport kliennya.
          </p>
        </div>
        <FormJadwalSesi
          klien={pilihanKlien}
          layanan={layanan}
          varian={varian}
          mitra={mitra}
          // Tanggal awal formulir = hari ini menurut kalender Jakarta, bukan
          // jam server: pada 17:00–24:00 UTC keduanya sudah berbeda tanggal.
          tanggalAwal={hariIniJakarta()}
        />
      </header>

      <section aria-label="Permintaan jadwal menunggu">
        {antre.length === 0 ? (
          <p className="rounded-2xl border border-black/10 bg-white p-8 text-center text-sm italic text-ink-soft">
            Tidak ada permintaan jadwal yang menunggu.
          </p>
        ) : (
          <>
            {antre.map((p) => (
              <BlokPermintaan key={p.id} permintaan={p} mitra={mitra} />
            ))}
            <p className="mb-4 mt-0.5 text-[12px] text-ink-soft">
              Konfirmasi mengubah permintaan menjadi sesi Terjadwal — kabari juga
              klien via WhatsApp.
            </p>
          </>
        )}
      </section>

      <section aria-label="Daftar sesi" className="mt-6">
        <h2 className="mb-1 font-serif text-lg text-night">Sesi terbaru</h2>
        {/* Kolom "Jenjang" pada setiap baris (form-selesai.tsx, BarisSesi) adalah
            hasil geocoding Nominatim (OSM) — lisensi ODbL mewajibkan atribusi
            tampak persis di LAYAR yang menampilkannya, bukan cukup di komentar
            kode maupun di dalam formulir yang mulai tertutup (form-sesi.tsx
            sudah memuatnya, tapi hanya terlihat setelah formulirnya dibuka).
            Ditaruh di sini, di atas tabel, karena inilah bagian halaman yang
            SELALU tampak begitu /admin/sesi dimuat — tidak menunggu klik apa
            pun. Nol rupiah di baris ini (money firewall). */}
        <p className="mb-3 text-[11px] text-ink-soft/70">
          Jenjang jarak pada tiap baris dihitung dari data lokasi © OpenStreetMap contributors.
        </p>

        {daftarSesi.length === 0 ? (
          <p className="rounded-2xl border border-black/10 bg-white p-8 text-center text-sm italic text-ink-soft">
            Belum ada sesi. Mulai dari tombol &ldquo;+ Jadwalkan sesi&rdquo;.
          </p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-black/10 bg-white">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-[13.5px]">
                <thead>
                  <tr className="border-b-[1.5px] border-black/10 bg-paper text-[11px] uppercase tracking-wider text-ink-soft">
                    <th className="p-4 text-left font-extrabold">Klien</th>
                    <th className="p-4 text-left font-extrabold">Layanan</th>
                    <th className="p-4 text-left font-extrabold">Mitra</th>
                    <th className="p-4 text-left font-extrabold">Status</th>
                    <th className="p-4 text-left font-extrabold">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {daftarSesi.map((s) => (
                    <BarisSesi key={s.id} sesi={s} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <p className="mt-2 text-[12px] text-ink-soft">
          Catatan &amp; rekomendasi yang ditulis saat menandai sesi selesai
          langsung terbaca klien di Passport-nya — tulislah untuk dibaca klien,
          bukan sebagai catatan internal.
        </p>
      </section>
    </main>
  );
}
