/**
 * Halaman Syarat & Ketentuan dan Kebijakan Privasi (spec 2026-10-06) — MURNI.
 *
 * `bacaPengaturan` di-mock: nomor WA dan area dibaca dari pengaturan admin,
 * dan uji ini memastikan keduanya benar-benar sampai ke teks.
 *
 * Yang dijaga BUKAN gaya bahasanya, melainkan FAKTA yang wajib tertulis
 * (spec "isi wajib per bagian"): angka-angka kebijakan pembatalan klien, nama
 * setiap pemroses data, pengakuan data kesehatan sebagai data pribadi
 * spesifik — dan janji yang TIDAK boleh ada (backup).
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/settings", () => ({
  bacaPengaturan: async () => ({
    nomorWaLink: "6281234567890",
    nomorWaTampilan: "0812-3456-7890",
    alamatTampilan: "Melayani Malang Raya dan Batu",
    jamTampilan: "Senin–Sabtu 08.00–17.00",
  }),
}));

const { default: HalamanSK } = await import("@/app/syarat-ketentuan/page");
const { default: HalamanPrivasi } = await import("@/app/kebijakan-privasi/page");
const { BAGIAN_SK, BAGIAN_PRIVASI, JANGKAR_PERSETUJUAN } = await import("@/app/_dokumen/bagian");
const { FooterSitus } = await import("@/app/_situs/footer");
const { VERSI_DOKUMEN } = await import("@/lib/persetujuan/versi");
const { formatTanggalID } = await import("@/lib/passport/waktu");

const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

/** Markup → teks polos: tag dibuang, entitas yang di-escape React dikembalikan. */
function polos(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

const sk = renderToStaticMarkup(await HalamanSK());
const privasi = renderToStaticMarkup(await HalamanPrivasi());
const teksSK = polos(sk);
const teksPrivasi = polos(privasi);

describe("kedua halaman — kerangka", () => {
  it.each([
    ["S&K", () => teksSK],
    ["Privasi", () => teksPrivasi],
  ])("%s menampilkan tanggal berlaku dari VERSI_DOKUMEN", (_n, teks) => {
    expect(teks()).toContain(`Berlaku sejak ${formatTanggalID(VERSI_DOKUMEN)}`);
  });

  it.each([
    ["S&K", BAGIAN_SK, () => sk, () => teksSK],
    ["Privasi", BAGIAN_PRIVASI, () => privasi, () => teksPrivasi],
  ] as const)("%s: setiap bagian punya jangkar, judul bernomor, dan entri daftar isi", (_n, daftar, m, t) => {
    daftar.forEach((b, i) => {
      expect(m(), `id="${b.id}" hilang`).toContain(`id="${b.id}"`);
      expect(m(), `daftar isi #${b.id} hilang`).toContain(`href="#${b.id}"`);
      expect(t()).toContain(`${i + 1}. ${b.judul}`);
    });
  });

  it("setiap jangkar yang ditautkan layar persetujuan BENAR-BENAR ada", () => {
    for (const url of Object.values(JANGKAR_PERSETUJUAN)) {
      const [halaman, jangkar] = url.split("#");
      expect(halaman).toBe("/kebijakan-privasi");
      expect(privasi, `jangkar #${jangkar} tidak ada`).toContain(`id="${jangkar}"`);
    }
  });

  it("halaman publik: tidak memanggil requireRole dan tidak mengaktifkan item nav mana pun", () => {
    expect(baca("src/app/syarat-ketentuan/page.tsx")).not.toContain("requireRole");
    expect(baca("src/app/kebijakan-privasi/page.tsx")).not.toContain("requireRole");
    expect(sk).not.toContain('aria-current="page"');
    expect(privasi).not.toContain('aria-current="page"');
  });

  it("nomor WhatsApp kontak dibaca dari pengaturan, tidak ditulis keras", () => {
    for (const [m, t] of [[sk, teksSK], [privasi, teksPrivasi]]) {
      expect(t).toContain("0812-3456-7890");
      expect(m).toContain("wa.me/6281234567890");
    }
    expect(baca("src/app/_dokumen/isi-syarat-ketentuan.tsx")).not.toMatch(/\b62\d{8,}\b/);
    expect(baca("src/app/_dokumen/isi-kebijakan-privasi.tsx")).not.toMatch(/\b62\d{8,}\b/);
  });
});

describe("Syarat & Ketentuan — fakta wajib", () => {
  it("kebijakan pembatalan klien disalin UTUH (empat jenjang + darurat medis)", () => {
    for (const penggal of [
      "≥ 24 jam",
      "Refund 100%",
      "reschedule gratis",
      "2–24 jam",
      "Reschedule gratis 1×",
      "kredit layanan, berlaku 30 hari",
      "< 2 jam",
      "mitra sudah berangkat",
      "no-show",
      "Dana tidak dapat dikembalikan",
      "pemesanan baru",
      "PADMA yang membatalkan",
      "reschedule prioritas tanpa biaya tambahan",
      "Persalinan dan rawat inap",
      "ditinjau",
    ]) {
      expect(teksSK, `hilang: ${penggal}`).toContain(penggal);
    }
  });

  it("keputusan C3 ikut tertulis: 1× per pemesanan, layanan yang sama, +30 hari, WIB", () => {
    for (const penggal of [
      "1× per pemesanan",
      "layanan yang sama",
      "30 hari setelah tanggal sesi yang dibatalkan",
      "WIB",
    ]) {
      expect(teksSK, `hilang: ${penggal}`).toContain(penggal);
    }
  });

  it("bukan layanan medis, nomor darurat, usia, tenggat, produk digital, area", () => {
    for (const penggal of [
      "bukan layanan medis",
      "119",
      "18 tahun",
      "24 jam",
      "tidak dapat dikembalikan",
      "lisensi pribadi",
      "Melayani Malang Raya dan Batu",
      "PADMA Wellness",
    ]) {
      expect(teksSK, `hilang: ${penggal}`).toContain(penggal);
    }
  });

  // Temuan review akhir #4 — keputusan pemilik 9 Sep (spec C3 §P4) yang
  // membatasi hak klien; tanpa kalimat ini teks menjanjikan kredit tanpa batas.
  it("rantai kredit berhenti setelah satu putaran", () => {
    expect(teksSK).toContain("tidak menerbitkan kredit kedua");
    expect(teksSK).toContain("paling banyak satu kredit");
  });

  // Temuan review akhir #11 — centang skrining hanya persetujuan pemrosesan
  // data kesehatan (Kebijakan Privasi), BUKAN penerimaan S&K.
  it("penerimaan S&K tidak diklaim lewat centang skrining", () => {
    expect(teksSK).not.toMatch(/formulir pendaftaran, skrining, atau layar persetujuan/);
    expect(teksSK).toContain("formulir pendaftaran atau layar persetujuan");
  });

  it("tidak menjanjikan lama proses refund (belum diputuskan klien)", () => {
    expect(teksSK).not.toMatch(/refund[^.]*\b\d+\s*(hari|jam)\s*kerja/i);
  });
});

describe("Kebijakan Privasi — fakta wajib", () => {
  it("menyebut setiap pemroses pihak ketiga", () => {
    for (const nama of ["Supabase", "Vercel", "Cloudflare R2", "Resend", "Google", "Midtrans", "OpenStreetMap"]) {
      expect(teksPrivasi, `pemroses hilang: ${nama}`).toContain(nama);
    }
  });

  it("data kesehatan disebut terang sebagai data pribadi spesifik, termasuk kesehatan mental", () => {
    for (const penggal of ["data pribadi spesifik", "kesehatan mental", "usia kehamilan", "persetujuan eksplisit"]) {
      expect(teksPrivasi, `hilang: ${penggal}`).toContain(penggal);
    }
  });

  it("mengungkap transfer ke luar negeri, WhatsApp/Meta, dan isi bukti bayar", () => {
    for (const penggal of ["Singapura", "HIJAU atau MERAH", "Meta", "nomor rekening", "saldo"]) {
      expect(teksPrivasi, `hilang: ${penggal}`).toContain(penggal);
    }
  });

  it("hak UU PDP, batas tanggap, dan cookie tanpa pelacak", () => {
    for (const penggal of [
      "Undang-Undang Nomor 27 Tahun 2022",
      "menarik persetujuan",
      "3×24 jam",
      "tidak memakai cookie analitik atau pelacak",
      "tidak mengumpulkan data bayi",
      "tidak menjualnya",
    ]) {
      expect(teksPrivasi, `hilang: ${penggal}`).toContain(penggal);
    }
  });

  // Temuan review akhir #5 — Supabase Auth dan Vercel mencatat IP di log
  // mereka; "tidak disimpan" adalah janji yang tidak ditepati tumpukannya.
  it("tidak mengklaim alamat IP tidak disimpan sama sekali", () => {
    expect(teksPrivasi).not.toMatch(/IP[^.]*tidak disimpan/);
    expect(teksPrivasi).toContain("log keamanan");
  });

  // Temuan review akhir #12 — skrining lama (sebelum dokumen ini) tersimpan
  // TANPA cap persetujuan; teks tidak boleh mengaku sebaliknya.
  it("jujur soal skrining yang terkumpul sebelum kebijakan ini berlaku", () => {
    expect(teksPrivasi).not.toContain("Data ini hanya kami proses dengan persetujuan eksplisit Anda.");
    expect(teksPrivasi).toContain("sebelum kebijakan ini berlaku");
  });

  it("TIDAK menjanjikan backup — jadwal backup otomatis masih mati", () => {
    // Akar kata `cadang`, bukan `cadangan`: "dicadangkan" tidak memuat "cadangan",
    // dan bentuk itulah yang paling mungkin ditulis (bukti-merah Tugas 3).
    expect(teksPrivasi).not.toMatch(/backup|cadang/i);
  });
});

describe("footer situs", () => {
  it("menautkan kedua dokumen di baris bawah", () => {
    const m = renderToStaticMarkup(
      <FooterSitus waTampilan="0812-3456-7890" alamat="Malang" jam="Senin–Sabtu" />,
    );
    expect(m).toContain('href="/syarat-ketentuan"');
    expect(m).toContain('href="/kebijakan-privasi"');
  });
});
