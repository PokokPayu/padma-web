import { describe, it, expect } from "vitest";
import { komentarKritikDulu } from "@/lib/admin/penilaian";
import type { BarisPenilaian } from "@/lib/admin/penilaian";

// ===========================================================================
// KOMENTAR UNTUK BOARD OWNER (butir 5, umpan balik klien 21 Sep 2026)
// ===========================================================================
// "Testimoni masukkan ke board owner dong mas, klo ada komen masukan/ kritik
// langsung tahu."
//
// Kalimat terakhirnya yang menentukan bentuk fungsi ini: yang diminta bukan
// "testimoni terbaru", melainkan kritik yang LANGSUNG terlihat. Urutan
// kronologis mengubur satu keluhan di bawah sepuluh pujian yang datang
// sesudahnya, dan pemilik klinik baru menemukannya kalau ia menggulir —
// yaitu, kalau ia sudah tahu ada yang perlu dicari.

const nilai = (o: Partial<BarisPenilaian>): BarisPenilaian => ({
  id: "r1",
  sessionId: "s1",
  tanggal: "2026-09-20",
  namaKlien: "Klien",
  namaMitra: "Bidan",
  namaLayanan: "Layanan",
  bintangLayanan: 5,
  bintangBidan: 5,
  komentar: "Terima kasih banyak.",
  ...o,
});

describe("komentarKritikDulu", () => {
  it("menaruh bintang TERENDAH di atas, bukan yang terbaru", () => {
    const hasil = komentarKritikDulu([
      nilai({ id: "baru-puas", tanggal: "2026-09-21", bintangLayanan: 5, bintangBidan: 5 }),
      nilai({ id: "lama-kecewa", tanggal: "2026-09-01", bintangLayanan: 2, bintangBidan: 4 }),
    ]);
    expect(hasil.map((h) => h.id)).toEqual(["lama-kecewa", "baru-puas"]);
  });

  it("memakai bintang TERENDAH dari dua angkanya, bukan rata-ratanya", () => {
    // Sesi yang layanannya bagus tetapi bidannya bermasalah punya rata-rata
    // yang tampak wajar — 5 dan 1 menjadi 3 — dan justru itu yang paling perlu
    // dibaca manusia. Aturan yang sama sudah dipakai saringan `rendah` di
    // `ambilPenilaianTerbaru`.
    const hasil = komentarKritikDulu([
      nilai({ id: "rata-rata-3", bintangLayanan: 3, bintangBidan: 3 }),
      nilai({ id: "bidan-1", bintangLayanan: 5, bintangBidan: 1 }),
    ]);
    expect(hasil[0].id).toBe("bidan-1");
  });

  it("membuang penilaian tanpa komentar — bintang saja bukan testimoni", () => {
    // Tren bintang sudah punya kartunya sendiri di board yang sama. Kartu ini
    // menjawab pertanyaan lain: APA yang dikatakan orang.
    const hasil = komentarKritikDulu([
      nilai({ id: "kosong", komentar: "" }),
      nilai({ id: "spasi", komentar: "   " }),
      nilai({ id: "berisi", komentar: "Bidannya telat 40 menit." }),
    ]);
    expect(hasil.map((h) => h.id)).toEqual(["berisi"]);
  });

  it("pada bintang yang sama, yang TERBARU di atas", () => {
    const hasil = komentarKritikDulu([
      nilai({ id: "lama", tanggal: "2026-09-01", bintangLayanan: 4, bintangBidan: 4 }),
      nilai({ id: "baru", tanggal: "2026-09-20", bintangLayanan: 4, bintangBidan: 4 }),
    ]);
    expect(hasil.map((h) => h.id)).toEqual(["baru", "lama"]);
  });

  it("dibatasi — board adalah ringkasan, bukan arsip", () => {
    const banyak = Array.from({ length: 20 }, (_, i) =>
      nilai({ id: `n${i}`, komentar: `komentar ${i}` }),
    );
    expect(komentarKritikDulu(banyak, 5)).toHaveLength(5);
  });

  it("tidak memutasi masukannya", () => {
    const masukan = [
      nilai({ id: "a", bintangBidan: 5 }),
      nilai({ id: "b", bintangBidan: 1 }),
    ];
    const salinan = JSON.parse(JSON.stringify(masukan));
    komentarKritikDulu(masukan);
    expect(masukan).toEqual(salinan);
  });

  it("daftar kosong menghasilkan daftar kosong, bukan lempar", () => {
    expect(komentarKritikDulu([])).toEqual([]);
  });
});
