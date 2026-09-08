import { requireRole } from "@/lib/auth/require-role";
import { daftarTagihanAdmin, SARING_BAYAR } from "@/lib/admin/tagihan";
import { uraikanParamDaftar, type ParamMentah } from "@/app/_shell/panel/daftar";
import { BilahDaftar } from "@/app/_shell/panel/bilah-daftar";
import { Paginasi } from "@/app/_shell/panel/paginasi";
import { Bantuan } from "@/app/_shell/panel/bantuan";
import { TabelBayar } from "./tabel-bayar";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: "Pembayaran" };

const BASIS = "/admin/bayar";

export default async function BayarPage({
  searchParams,
}: {
  searchParams: Promise<ParamMentah>;
}) {
  await requireRole(["admin", "owner"]);

  const param = uraikanParamDaftar(await searchParams, SARING_BAYAR);
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
          Sesi yang tercakup paket tidak muncul sendiri: status bayarnya mengikuti paketnya.
          Nominal tidak ditampilkan — besarannya disampaikan tim PADMA lewat WhatsApp.
        </Bantuan>
      </header>

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
