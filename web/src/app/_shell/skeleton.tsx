/**
 * Kerangka muat (skeleton) untuk ketiga panel.
 *
 * Dipakai lewat `loading.tsx` di tiap segmen. Karena `loading.tsx` hidup DI
 * DALAM layout panel, nav dan menu akun tetap tampil utuh saat isi halaman
 * dimuat — yang berganti hanya area isinya. Itu disengaja: nav yang ikut
 * berkedip membuat perpindahan halaman terasa seperti memuat ulang aplikasi.
 *
 * Bentuknya sengaja meniru bentuk yang benar-benar dominan di ketiga panel —
 * kartu putih `rounded-2xl border border-black/10` berisi judul dan beberapa
 * baris. Kerangka yang tidak menyerupai isi aslinya justru menambah kejut saat
 * isi datang, sebab tata letaknya melompat.
 */

/** Satu blok abu berdenyut. Selalu `aria-hidden`: ia bentuk, bukan informasi. */
export function Blok({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      // `motion-reduce:animate-none` bukan hiasan: denyut yang berulang adalah
      // salah satu pemicu paling umum bagi pemakai yang menyetel "kurangi
      // gerak", dan halaman ini bisa tampil berdetik-detik di koneksi lambat.
      className={`block animate-pulse rounded-md bg-black/[0.07] motion-reduce:animate-none ${className}`}
    />
  );
}

/**
 * Bentuk kartu berbeda antara panel staf dan panel klien.
 *
 * `/admin` & `/owner` memakai bahasa visual ruang kerja (radius 8px, garis
 * token panel); `/passport` tetap memakai bahasa visual PADMA yang lama.
 * Satu bentuk untuk keduanya berarti salah satunya melompat saat isi datang.
 */
export type VarianKerangka = "panel" | "klien";

const KARTU: Record<VarianKerangka, string> = {
  panel: "rounded-lg border border-panel-border bg-panel-surface p-5",
  klien: "rounded-2xl border border-black/10 bg-white p-6",
};

/** Kartu: satu judul + `baris` baris teks. */
export function KartuSkeleton({
  baris = 3,
  varian = "klien",
  className = "",
}: {
  baris?: number;
  varian?: VarianKerangka;
  className?: string;
}) {
  return (
    <div className={`${KARTU[varian]} ${className}`}>
      <Blok className="h-5 w-2/5" />
      <div className="mt-5 grid gap-3">
        {Array.from({ length: baris }, (_, i) => (
          <Blok
            key={i}
            // Baris terakhir sengaja lebih pendek — paragraf sungguhan memang
            // jarang berhenti pas di tepi kanan.
            className={`h-3.5 ${i === baris - 1 ? "w-1/2" : "w-full"}`}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Kerangka satu halaman panel.
 *
 * `label` dibacakan pembaca layar lewat `role="status"`; blok-bloknya sendiri
 * `aria-hidden`, sehingga yang terdengar adalah "Memuat ..." — bukan deretan
 * elemen kosong tanpa makna.
 */
export function HalamanSkeleton({
  label,
  kartu = 2,
  baris = 4,
  varian = "klien",
}: {
  label: string;
  kartu?: number;
  baris?: number;
  varian?: VarianKerangka;
}) {
  return (
    // `data-kerangka` adalah pegangan test E2E: sejak loading.tsx ada, Next
    // memindahkan URL seketika lalu menyusulkan isi, sehingga menunggu URL atau
    // "networkidle" saja bisa selesai ketika layar masih berisi kerangka ini.
    // Penanda inilah yang ditunggu HILANG. Sengaja atribut data tersendiri,
    // bukan role="status", supaya status lain yang mungkin lahir kelak (mis.
    // pesan hasil simpan pada form) tidak ikut membekukan test.
    <div role="status" aria-live="polite" data-kerangka="muat">
      <span className="sr-only">{label}</span>
      <div className="grid gap-3.5">
        {Array.from({ length: kartu }, (_, i) => (
          <KartuSkeleton
            key={i}
            varian={varian}
            baris={i === 0 ? baris : Math.max(2, baris - 2)}
          />
        ))}
      </div>
    </div>
  );
}
