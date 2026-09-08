import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PanggungAuth } from "@/app/_auth/panggung";
import MasukPage, { metadata as metaMasuk } from "@/app/masuk/page";
import DaftarPage, { metadata as metaDaftar } from "@/app/daftar/page";
import LupaSandiPage, { metadata as metaLupa } from "@/app/lupa-sandi/page";
import AturSandiPage, { metadata as metaAtur } from "@/app/atur-sandi/page";
import PeriksaEmailPage, { metadata as metaPeriksa } from "@/app/periksa-email/page";
import AkunBelumTerhubungPage, {
  metadata as metaBelumTerhubung,
} from "@/app/akun-belum-terhubung/page";
import { APP_NAME } from "@/lib/constants";

describe("panggung auth", () => {
  it("menampilkan kalimat sisi kiri dan isi sisi kanan", () => {
    const m = renderToStaticMarkup(
      <PanggungAuth judul="Passport Anda menunggu." kalimat="Riwayat sesi.">
        <p>isi kanan</p>
      </PanggungAuth>,
    );
    expect(m).toContain("Passport Anda menunggu.");
    expect(m).toContain("isi kanan");
  });

  it("membawa logo PADMA di sisi gelap", () => {
    const m = renderToStaticMarkup(
      <PanggungAuth judul="X" kalimat="Y"><span /></PanggungAuth>,
    );
    expect(m).toContain("logo-padma.png");
  });
});

/**
 * ATURAN YANG DIDEKLARASIKAN `panggung.tsx` UNTUK SELURUH PEMAKAINYA.
 *
 * Kepala `src/app/_auth/panggung.tsx` menyatakan hierarki judulnya MENGIKAT
 * untuk semua halaman yang memakainya: `judul` panel kiri adalah satu-satunya
 * `<h1>` karena panel itu datang lebih dulu di DOM, sehingga judul apa pun di
 * kolom kanan wajib `<h2>` atau lebih rendah. Pembaca layar menuruni halaman
 * dari atas; kalau elemen pertama bukan pemegang tingkat tertinggi, urutannya
 * melompat mundur.
 *
 * Sampai berkas ini diperluas, aturan itu dinyatakan untuk enam halaman dan
 * diuji untuk NOL — `MasukPage` satu-satunya yang pernah dirender di sini, dan
 * ia pun tidak diperiksa hierarkinya. Aturan yang ditulis mengikat tetapi tidak
 * diuji adalah aturan yang berlaku sampai orang keenam lupa membacanya; pada
 * cabang ini lima halaman lahir sekaligus dan tiga di antaranya salah menebak
 * hal serupa (nama brand pada judul tab).
 */
const HALAMAN = [
  { rute: "/masuk", Komponen: MasukPage, metadata: metaMasuk },
  { rute: "/daftar", Komponen: DaftarPage, metadata: metaDaftar },
  { rute: "/lupa-sandi", Komponen: LupaSandiPage, metadata: metaLupa },
  { rute: "/atur-sandi", Komponen: AturSandiPage, metadata: metaAtur },
  { rute: "/periksa-email", Komponen: PeriksaEmailPage, metadata: metaPeriksa },
  {
    rute: "/akun-belum-terhubung",
    Komponen: AkunBelumTerhubungPage,
    metadata: metaBelumTerhubung,
  },
] as const;

describe.each(HALAMAN)("halaman auth $rute", ({ rute, Komponen, metadata }) => {
  const m = renderToStaticMarkup(<Komponen />);

  it("memakai panggung yang sama (logo di panel gelap)", () => {
    expect(m).toContain("logo-padma.png");
  });

  it("punya TEPAT SATU <h1>, dan ia milik panel kiri", () => {
    const h1 = [...m.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)];
    expect(h1.length, `${rute} harus punya tepat satu <h1>`).toBe(1);
    // Panel kiri dirender lebih dulu, jadi h1-nya wajib mendahului kolom kanan.
    // Diikat ke posisi logo — elemen pertama panel kiri — bukan ke teksnya,
    // supaya kalimat panggung boleh berubah tanpa memerahkan perkara ini.
    expect(m.indexOf("logo-padma.png")).toBeLessThan(m.indexOf("<h1"));
    expect(h1[0][1].trim().length, `<h1> ${rute} tidak boleh kosong`).toBeGreaterThan(0);
  });

  it("judul di kolom kanan turun ke <h2>, tidak pernah <h1> kedua", () => {
    const h2 = [...m.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)];
    expect(h2.length, `${rute} kehilangan judul <h2> kolom kanannya`).toBeGreaterThanOrEqual(1);
    // Seluruh h2 berada SESUDAH h1 — bukan sekadar ada di halaman.
    for (const cocok of h2) {
      expect(m.indexOf(cocok[0])).toBeGreaterThan(m.indexOf("<h1"));
    }
  });

  it("judul tab tidak menempelkan nama brand (template sudah)", () => {
    const judul = metadata.title as string;
    expect(judul, `${rute} tidak mendeklarasikan title`).toBeTypeOf("string");
    expect(judul.toLowerCase()).not.toContain(APP_NAME.toLowerCase());
    expect(judul.length).toBeGreaterThan(0);
  });
});

describe("halaman /masuk", () => {
  const m = renderToStaticMarkup(<MasukPage />);

  // PAGAR E2E: tests/e2e/access-matrix.e2e.ts mengisi formulir ini lewat
  // getByLabel("Email"), getByLabel("Kata sandi"), dan tombol persis "Masuk".
  // Mengganti ketiga nama itu memerahkan matriks akses tanpa menyentuh satu
  // pun test unit — jadi pagarnya dipasang di sini.
  //
  // Regex-nya berjangkar pada strukturnya, bukan sekadar isi teks di suatu
  // tempat di halaman: getByLabel butuh input yang benar-benar terbungkus
  // <label> bersama teksnya (toContain("Email") tetap hijau meski input-nya
  // dilepas dari <label>-nya — kegagalan yang justru harus ditangkap di
  // sini), dan tombol "Masuk" harus persis elemen <button>, bukan cuma teks
  // ">Masuk<" yang bisa nyasar ke elemen lain. Repo ini tidak punya
  // @testing-library, jadi regex berjangkar adalah proksi berbiaya rendah.
  it("mempertahankan label yang dipakai skrip E2E", () => {
    expect(m).toMatch(/<label[^>]*>\s*<span[^>]*>Email<\/span>\s*<input/);
    expect(m).toMatch(/<label[^>]*>\s*<span[^>]*>Kata sandi<\/span>\s*<input/);
    expect(m).toMatch(/<button[^>]*>Masuk<\/button>/);
  });

  it("menawarkan daftar dan lupa sandi", () => {
    expect(m).toContain('href="/daftar"');
    expect(m).toContain('href="/lupa-sandi"');
  });

  /**
   * PINTU KE /periksa-email — satu-satunya yang ada bagi orang yang sudah
   * mendaftar tetapi belum membuka tautan konfirmasinya.
   *
   * Sejak `enable_confirmations = true`, login atas akun yang belum
   * dikonfirmasi memulangkan `email_not_confirmed` tanpa sesi, dan yang dibaca
   * pemakainya cuma "Email atau kata sandi salah". Tanpa tautan ini,
   * /periksa-email hanya bisa dicapai lewat pengalihan sesudah pendaftaran —
   * jalan yang tidak bisa diulang orang yang sudah menutup tabnya.
   */
  it("menautkan /periksa-email TANPA SYARAT (bukan hanya saat galat tertentu)", () => {
    expect(m).toContain('href="/periksa-email"');
    // Tautannya dirender pada keadaan AWAL formulir — belum ada galat sama
    // sekali. Kalau kelak ia dipindahkan ke balik cabang galat, markup awal
    // ini kehilangan tautannya dan perkara ini merah. Itulah gunanya: cabang
    // seperti itu akan menjadikan halaman login alat menghitung siapa saja
    // klien PADMA (bandingkan K6 pada /lupa-sandi).
    expect(m).not.toContain("Email atau kata sandi salah");
  });
});
