import { requireRole } from "@/lib/auth/require-role";
import { formatRupiah } from "@/lib/owner/rupiah";
import { uraikanParamDaftar, type ParamMentah } from "@/app/_shell/panel/daftar";
import { Paginasi } from "@/app/_shell/panel/paginasi";
import { Bantuan } from "@/app/_shell/panel/bantuan";
import { GrafikBatang } from "@/app/_shell/panel/grafik-batang";
import { bacaPenjualan } from "@/lib/penjualan/baca";
import { hitungPenjualan, type PenjualanBulan } from "@/lib/penjualan/hitung";
import {
  bulanSekarangJakarta,
  deretBulanTerakhir,
  labelBulan,
  labelBulanPendek,
  rentangBulanJakarta,
} from "@/lib/penjualan/bulan";
import { KartuBulan } from "./kartu-bulan";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: "Penjualan" };

const BASIS = "/owner/penjualan";
const PER_HAL_BULAN = 6;
const BULAN_GRAFIK = 12;

export default async function PenjualanOwnerPage({
  searchParams,
}: {
  searchParams: Promise<ParamMentah>;
}) {
  await requireRole(["owner"]);

  // Saringan kosong: halaman ini hanya memakai `hal`. Rekap honor punya
  // saringan karena ada PEKERJAAN yang menempel di sana (honor belum
  // dibayar); penjualan tidak punya padanannya, dan kontrol tanpa tindakan
  // hanyalah kontrol yang harus dirawat.
  const param = uraikanParamDaftar(await searchParams, {});

  const sekarang = bulanSekarangJakarta();
  const deret = deretBulanTerakhir(sekarang, BULAN_GRAFIK);
  const { mulai } = rentangBulanJakarta(deret[0]);
  const { sampai } = rentangBulanJakarta(sekarang);

  const { baris, terpotong } = await bacaPenjualan({ mulai, sampai });
  const { bulan, tanpaTanggal, tanpaNilai } = hitungPenjualan(baris);

  const per = new Map(bulan.map((b) => [b.bulan, b]));

  // Sumbu-X dibangun dari DERET, bukan dari bulan yang punya data. Bulan
  // kosong yang hilang dari sumbu membuat tren yang sebenarnya datar terbaca
  // naik — dan grafik tren yang berbohong lebih buruk daripada tidak ada
  // grafik sama sekali.
  const titik = deret.map((kunci) => ({
    label: labelBulanPendek(kunci),
    keterangan: labelBulan(kunci),
    nilai: per.get(kunci)?.omzet ?? 0,
  }));

  const kosong: PenjualanBulan = {
    bulan: "",
    omzet: 0,
    jumlahPembelian: 0,
    perProduk: [],
    pengecualian: [],
  };
  const kartu = [...deret]
    .reverse()
    .map((kunci) => per.get(kunci) ?? { ...kosong, bulan: kunci });

  const awal = (param.hal - 1) * PER_HAL_BULAN;
  const halaman = kartu.slice(awal, awal + PER_HAL_BULAN);

  const omzetSetahun = bulan.reduce((n, b) => n + b.omzet, 0);

  return (
    <main>
      <header className="mb-4">
        <h1 className="text-[18px] font-bold text-panel-ink">Penjualan</h1>
        <Bantuan judul="Tentang halaman ini">
          Dihitung dari pesanan produk digital yang berstatus <b>Lunas</b> dan tidak pernah
          menerima notifikasi pengembalian dana. Dikelompokkan menurut <b>bulan kalender
          Jakarta</b>, berdasarkan kapan uangnya masuk — bukan kapan pesanannya dibuat.
          Pesanan yang uangnya ditahan Midtrans, yang dibayar sesudah tenggat, atau yang
          dikembalikan <b>tidak ikut dijumlahkan</b>; ketiganya muncul sebagai baris terpisah
          di kartu bulannya. Angka di halaman ini adalah yang <b>ditagih dan dikonfirmasi
          Midtrans</b>, bukan yang mendarat di rekening setelah potongan biaya — untuk
          pencocokan dengan mutasi bank, ini titik awal, bukan titik akhir.
        </Bantuan>
      </header>

      <div className="mb-4 rounded-lg border border-panel-border bg-panel-surface px-5 py-4">
        <p className="text-[11.5px] text-panel-muted">{`Omzet ${BULAN_GRAFIK} bulan terakhir`}</p>
        <p className="font-mono text-[20px] text-leaf">{formatRupiah(omzetSetahun)}</p>
      </div>

      <GrafikBatang
        judul={`Omzet ${BULAN_GRAFIK} bulan terakhir`}
        data={titik}
        format={formatRupiah}
        labelKolomLabel="Bulan"
        labelKolomNilai="Omzet"
      />

      {terpotong && (
        <p className="mb-3 rounded-lg border border-clay/35 bg-panel-bg px-3.5 py-3 text-[11.5px] text-clay">
          Sebagian baris terpotong oleh batas kueri — angka di halaman ini belum lengkap.
        </p>
      )}

      {tanpaTanggal > 0 && (
        <p className="mb-3 rounded-lg border border-clay/35 bg-panel-bg px-3.5 py-3 text-[11.5px] text-clay">
          {`${tanpaTanggal} pesanan tidak punya tanggal uang masuk dan tidak masuk bulan mana pun. Periksa di /admin/pesanan.`}
        </p>
      )}

      {/* Bulan kosong + tanpaNilai > 0 berarti DATA TIDAK TERBACA, bukan "tidak
          ada penjualan". Tanpa banner ini keduanya tampak identik di layar. */}
      {tanpaNilai > 0 && (
        <p className="mb-3 rounded-lg border border-clay/35 bg-panel-bg px-3.5 py-3 text-[11.5px] text-clay">
          {`${tanpaNilai} pesanan tidak terbaca rincian itemnya, sehingga nilainya tidak ada di angka mana pun di halaman ini. Biasanya ini masalah hak akses, bukan penjualan yang hilang.`}
        </p>
      )}

      {halaman.map((b) => (
        <KartuBulan key={b.bulan} bulan={b} />
      ))}

      <Paginasi basis={BASIS} param={param} total={kartu.length} perHal={PER_HAL_BULAN} />
    </main>
  );
}
