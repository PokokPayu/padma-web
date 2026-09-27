"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PESANAN_TERBUKA, type StatusPesanan } from "@/lib/pesanan/status";

/**
 * Pemecah `PESANAN_BERUANG`, dan satu-satunya tempat di berkas ini yang
 * menyebut nama status.
 *
 * Kenapa bukan himpunan seperti di `bacaPesananStaf`: "Periksa ulang" memang
 * bisa dinyatakan dengan `PESANAN_TERBUKA` (lihat JSX di bawah), tapi kedua
 * anggota `PESANAN_BERUANG` menuntut tombol yang BERLAWANAN — `lunas`
 * menerbitkan barangnya, `ditahan` justru meminta manusia memutuskan lebih
 * dulu. Himpunan Tugas 1 sengaja tidak memecah keduanya, dan §0.6 melarang
 * melahirkan himpunan kelima yang bernama lain di sini.
 *
 * Yang memaksa kelengkapannya karena itu `Record` BERTIPE PENUH, mekanisme
 * yang sama dengan `LABEL_STATUS_PESANAN` di `status.ts`: nama status hidup
 * sebagai KUNCI yang diperiksa kompilator, bukan sebagai literal yang
 * dibandingkan. Nilai enum keenam memerahkan berkas ini sampai seseorang
 * memutuskan tombol apa yang pantas untuknya — alih-alih menghilangkan
 * tombolnya dari layar staf tanpa suara.
 */
const TOMBOL_BERUANG: Record<StatusPesanan, "akses" | "putusan" | null> = {
  menunggu_bayar: null,
  ditahan: "putusan",
  lunas: "akses",
  kedaluwarsa: null,
  dibatalkan: null,
};

/**
 * Alamat dan muatan tindakan "Putuskan", sebagai konstanta.
 *
 * Bukan kerapian: `panduanSesudah` di bawah memutuskan kalimatnya dengan
 * MEMBANDINGKAN keduanya, jadi literal yang diketik dua kali adalah dua
 * literal yang bisa berselisih — dan bentuk selisihnya adalah panduan yang
 * berhenti muncul tanpa satu pun galat, yaitu persis keadaan yang butir ini
 * ada untuk memperbaikinya.
 *
 * Nilai putusannya `satisfies StatusPesanan`, dan itu benar bukan kebetulan:
 * `putuskan_pesanan_ditahan` menerimanya sebagai TEXT lalu memakainya sebagai
 * status TUJUAN (`v_tujuan public.order_status`). Mengganti nama nilai enum
 * memerahkan `tsc` di sini, alih-alih membuat rute menjawab 400 untuk setiap
 * penekanan tombol.
 */
const JALUR_PUTUSKAN = "putuskan";
const PUTUSAN_LUNAS = "lunas" satisfies StatusPesanan;
const PUTUSAN_BATAL = "dibatalkan" satisfies StatusPesanan;

/**
 * Kalimat LANGKAH BERIKUTNYA untuk tindakan yang baru saja berhasil — atau
 * `null` bila tindakan itu memang selesai dengan sendirinya.
 *
 * ===== KENAPA "Putuskan lunas" MENUNTUT KALIMAT INI =====
 * `putuskan_pesanan_ditahan` memindahkan status, menulis jejak, dan
 * membiarkan `butuh_tinjauan_pada` menyala. Ia TIDAK memanggil
 * `salurkan_pesanan` maupun `terbitkan_akses_item` di badannya sama sekali —
 * nol entitlement lahir. `ditahan` karena itu satu-satunya alur di seluruh P1
 * di mana uang PASTI sudah masuk dan barangnya PASTI belum keluar, dan
 * separuh kedua keputusan staf harus ditekan manusia.
 *
 * Sebelum ini barisnya menawarkan "Terbitkan akses" DAN "Tutup tinjauan"
 * tanpa satu kalimat pun yang menyatakan yang mana. Kerusakannya terbatas —
 * klausa kedua "Butuh perhatian" (`PESANAN_BERUANG && !punyaAkses`) menahan
 * barisnya tetap terlihat bahkan sesudah "Tutup tinjauan", jadi ia tidak bisa
 * terkubur — tetapi kliennya menunggu sampai ada yang menebak tombol yang
 * benar.
 *
 * Perbaikan STRUKTURALNYA (menyambungkan penyalur ke transisi
 * `ditahan -> lunas`) ada di RPC milik P1-A dan di luar lingkup permukaan ini;
 * yang bisa dilakukan di sini adalah berhenti diam.
 *
 * ===== KENAPA FUNGSI MURNI, BUKAN KALIMAT DI DALAM `kirim()` =====
 * Selama ia tinggal di dalam handler, tidak satu pun uji di repo ini bisa
 * menjalankannya: `renderToStaticMarkup` tidak menjalankan handler dan repo
 * ini nol jsdom. Seseorang boleh menghapus kalimatnya besok dan semuanya tetap
 * hijau. Resep yang sama dengan `keadaanBeli` di `tombol-beli.tsx`, dan
 * `kirim()` benar-benar MEMANGGIL fungsi ini alih-alih menyalin isinya.
 */
export function panduanSesudah(jalur: string, badan?: unknown): string | null {
  const putusan = (badan as { putusan?: unknown } | undefined)?.putusan;
  if (jalur === JALUR_PUTUSKAN && putusan === PUTUSAN_LUNAS) {
    return 'Ditandai lunas. Sekarang tekan "Terbitkan akses" supaya kliennya menerima produknya.';
  }
  return null;
}

/**
 * Empat tindakan pemulihan Lapis 2, masing-masing dengan alamatnya sendiri.
 *
 * ===== KENAPA fetch KE RUTE, BUKAN SERVER ACTION =====
 * Dua di antaranya (periksa ulang, terbitkan akses) menulis lewat FUNGSI MESIN
 * yang tertutup bagi `authenticated` — `terapkan_notifikasi_midtrans` dan
 * `terbitkan_akses_item` ada di `MESIN_TERTUTUP`
 * (`tests/fungsi-mesin-tertutup.test.ts`), jadi keduanya menuntut service role.
 * Dan `tests/admin-shell.test.ts:643` melarang service role di seluruh
 * `src/app/admin/**`. Rute di `src/app/api/**` adalah satu-satunya tempat
 * keduanya boleh bertemu.
 *
 * ===== TOMBOL DIRENDER BERSYARAT =====
 * Bukan karena tampilan adalah pagar — setiap rute memeriksa syaratnya sendiri
 * — melainkan karena menawarkan tombol yang pasti ditolak adalah janji yang
 * tidak akan ditepati. `Tutup tinjauan` khususnya: pada baris `ditahan` ia
 * ditolak `P0001`, dan seandainya tidak ditolak ia akan mengubur pesanan yang
 * uangnya sudah di tangan Midtrans dan barangnya belum keluar.
 *
 * ===== NOL LITERAL STATUS =====
 * Tidak satu pun cabang di bawah membandingkan `status` dengan string yang
 * diketik di tempat. Pelajaran repo yang sudah dibayar sekali: nilai enum baru
 * membuat konstanta tunggal salah DIAM-DIAM — dan di layar ini bentuk salahnya
 * adalah tombol pemulihan yang berhenti muncul untuk status yang justru paling
 * butuh dipulihkan, tanpa satu pun galat.
 */
export function TombolPesanan({
  pesananId,
  status,
  butuhTinjauan,
}: {
  pesananId: string;
  status: StatusPesanan;
  butuhTinjauan: boolean;
}) {
  const router = useRouter();
  const [menyegarkan, mulai] = useTransition();
  const [sibuk, setSibuk] = useState(false);
  const [pesan, setPesan] = useState<string | null>(null);
  /**
   * Hasil tindakan yang BERHASIL — dan kenapa ia terpisah dari `pesan`:
   * `pesan` adalah kegagalan (dirender merah), yang ini adalah laporan.
   * Sebelum keduanya ada, satu-satunya umpan balik untuk tindakan yang
   * berhasil adalah halaman yang menyegarkan diri — dan "akses terbit",
   * "akses sudah ada", "akses SENGAJA ditahan" serta "jenis item ini belum
   * punya penangan" terlihat identik bagi operator yang melihatnya.
   */
  const [laporan, setLaporan] = useState<string | null>(null);

  async function kirim(jalur: string, badan?: unknown) {
    setPesan(null);
    setLaporan(null);
    setSibuk(true);
    try {
      const res = await fetch(`/api/pesanan/${pesananId}/${jalur}`, {
        method: "POST",
        headers: badan ? { "content-type": "application/json" } : undefined,
        body: badan ? JSON.stringify(badan) : undefined,
      });
      const isi = (await res.json().catch(() => ({}))) as { pesan?: string };
      if (!res.ok) {
        // Kalimat rute diteruskan apa adanya: rute yang menolak sudah menulis
        // alasannya untuk dibaca manusia, dan menggantinya dengan "Gagal."
        // membuang justru bagian yang berguna.
        setPesan(isi.pesan ?? "Tindakan gagal dijalankan.");
        return;
      }
      // Kalimat RUTE menang atas panduan lokal: hanya rute yang tahu hasil
      // yang sebenarnya terjadi di basis data. Panduan lokal mengisi kasus
      // sebaliknya — tindakan yang berhasil tapi BELUM selesai.
      setLaporan(isi.pesan ?? panduanSesudah(jalur, badan));
      mulai(() => router.refresh());
    } catch {
      setPesan("Jaringan tidak menjawab. Coba lagi.");
    } finally {
      setSibuk(false);
    }
  }

  const mati = sibuk || menyegarkan;
  const kelas =
    "min-h-[36px] rounded-lg border border-panel-border bg-panel-bg px-3 text-[12px] font-bold text-panel-ink disabled:opacity-60";

  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="flex flex-wrap gap-1.5">
        {PESANAN_TERBUKA.includes(status) && (
          <button type="button" disabled={mati} className={kelas} onClick={() => void kirim("periksa-ulang")}>
            Periksa ulang
          </button>
        )}
        {TOMBOL_BERUANG[status] === "akses" && (
          <button type="button" disabled={mati} className={kelas} onClick={() => void kirim("terbitkan-akses")}>
            Terbitkan akses
          </button>
        )}
        {TOMBOL_BERUANG[status] === "putusan" && (
          <>
            <button
              type="button"
              disabled={mati}
              className={kelas}
              onClick={() => void kirim(JALUR_PUTUSKAN, { putusan: PUTUSAN_LUNAS })}
            >
              Putuskan lunas
            </button>
            <button
              type="button"
              disabled={mati}
              className={kelas}
              onClick={() => void kirim(JALUR_PUTUSKAN, { putusan: PUTUSAN_BATAL })}
            >
              Putuskan batal
            </button>
          </>
        )}
        {butuhTinjauan && TOMBOL_BERUANG[status] !== "putusan" && (
          <button type="button" disabled={mati} className={kelas} onClick={() => void kirim("tutup-tinjauan")}>
            Tutup tinjauan
          </button>
        )}
      </div>
      {pesan && <p className="text-[11.5px] font-semibold text-clay">{pesan}</p>}
      {laporan && (
        <p className="rounded-lg border border-panel-border bg-panel-bg px-2 py-1 text-[11.5px] font-semibold text-panel-ink">
          {laporan}
        </p>
      )}
    </div>
  );
}
