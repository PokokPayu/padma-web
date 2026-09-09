"use client";

import { useMemo, useState } from "react";

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
//
// KENAPA TIDAK SEMUANYA TERBUKA SEKALIGUS. Versi pertama merender SELURUH
// katalog terbuka: setiap fase, setiap layanan, setiap varian. Dengan katalog
// klien yang sesungguhnya (lima fase, puluhan layanan, dua varian per layanan)
// halamannya tumbuh melewati sepuluh layar penuh, dan memilih layanan berarti
// menggulir melewati layanan yang tidak mungkin dipesan klien ini. Tiga alat
// di bawah menjawab tiga cara orang datang ke layar ini, dan tidak lebih:
//   - kotak cari, untuk yang sudah tahu nama layanannya;
//   - chip fase (fase klien terpilih lebih dulu), untuk yang tahu fasenya;
//   - baris layanan yang terlipat, untuk yang sedang menjelajah.
// Yang TIDAK ikut dilipat adalah harganya: baris tertutup tetap menyebut
// rentang harga layanan itu, karena menyembunyikan angka akan merusak alasan
// layar ini ada.

export type VarianKatalogAjukan = {
  id: string;
  serviceId: string;
  /** Dari `labelVarian()`. String kosong = varian baku, tampil "Standar". */
  label: string;
  /** Sudah diformat rupiah di server. `null` = tarifnya belum ditetapkan. */
  hargaKlien: string | null;
  hargaCoret: string | null;
  /** Angka mentah untuk menghitung rentang. `null` bila tarif belum ada. */
  hargaAngka: number | null;
};

export type LayananKatalogAjukan = {
  id: string;
  nama: string;
  /** Mis. "Garbha · Masa Kehamilan". String kosong bila fasenya tak terbaca. */
  namaFase: string;
  /** `phases.id` — penentu ikon dan chip penyaring. "" bila tak terbaca. */
  faseId: string;
  /** `services.deskripsi`. String kosong = belum ditulis admin; itu SAH. */
  deskripsi: string;
  varian: VarianKatalogAjukan[];
};

/**
 * Ikon fase, digambar dari ARTI nama Sanskertanya dan bukan dari kategori umum
 * "kesehatan": Sankalpa = niat yang ditanam (tunas), Garbha = kandungan
 * (lengkung perut), Sutika = ibu baru bersalin (purnama), Sandhya = senja
 * (matahari di garis cakrawala), Shishu = bayi (telapak kaki).
 *
 * Dikunci pada `phases.id` yang sudah dirujuk kode dan ditanam migration
 * `tanam_fase_acuan`. Fase yang tidak ada di peta ini tampil TANPA ikon —
 * sengaja: tanpa ikon jauh lebih baik daripada ikon yang salah arti.
 */
const IKON_FASE: Record<string, React.ReactNode> = {
  prekonsepsi: (
    <>
      <path d="M10 16.6v-5.2" />
      <path d="M10 11.4c0-2.6 1.9-4.7 4.4-4.9-.2 2.7-2 4.7-4.4 4.9Z" />
      <path d="M10 13.1c-2.1-.2-3.7-1.9-3.9-4.1 2.1.2 3.7 1.9 3.9 4.1Z" />
    </>
  ),
  kehamilan: (
    <>
      <path d="M6.5 3.5v13" />
      <path d="M6.5 6.9c3.6 0 6.5 2.2 6.5 4.9s-2.9 4.7-6.5 4.7" />
      <circle cx="9.1" cy="11.6" r="1.5" />
    </>
  ),
  nifas: (
    <>
      <circle cx="10" cy="10" r="6.3" />
      <path d="M10 3.7a6.3 6.3 0 0 0 0 12.6" />
    </>
  ),
  menopause: (
    <>
      <path d="M3.4 15.4h13.2" />
      <path d="M6.5 15.4a3.5 3.5 0 0 1 7 0" />
      <path d="M10 4.2v2.2M4.9 6.6l1.5 1.5M15.1 6.6l-1.5 1.5" />
    </>
  ),
  newborn: (
    <>
      <path d="M12.6 15.2c-2.3.9-4.6-.4-4.6-2.7 0-1.9 1.5-3 1.5-5.1 0-1.6 1-2.6 2.4-2.6 1.6 0 2.7 1.4 2.7 3.4 0 3-1.5 6.1-2 7Z" />
      <circle cx="6.4" cy="8.2" r="1.2" />
      <circle cx="5.5" cy="11.4" r="1" />
    </>
  ),
  // Chip "semua" bukan fase; ikonnya kelopak padma, lambang rumahnya sendiri.
  semua: (
    <>
      <path d="M10 3.4c2 1.9 2 4.6 0 6.5-2-1.9-2-4.6 0-6.5Z" />
      <path d="M10 9.9c2.5-1 5 0 5.8 2.3-2.5 1-5 0-5.8-2.3Z" />
      <path d="M10 9.9c-2.5-1-5 0-5.8 2.3 2.5 1 5 0 5.8-2.3Z" />
      <path d="M10 9.9v6.7" />
    </>
  ),
};

function IkonFase({ faseId, className }: { faseId: string; className: string }) {
  const isi = IKON_FASE[faseId];
  if (!isi) return null;
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {isi}
    </svg>
  );
}

/**
 * Kelompok tampilan: satu fase, beserta layanan yang berdiri di bawahnya.
 *
 * Dirakit di sini dan bukan di server karena bentuknya murni urusan TAMPILAN —
 * server sudah menyerahkan katalog TERURUT menurut `phases.urutan`, jadi yang
 * tersisa hanyalah memampatkan deret yang `namaFase`-nya sama berturut-turut.
 */
function kelompokkanPerFase(layanan: LayananKatalogAjukan[]) {
  const kelompok: Array<{
    namaFase: string;
    faseId: string;
    layanan: LayananKatalogAjukan[];
  }> = [];
  for (const l of layanan) {
    const terakhir = kelompok[kelompok.length - 1];
    if (terakhir && terakhir.namaFase === l.namaFase) terakhir.layanan.push(l);
    else kelompok.push({ namaFase: l.namaFase, faseId: l.faseId, layanan: [l] });
  }
  return kelompok;
}

/**
 * Rentang harga sebuah layanan, untuk baris yang sedang TERTUTUP.
 *
 * Layanan yang satu pun varianya belum bertarif memulangkan `null` — barisnya
 * lalu berkata "Tarif menyusul", kalimat yang sama dengan baris varian, bukan
 * rentang kosong yang menyesatkan.
 */
function rentangHarga(l: LayananKatalogAjukan) {
  const angka = l.varian.map((v) => v.hargaAngka).filter((n): n is number => n !== null);
  if (angka.length === 0) return null;
  const min = Math.min(...angka);
  const max = Math.max(...angka);
  const f = (n: number) => n.toLocaleString("id-ID");
  return min === max ? `Rp ${f(min)}` : `Rp ${f(min)}–${f(max)}`;
}

function cocokDenganCarian(l: LayananKatalogAjukan, q: string) {
  const k = q.trim().toLowerCase();
  if (k === "") return true;
  // Deskripsi ikut dicari. Klien lebih sering ingat apa yang layanan itu
  // LAKUKAN ("pijat punggung") daripada nama Sanskertanya, dan nama itulah
  // satu-satunya yang tercari sebelum ini.
  return (
    l.nama.toLowerCase().includes(k) ||
    l.deskripsi.toLowerCase().includes(k) ||
    l.varian.some((v) => v.label.toLowerCase().includes(k))
  );
}

export function Katalog({
  layanan,
  varianId,
  faseKlien,
  onPilih,
}: {
  layanan: LayananKatalogAjukan[];
  varianId: string;
  /**
   * `clients.phase_id`. Boleh null sejak migration `fase_klien_boleh_kosong`:
   * klien yang mendaftar sendiri belum punya fase sampai skrining pertamanya
   * tersambung. Null (atau fase tanpa layanan) mendarat di "Semua".
   */
  faseKlien: string | null;
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
  const tampil = useMemo(() => layanan.filter((l) => l.varian.length > 0), [layanan]);

  const [cari, setCari] = useState("");
  // Fase klien hanya dipakai bila ia PUNYA layanan yang bisa dipesan. Mendarat
  // di chip yang daftarnya kosong adalah cara tercepat membuat klien mengira
  // PADMA tidak melayani dirinya.
  const [fase, setFase] = useState(() =>
    faseKlien && tampil.some((l) => l.faseId === faseKlien) ? faseKlien : "semua",
  );
  // Layanan yang sedang dipilih ikut terbuka sejak awal, supaya klien melihat
  // varian mana yang sedang berlaku baginya tanpa mengetuk apa pun.
  const [terbuka, setTerbuka] = useState<Set<string>>(
    () => new Set(tampil.filter((l) => l.varian.some((v) => v.id === varianId)).map((l) => l.id)),
  );

  const mencari = cari.trim() !== "";

  // Saat mencari, chip fase BERHENTI menyaring: hasil pencarian melintasi fase,
  // dan menyembunyikan hasil di fase lain membuat pencarian terasa rusak.
  const daftar = tampil.filter(
    (l) => cocokDenganCarian(l, cari) && (mencari || fase === "semua" || l.faseId === fase),
  );

  const chips = [
    { id: "semua", teks: "Semua", jumlah: tampil.length },
    ...kelompokkanPerFase(tampil).map((k) => ({
      id: k.faseId,
      teks: k.namaFase.split(" · ")[0] || "Lainnya",
      jumlah: k.layanan.length,
    })),
  ];

  if (tampil.length === 0) {
    return (
      <p className="rounded-xl border border-black/10 bg-paper px-4 py-3.5 text-[13px] text-ink-soft">
        Belum ada layanan yang bisa dipesan hari ini. Hubungi tim PADMA lewat WhatsApp dan
        kami carikan jadwalnya.
      </p>
    );
  }

  return (
    <div>
      <label className="relative block">
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          fill="none"
          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft"
        >
          <circle cx="7" cy="7" r="4.6" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input
          type="search"
          value={cari}
          onChange={(e) => setCari(e.target.value)}
          placeholder="Cari layanan atau durasi"
          aria-label="Cari layanan"
          className="min-h-[44px] w-full rounded-xl border border-black/10 bg-white py-2.5 pl-10 pr-3 text-sm"
        />
      </label>

      {/* Chip fase disembunyikan dari pembaca layar saat mencari: ia tidak lagi
          menyaring apa pun, dan tombol yang tidak berpengaruh membingungkan. */}
      <div
        role="group"
        aria-label="Saring menurut fase"
        className="-mx-1 mt-2.5 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {chips.map((c) => {
          const aktif = !mencari && fase === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                setFase(c.id);
                setCari("");
              }}
              aria-pressed={aktif}
              className={`flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full border py-1.5 pl-2.5 pr-3 text-[13px] font-semibold ${
                aktif
                  ? "border-night bg-night text-paper"
                  : "border-black/10 bg-white text-pine"
              }`}
            >
              <IkonFase
                faseId={c.id}
                className={`h-[17px] w-[17px] shrink-0 ${aktif ? "text-gold-pale" : "text-gold"}`}
              />
              {c.teks}
              <span className={`font-medium ${aktif ? "text-gold-pale" : "text-ink-soft"}`}>
                {c.jumlah}
              </span>
            </button>
          );
        })}
      </div>

      {daftar.length === 0 ? (
        <div className="mt-4 rounded-xl border border-black/10 bg-white px-4 py-4 text-[13px] text-ink-soft">
          <b className="mb-1 block text-sm text-night">Tidak ada layanan bernama “{cari.trim()}”</b>
          Coba kata yang lebih pendek, atau ketuk “Semua” untuk melihat seluruh katalog.
        </div>
      ) : (
        <div className="mt-5 space-y-7">
          {kelompokkanPerFase(daftar).map((kel) => {
            // "Garbha · Masa Kehamilan" dipecah kembali menjadi dua peran
            // tipografi — nama Sanskerta sebagai tajuk serif, nama Indonesia
            // sebagai keterangan — persis seperti kartu fase di landing. Titik
            // tengahnya tidak pernah ikut tampil: ia pemisah data, bukan hiasan.
            const [sanskerta, ...sisa] = kel.namaFase.split(" · ");
            const namaIndonesia = sisa.join(" · ");
            return (
              <section key={kel.namaFase || "tanpa-fase"}>
                {kel.namaFase !== "" && (
                  <div className="mb-3 flex items-center gap-2.5">
                    {/* Ikon memungut warna garis rambut emas di sebelahnya, jadi
                        ia terbaca sebagai ujung garis itu — bukan benda baru. */}
                    <IkonFase faseId={kel.faseId} className="h-5 w-5 shrink-0 text-gold" />
                    <h2 className="font-serif text-[17px] leading-none text-night">{sanskerta}</h2>
                    {namaIndonesia !== "" && (
                      <span className="text-[12px] text-ink-soft">{namaIndonesia}</span>
                    )}
                    <span aria-hidden className="h-px flex-1 bg-gold/35" />
                  </div>
                )}

                <div className="space-y-3">
                  {kel.layanan.map((l) => {
                    // Saat mencari, semua hasil terbuka: daftar hasil yang harus
                    // diketuk satu per satu bukan hasil pencarian, melainkan
                    // pekerjaan kedua.
                    const dibuka = mencari || terbuka.has(l.id);
                    const punyaPilihan = l.varian.some((v) => v.id === varianId);
                    const varianTerpilih = l.varian.find((v) => v.id === varianId);
                    const rentang = rentangHarga(l);
                    return (
                      <article
                        key={l.id}
                        className={`overflow-hidden rounded-2xl border bg-white ${
                          punyaPilihan ? "border-gold/55" : "border-black/10"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setTerbuka((s) => {
                              const baru = new Set(s);
                              if (baru.has(l.id)) baru.delete(l.id);
                              else baru.add(l.id);
                              return baru;
                            })
                          }
                          aria-expanded={dibuka}
                          className="flex min-h-[56px] w-full items-center gap-2.5 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block font-serif text-[16.5px] leading-snug text-night">
                              {l.nama}
                            </span>
                            {/* Baris tertutup yang menyimpan pilihan klien tetap
                                menyebut pilihan itu. Tanpa ini, satu-satunya
                                cara mengingat "saya pilih yang mana" adalah
                                membuka kembali tiap kartu. */}
                            {punyaPilihan && !dibuka && varianTerpilih && (
                              <span className="mt-0.5 block text-[11.5px] font-semibold text-leaf">
                                {varianTerpilih.label === "" ? "Standar" : varianTerpilih.label}
                                {varianTerpilih.hargaKlien !== null &&
                                  ` · ${varianTerpilih.hargaKlien}`}
                              </span>
                            )}
                          </span>
                          <span className="shrink-0 text-right">
                            <span className="block whitespace-nowrap font-serif text-[13px] leading-tight text-ink-soft">
                              {rentang ?? "Tarif menyusul"}
                            </span>
                            <span className="block text-[10.5px] text-ink-soft">
                              {l.varian.length} pilihan
                            </span>
                          </span>
                          <svg
                            aria-hidden
                            viewBox="0 0 14 14"
                            fill="none"
                            className={`h-3.5 w-3.5 shrink-0 text-ink-soft transition-transform ${
                              dibuka ? "rotate-180" : ""
                            }`}
                          >
                            <path
                              d="M3 5.5 7 9.5 11 5.5"
                              stroke="currentColor"
                              strokeWidth="1.6"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>

                        {/* Varian sebagai DAFTAR baris, bukan petak kartu: hanya
                            daftar yang membuat kolom harga sejajar, dan hanya
                            kolom yang sejajar yang bisa dibandingkan tanpa
                            membaca ulang. */}
                        {/* Deskripsi hanya muncul saat kartu TERBUKA, dan
                            berdiri di antara nama layanan dan daftar varian —
                            tepat di detik klien sedang memutuskan. Di baris
                            tertutup ia sengaja absen: yang harus bisa disapu
                            mata di sana adalah nama dan angka, dan paragraf
                            akan mengubur keduanya. Layanan tanpa deskripsi
                            tidak menyisakan apa pun, bukan ruang kosong. */}
                        {dibuka && l.deskripsi !== "" && (
                          <p className="border-t border-black/[0.07] bg-paper/60 px-4 py-3 text-[12.5px] leading-relaxed text-ink-soft">
                            {l.deskripsi}
                          </p>
                        )}

                        {dibuka && (
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
                                        menandai BARIS yang aktif tanpa memakan
                                        lebar yang dibutuhkan nama varian di layar
                                        sempit, dan ruangnya tetap dipesan saat
                                        tidak aktif supaya teks tidak bergeser
                                        ketika dipilih. */}
                                    <span
                                      aria-hidden
                                      className={`h-8 w-[3px] shrink-0 rounded-full ${
                                        terpilih ? "bg-gold" : "bg-transparent"
                                      }`}
                                    />
                                    <span className="min-w-0 flex-1">
                                      <span className="block text-[13.5px] font-semibold text-night">
                                        {/* Varian baku memulangkan label KOSONG
                                            dari `labelVarian()`, dan itu sah.
                                            Tampil "Standar", persis seperti
                                            <select> yang digantikan katalog ini. */}
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
                                        // `aria-label` menyebut perannya. Tanpa
                                        // itu pembaca layar membacakan dua angka
                                        // berturut-turut tanpa hubungan, dan yang
                                        // terdengar adalah harga yang
                                        // membingungkan, bukan potongan harga.
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
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
