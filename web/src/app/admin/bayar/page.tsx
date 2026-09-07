import { requireRole } from "@/lib/auth/require-role";
import { PAKET_TAMPIL } from "@/lib/paket-tampil";
import { daftarTagihanAdmin } from "@/lib/admin/tagihan";
import { TabelBayar } from "./tabel-bayar";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: "Pembayaran" };

export default async function BayarPage() {
  await requireRole(["admin", "owner"]);

  // Daftarnya dirakit `daftarTagihanAdmin()` dengan saringan yang IDENTIK
  // dengan yang dipakai passport klien — dan dengan badge antrean. Tiga tempat,
  // satu kebenaran: begitu ketiganya berpisah, badge yang tidak bisa
  // dibersihkan lahir.
  const item = await daftarTagihanAdmin();

  return (
    <main>
      <header className="mb-5">
        <h1 className="font-serif text-2xl text-night">Pembayaran</h1>
        <p className="mt-1 max-w-2xl text-[13px] text-ink-soft">
          Verifikasi manual: cocokkan bukti di WhatsApp dengan mutasi rekening,
          lalu putuskan di sini. Nominal tidak ditampilkan — besarannya
          disampaikan tim PADMA lewat WhatsApp.
        </p>
      </header>

      <p className="mb-4 rounded-2xl border-[1.5px] border-dashed border-gold bg-[#FDFAF1] p-4 text-[13px] text-ink">
        ✦ Klien menekan <b>Saya sudah bayar</b> di Passport-nya → status menjadi{" "}
        <b>Menunggu verifikasi</b> → Anda menandai <b>Lunas</b> setelah buktinya
        cocok, atau <b>Tolak klaim</b> supaya klien bisa mengklaim ulang. Setiap
        keputusan tercatat beserta nama Anda dan tidak bisa dihapus.
      </p>

      <TabelBayar item={item} />

      <p className="mt-2 text-[12px] text-ink-soft">
        Item yang sudah <b>Lunas</b> tidak bisa diputar mundur dari sini —
        koreksi setelah rekap pekan berjalan adalah rekonsiliasi, bukan satu
        klik.
        {/* Kalimat "Sesi yang tercakup paket tidak muncul sendiri..."
            DIHAPUS SELURUHNYA saat saklar mati — bukan diganti kata lain.
            Baris paket sudah digerbang (daftarTagihanAdmin, Task 2), jadi
            perilaku yang dijelaskannya sudah tidak bisa diamati siapa pun;
            menerangkan hal yang tak terlihat hanya membingungkan. */}
        {PAKET_TAMPIL && (
          <> Sesi yang tercakup paket tidak muncul sendiri: status bayarnya mengikuti paketnya.</>
        )}
      </p>
    </main>
  );
}
