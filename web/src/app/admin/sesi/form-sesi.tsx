"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PAKET_TAMPIL } from "@/lib/paket-tampil";
import { jadwalkanSesi } from "./aksi";
import { JENJANG_SAH } from "./status";
import { saranJenjang } from "@/lib/transport/saran";
import { LABEL_JENJANG } from "@/lib/transport/jarak";
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
  "mt-1 min-h-[42px] w-full rounded-lg border border-panel-border bg-panel-surface px-3 py-2 text-[13.5px] text-panel-ink";
const KELAS_LABEL = "block text-[12.5px] font-bold text-panel-muted";

/**
 * Formulir "Jadwalkan sesi" — jalur langsung, tanpa antrean permintaan.
 *
 * Sejak Task 3 (bilah daftar & panel geser) formulir ini tidak lagi punya
 * gerbang buka/tutup sendiri: URL (`?ubah=baru`) yang memutuskan apakah
 * `PanelGeser` — dan karena itu formulir ini — dirender sama sekali. Gerbang
 * kedua di dalam panel yang sudah menjadi gerbangnya sendiri hanya berarti
 * admin mengeklik "+ Sesi baru", panel terbuka, dan isinya masih sebuah
 * tombol.
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
  hrefTutup,
}: {
  klien: PilihanKlien[];
  layanan: PilihanSederhana[];
  // Varian AKTIF seluruh layanan, disaring per layanan terpilih di klien —
  // pola yang sama dengan wizard klien `/passport/ajukan`.
  varian: VarianPilihan[];
  mitra: PilihanMitra[];
  tanggalAwal: string;
  /** Alamat halaman TANPA `?ubah` — ke sinilah sukses & "Batal" menuju. */
  hrefTutup: string;
}) {
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);
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

  // "" berarti "ikuti saran" — pilihan admin sendiri hanya dianggap ada
  // sesudah `onChange` benar-benar tersentuh. Direset ke "" tiap kali klien
  // atau mitra berganti, supaya pilihan manual pada pasangan klien/mitra
  // SEBELUMNYA tidak diam-diam ikut terbawa ke pasangan yang baru dipilih.
  // Disesuaikan SELAMA render (pola "Adjusting state when a prop changes"
  // dari dokumentasi React), bukan lewat `useEffect`, supaya nilai lama tidak
  // sempat terlihat sekejap sebelum efeknya berjalan.
  const [jenjangPilihan, setJenjangPilihan] = useState("");
  const [pasanganSebelumnya, setPasanganSebelumnya] = useState([clientId, partnerId]);
  if (pasanganSebelumnya[0] !== clientId || pasanganSebelumnya[1] !== partnerId) {
    setPasanganSebelumnya([clientId, partnerId]);
    setJenjangPilihan("");
  }
  const nilaiJenjang = jenjangPilihan || saran?.jenjang || JENJANG_SAH[0];
  // Alasan hanya diwajibkan (dan hanya DIKIRIM sebagai penimpaan) ketika ada
  // saran DAN pilihan admin berbeda darinya. Tanpa saran, `jadwalkanSesi`
  // sendiri yang menjamin jenjang tidak pernah ditulis dari pemilih ini
  // (lihat komentar di aksi.ts) — kotak alasan tidak perlu tampil sama sekali.
  const menimpaSaran = saran !== null && nilaiJenjang !== saran.jenjang;

  const kosong =
    klien.length === 0 || layanan.length === 0 || varian.length === 0 || mitra.length === 0;

  return (
    <form
      action={(fd) =>
        mulai(async () => {
          const r = await jadwalkanSesi(fd);
          if (r.ok) {
            setPesan(null);
            // Menutup panel DENGAN kembali ke daftar yang sama — cari,
            // saringan, dan halaman ikut, jadi admin melanjutkan dari tempat
            // ia berhenti.
            router.push(hrefTutup);
          } else {
            setPesan(r.pesan);
          }
        })
      }
      className="grid gap-3"
    >
      <div className="grid gap-3">
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
          lurus, jenjang yang disarankan, dan pemilih jenjang. `jadwalkanSesi`
          menyimpan jenjang ini BERSAMA barisnya: mengikuti saran menjadi
          `jenjang_sumber = 'otomatis'`, menimpanya (dengan alasan) menjadi
          `'admin'` — server yang memutuskan mana dari keduanya dengan
          menghitung ulang sarannya sendiri, bukan mempercayai klaim formulir.
          Bila `saranJenjang()` memulangkan `null`, saran tidak muncul dan
          pemilih tetap ada — TANPA pesan galat — tapi jenjangnya sendiri
          tidak akan tersimpan (lihat komentar di aksi.ts): pemilih di sini
          hanyalah perkiraan tanpa dasar untuk dibandingkan.
          Nol rupiah di blok ini: admin melihat "5–10 km", tidak pernah harga. */}
      <div className="rounded-lg border border-panel-border bg-panel-bg px-3 py-2.5 text-[12.5px] text-panel-muted">
        <span className="block font-bold text-panel-ink">Perkiraan jarak ke mitra</span>
        {/* Jarak di atas dihitung dari koordinat hasil geocoding Nominatim
            (OSM) — lisensi ODbL mewajibkan atribusi tampak persis di layar
            yang menampilkan hasilnya, bukan cukup di komentar kode. */}
        <span className="block text-[10.5px] text-panel-muted">
          Jarak dihitung dari data lokasi © OpenStreetMap contributors.
        </span>
        {saran ? (
          <span className="mt-0.5 block">
            Jarak garis lurus dari alamat klien ke mitra: <b>{saran.jarakKm.toFixed(1)} km</b> —
            saran jenjang <b>{LABEL_JENJANG[saran.jenjang]}</b>. Ini jarak GARIS LURUS, bukan jarak
            jalan — nilai sesungguhnya bisa lebih jauh (mis. memutar sungai atau jalan searah).
          </span>
        ) : (
          <span className="mt-0.5 block">
            Jarak tidak bisa diperkirakan — alamat klien atau domisili mitra belum punya koordinat.
            Jenjang sesi ini belum akan tersimpan; tetapkan belakangan dari daftar sesi.
          </span>
        )}
        <label className="mt-2 block">
          <span className={KELAS_LABEL}>Jenjang transport</span>
          <select
            name="jenjang"
            value={nilaiJenjang}
            onChange={(e) => setJenjangPilihan(e.target.value)}
            className={KELAS_MEDAN}
          >
            {JENJANG_SAH.map((j) => (
              <option key={j} value={j}>
                {LABEL_JENJANG[j]}
              </option>
            ))}
          </select>
        </label>
        {menimpaSaran && (
          <label className="mt-2 block">
            <span className={KELAS_LABEL}>Alasan berbeda dari saran (wajib)</span>
            <textarea
              name="alasan"
              rows={2}
              required
              placeholder="Mis. alamat di seberang sungai, memutar jauh…"
              className={KELAS_MEDAN}
            />
          </label>
        )}
      </div>

      {/* GERBANG SAKLAR (K11): checkbox dicabut sepenuhnya dari layar, bukan
          disembunyikan lewat CSS — namanya (`pakai_paket`) tidak boleh
          sampai ke formData sama sekali selagi saklar mati. `jadwalkanSesi`
          (aksi.ts) sendiri tidak disentuh: field yang tidak pernah dikirim
          form dibaca sebagai "tidak dicentang", persis seperti checkbox
          biasa yang kosong. Gerbangnya dipertahankan saat merge; isinya
          memakai token panel staf & tata letak dari sapuan panel. */}
      {PAKET_TAMPIL && (
        <label className="flex items-start gap-2 text-[12.5px] text-panel-ink">
          <input name="pakai_paket" type="checkbox" className="mt-0.5" />
          <span>
            Hitung ke paket aktif klien (bila ada). Paketnya ditentukan dari klien
            yang dipilih — sesi lepas bila klien itu belum punya paket berjalan.
          </span>
        </label>
      )}

      {kosong && (
        <p className="text-[12.5px] font-semibold text-clay">
          Klien, layanan (dengan varian), dan mitra aktif harus ada dulu
          sebelum sesi bisa dijadwalkan.
        </p>
      )}
      {pesan && <p className="text-[13px] font-semibold text-clay">{pesan}</p>}

      <div className="flex gap-2.5">
        <button
          type="submit"
          disabled={pending || kosong}
          className="rounded-lg bg-panel-ink px-4 py-2.5 text-[13px] font-bold text-panel-surface disabled:opacity-60"
        >
          {pending ? "Menyimpan…" : "Simpan jadwal"}
        </button>
        <a
          href={hrefTutup}
          className="rounded-lg border border-panel-border bg-panel-surface px-4 py-2.5 text-[13px] font-bold text-panel-muted"
        >
          Batal
        </a>
      </div>
    </form>
  );
}
