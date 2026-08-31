import { requireRole } from "@/lib/auth/require-role";
import { NavOwner } from "./_shell/nav-owner";

// JEBAKAN: `tests/access-matrix-layouts.test.ts` dan
// `tests/owner-kerangka.test.ts` mem-parse berkas ini dan menuntut penjaga
// peran dipanggil TEPAT SATU KALI dengan daftar peran PERSIS ["owner"].
//
// Menyalin shell admin membawa serta daftar peran admin+owner miliknya — dan
// itu bukan kelonggaran kecil: seluruh nominal PADMA (rate card, honor, margin)
// akan terbuka untuk admin dalam satu karakter perubahan. Nama pemakai diambil
// dari nilai kembalian panggilan yang sama; jangan menambah pemanggilan kedua
// hanya untuk memperoleh identitas.
//
// Perlu diingat pula bahwa layout ini TIDAK menjaga server action: dibuktikan
// dengan mem-POST action panel admin dari rute lain sebagai admin, dan
// mutasinya berhasil. Karena itu SETIAP server action di bawah /owner wajib
// memanggil penjaga peran yang sama sendiri di baris pertamanya.
export default async function OwnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { nama } = await requireRole(["owner"]);

  return (
    <div className="min-h-screen bg-paper">
      <div className="mx-auto max-w-6xl px-4 pb-36 pt-6 sm:pb-10">
        {/* Identitas & jalan keluar kini di dalam kartu nav (MenuAkun), bukan
            strip terpisah di atasnya. Di mobile jalan keluarnya ada di Beranda. */}
        <NavOwner nama={nama} />
        {children}

        {/* Kebalikan persis dari catatan di panel admin ("tidak ada angka uang
            di panel ini"). Keduanya menjelaskan sisi yang sama dari satu
            firewall, dan owner perlu tahu bahwa yang ia lihat di sini memang
            tidak pernah sampai ke layar siapa pun yang lain. */}
        <p className="mt-10 border-t border-black/10 pt-4 text-[11.5px] leading-relaxed text-ink-soft">
          <b className="text-ink">Money firewall</b> — panel inilah satu-satunya
          tempat nominal uang hidup. Admin dan klien tidak pernah melihat angka
          di halaman ini, dan penolakannya ditegakkan di level basis data.
        </p>
      </div>
    </div>
  );
}
