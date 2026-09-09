import Link from "next/link";
import { notFound } from "next/navigation";
import { ambilKlien, ambilPermintaanJadwal } from "@/lib/passport/data";
import { formatTanggalID } from "@/lib/passport/waktu";
import { formatJam, jamDariDb } from "@/lib/jadwal/jam";
import { bacaPengaturan } from "@/lib/settings";

export const metadata = { title: "Permintaan Terkirim" };

// Rute passport dilarang mengekspor pengaturan revalidasi Next.js (ditulis
// tanpa mengeja bentuknya, karena tests/passport-shell.test.ts memindai sumber
// berkas ini apa adanya): pengaturan itu menghapus `private` dari Cache-Control
// sehingga respons satu klien boleh disimpan CDN dan disajikan ke klien lain.
export const dynamic = "force-dynamic";

/**
 * HALAMAN TERKIRIM BERDIRI SENDIRI, BUKAN PANEL DI DALAM FORMULIR.
 *
 * Panel sukses pernah tinggal di dalam `FormAjukan`, dan di sana ia tidak bisa
 * bertahan: `ajukanJadwal` memanggil `revalidatePath`, Next merender ulang
 * pohon rute yang sedang dibuka, dan `/passport/ajukan` — yang skriningnya baru
 * saja HANGUS terpakai (spec J3) — sah berubah menjadi "Isi skrining
 * keselamatan dulu". Komponen klien yang memuat panel itu ikut tercabut, dan
 * yang dibaca klien adalah perintah mengulang skrining tepat setelah ia
 * berhasil memesan.
 *
 * Jalan keluar sebelumnya adalah melompat ke beranda dengan spanduk hijau —
 * benar, tetapi klien kehilangan halaman yang menyebutkan APA yang ia pesan.
 * Rute ini mengembalikannya: ia tidak berdiri di atas skrining, jadi tidak ada
 * yang bisa menggantikannya.
 */
export default async function HalamanPengajuanTerkirim() {
  const klien = await ambilKlien();
  if (!klien) notFound(); // layout sudah menangani; ini penjaga tipe

  const [permintaan, { nomorWaLink }] = await Promise.all([
    ambilPermintaanJadwal(klien.id),
    bacaPengaturan(),
  ]);

  // Permintaan TERBARU — yang baru saja dikirim. `ambilPermintaanJadwal`
  // memulangkan antrean yang masih hidup, jadi daftarnya bisa berisi lebih dari
  // satu; yang dirayakan halaman ini hanya yang paling belakang tanggalnya.
  // Kosong pun tidak apa-apa: klien bisa saja membuka URL ini langsung, dan
  // halaman tetap berkata sesuatu yang benar tanpa mengarang detail.
  const baru = permintaan[permintaan.length - 1] ?? null;

  const teksWa = baru
    ? [
        `Halo PADMA, saya ${klien.nama} baru mengajukan jadwal:`,
        ``,
        `Layanan: ${baru.namaLayanan}`,
        `Tanggal: ${formatTanggalID(baru.tanggal)}`,
        `Jam: ${formatJam(jamDariDb(baru.jamMulai))}`,
        ``,
        `Mohon dikonfirmasi ya, terima kasih.`,
      ].join("\n")
    : `Halo PADMA, saya ${klien.nama} baru mengajukan jadwal. Mohon dikonfirmasi ya.`;

  return (
    <section className="rounded-2xl border border-black/10 bg-white p-6 text-center">
      <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full border border-leaf/25 bg-leaf-soft text-2xl text-leaf">
        ✓
      </span>
      <h1 className="font-serif text-xl text-night">Permintaan terkirim</h1>
      <p className="mx-auto mt-2 max-w-sm text-[13.5px] leading-relaxed text-[#415247]">
        Tim PADMA akan menghubungi Anda via WhatsApp untuk mengonfirmasi jadwal dan bidan
        yang datang.
      </p>

      {baru && (
        <div className="mx-auto mt-5 max-w-sm rounded-2xl border border-black/10 bg-paper p-4 text-left">
          <b className="block font-serif text-[15.5px] font-normal leading-snug text-night">
            {baru.namaLayanan}
          </b>
          <span className="mt-1 block text-[12.5px] text-ink-soft">
            {formatTanggalID(baru.tanggal)} · {formatJam(jamDariDb(baru.jamMulai))}
          </span>
        </div>
      )}

      {/* Jendela WhatsApp sudah dibuka otomatis saat mengirim. Tombol ini
          jaringnya: pemblokir pop-up menolak jendela yang lahir sesudah await,
          diam-diam. Ketukan pada tautan adalah gerakan pemakai, dan gerakan
          pemakai tidak pernah diblokir. */}
      <a
        href={`https://wa.me/${nomorWaLink}?text=${encodeURIComponent(teksWa)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-5 inline-block min-h-[44px] rounded-xl bg-[#1FAF57] px-5 py-3 text-sm font-bold text-white"
      >
        Kabari PADMA via WhatsApp
      </a>

      <Link
        href="/passport"
        className="mt-3 block text-[13px] font-bold text-ink-soft underline underline-offset-2"
      >
        Kembali ke Beranda
      </Link>
    </section>
  );
}
