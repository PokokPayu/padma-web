import { createServerSupabase } from "@/lib/supabase/server";

export type SesiAgenda = {
  id: string;
  namaKlien: string;
  padmaId: string;
  namaLayanan: string;
  namaMitra: string;
  status: "terjadwal" | "selesai";
};

type BarisAgenda = {
  id: string;
  status: SesiAgenda["status"];
  clients: { nama: string; padma_id: string } | null;
  services: { nama: string } | null;
  partners: { nama: string } | null;
};

/**
 * Sesi yang dijadwalkan HARI INI.
 *
 * Tanggalnya datang sebagai ARGUMEN, tidak dibaca dari jam server: Vercel
 * berjalan UTC sementara klinik hidup di WIB, sehingga membaca jam sistem
 * langsung (memanggil konstruktor `Date` tanpa argumen) di sini akan
 * menggeser agenda satu hari selama tujuh jam setiap hari — dan pergeseran
 * itu tidak menghasilkan error apa pun.
 *
 * Sesi BATAL disaring. Bidan yang berangkat ke rumah klien karena membaca
 * baris yang sudah dibatalkan adalah kerugian nyata, bukan sekadar tampilan
 * yang keliru.
 */
export async function agendaHariIni(hariIni: string): Promise<SesiAgenda[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("sessions")
    .select("id, status, clients(nama, padma_id), services(nama), partners(nama)")
    .eq("tanggal", hariIni)
    .neq("status", "batal")
    .returns<BarisAgenda[]>();

  return (data ?? []).map((r) => ({
    id: r.id,
    namaKlien: r.clients?.nama ?? "Klien",
    padmaId: r.clients?.padma_id ?? "",
    namaLayanan: r.services?.nama ?? "Layanan",
    namaMitra: r.partners?.nama ?? "Mitra PADMA",
    status: r.status,
  }));
}

export type Aktivitas = {
  jenis: "skrining" | "permintaan";
  teks: string;
  /** ISO timestamp; dipakai mengurutkan, bukan ditampilkan apa adanya. */
  pada: string;
  href: string;
};

/**
 * Apa yang baru masuk ke klinik dari luar.
 *
 * Dua sumber saja — skrining dan permintaan jadwal — karena keduanyalah yang
 * DATANG SENDIRI dan menunggu jawaban admin. Klien baru dan sesi baru adalah
 * hasil tindakan admin sendiri; menampilkannya di sini membuat daftar ini
 * berisi gema pekerjaan yang baru saja dikerjakan.
 *
 * Penggabungan dan pengurutan dilakukan di JS: dua tabel tanpa relasi tidak
 * bisa diurutkan bersama oleh PostgREST tanpa membuat view, dan view berjalan
 * dengan hak pemiliknya sehingga MELEWATI RLS.
 */
export async function aktivitasTerbaru(batas = 6): Promise<Aktivitas[]> {
  const supabase = await createServerSupabase();

  const [skrining, permintaan] = await Promise.all([
    supabase
      .from("screenings")
      .select("kode, nama, created_at")
      .order("created_at", { ascending: false })
      .limit(batas)
      .returns<{ kode: string; nama: string; created_at: string }[]>(),
    supabase
      .from("booking_requests")
      .select("id, created_at, clients(nama), services(nama)")
      .order("created_at", { ascending: false })
      .limit(batas)
      .returns<
        {
          id: string;
          created_at: string;
          clients: { nama: string } | null;
          services: { nama: string } | null;
        }[]
      >(),
  ]);

  const gabungan: Aktivitas[] = [
    ...(skrining.data ?? []).map((r) => ({
      jenis: "skrining" as const,
      teks: `Skrining masuk dari ${r.nama}`,
      pada: r.created_at,
      href: "/admin/skrining",
    })),
    ...(permintaan.data ?? []).map((r) => ({
      jenis: "permintaan" as const,
      teks: `${r.clients?.nama ?? "Klien"} meminta jadwal ${r.services?.nama ?? "layanan"}`,
      pada: r.created_at,
      href: "/admin/sesi",
    })),
  ];

  // Perbandingan string ISO 8601 UTC = perbandingan kronologis.
  gabungan.sort((a, b) => (a.pada < b.pada ? 1 : a.pada > b.pada ? -1 : 0));
  return gabungan.slice(0, batas);
}
