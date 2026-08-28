import { describe, it, expect, beforeAll } from "vitest";
import { querySql } from "./helpers/db";

/**
 * MONEY FIREWALL — invarian STRUKTURAL.
 *
 * Semua test firewall yang ada bersifat PERILAKU: "admin dapat 0 baris dari
 * service_rates". Test seperti itu hanya menjaga pintu yang sudah kita tahu
 * ada. Ia buta terhadap pintu BARU: begitu seseorang menambahkan
 * `sessions.harga_sesi` atau `client_packages.total_bayar`, seluruh suite tetap
 * hijau sementara nominal uang kini hidup di tabel yang admin & klien boleh
 * baca — firewall bocor tanpa satu pun assertion berubah merah.
 *
 * Invarian yang dijaga di sini: KOLOM NOMINAL UANG HANYA BOLEH HIDUP DI
 * `service_rates` DAN `honor_marks`. Dijaga dengan membaca
 * information_schema.columns, jadi berlaku untuk kolom yang BELUM ADA saat
 * test ini ditulis — termasuk kolom pada tabel yang belum lahir (Plan 2 dst).
 *
 * Yang sengaja TIDAK dituduh: kolom STATUS. `sessions.status_bayar` dan
 * `client_packages.status_bayar` memang mengandung kata "bayar", tetapi
 * bertipe enum `pay_status` ('belum'|'menunggu_verifikasi'|'lunas') — keadaan,
 * bukan nominal. Tanpa nominal, admin tetap bisa menjalankan operasional
 * (menagih, memverifikasi) tanpa pernah melihat angka rupiah. Pengecualiannya
 * DIIKAT KE TIPE: `status_bayar int` tetap akan merah, karena itu nominal yang
 * menyamar sebagai status.
 */

/** Satu-satunya tempat sah bagi nominal uang. */
const TABEL_UANG = new Set(["service_rates", "honor_marks"]);

/**
 * Pola nama kolom bernuansa uang. Sengaja dicocokkan per-KATA (dibatasi `_`
 * atau ujung nama), bukan substring bebas, supaya nama wajar seperti
 * `created_at` atau `durasi` tidak tertuduh — dan `harga_klien`,
 * `total_bayar`, `biaya_admin`, `amount_paid`, `service_fee` tetap tertangkap.
 */
const POLA_NOMINAL: RegExp[] = [
  /(^|_)harga(_|$)/,
  /(^|_)honor(_|$)/,
  /(^|_)tarif(_|$)/,
  /(^|_)biaya(_|$)/,
  /(^|_)nominal(_|$)/,
  /(^|_)bayar(an)?(_|$)/,
  /(^|_)dibayar(kan)?(_|$)/,
  /(^|_)pembayaran(_|$)/,
  /(^|_)rupiah(_|$)/,
  /(^|_)idr(_|$)/,
  /(^|_)amounts?(_|$)/,
  /(^|_)prices?(_|$)/,
  /(^|_)fees?(_|$)/,
  /(^|_)rates?(_|$)/,
  /(^|_)totals?(_|$)/,
  /(^|_)cost(s)?(_|$)/,
  /(^|_)payments?(_|$)/,
  /(^|_)salary(_|$)/,
  /(^|_)revenue(_|$)/,
];

type Kolom = {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
};

/**
 * Pengecualian eksplisit — kolom STATUS, bukan nominal.
 * Daftar ini sengaja pendek dan terikat TIPE: begitu tipenya berubah menjadi
 * angka, pengecualiannya gugur dan test kembali merah.
 */
function statusSah(k: Kolom): boolean {
  return k.column_name === "status_bayar" && k.udt_name === "pay_status";
}

function bernuansaUang(nama: string): boolean {
  return POLA_NOMINAL.some((pola) => pola.test(nama));
}

let semuaKolom: Kolom[] = [];

beforeAll(async () => {
  // Termasuk VIEW, bukan hanya tabel dasar: view `laporan_omzet` yang
  // mengekspos `total_harga` sama bocornya dengan kolom di tabel.
  semuaKolom = await querySql<Kolom>(
    `select c.table_name, c.column_name, c.data_type, c.udt_name
       from information_schema.columns c
       join information_schema.tables t
         on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'public'
        and t.table_type in ('BASE TABLE', 'VIEW')
      order by c.table_name, c.column_name`,
  );
  if (semuaKolom.length === 0) {
    throw new Error("information_schema.columns kosong — DB belum di-reset?");
  }
});

describe("MONEY FIREWALL STRUKTURAL — nominal uang hanya di tabel uang", () => {
  it("tidak ada kolom bernuansa nominal uang di luar service_rates & honor_marks", () => {
    const pelanggaran = semuaKolom
      .filter((k) => !TABEL_UANG.has(k.table_name))
      .filter((k) => bernuansaUang(k.column_name))
      .filter((k) => !statusSah(k))
      .map((k) => `${k.table_name}.${k.column_name} (${k.data_type})`);

    expect(
      pelanggaran,
      `Kolom nominal uang hanya boleh hidup di ${[...TABEL_UANG].join(" & ")}. ` +
        `Ditemukan di luar itu: ${pelanggaran.join(", ")}. ` +
        "Pindahkan nominalnya ke tabel uang (owner-only) dan sisakan hanya " +
        "STATUS di tabel operasional, atau — bila ini memang status — beri " +
        "tipe enum dan daftarkan pengecualiannya di statusSah().",
    ).toEqual([]);
  });

  it("kolom uang yang sah TETAP berada di tempatnya (bukan diam-diam dipindah)", () => {
    const diTabelUang = semuaKolom
      .filter((k) => TABEL_UANG.has(k.table_name))
      .map((k) => `${k.table_name}.${k.column_name}`);

    expect(diTabelUang).toContain("service_rates.harga_klien");
    expect(diTabelUang).toContain("service_rates.honor_mitra");
  });

  it("kolom STATUS bayar TIDAK dituduh sebagai nominal (bukan false positive)", () => {
    const statusBayar = semuaKolom.filter((k) => k.column_name === "status_bayar");

    // Prasyarat: kolom status memang ada di tabel operasional.
    expect(statusBayar.map((k) => k.table_name).sort()).toEqual([
      "client_packages",
      "sessions",
    ]);
    // Namanya memang bernuansa uang…
    expect(bernuansaUang("status_bayar")).toBe(true);
    // …tetapi lolos karena tipenya enum keadaan, bukan angka.
    for (const k of statusBayar) {
      expect(k.udt_name).toBe("pay_status");
      expect(statusSah(k)).toBe(true);
    }
  });

  it("pola deteksi menangkap nama nominal yang lazim & tidak salah tuduh", () => {
    for (const nama of [
      "harga_klien",
      "honor_mitra",
      "tarif_dasar",
      "biaya_admin",
      "nominal_transfer",
      "total_bayar",
      "jumlah_pembayaran",
      "amount",
      "unit_price",
      "service_fee",
      "hourly_rate",
      "total",
      "payment_amount",
    ]) {
      expect(bernuansaUang(nama), `harusnya terdeteksi: ${nama}`).toBe(true);
    }

    for (const nama of [
      "created_at",
      "updated_at",
      "status",
      "catatan",
      "rekomendasi",
      "jumlah_sesi",
      "tanggal_mulai",
      "preferensi_waktu",
      "berlaku_sejak",
      "week_start",
      "no_hp",
      "padma_id",
    ]) {
      expect(bernuansaUang(nama), `harusnya AMAN: ${nama}`).toBe(false);
    }
  });

  it("kolom nominal yang menyamar sebagai status (bertipe angka) tetap tertangkap", () => {
    const menyamar: Kolom = {
      table_name: "sessions",
      column_name: "status_bayar",
      data_type: "integer",
      udt_name: "int4",
    };
    expect(bernuansaUang(menyamar.column_name)).toBe(true);
    expect(statusSah(menyamar)).toBe(false);
  });
});
