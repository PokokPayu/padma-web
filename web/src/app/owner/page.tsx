import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { ambilRekap } from "@/lib/owner/data";
import { deretPekanTerakhir } from "@/lib/owner/rekap";
import { formatRupiah } from "@/lib/owner/rupiah";
import { formatTanggalID, formatTanggalPendek, hariIniJakarta } from "@/lib/passport/waktu";
import { StatTile } from "@/app/_shell/panel/stat-tile";
import { Kartu } from "@/app/_shell/panel/kartu";
import { Tabel, Th, Td } from "@/app/_shell/panel/tabel";
import { GrafikPekan } from "./_shell/grafik-pekan";
import { ambilTrenPenilaian } from "@/lib/admin/penilaian";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: "Panel Owner" };

const TAUTAN_KECIL =
  "text-[12px] font-bold text-leaf underline underline-offset-4 transition hover:text-night";

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
  const [rekap, tren] = await Promise.all([ambilRekap(), ambilTrenPenilaian()]);

  // Pekan sepi tidak punya ember sendiri di `hitungRekap()`; deretPekanTerakhir
  // mengisinya dengan nol supaya sumbu waktunya tidak berlubang.
  const deret = deretPekanTerakhir(rekap, hariIni, 8);
  // Elemen terakhir deret ADALAH pekan berjalan menurut definisinya, dan sudah
  // berisi nol bila pekan itu belum punya sesi sama sekali.
  const pekan = deret[deret.length - 1];
  const jumlahMitra = pekan.perMitra.length;
  const jumlahTakBertarif = pekan.sesiTakBertarif.length;

  const labelPekan = deret.map((p) => {
    const { hari, bulan } = formatTanggalPendek(p.senin);
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
        <StatTile
          label="Honor dibayar Sabtu ini"
          nilai={formatRupiah(pekan.totalHonor)}
          keterangan={`Dari sesi berstatus Selesai pekan ${pekan.rentang}`}
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
    </main>
  );
}
