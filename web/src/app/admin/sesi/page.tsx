import { requireRole } from "@/lib/auth/require-role";
import { createServerSupabase } from "@/lib/supabase/server";
import { pilihanMitra } from "@/lib/admin/mitra";
import { formatTanggalID } from "@/lib/passport/waktu";
import { BlokPermintaan, type PermintaanAntre } from "./antrean-permintaan";
import { LABEL_WAKTU, type PreferensiWaktu } from "./status";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: "Sesi" };

type BarisPermintaan = {
  id: string;
  tanggal: string;
  preferensi_waktu: PreferensiWaktu;
  catatan: string;
  clients: { nama: string } | null;
  services: { nama: string } | null;
};

export default async function SesiPage() {
  await requireRole(["admin", "owner"]);

  // Sesi pengguna, bukan service role: policy `booking: staf` yang mengizinkan
  // antrean ini terbaca, dan itulah yang ingin ikut diperiksa Postgres.
  const supabase = await createServerSupabase();

  const [{ data: permintaan }, mitra] = await Promise.all([
    supabase
      .from("booking_requests")
      .select("id, tanggal, preferensi_waktu, catatan, clients ( nama ), services ( nama )")
      .eq("status", "menunggu")
      // Yang paling dekat tanggalnya paling mendesak dijawab.
      .order("tanggal", { ascending: true })
      .order("created_at", { ascending: true })
      .returns<BarisPermintaan[]>(),
    // Hanya mitra AKTIF yang boleh ditawarkan untuk sesi baru. Daftar NAMA untuk
    // riwayat (view `partner_publik`) sengaja tidak menyaring apa pun — dua
    // kebutuhan berbeda dari satu tabel yang sama.
    pilihanMitra(),
  ]);

  const antre: PermintaanAntre[] = (permintaan ?? []).map((p) => ({
    id: p.id,
    // Nama, bukan UUID: antrean ini dibaca manusia yang akan menelepon orangnya.
    namaKlien: p.clients?.nama ?? "Klien",
    namaLayanan: p.services?.nama ?? "Layanan",
    // Tanggal diformat lewat kalender Asia/Jakarta — server berjalan UTC, dan
    // `new Date(tgl)` di zona mana pun bisa mundur sehari.
    tanggal: formatTanggalID(p.tanggal),
    waktu: LABEL_WAKTU[p.preferensi_waktu] ?? p.preferensi_waktu,
    catatan: p.catatan,
  }));

  return (
    <main>
      <header className="mb-5">
        <h1 className="font-serif text-2xl text-night">Sesi</h1>
        <p className="mt-1 max-w-xl text-[13px] text-ink-soft">
          Permintaan jadwal dari klien menunggu keputusan di sini. Yang
          dikonfirmasi langsung menjadi sesi pada Passport kliennya.
        </p>
      </header>

      <section aria-label="Permintaan jadwal menunggu">
        {antre.length === 0 ? (
          <p className="rounded-2xl border border-black/10 bg-white p-8 text-center text-sm italic text-ink-soft">
            Tidak ada permintaan jadwal yang menunggu.
          </p>
        ) : (
          <>
            {antre.map((p) => (
              <BlokPermintaan key={p.id} permintaan={p} mitra={mitra} />
            ))}
            <p className="mb-4 mt-0.5 text-[12px] text-ink-soft">
              Konfirmasi mengubah permintaan menjadi sesi Terjadwal — kabari juga
              klien via WhatsApp.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
