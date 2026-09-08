import { requireRole } from "@/lib/auth/require-role";
import { PAKET_TAMPIL } from "@/lib/paket-tampil";
import { daftarTagihanAdmin, SARING_BAYAR } from "@/lib/admin/tagihan";
import { uraikanParamDaftar, type ParamMentah } from "@/app/_shell/panel/daftar";
import { BilahDaftar } from "@/app/_shell/panel/bilah-daftar";
import { Paginasi } from "@/app/_shell/panel/paginasi";
import { Bantuan } from "@/app/_shell/panel/bantuan";
import { TabelBayar } from "./tabel-bayar";
import { BarisTagihanPengajuan } from "./tagihan-pengajuan";
import { daftarTagihanPengajuanAdmin } from "@/lib/admin/tagihan-pengajuan";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: "Pembayaran" };

const BASIS = "/admin/bayar";

export default async function BayarPage({
  searchParams,
}: {
  searchParams: Promise<ParamMentah>;
}) {
  await requireRole(["admin", "owner"]);

  const sp = await searchParams;
  const lamaTerlihat = sp.bukti_lama === "ya";
  const tagihanPengajuan = await daftarTagihanPengajuanAdmin({ buktiLama: lamaTerlihat });

  const param = uraikanParamDaftar(sp, SARING_BAYAR);
  // Daftarnya dirakit dengan saringan yang IDENTIK dengan yang dipakai
  // passport klien — dan dengan badge antrean. Tiga tempat, satu kebenaran:
  // begitu ketiganya berpisah, badge yang tidak bisa dibersihkan lahir.
  const { baris, total } = await daftarTagihanAdmin(param);

  return (
    <main>
      <header className="mb-4">
        <h1 className="text-[18px] font-bold text-panel-ink">Pembayaran</h1>
        <Bantuan judul="Tentang halaman ini">
          Klien menekan <b>Saya sudah bayar</b> di Passport-nya → status menjadi{" "}
          <b>Menunggu verifikasi</b> → Anda menandai <b>Lunas</b> setelah buktinya cocok, atau{" "}
          <b>Tolak klaim</b> supaya klien bisa mengklaim ulang. Setiap keputusan tercatat beserta
          nama Anda dan tidak bisa dihapus. Item yang sudah <b>Lunas</b> tidak bisa diputar mundur
          dari sini — koreksi setelah rekap pekan berjalan adalah rekonsiliasi, bukan satu klik.
          {/* GERBANG SAKLAR (K11). Kalimat ini digerbang di paragraf kaki
              halaman sebelum sapuan panel memindahkannya ke <Bantuan>;
              gerbangnya ikut pindah, tidak ditinggal. DIHAPUS seluruhnya saat
              saklar mati — bukan diganti kata lain: baris paket sudah
              digerbang di `daftarTagihanAdmin()`, jadi perilaku yang
              dijelaskannya tidak bisa diamati siapa pun, dan menerangkan hal
              yang tak terlihat hanya membingungkan. */}
          {PAKET_TAMPIL && (
            <> Sesi yang tercakup paket tidak muncul sendiri: status bayarnya mengikuti paketnya.</>
          )}{" "}
          Nominal tidak ditampilkan di daftar sesi — besarannya disampaikan tim PADMA lewat
          WhatsApp. Tagihan <b>pengajuan</b> di blok atas berbeda: ia menahan jadwal, punya
          tenggat, dan nominalnya memang ditampilkan karena QRIS statis menuntut klien mengetik
          jumlahnya sendiri.
        </Bantuan>
      </header>

      {/* TAGIHAN PENGAJUAN (spec C2) — blok TERSENDIRI di atas, bukan dilebur.
          Hanya yang ini menahan jadwal dan punya tenggat; meleburnya ke satu
          daftar tanpa penanda berarti admin tidak bisa lagi membedakan mana
          yang mendesak. */}
      <section aria-label="Tagihan pengajuan" className="mb-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-bold text-panel-ink">
            Tagihan pengajuan — menahan jadwal
          </h2>
          <a
            href={lamaTerlihat ? BASIS : `${BASIS}?bukti_lama=ya`}
            className="text-[12.5px] font-semibold text-panel-muted underline underline-offset-2"
          >
            {lamaTerlihat ? "Tampilkan semua" : "Bukti lunas > 90 hari"}
          </a>
        </div>
        {tagihanPengajuan.length === 0 ? (
          <p className="rounded-lg border border-panel-border bg-panel-surface p-6 text-center text-[13px] italic text-panel-muted">
            {lamaTerlihat
              ? "Tidak ada bukti lunas yang lebih tua dari 90 hari."
              : "Tidak ada tagihan pengajuan yang menunggu."}
          </p>
        ) : (
          <ul>
            {tagihanPengajuan.map((t) => (
              <BarisTagihanPengajuan key={t.permintaanId} {...t} />
            ))}
          </ul>
        )}
      </section>

      <BilahDaftar
        basis={BASIS}
        param={param}
        kelompok={[
          {
            nama: "status",
            label: "Status bayar",
            pilihan: [
              { nilai: "menunggu_verifikasi", label: "Menunggu verifikasi", menuntut: true },
              { nilai: "belum", label: "Belum dibayar" },
              { nilai: "lunas", label: "Lunas" },
            ],
          },
        ]}
        jumlah={baris.length}
        total={total}
        // Tidak ada tombol "+ baru": tagihan lahir dari sesi & paket, tidak
        // pernah diketik admin.
        aksi={null}
      />

      {baris.length === 0 ? (
        <p className="rounded-lg border border-panel-border bg-panel-surface p-8 text-center text-[13px] italic text-panel-muted">
          {/* Dua sebab, dua kalimat — hanya `page.tsx` tahu bedanya karena
              hanya di sini `param` (cari + saring) terlihat sekaligus. */}
          {param.cari === "" && Object.keys(param.saring).length === 0 ? (
            <>
              Belum ada tagihan yang perlu diverifikasi. Begitu klien menekan &ldquo;Saya sudah
              bayar&rdquo; di Passport-nya, itemnya muncul di sini.
            </>
          ) : (
            "Tidak ada tagihan yang cocok dengan pencarian ini."
          )}
        </p>
      ) : (
        <TabelBayar item={baris} />
      )}

      <Paginasi basis={BASIS} param={param} total={total} />
    </main>
  );
}
