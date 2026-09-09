import Link from "next/link";
import { notFound } from "next/navigation";
import { Lotus } from "@/app/_landing/lotus";
import {
  ambilKlien,
  ambilPaket,
  ambilPermintaanJadwal,
  ambilSesi,
} from "@/lib/passport/data";
import {
  badgeDari,
  gridStempel,
  progresPaket,
  sesiBerikutnya,
} from "@/lib/passport/turunan";
import { formatTanggalID, hariIniJakarta } from "@/lib/passport/waktu";
import { GridStempel } from "./_komponen/grid-stempel";
import { createServerSupabase } from "@/lib/supabase/server";
import { BarisAgenda } from "./_komponen/baris-agenda";
import { TajukBagian } from "./_komponen/tajuk-bagian";
import { SampulPassport } from "./_komponen/sampul";
import { formatJam, jamDariDb } from "@/lib/jadwal/jam";
import { LABEL_PERMINTAAN } from "@/lib/jadwal/status";
import { TombolBatal } from "./_komponen/tombol-batal";
import { masihBisaDinilai } from "@/lib/passport/penilaian";

// Judul mengandalkan template `%s · PADMA` di root layout — jangan mengulang
// nama aplikasi di sini.
export const metadata = { title: "Digital Care Passport" };

// Rute passport dilarang mengekspor pengaturan revalidasi Next.js (ditulis
// tanpa mengeja bentuknya, karena tests/passport-shell.test.ts memindai sumber
// berkas ini apa adanya): pengaturan itu menghapus `private` dari Cache-Control
// sehingga respons satu klien boleh disimpan CDN dan disajikan ke klien lain.

export default async function BerandaPassport({
  searchParams,
}: {
  searchParams: Promise<{ skrining?: string; pengajuan?: string }>;
}) {
  const klien = await ambilKlien();
  if (!klien) notFound(); // layout sudah menangani; ini penjaga tipe

  // SAPAAN BERNAMA SESUDAH SKRINING TERSAMBUNG (spec C1 J4).
  //
  // Yang datang lewat URL hanyalah ID; NAMANYA dibaca dari basis data lewat
  // sesi pengguna, sehingga policy "screenings: klien baca miliknya" yang
  // memutuskan boleh-tidaknya. Id karangan memulangkan nol baris dan tidak ada
  // sapaan yang terbit — bukan galat, karena ini kabar baik yang gagal tampil,
  // bukan pintu yang tertutup.
  //
  // Kenapa namanya disebut TERBUKA: umur token 2 jam menjaga perangkat bersama
  // dari sisi waktu, tetapi tidak ada yang menjaganya dari sisi manusia. Satu
  // HP di ruang tunggu bisa saja dipakai dua orang dalam sepuluh menit.
  // Menyebut nama membuat salah sambung TERLIHAT oleh satu-satunya pihak yang
  // pasti mengenalinya: pemilik akun.
  const sp = await searchParams;
  const idSkrining = typeof sp.skrining === "string" ? sp.skrining : "";
  let namaSkrining: string | null = null;
  if (idSkrining) {
    const supabase = await createServerSupabase();
    const { data } = await supabase
      .from("screenings")
      .select("nama")
      .eq("id", idSkrining)
      .maybeSingle<{ nama: string }>();
    namaSkrining = data?.nama ?? null;
  }

  const [sesi, paket, permintaan] = await Promise.all([
    ambilSesi(klien.id),
    ambilPaket(klien.id),
    ambilPermintaanJadwal(klien.id),
  ]);

  // SESI YANG BELUM DINILAI (spec C1 J10) — paling banyak SATU kartu.
  //
  // Menampilkan semuanya sekaligus akan mengubah beranda menjadi daftar
  // pekerjaan; yang paling baru juga yang paling diingat, dan sisanya bisa
  // menunggu kunjungan berikutnya. Kartu ini bisa diabaikan dan hilang sendiri
  // setelah 30 hari — lihat `masihBisaDinilai()`.
  const sudahDinilai = new Set<string>();
  {
    const supabase = await createServerSupabase();
    const { data } = await supabase.from("session_ratings").select("session_id");
    for (const b of data ?? []) sudahDinilai.add(b.session_id as string);
  }
  const belumDinilai = sesi.find(
    (s) =>
      s.status === "selesai" &&
      !sudahDinilai.has(s.id) &&
      masihBisaDinilai(s.tanggal, hariIniJakarta()),
  );

  // "Hari ini" menurut Jakarta, bukan menurut jam server (Vercel berjalan UTC).
  const sekarang = hariIniJakarta();
  const paketAktif = paket[0] ?? null;
  const progres = progresPaket({ totalSesi: paketAktif?.jumlahSesi ?? null, sesi });
  const slot = paketAktif
    ? gridStempel({ totalSesi: paketAktif.jumlahSesi, sesi, sekarang })
    : [];
  const berikut = sesiBerikutnya(sesi, sekarang);
  const badge = badgeDari(sesi);

  // "Sejak" dari sesi terawal, bukan `clients.created_at` — tanggal itu berubah
  // setiap `db reset` sehingga sampul akan berbohong soal lama perjalanan.
  // Urutan tanggal = urutan string (kolom `tanggal` sudah YYYY-MM-DD).
  const terawal = [...sesi].sort((a, b) =>
    a.tanggal < b.tanggal ? -1 : a.tanggal > b.tanggal ? 1 : 0,
  )[0];
  const sejak = terawal
    ? formatTanggalID(terawal.tanggal).split(" ").slice(1).join(" ")
    : "—";

  return (
    <>
      {namaSkrining && (
        <div
          className="mb-3.5 rounded-2xl border-[1.6px] border-leaf/30 bg-leaf-soft p-4 text-[13px]"
          data-skrining-tersambung
        >
          <b className="block text-sm text-night">
            Skrining atas nama {namaSkrining} telah disambungkan
          </b>
          <span className="text-[#415247]">
            Anda sudah bisa mengajukan jadwal. Bila nama di atas bukan Anda, hubungi tim PADMA —
            jangan lanjutkan pemesanan.
          </span>
        </div>
      )}
      {sp.pengajuan === "terkirim" && (
        <div
          className="mb-3.5 rounded-2xl border-[1.6px] border-leaf/30 bg-leaf-soft p-4 text-[13px]"
          data-pengajuan-terkirim
        >
          <b className="block text-sm text-night">Permintaan jadwal terkirim</b>
          <span className="text-[#415247]">
            Tim PADMA akan menghubungi Anda via WhatsApp untuk mengonfirmasi jadwal dan bidan yang
            datang. Permintaannya tercantum di bawah.
          </span>
        </div>
      )}
      {/* NOMOR WHATSAPP KOSONG — permintaan, bukan gerbang.
          Klien yang mendaftar sendiri lahir tanpa nomor, dan seluruh alur PADMA
          berdiri di atas WhatsApp: konfirmasi jadwal, tagihan, kabar bidan yang
          datang. Tanpa nomor, pengajuannya masuk antrean dan tim tidak punya
          cara membalasnya.
          Ia diletakkan PALING ATAS, di atas sampul, karena inilah satu-satunya
          hal di halaman ini yang menghalangi hal lain bekerja — dan ia hilang
          sendiri begitu nomornya terisi. Tetap sekadar permintaan: memblokir
          beranda akan mengurung klien yang membuka aplikasi hanya untuk membaca
          materi. */}
      {klien.noHp.trim() === "" && (
        <div
          className="mb-3.5 flex flex-wrap items-center gap-3 rounded-2xl border-[1.6px] border-gold/60 bg-[#FDFAF1] p-4"
          data-lengkapi-wa
        >
          <span className="min-w-0 flex-1">
            <b className="block text-sm text-night">Nomor WhatsApp Anda belum terisi</b>
            <span className="text-[13px] text-ink-soft">
              Tim PADMA mengonfirmasi jadwal, tagihan, dan bidan yang datang lewat WhatsApp.
              Tanpa nomor, kami tidak punya cara membalas pengajuan Anda.
            </span>
          </span>
          <Link
            href="/passport/profil"
            className="flex min-h-[44px] flex-none items-center rounded-xl bg-gold px-5 text-[13.5px] font-bold text-[#FFF8EA]"
          >
            Isi nomor sekarang
          </Link>
        </div>
      )}
      {/* KABAR, BUKAN FORMULIR. Dua baris bintang dan kotak teks dulu berdiri
          di sini, menuntut perhatian setiap kali klien membuka aplikasi untuk
          pekerjaan yang boleh dilewati. Formulirnya kini tinggal di halaman
          detail sesi — bersama catatan bidan dan rincian kunjungannya, tempat
          orang paling siap menilai. Yang tersisa di beranda hanyalah tautan
          menuju ke sana. */}
      {belumDinilai && (
        <Link
          href={`/passport/sesi/${belumDinilai.id}`}
          className="mb-3.5 flex items-center gap-3 rounded-2xl border-[1.6px] border-dotted border-gold bg-[#FDFAF1] p-4"
          data-sesi-belum-dinilai={belumDinilai.id}
        >
          <span aria-hidden className="flex-none text-[17px] leading-none text-gold">★</span>
          <span className="min-w-0 flex-1">
            <b className="block text-sm text-night">
              {belumDinilai.namaLayanan} menunggu penilaian Anda
            </b>
            <span className="text-[13px] text-ink-soft">
              {formatTanggalID(belumDinilai.tanggal)} · bersama {belumDinilai.namaMitra} —
              boleh dilewati
            </span>
          </span>
          <span aria-hidden className="flex-none text-[13px] font-bold text-night">
            Beri nilai
          </span>
        </Link>
      )}
      <SampulPassport
        nama={klien.nama}
        padmaId={klien.padmaId}
        faseId={klien.faseId}
        faseSanskrit={klien.faseSanskrit}
        faseNama={klien.faseNama}
        sejak={sejak}
        ringkasProgres={
          paketAktif && progres
            ? `${paketAktif.nama} · Sesi ${progres.selesai}/${progres.total}`
            : null
        }
      />

      {paketAktif && progres ? (
        <section className="mb-4 rounded-2xl border border-black/10 bg-white p-6">
          <h2 className="mb-4 font-serif text-xl text-night">
            Paket Aktif{" "}
            <span className="font-sans text-xs font-semibold text-ink-soft">
              {paketAktif.nama} · {paketAktif.jumlahSesi} sesi
            </span>
          </h2>
          <GridStempel slot={slot} />
          <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-ink-soft">
            <span>
              {progres.selesai} dari {progres.total} sesi selesai
              {berikut && ` · berikutnya ${formatTanggalID(berikut.tanggal)}`}
            </span>
            <b className="font-serif text-[15px] text-night">{progres.persen}%</b>
          </div>
        </section>
      ) : null}
      {/* Tidak ada kartu pengganti saat klien tak berpaket. Sebelumnya berdiri
          kartu "Perjalanan Anda" yang isinya hanya mengabarkan ketiadaan paket
          dan menunjuk ke halaman Sesi — sebuah kotak seukuran kartu terpenting
          di layar ini, untuk kalimat yang tidak menuntut apa pun dari
          pembacanya. Model per-sesi bukan keadaan cacat yang perlu dijelaskan;
          agenda di bawah sudah menjadi isi beranda. */}

      {/* SATU BAGIAN untuk semua yang akan datang — sesi yang sudah pasti dan
          permintaan yang masih menunggu. Sebelumnya keduanya berupa kartu lepas
          yang saling berdempet tanpa tajuk, sehingga beranda terbaca sebagai
          tumpukan pengumuman yang urutannya kebetulan. Di bawah satu tajuk,
          urutannya menjadi pernyataan: yang pasti lebih dulu, yang menunggu
          menyusul. */}
      <section className="mb-5">
        <TajukBagian
          judul="Agenda"
          keterangan={
            permintaan.length > 0
              ? `${permintaan.length} menunggu konfirmasi`
              : undefined
          }
        />

        {berikut ? (
          <BarisAgenda
            nada="pasti"
            tanggal={berikut.tanggal}
            judul={`Sesi berikutnya: ${berikut.namaLayanan}`}
            detail={`${formatJam(jamDariDb(berikut.jamMulai))} · ${berikut.namaMitra} · datang ke rumah Anda`}
          />
        ) : (
          permintaan.length === 0 && (
            <div className="mb-2.5 rounded-2xl border border-dashed border-gold/60 bg-[#FDFAF1] p-4">
              <b className="block text-sm text-night">Belum ada jadwal berikutnya</b>
              <span className="text-[13px] text-ink-soft">
                Ajukan jadwal — tim PADMA mengonfirmasi via WhatsApp.
              </span>
            </div>
          )
        )}

        {permintaan.map((p) => (
          <BarisAgenda
            key={p.id}
            nada="menunggu"
            tanggal={p.tanggal}
            judul={`Permintaan jadwal: ${p.namaLayanan}`}
            detail={`${formatJam(jamDariDb(p.jamMulai))} · diajukan, belum terjadwal`}
            pill={LABEL_PERMINTAAN[p.status]}
            // Hanya pengajuan yang masih di antrean yang bisa dibatalkan
            // sendiri. Yang sudah dikonfirmasi adalah SESI, dan pembatalan sesi
            // menyangkut uang serta tenggat waktu — seluruhnya milik C3.
            aksi={<TombolBatal permintaanId={p.id} />}
          />
        ))}
      </section>

      {/* Dua tombol, dua bobot. Sebelumnya keduanya sama besar dan sama tinggi
          di grid dua kolom, sehingga "Ajukan Jadwal" — satu-satunya tindakan
          yang memulai sesuatu — tampak setara dengan tautan ke halaman materi.
          Yang emas kini memimpin barisnya, yang lain menjadi tautan bertepi. */}
      <div className="mb-6 flex flex-col gap-2.5 sm:flex-row">
        <Link
          href="/passport/ajukan"
          className="flex min-h-[52px] flex-1 items-center justify-center rounded-2xl bg-gold text-[15px] font-bold text-[#FFF8EA] shadow-[0_10px_24px_-16px_rgba(181,138,60,0.9)]"
        >
          + Ajukan Jadwal
        </Link>
        <Link
          href="/passport/materi"
          className="flex min-h-[52px] items-center justify-center rounded-2xl border border-black/10 bg-white px-6 text-[14px] font-bold text-night"
        >
          Materi Saya
        </Link>
      </div>

      <section>
        <TajukBagian
          judul="Pencapaian"
          keterangan={badge.length > 0 ? `${badge.length} badge` : undefined}
        />
        {badge.length === 0 ? (
          // Keadaan kosong yang MEMPERLIHATKAN bentuk hadiahnya, bukan hanya
          // menyebutnya. Tiga cincin putus-putus seukuran badge sungguhan
          // memberi tahu apa yang akan muncul di sini dan berapa besar — satu
          // kalimat miring di dalam kartu putih kosong tidak melakukan
          // keduanya, dan itulah yang membuat bagian ini terbaca sebagai ruang
          // yang terlupakan.
          <div className="flex items-center gap-4 rounded-2xl border border-black/10 bg-white p-5">
            <span aria-hidden className="flex flex-none gap-2">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-dashed border-gold/45"
                >
                  <Lotus className="w-4 text-gold/25" />
                </span>
              ))}
            </span>
            <p className="text-[13px] leading-relaxed text-ink-soft">
              Badge pertama terbit saat sesi pertama Anda selesai.
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-3.5 rounded-2xl border border-black/10 bg-white p-5">
            {badge.map((b) => (
              <Link
                key={b.serviceId}
                href={`/passport/sertifikat/${b.serviceId}`}
                data-badge={b.serviceId}
                className="w-[104px] text-center text-[11px] font-bold leading-tight text-[#6B5A2E]"
              >
                <span className="relative mx-auto mb-2 flex h-[72px] w-[72px] items-center justify-center rounded-full border-2 border-gold bg-[radial-gradient(circle_at_35%_30%,#FDF6E4,#F3E6C4)] text-gold shadow-[inset_0_0_0_3px_#fff,inset_0_0_0_4px_rgba(217,179,106,.28)]">
                  <Lotus className="w-[34px]" />
                  {/* Angka muncul mulai kunjungan KEDUA. "×1" pada setiap badge
                      menambah keramaian tanpa memberi kabar baru. */}
                  {b.jumlah > 1 && (
                    <span
                      data-badge-jumlah={b.jumlah}
                      className="absolute -right-1 -top-1 flex h-[22px] min-w-[22px] items-center justify-center rounded-full border-2 border-paper bg-night px-1 text-[10.5px] font-bold text-gold-pale"
                    >
                      ×{b.jumlah}
                    </span>
                  )}
                </span>
                {b.nama}
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
