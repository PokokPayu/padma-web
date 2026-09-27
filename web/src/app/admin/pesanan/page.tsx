import { requireRole } from "@/lib/auth/require-role";
import { Bantuan } from "@/app/_shell/panel/bantuan";
import { bacaPesananStaf } from "@/lib/admin/pesanan";
import { TabelPesanan } from "./tabel-pesanan";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: "Pesanan" };

/**
 * LAPIS 2 — REKONSILIASI YANG DIPICU MANUSIA (spec 26 Sep 2026).
 *
 * DUA BLOK, bukan satu saringan. "Butuh perhatian" menjawab "apa yang salah";
 * "Terbuka" menjawab "apa yang sedang berjalan". Meleburnya jadi satu daftar
 * bersaringan berarti pesanan yang uangnya sudah masuk berbaris di antara
 * pesanan yang belum dibayar, dan yang mendesak berhenti terlihat mendesak.
 */
export default async function PesananPage() {
  await requireRole(["admin", "owner"]);

  const { butuhPerhatian, terbuka } = await bacaPesananStaf();

  return (
    <main>
      <header className="mb-4">
        <h1 className="text-[18px] font-bold text-panel-ink">Pesanan</h1>
        <Bantuan judul="Tentang halaman ini">
          Pembayaran produk digital berjalan sendiri lewat Midtrans; halaman ini hanya untuk
          yang <b>tidak</b> berjalan sendiri. <b>Butuh perhatian</b> memuat pesanan yang
          uangnya sudah masuk tapi barangnya belum keluar — <b>Ditahan</b> (nominalnya tidak
          cocok), pesanan bertanda tinjauan, dan pesanan <b>Lunas</b> yang aksesnya tidak
          pernah terbit. <b>Terbuka</b> memuat yang masih menunggu pembayaran, yang paling
          lama tidak diperiksa di atas.
          {" "}
          <b>Periksa ulang</b> menanyakan keadaan transaksi ke Midtrans lalu menjalankan
          jawabannya — vonisnya tetap datang dari Midtrans, bukan dari tombol ini.{" "}
          <b>Terbitkan akses</b> menerbitkan ulang akses produk untuk pesanan yang sudah
          lunas. <b>Putuskan</b> hanya untuk baris Ditahan, dan nama Anda ikut tercatat.{" "}
          <b>Tutup tinjauan</b> mengosongkan penanda tanpa menyentuh status — ia sengaja
          menolak baris Ditahan, karena pesanan Ditahan menuntut putusan, bukan penutupan.
          {" "}
          Nominal pesanan ditampilkan di halaman ini — satu-satunya di panel admin yang
          menunjukkan yang ditagih bersebelahan dengan yang diterima — karena
          pertanyaan &ldquo;berapa yang klien ini bayar&rdquo; harus bisa dijawab dari dalam
          PADMA, bukan dari dashboard Midtrans. Pengembalian uang tidak dilakukan dari sini;
          yang disediakan hanyalah nomor transaksi untuk diurus di dashboard Midtrans.
        </Bantuan>
      </header>

      <section aria-label="Butuh perhatian" className="mb-6">
        <h2 className="mb-2 text-[15px] font-bold text-panel-ink">
          Butuh perhatian — uang masuk, barang belum keluar
        </h2>
        {butuhPerhatian.length === 0 ? (
          <p className="rounded-lg border border-panel-border bg-panel-surface p-6 text-center text-[13px] italic text-panel-muted">
            Tidak ada pesanan yang menunggu keputusan.
          </p>
        ) : (
          <TabelPesanan baris={butuhPerhatian} />
        )}
      </section>

      <section aria-label="Terbuka">
        <h2 className="mb-2 text-[15px] font-bold text-panel-ink">
          Terbuka — menunggu pembayaran
        </h2>
        {terbuka.length === 0 ? (
          <p className="rounded-lg border border-panel-border bg-panel-surface p-6 text-center text-[13px] italic text-panel-muted">
            Tidak ada pesanan yang sedang menunggu pembayaran.
          </p>
        ) : (
          <TabelPesanan baris={terbuka} />
        )}
      </section>
    </main>
  );
}
