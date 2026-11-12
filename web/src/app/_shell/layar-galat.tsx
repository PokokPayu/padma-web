import Link from "next/link";

/**
 * Isi layar untuk keempat `error.tsx` (situs, `/admin`, `/owner`, `/passport`).
 * Murni tampilan: tidak menerima objek galat, hanya `kode` (digest), supaya
 * pesan galat tidak punya jalan ke layar. Di produksi Next sudah menyamarkan
 * pesan galat server component, tetapi galat dari client component tetap
 * membawa pesan aslinya.
 */
export function LayarGalat({
  tema,
  kode,
  pulang,
  onCobaLagi,
}: {
  tema: "klien" | "panel";
  kode?: string;
  pulang: { href: string; label: string };
  onCobaLagi: () => void;
}) {
  const panel = tema === "panel";
  return (
    <div role="alert" className="mx-auto w-full max-w-md px-4 py-12">
      <h1
        className={
          panel ? "text-[18px] font-bold text-panel-ink" : "font-serif text-xl text-night"
        }
      >
        Halaman ini gagal dimuat.
      </h1>
      <p className={`mt-2 text-[14px] ${panel ? "text-panel-ink" : "text-ink"}`}>
        {panel
          ? "Coba muat ulang. Bila tetap gagal, laporkan ke pengembang beserta kode di bawah."
          : "Coba muat ulang. Bila tetap gagal, hubungi tim PADMA dan sebutkan kode di bawah."}
      </p>
      {kode && (
        <p className={`mt-3 text-[13px] ${panel ? "text-panel-ink" : "text-ink"}`}>
          Kode galat: <span className="font-mono">{kode}</span>
        </p>
      )}
      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onCobaLagi}
          className={
            panel
              ? "min-h-[44px] rounded-xl bg-panel-ink px-4 py-2.5 text-[13px] font-bold text-panel-surface"
              : "min-h-[44px] rounded-lg bg-night px-5 py-3 font-bold text-gold-pale"
          }
        >
          Coba lagi
        </button>
        <Link
          href={pulang.href}
          className={
            panel
              ? "inline-flex min-h-[44px] items-center rounded-xl border border-panel-border bg-panel-surface px-4 py-2.5 text-[13px] font-bold text-panel-ink"
              : "inline-flex min-h-[44px] items-center rounded-lg border border-night/20 px-5 py-3 font-bold text-night"
          }
        >
          {pulang.label}
        </Link>
      </div>
    </div>
  );
}
