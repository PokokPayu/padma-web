/**
 * ATRIBUSI OpenStreetMap pada layar yang menampilkan hasil geocoding.
 *
 * Data Nominatim (OSM) dipakai untuk menyarankan jenjang transport dari
 * koordinat alamat klien dan domisili mitra (Task 1–9). Lisensi ODbL menuntut
 * ATRIBUSI TAMPIL DI LAYAR — kewajiban lisensi, bukan pilihan desain, dan
 * satu-satunya hal di seluruh rencana ini yang bukan soal teknis.
 *
 * Uji naif `readFileSync(berkas).toMatch(/OpenStreetMap/)` HIJAU walau kata
 * itu cuma hidup di sebuah KOMENTAR kode — dan atribusi di komentar tidak
 * pernah sampai ke mata siapa pun, jadi tidak memenuhi kewajiban apa pun.
 * Proyek ini sudah tiga kali tertipu tabrakan komentar vs regex struktural
 * (lihat riwayat Ruling di rencana Task 9/10); berkas ini sengaja menuntut
 * BUKTI SAMPAI KE LAYAR, dengan dua kelas bukti:
 *
 *  1. `FormEditKlien` (form-klien.tsx) dirender SUNGGUHAN lewat
 *     `renderToStaticMarkup` — komponen ini TIDAK bergerbang status buka/tutup
 *     (beda dari `FormKlienBaru`), jadi markup atribusinya langsung terlihat
 *     tanpa simulasi klik apa pun. Ini bukti terkuat: literal ada di DOM.
 *
 *  2. `FormJadwalSesi` (form-sesi.tsx), `FormMitra` (form-mitra.tsx), dan
 *     `SesiPage` (`app/admin/sesi/page.tsx`) jatuh ke PEMINDAIAN SUMBER
 *     seperti diizinkan Ruling 22, untuk TIGA alasan berbeda yang kebetulan
 *     berujung pada solusi yang sama:
 *       - `FormJadwalSesi` mulai TERTUTUP (`useState(false)`) — pola yang
 *         disengaja supaya admin tidak membuat baris ganda (lihat komentar
 *         di berkasnya). Rendernya statis (`renderToStaticMarkup`) tidak
 *         menjalankan efek atau event, sehingga tidak ada cara membuka
 *         formulirnya tanpa jsdom + testing-library — dua dependensi yang
 *         tidak ada di proyek ini dan bukan bagian tugas ini untuk
 *         ditambahkan hanya demi satu assertion.
 *       - `FormMitra` (sejak Task 7 — bilah daftar & panel geser) TIDAK LAGI
 *         bergerbang `useState(false)` sendiri: `page.tsx` yang memutuskan
 *         apakah `PanelGeser` dirender sama sekali, lewat URL (`?ubah=`).
 *         Ia tetap jatuh ke pemindaian sumber karena alasan LAIN:
 *         `FormMitra` memanggil `useRouter()` (untuk `router.push(hrefTutup)`
 *         sesudah submit berhasil), dan hook itu melempar di luar konteks
 *         App Router Next — `renderToStaticMarkup` polos tidak
 *         menyediakannya, beda dari `FormEditKlien` yang tidak memanggil
 *         hook navigasi apa pun (dibuktikan manual: merender `FormMitra`
 *         langsung tanpa mock router melempar galat, bukan markup).
 *       - `SesiPage` (Ruling — gelombang perbaikan akhir) SEBALIKNYA memuat
 *         atribusinya TIDAK bergerbang apa pun — ia tampil begitu halaman
 *         dimuat, sama seperti `FormEditKlien`. Ia jatuh ke pemindaian sumber
 *         murni karena alasan LAIN: komponen server async yang membaca
 *         `sessions`/`clients`/dst lewat Supabase, dan `renderToStaticMarkup`
 *         atasnya menuntut memalsukan seluruh rantai data (pola berat yang
 *         dipakai tests/admin-shell.test.ts, bukan untuk satu assertion
 *         atribusi). Baris "Jenjang: …" yang dirender `BarisSesi`
 *         (form-selesai.tsx) untuk SETIAP sesi adalah hasil geocoding yang
 *         dimaksud — atribusinya sendiri sengaja hidup SEKALI di `page.tsx`,
 *         di atas tabel, bukan diulang di tiap baris.
 *     Regexnya tetap menuntut atribusi berada di dalam TEKS JSX (di antara
 *     `>` dan `<`, sesudah komentar disingkirkan lebih dulu), bukan di
 *     komentar ataupun string sembarang, untuk KETIGA berkas itu.
 *     `tanpaKomentar()` di bawah membuktikan itu: memindahkan atribusi ke
 *     komentar membuat test ini MERAH (dibuktikan manual sebelum berkas ini
 *     dianggap selesai — lihat laporan Task 10).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

const TEKS_ATRIBUSI = "© OpenStreetMap contributors";

/**
 * Menyingkirkan SELURUH bentuk komentar JS/JSX dari sumber sebelum dipindai.
 * Tanpa ini, regex "atribusi di dalam JSX" tetap bisa lolos dari komentar
 * `{/* ... *\/}` yang kebetulan duduk di antara dua tag — persis tabrakan yang
 * membuat proyek ini tertipu tiga kali sebelumnya.
 */
function tanpaKomentar(kode: string): string {
  return kode
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "") // komentar JSX: {/* ... */}
    .replace(/\/\*[\s\S]*?\*\//g, "") // komentar blok biasa: /* ... */
    .replace(/\/\/.*$/gm, ""); // komentar baris: // ...
}

/** Atribusi wajib duduk sebagai TEKS JSX (di antara `>` dan `<`), bukan di
 * komentar atau di string yang tidak pernah dirender. */
function atribusiDalamJsx(kode: string): boolean {
  const bersih = tanpaKomentar(kode);
  if (!bersih.includes(TEKS_ATRIBUSI)) return false;
  return />[^<]*©\s*OpenStreetMap contributors[^<]*</.test(bersih);
}

describe("atribusi OpenStreetMap sampai ke layar", () => {
  // --- Kelas 1: render sungguhan (bukti terkuat) --------------------------

  it("form-klien.tsx — FormEditKlien merender atribusi di DOM, dekat medan alamat", async () => {
    const { FormEditKlien } = await import("@/app/admin/klien/form-klien");
    const markup = renderToStaticMarkup(
      createElement(FormEditKlien, {
        id: "id-uji",
        awal: { nama: "Ananda Uji", noHp: "0812", faseId: "prekonsepsi", alamat: "Jl. Uji" },
        fase: [{ id: "prekonsepsi", nama: "Prekonsepsi" }],
      }),
    );
    expect(markup).toContain(TEKS_ATRIBUSI);
    // Bukan sekadar ADA di halaman — harus duduk dekat medan alamat, bukan
    // nyasar di footer atau navigasi yang tidak terkait geocoding.
    const indeksAlamat = markup.indexOf("Alamat rumah klien");
    const indeksAtribusi = markup.indexOf(TEKS_ATRIBUSI);
    expect(indeksAlamat).toBeGreaterThanOrEqual(0);
    expect(indeksAtribusi).toBeGreaterThan(indeksAlamat);
    expect(indeksAtribusi - indeksAlamat).toBeLessThan(400);
  });

  // --- Kelas 2: pemindaian sumber, regex menuntut posisi JSX --------------
  //
  // Ketiga berkas di bawah jatuh ke pemindaian sumber untuk dua alasan
  // berbeda (rincian lengkap di komentar kepala berkas ini): `FormJadwalSesi`
  // mulai TERTUTUP (`useState(false)`) sehingga blok atribusinya tidak
  // pernah muncul di markup statis tanpa jsdom+testing-library (tidak ada
  // di proyek ini); `FormMitra` sudah TIDAK bergerbang begitu sejak Task 7
  // (page.tsx yang memutuskan lewat `?ubah=`), tapi memanggil `useRouter()`
  // yang melempar di luar konteks App Router Next saat dirender polos.
  // `SesiPage` punya alasan LAIN lagi, dijelaskan di bawahnya sendiri.
  // form-klien.tsx tetap dibuktikan lewat render sungguhan di atas karena
  // tidak satu pun dari kedua alasan ini berlaku untuknya.

  it.each([
    "src/app/admin/sesi/form-sesi.tsx",
    "src/app/admin/mitra/form-mitra.tsx",
    "src/app/admin/sesi/page.tsx",
  ])("%s — atribusi duduk di dalam TEKS JSX, bukan komentar", (berkas) => {
    const sumber = baca(berkas);
    expect(atribusiDalamJsx(sumber)).toBe(true);
  });

  it("berkas ketiga (form-klien.tsx) JUGA lolos pemindaian JSX yang sama — dua bukti independen", () => {
    // Uji render di atas sudah cukup, tapi baris ini menegaskan bahwa
    // atribusinya sendiri memang literal JSX, bukan hasil kebetulan dari
    // sesuatu yang di-generate saat render (mis. interpolasi tersembunyi).
    expect(atribusiDalamJsx(baca("src/app/admin/klien/form-klien.tsx"))).toBe(true);
  });

  it("TIDAK ada nominal uang menempel pada blok atribusi (money firewall)", () => {
    // Atribusi berdampingan dengan alamat/jarak, TIDAK PERNAH dengan rupiah —
    // /admin tidak menampilkan satu nominal transport pun.
    for (const berkas of [
      "src/app/admin/sesi/form-sesi.tsx",
      "src/app/admin/klien/form-klien.tsx",
      "src/app/admin/mitra/form-mitra.tsx",
      "src/app/admin/sesi/page.tsx",
    ]) {
      const sumber = tanpaKomentar(baca(berkas));
      const i = sumber.indexOf(TEKS_ATRIBUSI);
      expect(i, `${berkas} tidak memuat atribusi`).toBeGreaterThanOrEqual(0);
      const sekitar = sumber.slice(Math.max(0, i - 200), i + 200);
      expect(sekitar).not.toMatch(/Rp\s?\d/);
    }
  });
});
