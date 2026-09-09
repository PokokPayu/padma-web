import { PemilihLokasi } from "@/app/_shell/pemilih-lokasi";
import { TombolPermintaan, FormPinPermintaan, type MitraPilihan } from "./aksi-permintaan";
import type { BarisPermintaanDaftar } from "@/lib/admin/permintaan";
import { LABEL_PERMINTAAN } from "@/lib/jadwal/status";

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
}) {
  const berkoordinat = permintaan.alamatLat !== null && permintaan.alamatLon !== null;

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
        <p className="mt-1 whitespace-pre-line text-[12.5px] text-panel-ink">
          {permintaan.alamat || "—"}
        </p>

        {berkoordinat ? (
          <p className="mt-1 text-[11px] text-panel-muted">
            Pin: {permintaan.alamatLat!.toFixed(6)}, {permintaan.alamatLon!.toFixed(6)}
          </p>
        ) : (
          <>
            {/* Kalimat menyebut AKIBATNYA, bukan hanya keadaannya. "Belum
                berkoordinat" saja tidak memberi tahu admin bahwa sesi yang
                lahir dari sini akan menuntut jenjang transport ditetapkan
                tangan belakangan. */}
            <p className="mt-2 rounded-lg bg-clay/10 px-3 py-2 text-[12px] font-semibold text-clay">
              Alamat ini belum berkoordinat. Jarak ke bidan tidak bisa dihitung, dan sesi yang lahir
              darinya tidak akan punya jenjang transport.
            </p>
            <FormPinPermintaan
              permintaanId={permintaan.id}
              anak={
                <>
                  {/* `PemilihLokasi` membaca alamat lewat
                      `namedItem("alamat")` pada FORMULIR yang sama — tapi di
                      panel ini alamatnya cuma teks tampilan di atas, di luar
                      formulir. Tanpa medan tersembunyi ini, tombol "Cari
                      alamat di peta" selalu menganggap alamatnya kosong dan
                      menyalahkan admin ("Isi alamatnya lebih dulu.") padahal
                      alamatnya terlihat jelas dua baris di atas. JANGAN
                      dihapus sebagai "duplikat" — ia satu-satunya jalan
                      alamat itu sampai ke pencarian peta. */}
                  <input type="hidden" name="alamat" value={permintaan.alamat} />
                  <PemilihLokasi
                    awal={null}
                    kalimatKosong="Belum ada pin. Klik di peta untuk menandai lokasinya — tanpa pin, jarak ke bidan tetap tidak bisa dihitung."
                  />
                </>
              }
            />
          </>
        )}
        {/* Lisensi ODbL menuntut atribusi tampak di layar yang memakai
            hasilnya, bukan cukup di komentar kode. */}
        <p className="mt-1 text-[11px] text-panel-muted">
          Peta &amp; lokasi dari data © OpenStreetMap contributors.
        </p>
      </section>

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
