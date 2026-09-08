import { describe, it, expect } from "vitest";
import { querySql } from "./helpers/db";
import {
  STATUS_PERMINTAAN,
  PERPINDAHAN_PERMINTAAN,
  STATUS_SESI,
  PERPINDAHAN_SESI,
  type StatusPermintaan,
} from "@/lib/jadwal/status";

/**
 * Enum Postgres dan daftar TypeScript adalah DUA daftar yang harus identik —
 * persis jenis kesalahan yang paling mudah terjadi dan paling sulit terlihat.
 * Karena itu uji ini membaca keduanya dan membandingkannya, bukan menulis
 * daftar ketiga.
 */
async function nilaiEnum(nama: string): Promise<string[]> {
  const baris = await querySql<{ label: string }>(
    `select e.enumlabel as label
       from pg_enum e
       join pg_type t on t.oid = e.enumtypid
      where t.typname = $1
      order by e.enumsortorder`,
    [nama],
  );
  return baris.map((b) => b.label);
}

describe("enum booking_status sesudah C1", () => {
  it("isinya persis daftar di lib/jadwal/status.ts", async () => {
    expect((await nilaiEnum("booking_status")).sort()).toEqual([...STATUS_PERMINTAAN].sort());
  });

  it("nilai lama 'menunggu' sudah tidak ada — ia BERGANTI NAMA, bukan ditambah", async () => {
    expect(await nilaiEnum("booking_status")).not.toContain("menunggu");
  });

  it("'ditolak' TETAP ada (spec J8: disembunyikan, bukan dihapus)", async () => {
    expect(await nilaiEnum("booking_status")).toContain("ditolak");
  });

  it("menunggu_bayar BELUM ada — itu milik C2", async () => {
    expect(await nilaiEnum("booking_status")).not.toContain("menunggu_bayar");
  });
});

describe("enum session_status sesudah C1", () => {
  it("isinya persis daftar di lib/jadwal/status.ts", async () => {
    expect((await nilaiEnum("session_status")).sort()).toEqual([...STATUS_SESI].sort());
  });

  it("'batal' sudah tidak ada — ia berganti nama menjadi dibatalkan_padma", async () => {
    expect(await nilaiEnum("session_status")).not.toContain("batal");
  });
});

describe("trigger perpindahan permintaan", () => {
  it("menolak setiap perpindahan yang TIDAK ada di peta, menerima yang ada", async () => {
    // Diuji lewat fungsi penilai yang sama dengan yang dipakai trigger, di
    // dalam satu query — tanpa membuat baris fixture apa pun.
    for (const dari of STATUS_PERMINTAAN) {
      for (const ke of STATUS_PERMINTAAN) {
        if (dari === ke) continue;
        const [{ hasil }] = await querySql<{ hasil: boolean }>(
          "select public.perpindahan_permintaan_sah($1::booking_status, $2::booking_status) as hasil",
          [dari, ke],
        );
        const diharapkan = PERPINDAHAN_PERMINTAAN[dari as StatusPermintaan].includes(ke);
        expect(
          hasil,
          `perpindahan ${dari} -> ${ke} seharusnya ${diharapkan ? "SAH" : "DITOLAK"}`,
        ).toBe(diharapkan);
      }
    }
  });
});

describe("trigger perpindahan sesi", () => {
  it("menolak setiap perpindahan yang TIDAK ada di peta, menerima yang ada", async () => {
    for (const dari of STATUS_SESI) {
      for (const ke of STATUS_SESI) {
        if (dari === ke) continue;
        const [{ hasil }] = await querySql<{ hasil: boolean }>(
          "select public.perpindahan_sesi_sah($1::session_status, $2::session_status) as hasil",
          [dari, ke],
        );
        expect(hasil, `sesi ${dari} -> ${ke}`).toBe(PERPINDAHAN_SESI[dari].includes(ke));
      }
    }
  });
});

describe("indeks antrean mengikuti rantai yang diperpanjang", () => {
  it("dedup & batas antrean berlaku untuk KETIGA keadaan sebelum konfirmasi", async () => {
    const [{ def }] = await querySql<{ def: string }>(
      "select indexdef as def from pg_indexes where indexname = 'booking_requests_antrean_unik'",
    );
    // Bila predikatnya masih menyebut satu status saja, klien bisa mengirim
    // permintaan kembar begitu yang pertama pindah ke 'mencari_mitra'.
    expect(def).toContain("diminta");
    expect(def).toContain("mencari_mitra");
    expect(def).toContain("mitra_siap");
  });
});

describe("tidak ada nilai status lama yang tertinggal di definisi SQL", () => {
  /**
   * Fungsi plpgsql dan view menyimpan literalnya sebagai TEKS. Sesudah RENAME
   * VALUE, literal lama tidak lagi menjadi anggota enum — dan pemanggilannya
   * gagal 22P02 SAAT DIJALANKAN, bukan saat migrasi. Pagar ini menangkapnya
   * lebih awal.
   *
   * Versi pertama pagar ini hanya memeriksa `booking_status`, dan hanya
   * mencocokkan bentuk bercast (`'menunggu'::booking_status`). Ia meloloskan
   * dua definisi nyata yang menulis `s.status <> 'batal'` tanpa cast —
   * fungsi `klaim_sudah_bayar` dan view `sesi_menunggu_tarif` — yang baru
   * ketahuan lewat uji LAIN yang merah. Satu pagar yang memeriksa separuh enum
   * yang berubah memberi rasa aman tanpa memberi keamanan; karena itu
   * pemindaiannya kini menyasar KATA-nya, bukan bentuk cast-nya, dan mencakup
   * kedua enum.
   */
  const NILAI_MATI = ["menunggu", "batal"];
  const pola = (mati: string) => `status[^;]{0,40}'${mati}'`;

  it("tak satu pun fungsi menyebut nilai status yang sudah berganti nama", async () => {
    for (const mati of NILAI_MATI) {
      const baris = await querySql<{ nama: string }>(
        `select p.proname as nama
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.prokind = 'f' and p.prosrc ~ $1`,
        [pola(mati)],
      );
      expect(baris.map((b) => b.nama), `fungsi menyebut '${mati}'`).toEqual([]);
    }
  });

  it("tak satu pun view menyebut nilai status yang sudah berganti nama", async () => {
    for (const mati of NILAI_MATI) {
      const baris = await querySql<{ nama: string }>(
        `select c.relname as nama
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'v' and pg_get_viewdef(c.oid) ~ $1`,
        [pola(mati)],
      );
      expect(baris.map((b) => b.nama), `view menyebut '${mati}'`).toEqual([]);
    }
  });
});
