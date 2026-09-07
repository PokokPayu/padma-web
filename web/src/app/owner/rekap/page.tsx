import { requireRole } from "@/lib/auth/require-role";
import { ambilRekap } from "@/lib/owner/data";
import type { RekapPekan } from "@/lib/owner/rekap";
import { formatRupiah } from "@/lib/owner/rupiah";
import { formatTanggalID } from "@/lib/passport/waktu";
import { BarisHonorMitra } from "./tabel-rekap";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: "Rekap & Honor" };

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
      className="mb-3.5 rounded-2xl border border-black/10 bg-white px-5 py-5"
    >
      <h3 className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <span className="font-serif text-[17px] text-night">{`Pekan ${pekan.rentang}`}</span>
        <span className="rounded-full bg-paper px-2.5 py-1 text-[10.5px] font-extrabold uppercase tracking-wider text-ink-soft">
          {`${pekan.jumlahSesi} sesi selesai`}
        </span>
      </h3>

      <p className="mb-1 text-[11.5px] text-ink-soft">
        Honor yang harus dibayar (jadwal gajian: Sabtu):
      </p>

      {pekan.perMitra.map((m) => (
        <BarisHonorMitra key={m.partnerId} baris={m} senin={pekan.senin} />
      ))}

      {/* Margin adalah angka PADMA — per PEKAN, bukan per mitra (spec keputusan
          #6). Ia DIHITUNG di TypeScript, tidak pernah menjadi kolom: kolom
          nominal turunan akan hidup di dalam sebuah VIEW milik postgres yang
          berjalan dengan hak pemilik dan karenanya MELEWATI RLS. */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t-[1.5px] border-black/10 pt-3">
        <span className="text-[12.5px] font-bold text-ink-soft">Margin PADMA</span>
        <span className="font-mono text-[14px] text-leaf">{formatRupiah(pekan.margin)}</span>
      </div>

      {pekan.sesiTakBertarif.length > 0 && (
        <div className="mt-3 rounded-xl border border-clay/35 bg-paper px-3.5 py-3">
          <b className="block text-[12px] text-clay">
            {`${pekan.sesiTakBertarif.length} sesi pekan ini belum bertarif — honornya belum ikut dihitung di angka mana pun di atas.`}
          </b>
          <ul className="mt-1.5">
            {pekan.sesiTakBertarif.map((s) => (
              <li key={s.id} className="text-[11.5px] leading-relaxed text-ink-soft">
                {`${formatTanggalID(s.tanggal)} · ${s.namaLayanan} · ${s.namaMitra} · `}
                <span className="font-semibold text-ink">{SARAN_LAYAR[s.sebab]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

export default async function RekapPage() {
  await requireRole(["owner"]);

  // Seluruh agregasinya dihitung di TypeScript (`lib/owner/rekap.ts`), bukan
  // oleh SQL. Sebuah view penjumlah dimiliki `postgres`, berjalan dengan hak
  // PEMILIK, dan karenanya MELEWATI RLS — terbukti: admin membaca 10 baris rate
  // card lengkap lewat view biasa sementara SELECT langsung memulangkan 0.
  const rekap = await ambilRekap();

  return (
    <main>
      <header className="mb-5">
        <h1 className="font-serif text-2xl text-night">Rekap &amp; Honor</h1>
        <p className="mt-1 max-w-2xl text-[13px] text-ink-soft">
          Dihitung otomatis dari sesi berstatus <b>Selesai</b>, dengan tarif yang
          berlaku <b>pada tanggal sesi</b> — jadi menaikkan tarif hari ini tidak
          menggeser satu angka pun di pekan yang sudah lewat.
        </p>
      </header>

      {/* Ketiadaan jalur pencabutan bukan kelalaian, dan alasannya ditulis di
          layar supaya tidak ada yang menambahkannya sebagai "kenyamanan
          kecil": hak DELETE atas tanda bayar sudah dicabut, bahkan untuk
          pemilik. */}
      <p className="mb-4 rounded-2xl border-[1.5px] border-dashed border-gold bg-[#FDFAF1] p-4 text-[13px] leading-relaxed text-ink">
        ✦ Tanda bayar bersifat <b>sekali dan permanen</b>. Basis data menolak
        mencabutnya, bahkan untuk pemilik — tanda itu adalah bukti bahwa seorang
        mitra sudah menerima uangnya. Periksa jumlahnya sebelum menandai.
      </p>

      {rekap.length === 0 ? (
        <p className="rounded-2xl border border-black/10 bg-white px-5 py-8 text-center text-[13px] text-ink-soft">
          Belum ada sesi selesai. Angka di halaman ini bergerak begitu sesi
          diselesaikan di panel Admin.
        </p>
      ) : (
        rekap.map((p) => <KartuPekan key={p.senin} pekan={p} />)
      )}
    </main>
  );
}
