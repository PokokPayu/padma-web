"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import type { Map as PetaLeaflet, Marker as MarkerLeaflet } from "leaflet";

/**
 * Pemilih koordinat di peta, untuk formulir alamat panel staf.
 *
 * Kenapa ini ada: pengukuran 7 September 2026 menunjukkan 26 dari 32 alamat
 * berbentuk Malang GAGAL digeocoding, dan yang berhasil pun membuang nomor
 * rumahnya — "Jl. Veteran No. 8" dan "Jl. Veteran" memulangkan koordinat yang
 * identik. Angka yang menentukan uang karena itu tidak boleh berasal dari
 * tebakan. Di sini ada manusia yang melihat titiknya dan membenarkannya.
 *
 * Geocoding TIDAK dihapus — ia turun pangkat menjadi penggeser peta. Gagal pun
 * tidak apa-apa: orangnya tinggal menggeser sendiri.
 *
 * Komponen ini TIDAK PERNAH dipakai di layar klien. Tombol "gunakan lokasi
 * saat ini" aman di tangan staf yang sedang di lokasi, tetapi ditekan klien
 * yang sedang tidak di rumah ia menyimpan lokasi yang salah TANPA penanda apa
 * pun — dan terlihat disengaja. Kegagalan geocoding setidaknya berisik; itu
 * diam.
 */

/** Satu-satunya tempat sumber ubin ditulis (spec Keputusan 4). */
const URL_UBIN = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

/** Kewajiban lisensi ODbL, bukan pilihan desain. */
const ATRIBUSI_OSM = "© OpenStreetMap contributors";

/** Alun-Alun Malang — titik awal peta ketika belum ada apa pun untuk dituju. */
const PUSAT_AWAL: [number, number] = [-7.9825, 112.6304];
const ZOOM_KOTA = 13;
const ZOOM_TITIK = 17;

/**
 * Penanda pin sebagai `divIcon`, bukan ikon bawaan Leaflet: ikon bawaan memuat
 * berkas PNG lewat URL relatif yang pecah di bawah bundler mana pun, dan
 * pecahnya SENYAP — penandanya menjadi tak terlihat, bukan melempar error.
 */
const HTML_PIN =
  '<span style="display:block;width:18px;height:18px;border-radius:9999px;background:#B08D57;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></span>';

type Titik = { lat: number; lon: number };

/** Kalimat lama, benar untuk keempat formulir mitra/klien: pin kosong di
 * sana masih jatuh ke geocoding server-side, jadi "diperkirakan otomatis"
 * bukan bualan. */
const KALIMAT_KOSONG_BAWAAN =
  "Belum ada pin. Tanpa pin, lokasi diperkirakan otomatis dari teks alamat.";

export function PemilihLokasi({
  awal = null,
  kalimatKosong = KALIMAT_KOSONG_BAWAAN,
}: {
  awal?: Titik | null;
  /** Teks saat belum ada pin. Boleh dioper beda oleh pemanggil yang, tidak
   * seperti mitra/klien, TIDAK jatuh ke geocoding otomatis bila pin dibiarkan
   * kosong — lihat panel permintaan. */
  kalimatKosong?: string;
}) {
  const wadah = useRef<HTMLDivElement | null>(null);
  const peta = useRef<PetaLeaflet | null>(null);
  const penanda = useRef<MarkerLeaflet | null>(null);
  const medanLat = useRef<HTMLInputElement | null>(null);

  const [koordinat, setKoordinat] = useState<Titik | null>(awal);
  const [status, setStatus] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);

  useEffect(() => {
    if (!wadah.current || peta.current) return;
    let dibatalkan = false;

    // Leaflet menyentuh `window` saat dimuat, jadi ia diimpor DI DALAM efek —
    // bukan di puncak berkas — supaya render server tidak pernah menjalankannya.
    void import("leaflet").then((L) => {
      if (dibatalkan || !wadah.current || peta.current) return;

      const p = L.map(wadah.current).setView(
        awal ? [awal.lat, awal.lon] : PUSAT_AWAL,
        awal ? ZOOM_TITIK : ZOOM_KOTA,
      );
      L.tileLayer(URL_UBIN, { maxZoom: 19, attribution: ATRIBUSI_OSM }).addTo(p);

      const ikon = L.divIcon({
        className: "",
        html: HTML_PIN,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });

      const pasang = (lat: number, lon: number) => {
        if (penanda.current) {
          penanda.current.setLatLng([lat, lon]);
          return;
        }
        penanda.current = L.marker([lat, lon], { draggable: true, icon: ikon }).addTo(p);
        penanda.current.on("dragend", (e) => {
          const t = (e.target as MarkerLeaflet).getLatLng();
          setKoordinat({ lat: t.lat, lon: t.lng });
          setStatus("Pin dipindahkan.");
        });
      };

      if (awal) pasang(awal.lat, awal.lon);

      p.on("click", (e) => {
        pasang(e.latlng.lat, e.latlng.lng);
        setKoordinat({ lat: e.latlng.lat, lon: e.latlng.lng });
        setStatus("Pin dijatuhkan. Geser untuk menyesuaikan.");
      });

      // Disimpan TERAKHIR: `peta.current` adalah penjaga "sudah dibangun" di
      // puncak efek ini, jadi mengisinya lebih awal membuat efek yang berjalan
      // dua kali (StrictMode dev) melihat peta yang belum berpenanda.
      peta.current = p;
    });

    return () => {
      dibatalkan = true;
      peta.current?.remove();
      peta.current = null;
      penanda.current = null;
    };
  }, [awal]);

  /** Menggeser peta & pin ke koordinat baru, tanpa membuat ulang petanya. */
  async function pindahkan(lat: number, lon: number) {
    setKoordinat({ lat, lon });
    const p = peta.current;
    if (!p) return;
    p.setView([lat, lon], ZOOM_TITIK);

    if (penanda.current) {
      penanda.current.setLatLng([lat, lon]);
      return;
    }
    const L = await import("leaflet");
    const ikon = L.divIcon({
      className: "",
      html: HTML_PIN,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });
    penanda.current = L.marker([lat, lon], { draggable: true, icon: ikon }).addTo(p);
    penanda.current.on("dragend", (e) => {
      const t = (e.target as MarkerLeaflet).getLatLng();
      setKoordinat({ lat: t.lat, lon: t.lng });
      setStatus("Pin dipindahkan.");
    });
  }

  /**
   * Membaca medan `alamat` dari FORMULIR YANG SAMA lewat DOM.
   *
   * Seluruh formulir panel ini tak terkendali (`name=`, tanpa state), jadi
   * mengangkat nilai alamat menjadi state React hanya demi tombol ini akan
   * menular ke empat formulir sekaligus. `input.form` memberi jalan langsung.
   */
  function alamatSaatIni(): string {
    const medan = medanLat.current?.form?.elements.namedItem("alamat");
    // `namedItem` bisa memulangkan RadioNodeList bila ada dua medan bernama
    // sama, jadi tipenya dipersempit lewat `instanceof` — bukan di-cast paksa.
    // Alamat hidup sebagai <textarea> di keempat formulir, tapi <input>
    // diterima juga supaya komponen ini tidak pecah kalau bentuknya berubah.
    if (medan instanceof HTMLTextAreaElement || medan instanceof HTMLInputElement) {
      return medan.value.trim();
    }
    return "";
  }

  async function cariAlamat() {
    const alamat = alamatSaatIni();
    if (alamat === "") {
      setStatus("Isi alamatnya lebih dulu.");
      return;
    }
    setSibuk(true);
    setStatus("Mencari…");
    try {
      const jawaban = await fetch("/api/geocode", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ alamat }),
      });
      const isi = (await jawaban.json()) as { koordinat: Titik | null };
      if (!isi.koordinat) {
        // Bukan kegagalan yang menghentikan apa pun: alamat Malang memang
        // sering tidak dikenal peta. Petanya tetap bisa diklik.
        setStatus("Tidak ketemu di peta. Klik langsung di peta untuk menandai lokasinya.");
        return;
      }
      await pindahkan(isi.koordinat.lat, isi.koordinat.lon);
      setStatus("Ketemu. PERIKSA posisi pin — nomor rumah sering diabaikan peta.");
    } catch {
      setStatus("Gagal mencari. Klik langsung di peta untuk menandai lokasinya.");
    } finally {
      setSibuk(false);
    }
  }

  function lokasiSaatIni() {
    if (!navigator.geolocation) {
      setStatus("Peramban ini tidak mendukung deteksi lokasi.");
      return;
    }
    setSibuk(true);
    setStatus("Mengambil lokasi…");
    navigator.geolocation.getCurrentPosition(
      (posisi) => {
        void pindahkan(posisi.coords.latitude, posisi.coords.longitude);
        setStatus("Lokasi perangkat ini dipakai. Pastikan Anda memang sedang di lokasinya.");
        setSibuk(false);
      },
      () => {
        setStatus("Gagal mengambil lokasi. Klik langsung di peta.");
        setSibuk(false);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  }

  const KELAS_TOMBOL =
    "rounded-lg border border-black/15 bg-white px-3 py-1.5 text-[12px] font-bold text-ink disabled:opacity-60";

  return (
    <div className="mt-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={cariAlamat} disabled={sibuk} className={KELAS_TOMBOL}>
          Cari alamat di peta
        </button>
        <button type="button" onClick={lokasiSaatIni} disabled={sibuk} className={KELAS_TOMBOL}>
          Gunakan lokasi saat ini
        </button>
      </div>

      <div
        ref={wadah}
        className="mt-2 h-[300px] w-full overflow-hidden rounded-xl border border-black/10"
      />

      {/* Nilai yang benar-benar tersimpan. Kosong bila belum ada pin —
          `koordinatDariFormData` menolak medan kosong, sehingga formulir yang
          petanya tidak disentuh jatuh ke jalur geocoding lama. */}
      <input ref={medanLat} type="hidden" name="lat" value={koordinat?.lat ?? ""} readOnly />
      <input type="hidden" name="lon" value={koordinat?.lon ?? ""} readOnly />

      <p className="mt-1 text-[11px] text-ink-soft/70">
        {koordinat
          ? `Pin: ${koordinat.lat.toFixed(6)}, ${koordinat.lon.toFixed(6)}`
          : kalimatKosong}
      </p>
      {status && <p className="mt-1 text-[11px] text-ink-soft">{status}</p>}
      <p className="mt-1 block text-[11px] text-ink-soft/70">
        Peta &amp; lokasi dari data © OpenStreetMap contributors.
      </p>
    </div>
  );
}
