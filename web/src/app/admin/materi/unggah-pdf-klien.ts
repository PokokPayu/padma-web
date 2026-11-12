"use client";

import { createBrowserSupabase } from "@/lib/supabase/client";
import { rasterisasiPdf } from "@/lib/materi/pdf-klien";
import { periksaBerkasPdf, MAKS_HALAMAN, KONKURENSI_UNGGAH } from "@/lib/materi/rasterisasi";
import { terbitkanUrlUnggahHalaman, catatHalamanMateri } from "./unggah";

const BUCKET = "materi-halaman";

export type FaseUnggah = "membaca" | "mengunggah";
export type LaporProgres = (fase: FaseUnggah, selesai: number, total: number) => void;
export type HasilUnggahPdf = { ok: true; jumlah: number } | { ok: false; pesan: string };

/**
 * Rasterisasi PDF di peramban lalu unggah seluruh halamannya — SATU jalur,
 * dipakai dua layar.
 *
 * Diekstrak dari `PengunggahPdf` saat formulir "Materi baru" ikut menerima PDF
 * (butir 6 umpan balik klien 21 Sep 2026: "Cara masukkan ebook apa bisa
 * dipersimpel, 1 klik aja gitu mas dari board admin, langsung upload?").
 * Menyalin logikanya ke formulir baru akan melahirkan dua jalur unggah yang
 * bisa menyimpang diam-diam — dan yang menyimpang di sini bukan kosmetik,
 * melainkan urutan yang menentukan apakah materi bisa berakhir SETENGAH terisi.
 *
 * Urutannya sengaja: seluruh halaman diunggah dulu, barisnya dicatat BELAKANGAN
 * dan sekali jalan. Gagal di tengah berarti nol baris tercatat — materi tampak
 * "belum ada isi", bukan "terisi sebagian" yang tidak bisa dibedakan dari
 * materi utuh oleh layar mana pun.
 */
export async function unggahPdfKeMateri(
  materiId: string,
  berkas: File,
  lapor: LaporProgres = () => {},
): Promise<HasilUnggahPdf> {
  const periksa = periksaBerkasPdf(berkas.name, berkas.size);
  if (!periksa.ok) return { ok: false, pesan: periksa.pesan };

  try {
    lapor("membaca", 0, 0);
    const halaman = await rasterisasiPdf(berkas, (selesai, total) =>
      lapor("membaca", selesai, total),
    );
    if (halaman.length > MAKS_HALAMAN) {
      return { ok: false, pesan: `PDF maksimal ${MAKS_HALAMAN} halaman; berkas ini ${halaman.length}.` };
    }

    const izin = await terbitkanUrlUnggahHalaman(materiId, halaman.length);
    if (!izin.ok) return { ok: false, pesan: izin.pesan };
    // Disalin ke variabel sendiri: TypeScript tidak menyempitkan tipe `izin`
    // (union ok/gagal) ke dalam `function pekerja()` di bawah karena deklarasi
    // fungsi di-hoist.
    const daftarUnggahan = izin.unggahan;

    lapor("mengunggah", 0, halaman.length);
    const supabase = createBrowserSupabase();

    // Konkurensi dibatasi: koneksi rumahan yang lambat akan saling
    // menggagalkan unggahan bila 300 halaman dikirim sekaligus.
    let berikutnya = 0;
    let terunggah = 0;
    async function pekerja() {
      while (berikutnya < halaman.length) {
        const i = berikutnya++;
        const h = halaman[i];
        const u = daftarUnggahan[i];
        // `u.objek` berakhiran `.webp` (namaObjekHalaman) TAPI itu KONVENSI
        // PENAMAAN, bukan jaminan isi byte: bila peramban admin tidak mendukung
        // ekspor WebP, canvas.toBlob() di pdf-klien.ts diam-diam menghasilkan
        // PNG (bukan gagal), dan `h.blob.type` mengikuti isi SUNGGUHAN itu.
        // `uploadToSignedUrl()` tidak diberi `contentType` — storage-js membaca
        // Content-Type multipart-nya dari `Blob.type` itu sendiri.
        //
        // Ini BUKAN aman: bucket `materi-halaman` dibatasi
        // `allowed_mime_types = ['image/webp','image/jpeg']` (migration
        // `materi_halaman_pdf`), dan storage server memvalidasi MIME type itu
        // SEBELUM byte-nya tersimpan — DIBUKTIKAN lewat PUT manual berisi PNG
        // ke path `.webp`: 400 `invalid_mime_type`. Unggahan PNG DITOLAK, bukan
        // lewat lalu direkode belakangan.
        const { error } = await supabase.storage
          .from(BUCKET)
          .uploadToSignedUrl(u.objek, u.token, h.blob);
        if (error) throw new Error(`Halaman ${h.halaman} gagal diunggah.`);
        terunggah++;
        lapor("mengunggah", terunggah, halaman.length);
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(KONKURENSI_UNGGAH, halaman.length) }, pekerja),
    );

    const catat = await catatHalamanMateri(
      materiId,
      halaman.map((h, i) => ({
        halaman: h.halaman,
        objek: daftarUnggahan[i].objek,
        lebar: h.lebar,
        tinggi: h.tinggi,
      })),
    );
    if (!catat.ok) return { ok: false, pesan: catat.pesan };

    return { ok: true, jumlah: catat.jumlah };
  } catch (e) {
    return { ok: false, pesan: e instanceof Error ? e.message : "Gagal memproses PDF." };
  }
}
