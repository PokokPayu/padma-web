import { requireRole } from "@/lib/auth/require-role";
import { ambilDaftarRekap, PER_HAL_REKAP, SARING_REKAP } from "@/lib/owner/daftar-rekap";
import type { RekapPekan } from "@/lib/owner/rekap";
import { formatRupiah } from "@/lib/owner/rupiah";
import { formatTanggalID } from "@/lib/passport/waktu";
import { uraikanParamDaftar, type ParamMentah } from "@/app/_shell/panel/daftar";
import { BilahDaftar } from "@/app/_shell/panel/bilah-daftar";
import { Paginasi } from "@/app/_shell/panel/paginasi";
import { Bantuan } from "@/app/_shell/panel/bantuan";
import { BarisHonorMitra } from "./tabel-rekap";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: "Rekap & Honor" };

const BASIS = "/owner/rekap";

/**
 * Ke layar mana owner harus pergi untuk menuntaskan satu sesi tak-bertarif.
 *
 * (Critical 2, Task 9 fix round 1) `SesiTakBertarif.sebab` sempat ditambahkan
 * tanpa satu pun konsumen — komentar di `lib/owner/rekap.ts` berjanji "owner
 * tahu layar mana yang harus ia buka", tetapi tidak ada baris UI yang
 * membacanya. Kemampuan tanpa konsumen adalah kemampuan yang tidak ada.
 */
const SARAN_LAYAR: Record<"varian" | "transport", string> = {
  varian: "Buka /owner/tarif untuk menetapkan tarif layanannya",
  transport: "Buka /owner/transport untuk menetapkan tarif jaraknya",
};

/**
 * Satu kartu pekan — bentuk `.week-card` prototipe.
 *
 * `data-pekan` membawa Senin pekannya. Ia bukan hiasan: seluruh nominal di
 * halaman ini tampak serupa antar pekan, dan tanpa penanda itu sebuah
 * assertion (atau seorang pembaca) bisa membaca angka pekan lain sebagai angka
 * pekan yang sedang dilihatnya.
 */
function KartuPekan({ pekan }: { pekan: RekapPekan }) {
  return (
    <article
      data-pekan={pekan.senin}
      className="mb-3.5 rounded-lg border border-panel-border bg-panel-surface px-5 py-5"
    >
      <h3 className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <span className="text-[14px] font-bold text-panel-ink">{`Pekan ${pekan.rentang}`}</span>
        <span className="rounded-full border border-panel-border px-2.5 py-1 text-[10.5px] font-extrabold uppercase tracking-wider text-panel-muted">
          {`${pekan.jumlahSesi} sesi selesai`}
        </span>
      </h3>

      <p className="mb-1 text-[11.5px] text-panel-muted">
        Honor yang harus dibayar (jadwal gajian: Sabtu):
      </p>

      {pekan.perMitra.map((m) => (
        <BarisHonorMitra key={m.partnerId} baris={m} senin={pekan.senin} />
      ))}

      {/* Margin adalah angka PADMA — per PEKAN, bukan per mitra (spec keputusan
          #6). Ia DIHITUNG di TypeScript, tidak pernah menjadi kolom: kolom
          nominal turunan akan hidup di dalam sebuah VIEW milik postgres yang
          berjalan dengan hak pemilik dan karenanya MELEWATI RLS. */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-panel-border pt-3">
        <span className="text-[12.5px] font-bold text-panel-muted">Margin PADMA</span>
        <span className="font-mono text-[14px] text-leaf">{formatRupiah(pekan.margin)}</span>
      </div>

      {pekan.sesiTakBertarif.length > 0 && (
        <div className="mt-3 rounded-lg border border-clay/35 bg-panel-bg px-3.5 py-3">
          <b className="block text-[12px] text-clay">
            {`${pekan.sesiTakBertarif.length} sesi pekan ini belum bertarif — honornya belum ikut dihitung di angka mana pun di atas.`}
          </b>
          <ul className="mt-1.5">
            {pekan.sesiTakBertarif.map((s) => (
              <li key={s.id} className="text-[11.5px] leading-relaxed text-panel-muted">
                {`${formatTanggalID(s.tanggal)} · ${s.namaLayanan} · ${s.namaMitra} · `}
                <span className="font-semibold text-panel-ink">{SARAN_LAYAR[s.sebab]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

export default async function RekapPage({
  searchParams,
}: {
  searchParams: Promise<ParamMentah>;
}) {
  await requireRole(["owner"]);

  const param = uraikanParamDaftar(await searchParams, SARING_REKAP);
  // Seluruh agregasinya dihitung di TypeScript (`lib/owner/rekap.ts`), bukan
  // oleh SQL. Sebuah view penjumlah dimiliki `postgres`, berjalan dengan hak
  // PEMILIK, dan karenanya MELEWATI RLS.
  const { baris, total } = await ambilDaftarRekap(param);

  return (
    <main>
      <header className="mb-4">
        <h1 className="text-[18px] font-bold text-panel-ink">Rekap &amp; Honor</h1>
        <Bantuan judul="Tentang halaman ini">
          Dihitung otomatis dari sesi berstatus <b>Selesai</b>, dengan tarif yang berlaku{" "}
          <b>pada tanggal sesi</b> — jadi menaikkan tarif hari ini tidak menggeser satu angka pun di
          pekan yang sudah lewat. Jadwal gajian: Sabtu. Tanda bayar bersifat{" "}
          <b>sekali dan permanen</b>: basis data menolak mencabutnya, bahkan untuk pemilik, karena
          tanda itu adalah bukti bahwa seorang mitra sudah menerima uangnya. Periksa jumlahnya
          sebelum menandai.
        </Bantuan>
      </header>

      <BilahDaftar
        basis={BASIS}
        param={param}
        kelompok={[
          {
            nama: "honor",
            label: "Honor",
            pilihan: [
              // Pekan yang masih punya honor belum ditandai adalah PEKERJAAN —
              // uang yang belum berpindah tangan, bukan sekadar kabar.
              { nilai: "belum", label: "Belum tuntas", menuntut: true },
              { nilai: "tuntas", label: "Sudah tuntas" },
            ],
          },
        ]}
        jumlah={baris.length}
        total={total}
        // Pekan tidak dibuat dari panel mana pun — ia lahir dari sesi yang
        // diselesaikan di panel Admin.
        aksi={null}
      />

      {baris.length === 0 ? (
        <p className="rounded-lg border border-panel-border bg-panel-surface p-8 text-center text-[13px] italic text-panel-muted">
          {param.cari === "" && Object.keys(param.saring).length === 0
            ? "Belum ada sesi selesai. Angka di halaman ini bergerak begitu sesi diselesaikan di panel Admin."
            : "Tidak ada pekan yang cocok dengan pencarian ini."}
        </p>
      ) : (
        baris.map((p) => <KartuPekan key={p.senin} pekan={p} />)
      )}

      <Paginasi basis={BASIS} param={param} total={total} perHal={PER_HAL_REKAP} />
    </main>
  );
}
