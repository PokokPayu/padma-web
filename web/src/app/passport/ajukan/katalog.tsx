"use client";

// ============================================================================
// KATALOG PESAN LAYANAN — pengganti dua <select> di formulir pengajuan
// ============================================================================
// Harga klien sudah tampil publik di landing sejak spec V4 §4.4. Sebelum
// berkas ini ada, klien yang SUDAH masuk justru melihat lebih sedikit daripada
// pengunjung yang belum mendaftar: dua kotak <select> berisi nama varian
// telanjang, tanpa satu angka pun. Katalog ini menutup selisih itu.
//
// BAHASA VISUALNYA SENGAJA SATU KELUARGA DENGAN `_landing/lini-layanan.tsx`:
// nama Sanskerta sebagai tajuk fase, garis rambut emas, serif Marcellus untuk
// nama, kartu putih di atas kertas krem. Yang BERBEDA cuma satu, dan
// perbedaannya disengaja: di landing harga adalah keterangan (10,5 px, abu),
// di sini harga adalah ISI — inilah layar tempat orang memutuskan berapa yang
// akan ia bayar. Karena itu angkanya naik ke serif dan berdiri di kolom kanan
// yang sejajar dari atas ke bawah, sehingga varian bisa dibandingkan dengan
// menyapu mata satu kolom, bukan dengan membaca ulang tiap kartu. Bentuknya
// meniru daftar harga rumah rawat — baris, bukan petak kartu seragam.

export type VarianKatalogAjukan = {
  id: string;
  serviceId: string;
  /** Dari `labelVarian()`. String kosong = varian baku, tampil "Standar". */
  label: string;
  /** Sudah diformat rupiah di server. `null` = tarifnya belum ditetapkan. */
  hargaKlien: string | null;
  hargaCoret: string | null;
};

export type LayananKatalogAjukan = {
  id: string;
  nama: string;
  /** Mis. "Garbha · Masa Kehamilan". String kosong bila fasenya tak terbaca. */
  namaFase: string;
  varian: VarianKatalogAjukan[];
};

/**
 * Kelompok tampilan: satu fase, beserta layanan yang berdiri di bawahnya.
 *
 * Dirakit di sini dan bukan di server karena bentuknya murni urusan TAMPILAN —
 * server sudah menyerahkan katalog TERURUT menurut `phases.urutan`, jadi yang
 * tersisa hanyalah memampatkan deret yang `namaFase`-nya sama berturut-turut.
 */
function kelompokkanPerFase(layanan: LayananKatalogAjukan[]) {
  const kelompok: Array<{ namaFase: string; layanan: LayananKatalogAjukan[] }> = [];
  for (const l of layanan) {
    const terakhir = kelompok[kelompok.length - 1];
    if (terakhir && terakhir.namaFase === l.namaFase) terakhir.layanan.push(l);
    else kelompok.push({ namaFase: l.namaFase, layanan: [l] });
  }
  return kelompok;
}

export function Katalog({
  layanan,
  varianId,
  onPilih,
}: {
  layanan: LayananKatalogAjukan[];
  varianId: string;
  /**
   * SATU callback yang menyetel KEDUANYA. Bukan dua penyetel terpisah, dan itu
   * bukan selera: memilih varian dari layanan lain tanpa ikut menggeser
   * `layananId` menghasilkan kombinasi yang ditolak FK gabungan
   * (service_id, variant_id) di basis data — penolakan yang sampai ke klien
   * sebagai kalimat galat untuk kombinasi yang tidak pernah ia maksud.
   */
  onPilih: (serviceId: string, varianId: string) => void;
}) {
  // Layanan tanpa satu pun varian AKTIF tidak dirender sama sekali. Alasannya
  // sama dengan penyaringan fase kosong di `_landing/lini-layanan.tsx`: kartu
  // tanpa isi terbaca sebagai layanan yang "tidak punya apa-apa", padahal yang
  // benar adalah layanan itu memang tidak bisa dipesan hari ini. Dan di layar
  // INI ia lebih berbahaya lagi — ia kartu yang tidak bisa diklik, di tengah
  // kartu-kartu yang bisa.
  const tampil = layanan.filter((l) => l.varian.length > 0);

  if (tampil.length === 0) {
    return (
      <p className="rounded-xl border border-black/10 bg-paper px-4 py-3.5 text-[13px] text-ink-soft">
        Belum ada layanan yang bisa dipesan hari ini. Hubungi tim PADMA lewat WhatsApp dan
        kami carikan jadwalnya.
      </p>
    );
  }

  return (
    <div className="space-y-7">
      {kelompokkanPerFase(tampil).map((kel) => {
        // "Garbha · Masa Kehamilan" dipecah kembali menjadi dua peran tipografi
        // — nama Sanskerta sebagai tajuk serif, nama Indonesia sebagai
        // keterangan — persis seperti kartu fase di landing. Titik tengahnya
        // tidak pernah ikut tampil: ia pemisah data, bukan hiasan.
        const [sanskerta, ...sisa] = kel.namaFase.split(" · ");
        const namaIndonesia = sisa.join(" · ");
        return (
          <section key={kel.namaFase || "tanpa-fase"}>
            {kel.namaFase !== "" && (
              <div className="mb-3 flex items-baseline gap-2.5">
                <h2 className="font-serif text-[17px] leading-none text-night">{sanskerta}</h2>
                {namaIndonesia !== "" && (
                  <span className="text-[12px] text-ink-soft">{namaIndonesia}</span>
                )}
                <span aria-hidden className="h-px flex-1 bg-gold/35" />
              </div>
            )}

            <div className="space-y-3">
              {kel.layanan.map((l) => (
                <article
                  key={l.id}
                  className="overflow-hidden rounded-2xl border border-black/10 bg-white"
                >
                  <h3 className="px-4 pb-2.5 pt-3.5 font-serif text-[17px] leading-snug text-night">
                    {l.nama}
                  </h3>
                  {/* Varian sebagai DAFTAR baris, bukan petak kartu: hanya
                      daftar yang membuat kolom harga sejajar, dan hanya kolom
                      yang sejajar yang bisa dibandingkan tanpa membaca ulang. */}
                  <ul className="divide-y divide-black/[0.07] border-t border-black/[0.07]">
                    {l.varian.map((v) => {
                      const terpilih = v.id === varianId;
                      return (
                        <li key={v.id}>
                          <button
                            type="button"
                            onClick={() => onPilih(l.id, v.id)}
                            aria-pressed={terpilih}
                            className={`flex min-h-[56px] w-full items-center gap-3 px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold ${
                              terpilih ? "bg-leaf-soft" : "bg-white hover:bg-paper"
                            }`}
                          >
                            {/* Penanda terpilih berupa batang emas di tepi
                                kiri, bukan centang di dalam lingkaran: ia
                                menandai BARIS yang aktif tanpa memakan lebar
                                yang dibutuhkan nama varian di layar sempit,
                                dan ruangnya tetap dipesan saat tidak aktif
                                supaya teks tidak bergeser ketika dipilih. */}
                            <span
                              aria-hidden
                              className={`h-8 w-[3px] shrink-0 rounded-full ${
                                terpilih ? "bg-gold" : "bg-transparent"
                              }`}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block text-[13.5px] font-semibold text-night">
                                {/* Varian baku memulangkan label KOSONG dari
                                    `labelVarian()`, dan itu sah. Tampil
                                    "Standar", persis seperti <select> yang
                                    digantikan katalog ini. */}
                                {v.label === "" ? "Standar" : v.label}
                              </span>
                              {terpilih && (
                                <span className="mt-0.5 block text-[11px] font-semibold text-leaf">
                                  Pilihan Anda
                                </span>
                              )}
                            </span>
                            <span className="shrink-0 text-right">
                              {v.hargaKlien === null ? (
                                <span className="block text-[12px] text-ink-soft">
                                  Tarif menyusul
                                </span>
                              ) : (
                                <span className="block font-serif text-[16px] leading-tight text-night">
                                  {v.hargaKlien}
                                </span>
                              )}
                              {v.hargaCoret !== null && (
                                // `aria-label` menyebut perannya. Tanpa itu
                                // pembaca layar membacakan dua angka
                                // berturut-turut tanpa hubungan, dan yang
                                // terdengar adalah harga yang membingungkan,
                                // bukan potongan harga.
                                <s
                                  aria-label={`harga sebelumnya ${v.hargaCoret}`}
                                  className="mt-0.5 block text-[11px] text-ink-soft/80"
                                >
                                  {v.hargaCoret}
                                </s>
                              )}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
