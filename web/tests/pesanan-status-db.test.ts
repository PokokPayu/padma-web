import { describe, it, expect } from "vitest";
import { querySql } from "./helpers/db";
import {
  STATUS_PESANAN_SAH,
  SUMBER_ITEM_PESANAN,
  KEJADIAN_PESANAN_SAH,
  KEJADIAN_BUTUH_TINJAUAN,
  PESANAN_TERBUKA,
  PESANAN_TIDAK_AKTIF,
  PESANAN_BERUANG,
  PESANAN_MATI,
  LABEL_STATUS_PESANAN,
  JAM_TENGGAT_PESANAN,
  MENIT_JEDA_PERIKSA,
  JAM_TENGGANG_404,
  type StatusPesanan,
} from "@/lib/pesanan/status";

/**
 * Enum Postgres dan daftar TypeScript adalah DUA daftar yang harus identik —
 * persis jenis kesalahan yang paling mudah terjadi dan paling sulit terlihat.
 * Berkas ini karena itu MELINGKARI `pg_enum`, bukan mengulang daftarnya:
 * sumber kebenarannya basis data, dan `src/lib/pesanan/status.ts` adalah
 * KLAIM yang diadu dengannya. Menulis daftar ketiga di sini berarti tiga
 * tempat yang bisa berbeda.
 */
async function nilaiEnum(nama: string): Promise<string[]> {
  const baris = await querySql<{ label: string }>(
    `select e.enumlabel as label
       from pg_enum e
       join pg_type t on t.oid = e.enumtypid
       join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public' and t.typname = $1
      order by e.enumsortorder`,
    [nama],
  );
  return baris.map((b) => b.label);
}

/**
 * Peta perpindahan yang diharapkan, ditulis DI SINI dan bukan di
 * `src/lib/pesanan/status.ts`.
 *
 * Alasannya: tidak satu pun kode produksi P1 membutuhkan peta ini di
 * TypeScript — yang menilai perpindahan adalah `perpindahan_pesanan_sah()` di
 * dalam transaksi yang sama dengan penulisannya, dan peta TS kedua hanya akan
 * jadi tempat kedua yang bisa basi. Yang dibutuhkan uji adalah PENDAPAT KEDUA,
 * dan pendapat kedua memang tempatnya di berkas uji.
 */
const PERPINDAHAN_PESANAN: Record<StatusPesanan, readonly StatusPesanan[]> = {
  menunggu_bayar: ["lunas", "ditahan", "kedaluwarsa", "dibatalkan"],
  // HANYA lewat RPC putusan staf (Tugas 4). Petanya tetap di sini karena
  // fungsi penilai tidak tahu siapa pemanggilnya — dan memang tidak boleh
  // tahu: ia penjaga INTEGRITAS, bukan penjaga otorisasi.
  ditahan: ["lunas", "dibatalkan"],
  lunas: [],
  kedaluwarsa: [],
  dibatalkan: [],
};

describe("enum pesanan lahir utuh di basis data", () => {
  it("order_status berisi PERSIS lima nilai, urut sama dengan daftar TS", async () => {
    expect(await nilaiEnum("order_status")).toEqual([...STATUS_PESANAN_SAH]);
  });

  it("order_status TIDAK memuat 'ditinjau' — penanda tinjauan hanya satu kolom", async () => {
    // Nilai keenam ini dibuang sadar di spec: ia mekanisme tinjauan kedua yang
    // hidup berdampingan dengan `butuh_tinjauan_pada`, dan pesanan yang masuk
    // ke sana tidak punya jalan pulang. Assertion ini menahannya lahir kembali
    // lewat `alter type ... add value` di migrasi mana pun sesudah ini.
    expect(await nilaiEnum("order_status")).not.toContain("ditinjau");
  });

  it("order_item_source berisi PERSIS dua nilai", async () => {
    expect(await nilaiEnum("order_item_source")).toEqual([...SUMBER_ITEM_PESANAN]);
  });

  it("order_event berisi PERSIS enam belas nilai, urut sama dengan daftar TS", async () => {
    const nilai = await nilaiEnum("order_event");
    expect(nilai).toHaveLength(16);
    expect(nilai).toEqual([...KEJADIAN_PESANAN_SAH]);
  });

  it("pay_status TIDAK ikut diperlebar — order_status adalah tipe TERPISAH", async () => {
    // Nol `alter type pay_status add value` berarti nol risiko 55P04, dan
    // assertion money firewall yang mengunci ketiga pemilik kolom
    // `status_bayar` (tests/money-firewall-struktural.test.ts:236-240) tetap
    // utuh. Uji ini yang menahan "gampang, tambahkan saja ke pay_status".
    expect(await nilaiEnum("pay_status")).toEqual(["belum", "menunggu_verifikasi", "lunas"]);
  });
});

describe("himpunan status — partisi yang tidak boleh bocor", () => {
  it("TERBUKA dan TIDAK AKTIF bersama menutup kelima nilai, tanpa tumpang tindih", () => {
    // Nilai enum keenam yang kelak lahir dan lupa diklasifikasikan jatuh ke
    // luar KEDUANYA, dan uji ini yang menemukannya — bukan pengguna yang
    // pesanannya menghilang dari kedua blok layar staf.
    expect([...PESANAN_TERBUKA, ...PESANAN_TIDAK_AKTIF].sort()).toEqual(
      [...STATUS_PESANAN_SAH].sort(),
    );
    const irisan = PESANAN_TERBUKA.filter((s) => PESANAN_TIDAK_AKTIF.includes(s));
    expect(irisan).toEqual([]);
  });

  it("BERUANG dan MATI membelah TIDAK AKTIF tepat dua, tanpa sisa", () => {
    expect([...PESANAN_BERUANG, ...PESANAN_MATI].sort()).toEqual([...PESANAN_TIDAK_AKTIF].sort());
    expect(PESANAN_BERUANG.filter((s) => PESANAN_MATI.includes(s))).toEqual([]);
  });

  it("ditahan ada di BERUANG — uangnya sudah masuk, hanya jumlahnya meleset", () => {
    expect(PESANAN_BERUANG).toContain("ditahan");
    expect(PESANAN_MATI).not.toContain("ditahan");
  });

  it("setiap status punya label layar", () => {
    expect(Object.keys(LABEL_STATUS_PESANAN).sort()).toEqual([...STATUS_PESANAN_SAH].sort());
    for (const s of STATUS_PESANAN_SAH) {
      expect(LABEL_STATUS_PESANAN[s].length, `label ${s} kosong`).toBeGreaterThan(0);
    }
  });

  it("kelima kejadian penanda tinjauan adalah anggota sah order_event", () => {
    for (const k of KEJADIAN_BUTUH_TINJAUAN) {
      expect(KEJADIAN_PESANAN_SAH, `kejadian ${k} bukan anggota order_event`).toContain(k);
    }
    expect([...KEJADIAN_BUTUH_TINJAUAN]).toEqual([
      "selisih_nominal",
      "selisih_status",
      "lunas_setelah_tutup",
      "akses_tertahan",
      "penangan_belum_ada",
    ]);
  });

  it("konstanta waktu bernilai seperti yang diputuskan spec", () => {
    expect(JAM_TENGGAT_PESANAN).toBe(24);
    expect(MENIT_JEDA_PERIKSA).toBe(5);
    expect(JAM_TENGGANG_404).toBe(1);
  });
});

describe("perpindahan_pesanan_sah", () => {
  it("menilai KEDUA PULUH LIMA pasangan persis seperti petanya", async () => {
    // Seluruh pasangan, termasuk `dari = ke`: perpindahan ke dirinya sendiri
    // harus false, bukan "tidak diuji". Pemanggil yang lupa menyaring
    // `is not distinct from` akan menabraknya, dan itu memang yang benar.
    for (const dari of STATUS_PESANAN_SAH) {
      for (const ke of STATUS_PESANAN_SAH) {
        const [{ hasil }] = await querySql<{ hasil: boolean | null }>(
          `select public.perpindahan_pesanan_sah($1::public.order_status,
                                                 $2::public.order_status) as hasil`,
          [dari, ke],
        );
        const diharapkan = PERPINDAHAN_PESANAN[dari].includes(ke);
        expect(
          hasil,
          `perpindahan ${dari} -> ${ke} seharusnya ${diharapkan ? "SAH" : "DITOLAK"}`,
        ).toBe(diharapkan);
      }
    }
  });

  it("nilai enum yang TIDAK dikenal dijawab false, bukan NULL (else false)", async () => {
    // Inilah uji `else false`, dan ia bisa dijalankan tanpa melahirkan nilai
    // enum keenam: `case p_dari when 'menunggu_bayar' then ...` dengan p_dari
    // NULL tidak cocok dengan satu `when` pun, jadi ia jatuh ke cabang ELSE.
    // Tanpa `else false`, `case` tanpa cabang yang cocok memulangkan NULL —
    // dan `if not NULL then` TIDAK PERNAH dieksekusi, sehingga penjaganya
    // fail-OPEN. Assertion ini yang membedakan keduanya.
    const [{ hasil }] = await querySql<{ hasil: boolean | null }>(
      `select public.perpindahan_pesanan_sah(null::public.order_status,
                                             'lunas'::public.order_status) as hasil`,
    );
    expect(hasil).toBe(false);
  });

  it("sasaran NULL memulangkan NULL — INILAH alasan pemanggil membungkus coalesce", async () => {
    // Bukan cacat yang dibiarkan diam-diam, melainkan kontrak yang ditulis
    // sebagai uji: `p_ke in (...)` atas NULL bernilai NULL, jadi cabang `then`
    // memulangkan NULL walau `else false` sudah ada. Setiap pemanggil di
    // Tugas 4 dan Tugas 5 karena itu WAJIB menulis
    // `coalesce(public.perpindahan_pesanan_sah(...), false)`. Bila seseorang
    // kelak membuat fungsi ini tidak pernah NULL, uji ini yang merah — dan
    // itulah saat yang tepat untuk mencabut coalesce di pemanggilnya.
    const [{ hasil }] = await querySql<{ hasil: boolean | null }>(
      `select public.perpindahan_pesanan_sah('menunggu_bayar'::public.order_status,
                                             null::public.order_status) as hasil`,
    );
    expect(hasil).toBeNull();
  });
});

describe("hak fungsi mesin", () => {
  it("authenticated TIDAK boleh mengeksekusi perpindahan_pesanan_sah", async () => {
    // Fungsi baru LAHIR ber-EXECUTE untuk authenticated — dibuktikan
    // tests/hak-default-sequence-fungsi.test.ts:253-266 — dan templat aturan
    // [F] repo sendiri menulis `revoke ... from public, anon` TANPA menyebut
    // authenticated. Implementer yang mengikuti templat rumah membuka pintu
    // dan suite tetap hijau. Assertion ini merah tepat pada kelalaian itu.
    const [row] = await querySql<{ bisa: boolean }>(
      `select has_function_privilege(
                'authenticated',
                'public.perpindahan_pesanan_sah(public.order_status, public.order_status)'::regprocedure,
                'EXECUTE') as bisa`,
    );
    expect(row.bisa).toBe(false);
  });

  it("anon TIDAK boleh mengeksekusinya", async () => {
    const [row] = await querySql<{ bisa: boolean }>(
      `select has_function_privilege(
                'anon',
                'public.perpindahan_pesanan_sah(public.order_status, public.order_status)'::regprocedure,
                'EXECUTE') as bisa`,
    );
    expect(row.bisa).toBe(false);
  });

  it("service_role TETAP boleh — jalur webhook & penyapu berjalan dengannya", async () => {
    // Pencabutan yang membabi buta akan melumpuhkan justru jalur yang
    // membutuhkannya. Dua arah, satu batas.
    const [row] = await querySql<{ bisa: boolean }>(
      `select has_function_privilege(
                'service_role',
                'public.perpindahan_pesanan_sah(public.order_status, public.order_status)'::regprocedure,
                'EXECUTE') as bisa`,
    );
    expect(row.bisa).toBe(true);
  });
});
