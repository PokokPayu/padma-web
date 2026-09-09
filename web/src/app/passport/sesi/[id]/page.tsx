import Link from "next/link";
import { notFound } from "next/navigation";
import { ambilKlien, ambilSesiSatu } from "@/lib/passport/data";
import { formatTanggalID, hariIniJakarta } from "@/lib/passport/waktu";
import { formatJam, jamDariDb } from "@/lib/jadwal/jam";
import { labelVarian } from "@/lib/varian";
import { createServerSupabase } from "@/lib/supabase/server";
import { masihBisaDinilai } from "@/lib/passport/penilaian";
import { KartuNilai } from "../../_komponen/kartu-nilai";
import { LABEL_SESI_KLIEN, PIL_SESI_KLIEN } from "../../_komponen/status-sesi";

export const metadata = { title: "Detail Sesi" };

// Sama seperti rute passport lain: dilarang mengekspor pengaturan revalidasi
// Next.js (ditulis tanpa mengeja bentuknya, karena tests/passport-shell.test.ts
// memindai sumber berkas ini apa adanya) — pengaturan itu menghapus `private`
// dari Cache-Control sehingga catatan perawatan satu klien boleh disimpan CDN
// dan disajikan ke klien lain.

/**
 * SATU kunjungan, selengkapnya.
 *
 * Catatan bidan dulu tinggal di laci yang mengembang pada kartu daftar, dan
 * karena itu SELURUH catatan perawatan ikut terkirim ke perangkat bersama
 * halaman riwayat — terbuka atau tidak. Halaman ini membalik urutannya: klien
 * memilih dulu sesi mana, baru catatannya diambil.
 */
export default async function DetailSesiPassport({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const klien = await ambilKlien();
  if (!klien) notFound(); // layout sudah menangani; ini penjaga tipe

  const { id } = await params; // Next 16: `params` adalah Promise
  const sesi = await ambilSesiSatu(klien.id, id);

  // Tidak ada ATAU bukan miliknya — dua-duanya berakhir sama. Membedakannya di
  // layar akan membocorkan keberadaan sesi yang bukan haknya.
  if (!sesi) notFound();

  // PENILAIAN TINGGAL DI SINI, BUKAN DI BERANDA.
  //
  // Formulirnya dulu berdiri di puncak beranda: dua baris bintang dan sebuah
  // kotak teks, menuntut perhatian setiap kali klien membuka aplikasi — untuk
  // pekerjaan yang tidak mendesak dan boleh dilewati. Beranda kini cukup
  // MENGABARKAN bahwa ada sesi yang menunggu dinilai; yang menilai adalah
  // halaman ini, tempat catatan bidan dan rincian kunjungannya sudah terbuka.
  // Orang yang baru saja membaca ulang kunjungannya adalah orang yang paling
  // siap menilainya.
  //
  // Dibaca dengan SESI PENGGUNA: policy "session_ratings: klien baca miliknya"
  // yang memutuskan, jadi id sesi milik orang lain memulangkan nol baris dan
  // formulirnya terbit — lalu ditolak server saat dikirim. Itu tidak masalah;
  // sesi milik orang lain sudah berhenti di `ambilSesiSatu` jauh di atas.
  const supabase = await createServerSupabase();
  const { data: nilaiAda } = await supabase
    .from("session_ratings")
    .select("session_id")
    .eq("session_id", sesi.id)
    .maybeSingle<{ session_id: string }>();

  const bolehDinilai =
    sesi.status === "selesai" &&
    !nilaiAda &&
    masihBisaDinilai(sesi.tanggal, hariIniJakarta());

  const varian = labelVarian(sesi.varian);
  const adaCatatan = sesi.catatan.trim() !== "";
  const adaRekomendasi = sesi.rekomendasi.trim() !== "";

  return (
    <>
      <Link
        href="/passport/sesi"
        className="mb-4 inline-block rounded-xl border border-black/10 bg-white px-4 py-2 text-[13px] font-bold text-ink"
      >
        ← Kembali ke riwayat
      </Link>

      <section className="mb-4 rounded-2xl border border-black/10 bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-serif text-xl text-night">{sesi.namaLayanan}</h1>
            {varian && <p className="mt-0.5 text-[12.5px] text-ink-soft">{varian}</p>}
          </div>
          <span
            className={`rounded-full border px-2.5 py-1 text-[11px] font-extrabold ${PIL_SESI_KLIEN[sesi.status]}`}
          >
            {LABEL_SESI_KLIEN[sesi.status]}
          </span>
        </div>

        <dl className="mt-4 grid gap-3 text-[13.5px] sm:grid-cols-2">
          <Medan judul="Tanggal & jam">
            {formatTanggalID(sesi.tanggal)} · {formatJam(jamDariDb(sesi.jamMulai))}
          </Medan>
          <Medan judul="Bidan">{sesi.namaMitra}</Medan>
          <Medan judul="Tempat">{sesi.alamat || "—"}</Medan>
        </dl>
      </section>

      {bolehDinilai && (
        <KartuNilai
          sesiId={sesi.id}
          namaLayanan={sesi.namaLayanan}
          namaMitra={sesi.namaMitra}
          tanggal={formatTanggalID(sesi.tanggal)}
        />
      )}

      <section className="rounded-2xl border border-black/10 bg-white p-6">
        <h2 className="mb-3 font-serif text-xl text-night">Catatan bidan</h2>
        {!adaCatatan && !adaRekomendasi ? (
          // Sesi yang belum dijalani memang belum punya catatan. Bagian kosong
          // tanpa kalimat apa pun terbaca seperti kegagalan memuat.
          <p className="text-[13px] italic text-ink-soft">
            {sesi.status === "selesai"
              ? "Bidan belum menuliskan catatan untuk kunjungan ini."
              : "Catatan bidan terbit setelah kunjungan ini selesai."}
          </p>
        ) : (
          <>
            {adaCatatan && (
              <p className="mb-4 text-[13.5px] leading-relaxed text-[#3C4C42]">
                <b className="mb-1 block text-[11px] uppercase tracking-wider text-gold">
                  {`Catatan ${sesi.namaMitra}`}
                </b>
                {sesi.catatan}
              </p>
            )}
            {adaRekomendasi && (
              <p className="text-[13.5px] leading-relaxed text-[#3C4C42]">
                <b className="mb-1 block text-[11px] uppercase tracking-wider text-gold">
                  Rekomendasi untuk Anda
                </b>
                {sesi.rekomendasi}
              </p>
            )}
          </>
        )}
      </section>
    </>
  );
}

function Medan({ judul, children }: { judul: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-bold uppercase tracking-wider text-ink-soft">{judul}</dt>
      <dd className="mt-0.5 text-ink">{children}</dd>
    </div>
  );
}
