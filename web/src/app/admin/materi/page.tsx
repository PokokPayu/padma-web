import { requireRole } from "@/lib/auth/require-role";
import {
  TANPA_LAYANAN_ID,
  daftarMateriAdmin,
  pilihanKlien,
  pilihanLayananMateri,
} from "@/lib/admin/materi-admin";
import { daftarPenugasan } from "@/lib/admin/penugasan";
import { AksiMateri, FormMateriBaru, type PilihanLayanan } from "./form-materi";
import { LABEL_ISI, LABEL_TIPE, type TipeMateri } from "./status";

// Judul mengandalkan template `%s · PADMA` di root layout.
export const metadata = { title: "Materi Panduan" };

/**
 * Pill ketersediaan materi.
 *
 * "Nonaktif" di sini berarti lebih dari sekadar hilang dari daftar klien: sejak
 * migration `gating_materi_hormati_aktif`, policy baca klien pada
 * `material_pages` & `material_videos` ikut mengevaluasi `materials.aktif`,
 * sehingga isinya benar-benar berhenti dijawab PostgREST. Yang TETAP terbaca
 * hanyalah baris metadata materi — menutupnya akan mengulangi bug
 * `partner_publik`, tempat satu klik "nonaktifkan" menghapus sebuah nama dari
 * riwayat SELURUH klien tanpa satu pun error.
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

function PillTipe({ tipe }: { tipe: TipeMateri }) {
  return (
    <span className="rounded-full bg-night/5 px-2.5 py-1 text-[11px] font-extrabold text-night">
      {LABEL_TIPE[tipe]}
    </span>
  );
}

/**
 * Materi tanpa satu pun layanan tertaut. Keadaan SAH sejak Task 11 — admin
 * wajar ingin menumpuk bahan dulu — tetapi keadaan itu WAJIB terlihat: materi
 * seperti ini tidak pernah terbuka lewat jalur otomatis (sesi selesai), hanya
 * lewat penugasan manual. Materi yang silently tidak terlihat siapa pun adalah
 * persis kegagalan yang seluruh rencana ini berusaha dicegah.
 */
function PillTanpaLayanan() {
  return (
    <span className="rounded-full bg-clay/10 px-2.5 py-1 text-[11px] font-extrabold text-clay">
      Tanpa layanan · hanya lewat assign
    </span>
  );
}

function PillBelumAdaIsi() {
  return (
    <span className="rounded-full bg-clay/10 px-2.5 py-1 text-[11px] font-extrabold text-clay">
      Belum ada isi
    </span>
  );
}

export default async function MateriPage() {
  await requireRole(["admin", "owner"]);

  const [katalog, layananAktif, klien] = await Promise.all([
    daftarMateriAdmin(),
    pilihanLayananMateri(),
    pilihanKlien(),
  ]);
  const pilihan: PilihanLayanan[] = layananAktif.map((l) => ({ id: l.id, nama: l.nama }));

  // Materi kini bisa muncul di bawah LEBIH dari satu kelompok layanan (atau di
  // kelompok sentinel "Tanpa layanan"). `daftarPenugasan` karena itu dipanggil
  // SEKALI per materi UNIK — bukan sekali per kemunculan di sebuah kelompok —
  // supaya materi berlayanan-ganda tidak melipatgandakan query penugasannya.
  const materiUnik = new Map<string, (typeof katalog)[number]["materi"][number]>();
  for (const l of katalog) for (const m of l.materi) materiUnik.set(m.id, m);
  const idMateri = [...materiUnik.keys()];
  const penugasanPerMateri = new Map(
    await Promise.all(
      idMateri.map(async (id) => [id, await daftarPenugasan(id)] as const),
    ),
  );

  const berisi = katalog.filter((l) => l.materi.length > 0);
  // "Tanpa layanan" bukan layanan sungguhan — tidak masuk daftar "belum ada
  // materi untuk fase/layanan X" di bawah, yang murni berbicara soal layanan.
  const kosong = katalog.filter((l) => l.materi.length === 0 && l.id !== TANPA_LAYANAN_ID);

  return (
    <main>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl text-night">Materi Panduan</h1>
          <p className="mt-1 max-w-2xl text-[13px] text-ink-soft">
            Isi yang terbuka untuk klien setelah layanan terkaitnya selesai
            dijalani, atau lewat penugasan manual. Satu materi boleh menempel
            ke lebih dari satu layanan — atau tidak satu pun.
          </p>
        </div>
        <FormMateriBaru layanan={pilihan} />
      </header>

      <p className="mb-4 rounded-2xl border-[1.5px] border-dashed border-gold bg-[#FDFAF1] p-4 text-[13px] text-ink">
        ✦ Materi tidak pernah dihapus, hanya <b>dinonaktifkan</b> — dan
        menonaktifkannya benar-benar menutup isinya: halaman e-book dan isi
        videonya berhenti dijawab basis data untuk klien, bukan sekadar hilang
        dari layarnya. Materi juga tidak pernah bisa terbit tanpa isi: e-book
        wajib punya {LABEL_ISI.ebook}, video wajib punya {LABEL_ISI.video}.
        Materi kosong tampil kepada klien sebagai kartu terkunci yang tidak
        akan pernah terbuka.
      </p>

      {berisi.map((l) => (
        <section
          key={l.id}
          aria-label={`Materi layanan ${l.nama}`}
          className="mb-4 rounded-2xl border border-black/10 bg-white p-4"
        >
          <h2 className="mb-3 font-serif text-lg text-night">
            {l.nama}{" "}
            {!l.aktif && (
              <span className="font-sans text-[11.5px] uppercase tracking-wider text-clay">
                layanan nonaktif
              </span>
            )}
          </h2>

          <ul className="grid gap-3">
            {l.materi.map((m) => {
              const penugasan = penugasanPerMateri.get(m.id) ?? { ditugaskan: [], otomatis: [] };
              return (
                <li key={m.id} className="rounded-xl border border-black/10 p-3.5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-[200px] flex-1">
                      <b className="text-[14px] text-night">{m.judul}</b>
                      <p className="mt-0.5 text-[12.5px] text-ink-soft">
                        {m.deskripsi || "Belum ada deskripsi."}
                      </p>
                      {/* Angka ini yang membuat "materi setengah jadi" terlihat,
                          bukan tertebak: materi video tanpa objek video (atau
                          e-book tanpa halaman) terkunci selamanya bagi klien
                          yang sudah berhak, tanpa satu pun error. */}
                      <p className="mt-1 font-mono text-[11.5px] text-ink-soft">
                        {m.tipe === "ebook"
                          ? `${m.jumlahHalaman} halaman`
                          : m.objekVideo !== null
                            ? "video terpasang"
                            : "video belum terpasang"}
                      </p>
                    </div>
                    <span className="flex flex-wrap items-center justify-end gap-2">
                      <PillTipe tipe={m.tipe} />
                      <PillAktif aktif={m.aktif} />
                      {m.layananId.length === 0 && <PillTanpaLayanan />}
                      {!m.lengkap && <PillBelumAdaIsi />}
                    </span>
                  </div>

                  <div className="mt-2.5">
                    <AksiMateri
                      id={m.id}
                      judul={m.judul}
                      deskripsi={m.deskripsi}
                      tipe={m.tipe}
                      aktif={m.aktif}
                      lengkap={m.lengkap}
                      layananId={m.layananId}
                      layanan={pilihan}
                      jumlahHalaman={m.jumlahHalaman}
                      objekVideo={m.objekVideo}
                      ditugaskan={penugasan.ditugaskan}
                      otomatis={penugasan.otomatis}
                      pilihanKlien={klien}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {kosong.length > 0 && (
        <p className="mt-2 text-[12px] text-ink-soft">
          Belum ada materi untuk: {kosong.map((l) => l.nama).join(", ")}.
        </p>
      )}
    </main>
  );
}
