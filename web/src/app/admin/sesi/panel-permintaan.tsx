import { PemilihLokasi } from "@/app/_shell/pemilih-lokasi";
import { TombolPermintaan, FormUbahPermintaan, type MitraPilihan } from "./aksi-permintaan";
import type { BarisPermintaanDaftar } from "@/lib/admin/permintaan";
import { LABEL_PERMINTAAN, STATUS_UBAH_PERMINTAAN } from "@/lib/jadwal/status";
import { formatJam, jamDariDb } from "@/lib/jadwal/jam";

/**
 * Isi panel geser untuk SATU permintaan.
 *
 * Komponen SERVER dengan sengaja: seluruh penyajian — ringkasan, alamat,
 * keadaan bayar — dirender di server, dan hanya tombol serta pemilih pin yang
 * menyeberang sebagai komponen klien. Suite proyek ini berjalan TANPA jsdom,
 * jadi apa pun yang hanya lahir sesudah hidrasi tidak bisa diperiksa sama
 * sekali.
 *
 * Tidak ada pengambilan data di sini. Seluruh isinya datang sebagai prop yang
 * sudah dirender halaman.
 */
export function PanelPermintaan({
  permintaan,
  mitra,
  tanggal,
  jam,
  waktu,
  labelBayar,
  lunas,
  tautanWa,
  tautanWaKosong,
  jamPilihan,
  tanggalIso,
}: {
  permintaan: BarisPermintaanDaftar;
  mitra: MitraPilihan[];
  /** Sudah diformat lewat kalender Asia/Jakarta di halaman. */
  tanggal: string;
  jam: string;
  waktu: string;
  labelBayar: string;
  lunas: boolean;
  tautanWa: string;
  tautanWaKosong: string;
  jamPilihan: string[];
  /** Nilai `YYYY-MM-DD` mentah, untuk `<input type="date">`. */
  tanggalIso: string;
}) {
  const berkoordinat = permintaan.alamatLat !== null && permintaan.alamatLon !== null;
  const bisaDiubah = STATUS_UBAH_PERMINTAAN.includes(permintaan.status);
  // Jam permintaan ini SEKARANG, dibaca lewat `jamDariDb` (bukan `slice(0,5)`
  // sendiri) — lihat dokblok fungsi itu untuk kenapa keduanya harus dibedakan.
  const jamSekarang = jamDariDb(permintaan.jamMulai);
  // `jamLayanan` bisa berubah runtime lewat /admin/pengaturan. Bila jam
  // permintaan ini sudah tidak ada di daftar (jam itu dihapus/digeser SETELAH
  // permintaan dibuat), `<select defaultValue={jamSekarang}>` jatuh diam-diam
  // ke opsi PERTAMA — admin yang cuma bermaksud membetulkan alamat menekan
  // Simpan dan tanpa sadar menggeser jam sesi. Opsi tambahan ini menjaga jam
  // aslinya tetap terpilih sampai admin benar-benar memilih yang lain.
  const jamTidakLagiDitawarkan = !jamPilihan.includes(jamSekarang);

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <section>
        <p className="text-[13.5px] font-bold text-panel-ink">
          {permintaan.namaKlien}
          {permintaan.padmaId && (
            <span className="ml-1.5 text-[11.5px] font-normal text-panel-muted">
              {permintaan.padmaId}
            </span>
          )}
        </p>
        {tautanWaKosong ? (
          <a
            href={tautanWaKosong}
            target="_blank"
            rel="noopener"
            className="mt-2 inline-block rounded-lg border border-black/15 px-3 py-1.5 text-[12px] font-bold text-ink-soft"
          >
            Hubungi klien via WA
          </a>
        ) : (
          <>
            {/* Tombolnya HILANG ketika nomor klien tidak sah, dan kalimat ini yang membuat hilangnya terlihat. Tanpa kalimat, admin membaca layar yang sama persis seperti layar yang benar dan menyimpulkan nomornya ada. */}
            <p className="mt-2 text-[12px] font-semibold text-clay">
              Nomor WhatsApp klien belum sah — lengkapi di menu Klien.
            </p>
          </>
        )}
        <p className="mt-0.5 text-[12px] text-panel-muted">
          {permintaan.namaLayanan}
          {permintaan.namaVarian ? ` · ${permintaan.namaVarian}` : ""} · {tanggal} ·{" "}
          <b>{jam}</b> · alternatif {waktu}
        </p>
        <p className="mt-1 text-[12px] font-bold text-panel-ink">
          {LABEL_PERMINTAAN[permintaan.status]}
        </p>
        {permintaan.catatan && (
          <p className="mt-2 rounded-lg bg-black/[0.03] px-3 py-2 text-[12.5px] italic text-ink-soft">
            “{permintaan.catatan}”
          </p>
        )}
      </section>

      <section>
        <p className="text-[12.5px] font-bold text-panel-muted">Alamat kunjungan</p>
        {!bisaDiubah ? (
          <>
            <p className="mt-1 whitespace-pre-line text-[12.5px] text-panel-ink">
              {permintaan.alamat || "—"}
            </p>
            {berkoordinat ? (
              <p className="mt-1 text-[11px] text-panel-muted">
                Pin: {permintaan.alamatLat!.toFixed(6)}, {permintaan.alamatLon!.toFixed(6)}
              </p>
            ) : (
              <p className="mt-2 rounded-lg bg-clay/10 px-3 py-2 text-[12px] font-semibold text-clay">
                Alamat ini belum berkoordinat, dan tidak bisa diubah lagi dari layar ini.
              </p>
            )}
          </>
        ) : (
          <FormUbahPermintaan
            permintaanId={permintaan.id}
            anak={
              <>
                {!berkoordinat && (
                  /* Kalimat menyebut AKIBATNYA, bukan hanya keadaannya. "Belum
                     berkoordinat" saja tidak memberi tahu admin bahwa sesi yang
                     lahir dari sini akan menuntut jenjang transport ditetapkan
                     tangan belakangan. */
                  <p className="mb-2 rounded-lg bg-clay/10 px-3 py-2 text-[12px] font-semibold text-clay">
                    Alamat ini belum berkoordinat. Jarak ke bidan tidak bisa dihitung, dan sesi yang
                    lahir darinya tidak akan punya jenjang transport.
                  </p>
                )}

                <label className="block">
                  <span className="text-[12px] font-bold text-panel-muted">Alamat</span>
                  <textarea
                    name="alamat"
                    rows={2}
                    defaultValue={permintaan.alamat}
                    className="mt-1 w-full rounded-lg border border-panel-border bg-panel-surface px-3 py-2 text-[13px] text-panel-ink"
                  />
                </label>

                <div className="mt-2 flex flex-wrap gap-2">
                  <label className="flex-1">
                    <span className="text-[12px] font-bold text-panel-muted">Tanggal</span>
                    <input
                      type="date"
                      name="tanggal"
                      defaultValue={tanggalIso}
                      className="mt-1 w-full rounded-lg border border-panel-border bg-panel-surface px-3 py-2 text-[13px] text-panel-ink"
                    />
                  </label>
                  <label className="flex-1">
                    <span className="text-[12px] font-bold text-panel-muted">Jam</span>
                    {/* Daftarnya sama dengan yang ditawarkan ke klien, supaya dua
                        jalur tidak melahirkan dua kebiasaan jam yang berbeda. */}
                    <select
                      name="jam"
                      defaultValue={jamSekarang}
                      className="mt-1 w-full rounded-lg border border-panel-border bg-panel-surface px-3 py-2 text-[13px] text-panel-ink"
                    >
                      {jamTidakLagiDitawarkan && (
                        <option value={jamSekarang}>
                          {formatJam(jamSekarang)} — di luar jam layanan sekarang
                        </option>
                      )}
                      {jamPilihan.map((j) => (
                        <option key={j} value={j}>
                          {formatJam(j)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {/* Peta SELALU ada di sini, tidak lagi hanya saat koordinat
                    kosong: pin salah klik sebelumnya tidak bisa dikoreksi dari
                    layar mana pun, dan pin yang salah menghasilkan jenjang
                    transport yang percaya diri dan salah — bukan NULL yang akan
                    tertangkap StatTile "menunggu jenjang". */}
                <PemilihLokasi
                  awal={berkoordinat ? { lat: permintaan.alamatLat!, lon: permintaan.alamatLon! } : null}
                  kalimatKosong="Belum ada pin. Klik di peta untuk menandai lokasinya — bila teks alamat diubah, sistem mencoba menebak koordinatnya sekali."
                />
              </>
            }
          />
        )}
        {/* Lisensi ODbL menuntut atribusi tampak di layar yang memakai
            hasilnya, bukan cukup di komentar kode. */}
        <p className="mt-1 text-[11px] text-panel-muted">
          Peta &amp; lokasi dari data © OpenStreetMap contributors.
        </p>
      </section>

      {permintaan.namaMitra !== null && bisaDiubah && (
        /* Bidan TIDAK dilepas otomatis saat jadwal atau alamat berubah (spec
           K2): sistem tidak tahu jadwal, cuti, maupun kesediaan bidan, jadi ia
           tidak berhak melepas orang berdasarkan pengetahuan yang tidak
           dimilikinya. Yang bisa ia lakukan adalah mengatakannya. */
        <p className="rounded-lg bg-gold/15 px-3 py-2 text-[12px] font-semibold text-[#8A6A16]">
          {permintaan.namaMitra} ditetapkan untuk jadwal &amp; alamat sebelum perubahan. Pastikan
          ulang ke beliau, atau tekan “Ganti bidan”.
        </p>
      )}

      <section>
        <p className="text-[12.5px] font-bold text-panel-muted">Pembayaran</p>
        <p className="mt-1 text-[12.5px] text-panel-ink">{labelBayar}</p>
      </section>

      <TombolPermintaan
        permintaanId={permintaan.id}
        status={permintaan.status}
        namaMitra={permintaan.namaMitra}
        mitra={mitra}
        lunas={lunas}
        tautanWa={tautanWa}
      />
    </div>
  );
}
