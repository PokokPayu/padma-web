"use client";

import { useState, useTransition } from "react";
import { jadwalkanSesi } from "./aksi";
import { JENJANG_SAH, LABEL_JENJANG } from "./status";
import { saranJenjang } from "@/lib/transport/saran";
import type { VarianPilihan } from "@/lib/admin/katalog-admin";

// `alamatLat`/`alamatLon` adalah alamat DEFAULT klien (Task 6/T7 spec),
// dipakai sebagai perkiraan lokasi sesi baru — jalur ini sendiri tidak
// mengumpulkan alamat khusus sesi, jadi ini satu-satunya sisi koordinat yang
// tersedia untuk saran jenjang saat menjadwalkan langsung.
export type PilihanKlien = {
  id: string;
  nama: string;
  padmaId: string;
  alamatLat: number | null;
  alamatLon: number | null;
};
export type PilihanSederhana = { id: string; nama: string };
// Domisili mitra (Task 7) — sisi lain jarak garis lurus terhadap alamat
// default klien di atas.
export type PilihanMitra = { id: string; nama: string; lat: number | null; lon: number | null };

const KELAS_MEDAN =
  "mt-1 min-h-[42px] w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-[13.5px]";
const KELAS_LABEL = "block text-[12.5px] font-bold text-ink-soft";

/**
 * Formulir "Jadwalkan sesi" — jalur langsung, tanpa antrean permintaan.
 *
 * Sengaja dimulai TERTUTUP, mengikuti `FormKlienBaru`. Alasannya bukan sekadar
 * kerapian: layar pertama modul ini adalah DAFTAR sesi dan antrean permintaan
 * yang menunggu jawaban. Formulir yang selalu terbuka mendorong admin membuat
 * jadwal baru untuk permintaan yang sebenarnya tinggal dikonfirmasi — dan sesi
 * hasil jalur itu kehilangan tautan ke permintaan asalnya.
 *
 * Yang tidak ada di sini juga penting: tidak ada medan status (sesi selalu
 * lahir `terjadwal`) dan tidak ada medan paket bebas. Centang paket hanyalah
 * pertanyaan ya/tidak; paket mana yang dipakai ditentukan server dari klien
 * yang dipilih.
 */
export function FormJadwalSesi({
  klien,
  layanan,
  varian,
  mitra,
  tanggalAwal,
}: {
  klien: PilihanKlien[];
  layanan: PilihanSederhana[];
  // Varian AKTIF seluruh layanan, disaring per layanan terpilih di klien —
  // pola yang sama dengan wizard klien `/passport/ajukan`.
  varian: VarianPilihan[];
  mitra: PilihanMitra[];
  tanggalAwal: string;
}) {
  const [terbuka, setTerbuka] = useState(false);
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);
  const [berhasil, setBerhasil] = useState(false);
  const [serviceId, setServiceId] = useState(layanan[0]?.id ?? "");
  const varianLayanan = varian.filter((v) => v.serviceId === serviceId);
  const [variantId, setVariantId] = useState(varianLayanan[0]?.id ?? "");
  const [clientId, setClientId] = useState(klien[0]?.id ?? "");
  const [partnerId, setPartnerId] = useState(mitra[0]?.id ?? "");

  // Saran jenjang — PERKIRAAN untuk membantu admin memilih mitra terdekat,
  // dihitung dari alamat DEFAULT klien (bukan alamat sesi ini sendiri, yang
  // memang belum ada sampai sesinya tersimpan). `saranJenjang()` memulangkan
  // `null` bila salah satu koordinat kosong, dan itu bukan galat (spec T4,
  // T6): saran sekadar tidak muncul, pemilih jenjang di bawah tetap ada.
  const klienTerpilih = klien.find((k) => k.id === clientId);
  const mitraTerpilih = mitra.find((m) => m.id === partnerId);
  const koordinatKlien =
    klienTerpilih?.alamatLat != null && klienTerpilih?.alamatLon != null
      ? { lat: klienTerpilih.alamatLat, lon: klienTerpilih.alamatLon }
      : null;
  const koordinatMitra =
    mitraTerpilih?.lat != null && mitraTerpilih?.lon != null
      ? { lat: mitraTerpilih.lat, lon: mitraTerpilih.lon }
      : null;
  const saran = saranJenjang(koordinatMitra, koordinatKlien);

  if (!terbuka) {
    return (
      <div className="text-right">
        <button
          type="button"
          onClick={() => {
            setPesan(null);
            setBerhasil(false);
            setTerbuka(true);
          }}
          className="rounded-xl bg-night px-4 py-2.5 text-[13px] font-bold text-gold-pale"
        >
          + Jadwalkan sesi
        </button>
        {/* Konfirmasi ditampilkan SESUDAH formulir ditutup — kalau ditaruh di
            dalam formulir, ia ikut hilang bersama formulirnya dan admin tidak
            pernah melihat bahwa jadwalnya tersimpan. */}
        {berhasil && (
          <p className="mt-2 text-[12.5px] text-leaf">Jadwal sesi tersimpan.</p>
        )}
      </div>
    );
  }

  const kosong =
    klien.length === 0 || layanan.length === 0 || varian.length === 0 || mitra.length === 0;

  return (
    <form
      action={(fd) =>
        mulai(async () => {
          const r = await jadwalkanSesi(fd);
          if (r.ok) {
            setBerhasil(true);
            setPesan(null);
            setTerbuka(false);
          } else {
            setPesan(r.pesan);
          }
        })
      }
      className="w-full rounded-2xl border-[1.5px] border-dashed border-gold bg-[#FDFAF1] p-4"
    >
      <h2 className="mb-3 text-[13.5px] font-extrabold text-ink">
        Jadwalkan sesi baru — sesi langsung tampil di Passport klien
      </h2>

      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className={KELAS_LABEL}>Klien</span>
          <select
            name="client_id"
            required
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className={KELAS_MEDAN}
          >
            {klien.map((k) => (
              <option key={k.id} value={k.id}>
                {k.nama} ({k.padmaId})
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={KELAS_LABEL}>Layanan</span>
          <select
            name="service_id"
            required
            value={serviceId}
            onChange={(e) => {
              const id = e.target.value;
              setServiceId(id);
              // Varian terpilih ikut direset ke pilihan pertama layanan baru
              // — FK gabungan bakal menolak kombinasi lama, dan pesan itu
              // sebaiknya tidak pernah lahir dari kombinasi yang tidak pernah
              // dimaksud admin sendiri.
              setVariantId(varian.find((v) => v.serviceId === id)?.id ?? "");
            }}
            className={KELAS_MEDAN}
          >
            {layanan.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nama}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={KELAS_LABEL}>Varian</span>
          <select
            name="variant_id"
            required
            value={variantId}
            onChange={(e) => setVariantId(e.target.value)}
            disabled={varianLayanan.length === 0}
            className={KELAS_MEDAN}
          >
            {varianLayanan.map((v) => (
              <option key={v.id} value={v.id}>
                {v.nama}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={KELAS_LABEL}>Tanggal</span>
          <input
            name="tanggal"
            type="date"
            required
            defaultValue={tanggalAwal}
            className={KELAS_MEDAN}
          />
        </label>
        <label>
          <span className={KELAS_LABEL}>Mitra</span>
          <select
            name="partner_id"
            required
            value={partnerId}
            onChange={(e) => setPartnerId(e.target.value)}
            className={KELAS_MEDAN}
          >
            {mitra.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nama}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Tiga hal berdampingan saat mitra dipilih (spec §5.2): jarak garis
          lurus, jenjang yang disarankan, dan pemilih jenjang. INFORMASI SAJA
          — jenjang sesi yang sebenarnya baru ditetapkan lewat `tetapkanJenjang`
          setelah sesinya ada (sesi baru ini belum punya alamat sendiri).
          Nol rupiah di blok ini: admin melihat "5–10 km", tidak pernah harga. */}
      <div className="mt-3 rounded-xl border border-black/10 bg-paper px-3 py-2.5 text-[12.5px] text-ink-soft">
        <span className="block font-bold text-ink">Perkiraan jarak ke mitra</span>
        {saran ? (
          <span className="mt-0.5 block">
            Jarak garis lurus dari alamat klien ke mitra: <b>{saran.jarakKm.toFixed(1)} km</b> —
            saran jenjang <b>{LABEL_JENJANG[saran.jenjang]}</b>. Ini jarak GARIS LURUS, bukan jarak
            jalan — nilai sesungguhnya bisa lebih jauh (mis. memutar sungai atau jalan searah).
          </span>
        ) : (
          <span className="mt-0.5 block">
            Jarak tidak bisa diperkirakan — alamat klien atau domisili mitra belum punya koordinat.
            Pilih jenjang secara manual bila sudah tahu perkiraannya.
          </span>
        )}
        <label className="mt-2 block">
          <span className={KELAS_LABEL}>Jenjang transport (perkiraan)</span>
          <select
            key={saran?.jenjang ?? "tanpa-saran"}
            defaultValue={saran?.jenjang ?? JENJANG_SAH[0]}
            className={KELAS_MEDAN}
          >
            {JENJANG_SAH.map((j) => (
              <option key={j} value={j}>
                {LABEL_JENJANG[j]}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[11.5px] italic text-ink-soft">
            Perkiraan untuk membantu memilih mitra — jenjang sesi ini sendiri baru dicatat resmi
            sesudah sesinya tersimpan dan alamatnya diketahui.
          </span>
        </label>
      </div>

      <label className="mt-3 flex items-start gap-2 text-[12.5px] text-ink">
        <input name="pakai_paket" type="checkbox" className="mt-0.5" />
        <span>
          Hitung ke paket aktif klien (bila ada). Paketnya ditentukan dari klien
          yang dipilih — sesi lepas bila klien itu belum punya paket berjalan.
        </span>
      </label>

      {kosong && (
        <p className="mt-3 text-[12.5px] font-semibold text-clay">
          Klien, layanan (dengan varian), dan mitra aktif harus ada dulu
          sebelum sesi bisa dijadwalkan.
        </p>
      )}
      {pesan && <p className="mt-3 text-[13px] font-semibold text-clay">{pesan}</p>}

      <div className="mt-4 flex gap-2.5">
        <button
          type="submit"
          disabled={pending || kosong}
          className="rounded-xl bg-night px-4 py-2.5 text-[13px] font-bold text-gold-pale disabled:opacity-60"
        >
          {pending ? "Menyimpan…" : "Simpan jadwal"}
        </button>
        <button
          type="button"
          onClick={() => {
            setTerbuka(false);
            setPesan(null);
          }}
          className="rounded-xl border border-black/15 px-4 py-2.5 text-[13px] font-bold text-ink-soft"
        >
          Batal
        </button>
      </div>
    </form>
  );
}
