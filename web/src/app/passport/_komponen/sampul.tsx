import { Lotus } from "@/app/_landing/lotus";

// Sampul paspor: elemen yang paling menentukan kesan pertama klien, dan satu-
// satunya blok di beranda yang bisa memaksa halaman menggeser ke samping di
// layar 390px. Deretan ringkas di bawah (bentuk "MRZ" pada paspor sungguhan)
// berjarak huruf lebar, jadi di mobile ia WAJIB boleh melipat — `nowrap` hanya
// dipasang mulai breakpoint sm.
export function SampulPassport({
  nama,
  padmaId,
  faseId,
  faseSanskrit,
  faseNama,
  sejak,
  ringkasProgres,
}: {
  nama: string;
  padmaId: string;
  /**
   * NULL = fase belum ditentukan, dan itu keadaan yang SAH: klien yang
   * mendaftar sendiri belum punya fase sampai skrining pertamanya tersambung
   * (migration `fase_klien_boleh_kosong`). `faseId` — bukan kedua string di
   * bawahnya — yang menjadi penanda, karena keduanya juga bernilai "" ketika
   * embed `phases` gagal dimuat, dan dua sebab berbeda tidak boleh dibedakan
   * dengan tanda yang sama.
   */
  faseId: string | null;
  faseSanskrit: string;
  faseNama: string;
  sejak: string;
  ringkasProgres: string | null;
}) {
  return (
    <section
      className="relative mb-6 overflow-hidden rounded-3xl border border-gold/30 p-8 pb-6 text-[#EFE6CE] shadow-2xl
      [background:radial-gradient(560px_300px_at_80%_-10%,rgba(47,106,72,.5),transparent_60%),linear-gradient(150deg,#12392A,#0A2B1F_70%)]"
    >
      {/* Bingkai emas dalam — detail kecil yang paling gampang hilang saat
          porting dari prototipe, padahal ia yang membuat sampul terbaca
          sebagai "paspor" alih-alih kartu biasa. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-2.5 rounded-2xl border border-gold/20"
      />

      <Lotus className="mx-auto mb-3.5 block w-[52px] text-gold-bright" />
      <p className="text-center text-[10.5px] font-bold uppercase tracking-[0.4em] text-gold-bright">
        Digital Care Passport
      </p>
      <h1 className="mt-2.5 text-center font-serif text-[32px] leading-tight text-[#F8F1DE]">
        {nama}
      </h1>

      <div className="mt-2.5 flex flex-wrap justify-center gap-3 text-xs text-[#B9C6B4]">
        <span>
          PADMA ID <b className="font-mono font-medium text-gold-pale">{padmaId}</b>
        </span>
        {/* Baris fase DIHILANGKAN seluruhnya saat belum ditentukan, bukan
            diisi "—". Ini sampul paspor, hal pertama yang dilihat klien
            tentang dirinya sendiri; sebuah medan kosong di sana terbaca
            sebagai "PADMA kehilangan data saya", padahal yang benar adalah
            "PADMA belum bertanya". Fasenya terisi sendiri begitu skrining
            pertamanya tersambung. */}
        {faseId && (
          <span>
            Fase{" "}
            <b className="font-mono font-medium uppercase text-gold-pale">
              {faseSanskrit} · {faseNama}
            </b>
          </span>
        )}
        <span>
          Sejak <b className="font-mono font-medium uppercase text-gold-pale">{sejak}</b>
        </span>
      </div>

      <p className="mt-4 overflow-hidden rounded-xl bg-black/25 px-3.5 py-2.5 text-center font-mono text-[11px] uppercase tracking-[0.22em] text-[#C9BE9A] max-sm:whitespace-normal max-sm:tracking-[0.14em] max-sm:text-[9.5px] sm:whitespace-nowrap">
        {padmaId}
        {ringkasProgres && (
          <>
            <span className="mx-1 text-[#6E8271]">·</span>
            {ringkasProgres}
          </>
        )}
      </p>
    </section>
  );
}
