import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { hitungAntrean } from "@/lib/admin/antrean";
import { trenSesiSelesai } from "@/lib/admin/tren";
import { agendaHariIni, aktivitasTerbaru } from "@/lib/admin/agenda";
import { formatTanggalID, formatTanggalPendek, hariIniJakarta } from "@/lib/passport/waktu";
import { StatTile } from "@/app/_shell/panel/stat-tile";
import { Kartu } from "@/app/_shell/panel/kartu";
import { Tabel, Th, Td } from "@/app/_shell/panel/tabel";
import { GrafikBatang } from "@/app/_shell/panel/grafik-batang";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: "Panel Admin" };

const TAUTAN_KECIL =
  "text-[12px] font-bold text-leaf underline underline-offset-4 transition hover:text-night";

export default async function AdminPage() {
  const { nama } = await requireRole(["admin", "owner"]);

  // "Hari ini" menurut Jakarta, bukan menurut jam server (Vercel berjalan UTC).
  // Tanggalnya diteruskan sebagai argumen ke seluruh lapisan data supaya tidak
  // ada satu pun di antaranya yang membaca jam sistem sendiri.
  const hariIni = hariIniJakarta();

  const [antrean, tren, agenda, aktivitas] = await Promise.all([
    hitungAntrean(),
    trenSesiSelesai(hariIni),
    agendaHariIni(hariIni),
    aktivitasTerbaru(6),
  ]);

  const titikTren = tren.map((t) => {
    const { hari, bulan } = formatTanggalPendek(t.senin);
    // `keterangan` membawa rentang penuh ("1 – 7 Sep 2026") ke tooltip dan
    // kolom pertama tabel padanan; label pendek ("1 SEP") tetap yang dipakai
    // di sumbu-X sendiri, tempat rentang penuh akan kepanjangan.
    return { label: `${hari} ${bulan}`, nilai: t.jumlah, keterangan: t.rentang };
  });

  return (
    <main>
      <header className="mb-5">
        <h1 className="text-[20px] font-bold text-panel-ink">Panel Admin</h1>
        <p className="mt-1 text-[13px] text-panel-muted">
          Halo, {nama}. Inilah yang menunggu ditangani hari ini · {formatTanggalID(hariIni)}
        </p>
      </header>

      {/* Aksi cepat: dua jalan pintas ke formulir yang paling sering dibuka
          dari beranda, bukan sekadar navigasi ke modulnya. Ditaruh persis di
          bawah header supaya terbaca sebagai TINDAKAN, bukan tautan lain di
          antara sekian banyak tautan pada halaman ini. */}
      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          href="/admin/klien"
          className="rounded-xl bg-night px-4 py-2.5 text-[13px] font-bold text-gold-pale"
        >
          + Klien baru
        </Link>
        <Link
          href="/admin/sesi"
          className="rounded-xl bg-night px-4 py-2.5 text-[13px] font-bold text-gold-pale"
        >
          + Sesi baru
        </Link>
      </div>

      {/* Keempat angka antrean. `menuntut` menyala hanya saat ada pekerjaan —
          bila semua angka merah, tidak ada yang berarti merah. */}
      <section
        aria-label="Antrean klinik"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        <StatTile
          label="Skrining baru"
          nilai={String(antrean.skriningBaru)}
          keterangan="Belum ditindaklanjuti"
          href="/admin/skrining"
          menuntut={antrean.skriningBaru > 0}
        />
        <StatTile
          label="Permintaan jadwal"
          nilai={String(antrean.permintaanMenunggu)}
          keterangan="Menunggu konfirmasi"
          href="/admin/sesi"
          menuntut={antrean.permintaanMenunggu > 0}
        />
        <StatTile
          label="Klaim pembayaran"
          nilai={String(antrean.klaimMenunggu)}
          keterangan="Sesi & paket menunggu verifikasi"
          href="/admin/bayar"
          menuntut={antrean.klaimMenunggu > 0}
        />
        <StatTile
          label="Klien belum aktif"
          nilai={String(antrean.klienBelumAktif)}
          keterangan="Tautan aktivasi belum dipakai"
          href="/admin/klien"
          menuntut={antrean.klienBelumAktif > 0}
        />
      </section>

      <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-3">
        <Kartu
          judul="Sesi selesai per pekan"
          className="xl:col-span-2"
          aksi={
            <Link href="/admin/sesi" className={TAUTAN_KECIL}>
              Buka Sesi
            </Link>
          }
        >
          {/* `format` SENGAJA tidak dioper: fungsi tidak bisa menyeberang dari
              server component ke client component di App Router. Nilai bawaan
              GrafikBatang (`String(n)`) memang yang dibutuhkan di sini —
              jumlah sesi adalah bilangan polos tanpa satuan. */}
          <GrafikBatang
            judul="Sesi selesai delapan pekan terakhir"
            data={titikTren}
          />
        </Kartu>

        <Kartu judul="Aktivitas terbaru">
          {aktivitas.length === 0 ? (
            <p className="text-[12.5px] text-panel-muted">
              Belum ada skrining atau permintaan jadwal yang masuk.
            </p>
          ) : (
            <ul className="grid gap-2.5">
              {aktivitas.map((a, i) => (
                <li key={`${a.href}-${i}`} className="text-[12.5px] leading-snug">
                  <Link href={a.href} className="text-panel-ink hover:text-leaf">
                    {a.teks}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Kartu>
      </div>

      <div className="mt-4">
        <Kartu
          judul="Agenda hari ini"
          aksi={
            <Link href="/admin/sesi" className={TAUTAN_KECIL}>
              Jadwalkan sesi
            </Link>
          }
        >
          {agenda.length === 0 ? (
            <p className="text-[12.5px] text-panel-muted">
              Tidak ada sesi terjadwal hari ini.
            </p>
          ) : (
            <Tabel label="Sesi terjadwal hari ini">
              <thead>
                <tr>
                  <Th>Klien</Th>
                  <Th>Layanan</Th>
                  <Th>Mitra</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {agenda.map((s) => (
                  <tr key={s.id}>
                    <Td>
                      <Link href="/admin/klien" className="font-bold hover:text-leaf">
                        {s.namaKlien}
                      </Link>
                      <span className="ml-1.5 text-[11.5px] text-panel-muted">
                        {s.padmaId}
                      </span>
                    </Td>
                    <Td>{s.namaLayanan}</Td>
                    <Td>{s.namaMitra}</Td>
                    <Td>{s.status === "selesai" ? "Selesai" : "Terjadwal"}</Td>
                  </tr>
                ))}
              </tbody>
            </Tabel>
          )}
        </Kartu>
      </div>
    </main>
  );
}
