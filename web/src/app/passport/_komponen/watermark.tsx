// Deterrent, bukan proteksi mutlak — itu tidak berubah, hanya APA yang
// dijaganya. `material_chapters` sudah dibongkar (migration
// materi_hapus_bab_teks / Task 11): komponen ini TIDAK LAGI dipakai reader
// bab teks (lenyap bersamanya) maupun reader e-book — halaman PDF membakar
// watermark-nya sendiri, per piksel, DI SERVER (lihat
// src/lib/materi/watermark.ts), dan `reader-pdf.tsx` tidak pernah
// mengimpor komponen ini. Satu-satunya pemanggil yang tersisa sekarang
// adalah cabang VIDEO di `passport/materi/[id]/page.tsx`.
//
// Hari ini cabang itu belum mengirim apa pun sensitif ke payload: belum ada
// penyedia video terpasang, jadi tidak ada URL pemutar yang ikut terkirim
// (lihat komentar "Kesiapan tidak boleh dikarang" di pemanggilnya) —
// watermark ini murni melapisi kartu placeholder untuk sementara. Begitu
// pemutar sungguhan terpasang, kartu itu akan membawa isi (URL/iframe
// penyedia) yang ikut terkirim bersama halaman dan terbaca lewat View
// Source/DevTools — persis seperti teks bab dulu — dan gunanya kembali
// seperti semula: melacak SUMBER bila satu tangkapan layar tersebar, bukan
// mengunci apa pun. Tidak ada platform yang bisa mencegah tangkapan layar;
// komponen ini tidak boleh dijual lebih dari itu.
export function Watermark({ nama, padmaId }: { nama: string; padmaId: string }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute -inset-10 z-0 flex rotate-[-24deg] flex-wrap items-center justify-center gap-x-12 gap-y-16 font-mono text-[12.5px] uppercase text-night opacity-[0.075]"
    >
      {Array.from({ length: 14 }, (_, i) => (
        <span key={i} className="whitespace-nowrap">
          {nama} · {padmaId}
        </span>
      ))}
    </div>
  );
}
