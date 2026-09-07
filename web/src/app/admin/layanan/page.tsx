import { requireRole } from "@/lib/auth/require-role";
import { PAKET_TAMPIL } from "@/lib/paket-tampil";
import { daftarKatalogAdmin } from "@/lib/admin/katalog-admin";
import { daftarMateriAdmin } from "@/lib/admin/materi-admin";
import { AksiLayanan, AksiPaket, FormLayananBaru, type PilihanFase } from "./form-layanan";
import { BlokVarian } from "./form-varian";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: PAKET_TAMPIL ? "Layanan & Paket" : "Layanan" };

/**
 * Pill ketersediaan.
 *
 * "Nonaktif" berarti dua hal saja: layanan berhenti muncul di katalog beranda,
 * dan berhenti ditawarkan saat menjadwalkan sesi baru. Ia TIDAK berarti namanya
 * hilang — riwayat sesi klien tetap menyebutnya, karena policy baca untuk
 * pengguna login sengaja tidak menyaring ketersediaan. Perbedaan itu pernah
 * hilang pada data mitra, dan akibatnya seluruh riwayat lama berganti menjadi
 * teks cadangan tanpa satu pun error.
 */
function PillAktif({ aktif }: { aktif: boolean }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${
        aktif ? "bg-leaf-soft text-leaf" : "bg-clay/10 text-clay"
      }`}
    >
      {aktif ? "Aktif" : "Nonaktif"}
    </span>
  );
}

export default async function LayananPage() {
  await requireRole(["admin", "owner"]);

  const [katalog, materiPerLayanan] = await Promise.all([
    daftarKatalogAdmin(),
    daftarMateriAdmin(),
  ]);
  const pilihanFase: PilihanFase[] = katalog.map((f) => ({ id: f.id, nama: f.nama }));
  const materiPerId = new Map(materiPerLayanan.map((l) => [l.id, l.materi]));

  return (
    <main>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl text-night">
            {PAKET_TAMPIL ? "Layanan & Paket" : "Layanan"}
          </h1>
          <p className="mt-1 max-w-2xl text-[13px] text-ink-soft">
            Katalog yang dibaca beranda dan wizard pengajuan jadwal klien.
            Tidak ada satu pun angka harga di sini — tarif adalah wilayah Owner.
          </p>
        </div>
        <FormLayananBaru fase={pilihanFase} />
      </header>

      <p className="mb-4 rounded-2xl border-[1.5px] border-dashed border-gold bg-[#FDFAF1] p-4 text-[13px] text-ink">
        {PAKET_TAMPIL ? (
          <>
            ✦ Layanan, paket, dan varian tidak pernah dihapus, hanya{" "}
            <b>dinonaktifkan</b>. Yang nonaktif berhenti muncul di beranda dan
            berhenti ditawarkan untuk sesi baru, tetapi namanya <b>tetap</b>{" "}
            menempel pada riwayat sesi klien yang sudah berjalan. Menghapusnya
            justru akan memutus riwayat itu. Satu layanan tidak bisa kehilangan
            varian aktif terakhirnya — aktifkan varian lain dulu sebelum
            menonaktifkan yang sedang dipakai.
          </>
        ) : (
          <>
            ✦ Layanan dan varian tidak pernah dihapus, hanya{" "}
            <b>dinonaktifkan</b>. Yang nonaktif berhenti muncul di beranda dan
            berhenti ditawarkan untuk sesi baru, tetapi namanya <b>tetap</b>{" "}
            menempel pada riwayat sesi klien yang sudah berjalan. Menghapusnya
            justru akan memutus riwayat itu. Satu layanan tidak bisa kehilangan
            varian aktif terakhirnya — aktifkan varian lain dulu sebelum
            menonaktifkan yang sedang dipakai.
          </>
        )}
      </p>

      {katalog.map((f) => (
        <section
          key={f.id}
          aria-label={`Layanan fase ${f.nama}`}
          className="mb-4 rounded-2xl border border-black/10 bg-white p-4"
        >
          <h2 className="mb-3 font-serif text-lg text-night">
            {f.nama}{" "}
            <span className="font-sans text-[12px] uppercase tracking-wider text-ink-soft">
              {f.namaSanskrit}
            </span>
          </h2>

          {f.layanan.length === 0 ? (
            <p className="text-[13px] italic text-ink-soft">
              Belum ada layanan pada fase ini.
            </p>
          ) : (
            <ul className="grid gap-3">
              {f.layanan.map((l) => (
                <li key={l.id} className="rounded-xl border border-black/10 p-3.5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-[200px] flex-1">
                      <b className="text-[14px] text-night">{l.nama}</b>
                      <p className="mt-0.5 text-[12.5px] text-ink-soft">
                        {l.deskripsi || "Belum ada deskripsi."}
                      </p>
                      {/* Angka ini menjelaskan mengapa baris tidak boleh
                          dihapus: setiap sesi menunjuk layanan ini. */}
                      <p className="mt-1 font-mono text-[11.5px] text-ink-soft">
                        {l.sesiTercatat} sesi tercatat
                      </p>
                    </div>
                    <PillAktif aktif={l.aktif} />
                  </div>

                  <div className="mt-2.5">
                    <AksiLayanan
                      id={l.id}
                      nama={l.nama}
                      deskripsi={l.deskripsi}
                      faseId={f.id}
                      aktif={l.aktif}
                      fase={pilihanFase}
                    />
                  </div>

                  <BlokVarian serviceId={l.id} namaLayanan={l.nama} varian={l.varian} />

                  {PAKET_TAMPIL && l.paket.length > 0 && (
                    <ul className="mt-3 grid gap-2 border-t border-black/5 pt-3">
                      {l.paket.map((p) => (
                        <li
                          key={p.id}
                          className="flex flex-wrap items-center justify-between gap-2.5"
                        >
                          <span className="min-w-[180px] flex-1">
                            <b className="text-[13px] text-ink">{p.nama}</b>
                            <span className="ml-2 font-mono text-[12px] text-ink-soft">
                              {p.jumlahSesi} sesi
                            </span>
                            <span className="block text-[11.5px] text-ink-soft">
                              {p.dipakai > 0
                                ? `${p.dipakai} klien sedang menjalani paket ini — mengubah jumlah sesi menggeser progres passport mereka.`
                                : "Belum dipakai klien mana pun."}
                            </span>
                          </span>
                          <PillAktif aktif={p.aktif} />
                          <AksiPaket
                            id={p.id}
                            nama={p.nama}
                            jumlahSesi={p.jumlahSesi}
                            aktif={p.aktif}
                            dipakai={p.dipakai}
                          />
                        </li>
                      ))}
                    </ul>
                  )}

                  {/*
                    Bacaan saja, sengaja. Keterkaitan materi<->layanan
                    (`material_services`) dikelola dari modul Materi — bukan
                    di sini — supaya tidak ada dua tempat yang bisa menulis
                    satu relasi. Tapi admin yang membuka layar layanan wajib
                    bisa MELIHAT "layanan ini include materi apa saja" tanpa
                    berpindah modul; tanpa daftar ini, tidak ada satu pun
                    layar yang menjawab pertanyaan itu dari sisi layanan.
                  */}
                  <div className="mt-3 border-t border-black/5 pt-3">
                    <p className="text-[11.5px] font-bold uppercase tracking-wide text-ink-soft">
                      Materi yang termasuk layanan ini
                    </p>
                    {(materiPerId.get(l.id) ?? []).length === 0 ? (
                      <p className="mt-1 text-[12.5px] italic text-ink-soft">
                        Belum ada materi yang menautkan layanan ini.
                      </p>
                    ) : (
                      <ul className="mt-1 grid gap-1">
                        {(materiPerId.get(l.id) ?? []).map((m) => (
                          <li key={m.id} className="text-[12.5px] text-ink">
                            {m.judul}{" "}
                            {!m.aktif && (
                              <span className="text-[11px] font-bold text-clay">(nonaktif)</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      <p className="mt-2 text-[12px] text-ink-soft">
        Materi pembelajaran menempel pada layanan dan dikelola di modulnya
        sendiri. Menonaktifkan layanan di sini tidak menghapus materi apa pun.
      </p>
    </main>
  );
}
