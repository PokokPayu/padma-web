import { requireRole } from "@/lib/auth/require-role";
import { formatRupiah } from "@/lib/rupiah-publik";
import { uraikanParamDaftar, type ParamMentah, type SaringSah } from "@/app/_shell/panel/daftar";
import { BilahDaftar } from "@/app/_shell/panel/bilah-daftar";
import { Paginasi } from "@/app/_shell/panel/paginasi";
import { Bantuan } from "@/app/_shell/panel/bantuan";
import { bacaPenjualan } from "@/lib/penjualan/baca";
import { urutkanBaris, type BarisPenjualan } from "@/lib/penjualan/hitung";
import {
  bulanSekarangJakarta,
  deretBulanTerakhir,
  labelBulan,
  rentangBulanJakarta,
} from "@/lib/penjualan/bulan";
import { TabelPenjualan } from "./tabel-penjualan";
import { CatatanBatas } from "./catatan-batas";
import { ringkasNota, notaTampil } from "./ringkas";

export const metadata = { title: "Penjualan" };

const BASIS = "/admin/penjualan";
const PER_HAL_PENJUALAN = 25;

/**
 * Periode sebagai DAFTAR PUTIH tetap, bukan bulan sembarang.
 *
 * `uraikanParamDaftar` menuntut daftar putih, dan bulan tidak bisa
 * dienumerasi. Empat pilihan ini menutupi dua pekerjaan nyata — tutup buku
 * bulanan ("bulan lalu") dan pemeriksaan berjalan ("bulan ini") — tanpa
 * mengarang kontrol yang harus dirawat.
 */
const SARING_PENJUALAN = {
  periode: ["bulan-ini", "bulan-lalu", "12-bulan", "semua"],
} as const satisfies SaringSah;

function rentangPeriode(periode: string): { mulai?: string; sampai?: string } {
  const sekarang = bulanSekarangJakarta();
  if (periode === "semua") return {};
  if (periode === "bulan-lalu") {
    const lalu = deretBulanTerakhir(sekarang, 2)[0];
    return rentangBulanJakarta(lalu);
  }
  if (periode === "12-bulan") {
    const deret = deretBulanTerakhir(sekarang, 12);
    return {
      mulai: rentangBulanJakarta(deret[0]).mulai,
      sampai: rentangBulanJakarta(sekarang).sampai,
    };
  }
  return rentangBulanJakarta(sekarang);
}

/**
 * Pencarian DI TYPESCRIPT, bukan di PostgREST.
 *
 * Barisnya sudah ditarik ke memori untuk dijumlahkan, jadi mencari di sana
 * gratis — dan ia bisa mencakup JUDUL PRODUK, yang lewat PostgREST mustahil
 * disaring dari `orders` karena judulnya hidup di kueri yang lain.
 */
function cocok(b: BarisPenjualan, cari: string): boolean {
  if (cari === "") return true;
  const q = cari.toLowerCase();
  if (b.kode.toLowerCase().includes(q)) return true;
  if (b.padmaId.toLowerCase().includes(q)) return true;
  if (b.namaKlien.toLowerCase().includes(q)) return true;
  return (b.item ?? []).some((i) => i.judulBeku.toLowerCase().includes(q));
}

export default async function PenjualanAdminPage({
  searchParams,
}: {
  searchParams: Promise<ParamMentah>;
}) {
  await requireRole(["admin", "owner"]);

  const param = uraikanParamDaftar(await searchParams, SARING_PENJUALAN);
  const periode = param.saring.periode ?? "bulan-ini";

  const { baris, terpotong } = await bacaPenjualan(rentangPeriode(periode));

  // SARINGAN PERTAMA, sebelum pencarian, total, dan paginasi. Tanpa ini
  // checkout yang ditinggalkan (lalu `kedaluwarsa`) tercetak byte-per-byte
  // sama dengan nota yang dibayar — lihat `notaTampil` di ./ringkas.
  const tampil = notaTampil(baris);

  const cocokan = urutkanBaris(tampil).filter((b) => cocok(b, param.cari));
  const awal = (param.hal - 1) * PER_HAL_PENJUALAN;
  const halaman = cocokan.slice(awal, awal + PER_HAL_PENJUALAN);

  // Hanya omzet yang dijumlahkan — pengecualian punya barisnya sendiri di
  // /owner/penjualan dan tidak boleh diam-diam masuk total mana pun.
  const { total, tanpaNilai } = ringkasNota(cocokan);

  return (
    <main>
      <header className="mb-4">
        <h1 className="text-[18px] font-bold text-panel-ink">Penjualan</h1>
        <Bantuan judul="Tentang halaman ini">
          Daftar nota penjualan produk digital, <b>satu baris per produk</b> — satu pesanan
          keranjang berisi tiga produk tampil sebagai tiga baris. Pencarian mencakup kode
          pesanan, PADMA ID, nama klien, dan judul produk. Total di bawah hanya menjumlahkan
          nota yang <b>Lunas dan tidak dikembalikan</b>; nota yang ditahan, dibayar lewat
          tenggat, atau dikembalikan tetap tampil dengan catatannya tetapi tidak ikut
          dijumlahkan. Halaman ini <b>baca saja</b> — tindakan atas pesanan bermasalah ada di{" "}
          <b>/admin/pesanan</b>.
        </Bantuan>
      </header>

      <BilahDaftar
        basis={BASIS}
        param={param}
        kelompok={[
          {
            nama: "periode",
            label: "Periode",
            bawaan: "bulan-ini",
            pilihan: [
              { nilai: "bulan-ini", label: labelBulan(bulanSekarangJakarta()) },
              { nilai: "bulan-lalu", label: labelBulan(deretBulanTerakhir(bulanSekarangJakarta(), 2)[0]) },
              { nilai: "12-bulan", label: "12 bulan" },
              { nilai: "semua", label: "Semua" },
            ],
          },
        ]}
        jumlah={halaman.length}
        total={cocokan.length}
        aksi={null}
      />

      {/* Labelnya menyebut BARIS YANG TAMPIL, bukan "periode ini", karena
          angkanya memang dijumlahkan dari `cocokan` — hasil periode SETELAH
          pencarian. Admin yang mengetik "MPASI" melihat totalnya turun; label
          yang tetap mengaku "periode ini" membuat angka itu disalin ke buku
          sebagai omzet sebulan. Yang diperbaiki kalimatnya, bukan
          hitungannya: total yang mengabaikan pencarian akan membuat layar
          memuat daftar dan angka yang tidak saling menjelaskan. */}
      <p className="mb-3 text-[12.5px] text-panel-muted">
        {"Total lunas dari baris yang tampil (seluruh halaman, mengikuti periode dan pencarian di atas): "}
        <b className="font-mono text-panel-ink">{formatRupiah(total)}</b>
      </p>

      {tanpaNilai > 0 && (
        <p
          data-tanpa-nilai={tanpaNilai}
          className="mb-3 rounded-lg border border-clay/35 bg-panel-bg px-3.5 py-3 text-[11.5px] text-clay"
        >
          {`Item dari ${tanpaNilai} nota tidak terbaca, jadi nilainya belum masuk ke total di atas. Total ini lebih kecil dari yang sebenarnya.`}
        </p>
      )}

      <CatatanBatas periode={periode} terpotong={terpotong} />

      <TabelPenjualan baris={halaman} />

      <Paginasi
        basis={BASIS}
        param={param}
        total={cocokan.length}
        perHal={PER_HAL_PENJUALAN}
      />
    </main>
  );
}
