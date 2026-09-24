import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { ambilRekap } from "@/lib/owner/data";
import { deretPekanTerakhir } from "@/lib/owner/rekap";
import { formatRupiah } from "@/lib/owner/rupiah";
import { formatTanggalID, formatTanggalPendek, hariIniJakarta } from "@/lib/passport/waktu";
import { geserHari } from "@/lib/owner/pekan";
import { StatTile } from "@/app/_shell/panel/stat-tile";
import { Kartu } from "@/app/_shell/panel/kartu";
import { Tabel, Th, Td } from "@/app/_shell/panel/tabel";
import { GrafikPekan } from "./_shell/grafik-pekan";
import {
  ambilTrenPenilaian,
  ambilPenilaianTerbaru,
  komentarKritikDulu,
  type BarisPenilaian,
} from "@/lib/admin/penilaian";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: "Panel Owner" };

const TAUTAN_KECIL =
  "text-[12px] font-bold text-leaf underline underline-offset-4 transition hover:text-panel-ink";

/** Satu kolom tren. Dipisah supaya kedua kolom tidak pernah bisa berbeda bentuk. */
function KolomTren({
  judul,
  baris,
  kosong,
}: {
  judul: string;
  baris: { nama: string; jumlah: number; rata: number }[];
  kosong: string;
}) {
  return (
    <div className="rounded-lg border border-panel-border bg-panel-surface p-3.5">
      <h3 className="mb-2 text-[13px] font-bold text-panel-ink">{judul}</h3>
      {baris.length === 0 ? (
        <p className="text-[12.5px] italic text-panel-muted">{kosong}</p>
      ) : (
        <ul>
          {baris.map((b) => (
            <li
              key={b.nama}
              data-tren={b.nama}
              className="flex items-center justify-between border-b border-dashed border-panel-border py-1.5 text-[12.5px] last:border-0"
            >
              <span className="min-w-0 truncate text-panel-ink">{b.nama}</span>
              <span className="flex-none text-panel-muted">
                <b className="text-panel-ink">{b.rata.toFixed(1)}</b> · {b.jumlah} penilaian
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Satu testimoni. Komentar klien adalah TEKS TAK TEPERCAYA — dirender sebagai
 * teks biasa, tidak pernah sebagai markup (disiplin yang sama dengan panel
 * admin dan dengan komentar pada `session_ratings` itu sendiri).
 */
function BarisKomentar({ baris }: { baris: BarisPenilaian }) {
  const terendah = Math.min(baris.bintangLayanan, baris.bintangBidan);
  return (
    <li
      data-komentar={baris.id}
      className="border-b border-dashed border-panel-border py-2.5 last:border-0"
    >
      <p className="text-[12.5px] leading-relaxed text-panel-ink">{baris.komentar}</p>
      <p className="mt-1 text-[11.5px] text-panel-muted">
        <b className={terendah <= 3 ? "text-clay" : "text-panel-ink"}>
          {baris.bintangLayanan}★ layanan · {baris.bintangBidan}★ bidan
        </b>{" "}
        · {baris.namaMitra} · {baris.namaLayanan} · {baris.tanggal}
      </p>
    </li>
  );
}

export default async function OwnerPage() {
  const { nama } = await requireRole(["owner"]);

  // "Hari ini" menurut Jakarta, bukan menurut jam server (Vercel berjalan UTC).
  const hariIni = hariIniJakarta();

  // SATU bacaan. `ringkasanPekanIni()` memanggil `ambilRekap()` di dalamnya,
  // jadi memakai keduanya berarti membaca seluruh sesi, tarif, dan tanda bayar
  // dua kali setiap beranda dibuka. Grafik pun tidak butuh query baru: rekap
  // ini sudah memuat SELURUH pekan lengkap dengan marginnya.
  // Tren penilaian dibaca terpisah dari rekap: keduanya menjawab pertanyaan
  // berbeda dan tidak berbagi satu baris pun. Digabung dalam satu query,
  // penilaian akan ikut tertahan setiap kali rekap melambat.
  // Komentar dibaca bersamaan dengan rekap & tren, bukan berurutan: ketiganya
  // tidak saling bergantung, dan beranda yang menunggu tiga perjalanan
  // berurutan ke Postgres terasa rusak meski tidak ada yang salah.
  //
  // `batas: 50` lalu dipangkas jadi lima di `komentarKritikDulu`: pemangkasan
  // TIDAK BISA dilakukan di query, karena urutan yang dibutuhkan board adalah
  // bintang terendah dulu sementara query mengurutkan menurut waktu. Mengambil
  // lima teratas menurut waktu berarti kritik tiga pekan lalu tidak pernah
  // terbaca sama sekali — persis yang diminta klien agar tidak terjadi.
  const [rekap, tren, penilaian] = await Promise.all([
    ambilRekap(),
    ambilTrenPenilaian(),
    ambilPenilaianTerbaru({ batas: 50 }),
  ]);
  const komentar = komentarKritikDulu(penilaian);

  // Pekan sepi tidak punya ember sendiri di `hitungRekap()`; deretPekanTerakhir
  // mengisinya dengan nol supaya sumbu waktunya tidak berlubang.
  const deret = deretPekanTerakhir(rekap, hariIni, 8);
  // Elemen terakhir deret ADALAH pekan berjalan menurut definisinya, dan sudah
  // berisi nol bila pekan itu belum punya sesi sama sekali.
  const pekan = deret[deret.length - 1];
  const jumlahMitra = pekan.perMitra.length;
  const jumlahTakBertarif = pekan.sesiTakBertarif.length;

  const labelPekan = deret.map((p) => {
    const { hari, bulan } = formatTanggalPendek(p.awal);
    return `${hari} ${bulan}`;
  });

  return (
    <main>
      <header className="mb-5">
        <h1 className="text-[20px] font-bold text-panel-ink">Panel Owner</h1>
        <p className="mt-1 text-[13px] text-panel-muted">
          Halo, {nama}. Ringkasan pekan berjalan · {formatTanggalID(hariIni)}
        </p>
      </header>

      <section
        aria-label={`Ringkasan pekan ${pekan.rentang}`}
        className="grid grid-cols-1 gap-3 sm:grid-cols-3"
      >
        <StatTile
          label="Sesi selesai pekan ini"
          nilai={String(pekan.jumlahSesi)}
          keterangan={
            pekan.jumlahSesi === 0
              ? "Selesaikan sesi di panel Admin — angka ini ikut bergerak."
              : `${jumlahMitra} mitra bekerja · ${pekan.rentang}`
          }
        />
        {/* Sabtu kini hari PERTAMA pekan (butir 4), bukan hari keenam seperti
            di bawah skema Senin–Minggu. Label lama "Honor dibayar Sabtu ini"
            karena itu menunjuk pekan yang SALAH: honor pekan berjalan baru
            dibayar Sabtu berikutnya, sesudah pekannya tutup Jumat. Tanggalnya
            ditulis apa adanya supaya tidak ada yang perlu menghitung sendiri
            "Sabtu yang mana" — selisih satu pekan di sini adalah selisih satu
            pekan honor. */}
        <StatTile
          label="Honor pekan berjalan"
          nilai={formatRupiah(pekan.totalHonor)}
          keterangan={`Sesi Selesai pekan ${pekan.rentang} · dibayar Sabtu ${formatTanggalID(
            geserHari(pekan.awal, 7),
          )}`}
          href="/owner/rekap"
        />
        <StatTile
          label="Margin PADMA pekan ini"
          nilai={formatRupiah(pekan.margin)}
          keterangan="Harga klien − honor mitra"
        />
      </section>

      {/* Sesi yang lebih tua dari tarif paling awal layanannya TIDAK boleh
          dihitung nol diam-diam — itu uang yang hilang tanpa jejak. Ia muncul
          di sini sebagai peringatan yang menautkan langsung ke perbaikannya. */}
      {jumlahTakBertarif > 0 && (
        <p className="mt-3 rounded-lg border border-clay/35 bg-panel-surface px-4 py-3 text-[12.5px] leading-relaxed text-panel-ink">
          <b className="text-clay">
            {jumlahTakBertarif} sesi pekan ini belum bertarif.
          </b>{" "}
          Layanannya belum punya tarif yang berlaku pada tanggal sesi, jadi
          honornya belum ikut dihitung di angka mana pun di atas.{" "}
          <Link href="/owner/tarif" className="font-bold text-leaf underline underline-offset-4">
            Tetapkan tarifnya
          </Link>{" "}
          atau lihat rinciannya di{" "}
          <Link href="/owner/rekap" className="font-bold text-leaf underline underline-offset-4">
            Rekap &amp; Honor
          </Link>
          .
        </p>
      )}

      <div className="mt-4">
        <Kartu
          judul="Delapan pekan terakhir"
          aksi={
            <Link href="/owner/rekap" className={TAUTAN_KECIL}>
              Buka Rekap &amp; Honor
            </Link>
          }
        >
          {/* Pembungkus client milik panel owner. Fungsi `formatRupiah` TIDAK
              bisa dioper dari server component ke client component, jadi ia
              diimpor di dalam pembungkus itu — yang letaknya di bawah
              `src/app/owner/`, persis tempat nominal memang boleh hidup. */}
          <GrafikPekan
            label={labelPekan}
            hargaKlien={deret.map((p) => p.totalHarga)}
            honorMitra={deret.map((p) => p.totalHonor)}
            margin={deret.map((p) => p.margin)}
          />
        </Kartu>
      </div>

      <div className="mt-4">
        <Kartu judul="Mitra teraktif pekan ini">
          {pekan.perMitra.length === 0 ? (
            <p className="text-[12.5px] text-panel-muted">
              Belum ada sesi selesai pekan ini.
            </p>
          ) : (
            <Tabel label={`Mitra pekan ${pekan.rentang}`}>
              <thead>
                <tr>
                  <Th>Mitra</Th>
                  <Th className="text-right">Sesi</Th>
                  <Th className="text-right">Honor</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {[...pekan.perMitra]
                  .sort((a, b) => b.jumlahSesi - a.jumlahSesi)
                  .map((m) => (
                    <tr key={m.partnerId}>
                      <Td className="font-bold">{m.nama}</Td>
                      <Td className="text-right tabular-nums">{m.jumlahSesi}</Td>
                      <Td className="text-right tabular-nums">
                        {formatRupiah(m.totalHonor)}
                      </Td>
                      <Td>{m.sudahDibayar ? "Sudah dibayar" : "Belum dibayar"}</Td>
                    </tr>
                  ))}
              </tbody>
            </Tabel>
          )}
        </Kartu>
      </div>

      <p className="mt-4 text-[12px] leading-relaxed text-panel-muted">
        Honor dihitung dengan tarif yang berlaku <b>pada tanggal sesi</b>, jadi
        menaikkan tarif hari ini tidak menggeser satu angka pun di pekan yang
        sudah lewat.
      </p>

      {/* TREN PENILAIAN (spec C1 J10) — DUA kolom terpisah, sengaja.
          Pertanyaan yang dijawab bagian ini adalah "orangnya atau layanannya?",
          dan satu angka gabungan justru menghapus pertanyaan itu. Dua tuas
          PADMA juga berbeda pemiliknya: katalog & durasi di tangan owner,
          pembinaan tim di tangan admin. */}
      <section aria-label="Tren penilaian" className="mt-8">
        <h2 className="text-[15px] font-bold text-panel-ink">Tren penilaian</h2>
        <p className="mb-3 text-[12px] text-panel-muted">
          Diurutkan dari yang terendah. Angka ini bahan percakapan, bukan papan skor — ia tidak
          memengaruhi honor dan tidak dipakai memilih bidan.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <KolomTren judul="Per bidan" baris={tren.perBidan} kosong="Belum ada penilaian bidan." />
          <KolomTren
            judul="Per layanan"
            baris={tren.perLayanan}
            kosong="Belum ada penilaian layanan."
          />
        </div>
      </section>

      {/* Butir 5 umpan balik klien 21 Sep 2026: "Testimoni masukkan ke board
          owner dong mas, klo ada komen masukan/ kritik langsung tahu."
          Kartu tren di atas menjawab "berapa"; seksi ini menjawab "apa yang
          dikatakan orang". Urutannya KRITIK DULU, bukan kronologis — lihat
          `komentarKritikDulu` untuk alasannya. */}
      <section aria-label="Testimoni terbaru" className="mt-8">
        <h2 className="text-[15px] font-bold text-panel-ink">Apa kata klien</h2>
        <p className="mb-3 text-[12px] text-panel-muted">
          Bintang terendah di atas, supaya masukan dan kritik terbaca lebih dulu.{" "}
          <Link
            href="/admin/penilaian"
            className="font-bold text-leaf underline underline-offset-4"
          >
            Lihat semua penilaian
          </Link>
        </p>
        <div className="rounded-lg border border-panel-border bg-panel-surface p-3.5">
          {komentar.length === 0 ? (
            <p className="text-[12.5px] italic text-panel-muted">
              Belum ada komentar. Angka bintang tanpa kata-kata tetap muncul di tren di atas.
            </p>
          ) : (
            <ul>
              {komentar.map((k) => (
                <BarisKomentar key={k.id} baris={k} />
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
