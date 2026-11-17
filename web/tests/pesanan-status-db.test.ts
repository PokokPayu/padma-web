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
  PESANAN_TUTUP_DISAPU,
  LABEL_STATUS_PESANAN,
  JAM_TENGGAT_PESANAN,
  MENIT_JEDA_PERIKSA,
  JAM_TENGGANG_TANPA_VONIS,
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

  it("order_event berisi PERSIS delapan belas nilai, urut sama dengan daftar TS", async () => {
    // 16 nilai P1 + `sesi_terkonfirmasi` & `sesi_tertahan` (B3, penyalur sesi),
    // DI EKOR: `alter type … add value` selalu menambah di akhir, jadi urutan
    // TS yang menyelipkan keduanya di tengah memerahkan baris di bawah.
    const nilai = await nilaiEnum("order_event");
    expect(nilai).toHaveLength(18);
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

  it("keenam kejadian penanda tinjauan adalah anggota sah order_event", () => {
    for (const k of KEJADIAN_BUTUH_TINJAUAN) {
      expect(KEJADIAN_PESANAN_SAH, `kejadian ${k} bukan anggota order_event`).toContain(k);
    }
    expect([...KEJADIAN_BUTUH_TINJAUAN]).toEqual([
      "selisih_nominal",
      "selisih_status",
      "lunas_setelah_tutup",
      "akses_tertahan",
      "penangan_belum_ada",
      // B3: penyalur sesi yang tidak bisa melahirkan sesi memanggil manusia.
      "sesi_tertahan",
    ]);
  });

  it("konstanta waktu bernilai seperti yang diputuskan spec", () => {
    expect(JAM_TENGGAT_PESANAN).toBe(24);
    expect(MENIT_JEDA_PERIKSA).toBe(5);
    expect(JAM_TENGGANG_TANPA_VONIS).toBe(1);
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

// ---------------------------------------------------------------------------
// Himpunan TS terikat ke daftar status SQL (perbaikan akhir, rekomendasi 8)
// ---------------------------------------------------------------------------

/**
 * Status pesanan yang DISEBUT predikat SQL sebagai daftar eksplisit.
 *
 * Indeks: literal `'x'::order_status` di klausa WHERE `pg_indexes`. Fungsi:
 * literal pada `o.status = '<x>'` dan `o.status = any (array[...]::
 * public.order_status[])` di badan fungsi tanpa komentar. Awalan `o.` sengaja:
 * `terbitkan_tagihan_sesi` juga membandingkan `b.status` (status PENGAJUAN,
 * enum lain yang kebetulan berbagi nama `menunggu_bayar`), dan `set status =`
 * adalah TUJUAN tulisan, bukan predikat.
 */
async function statusIndeks(nama: string): Promise<Set<string>> {
  const [b] = await querySql<{ def: string }>(
    `select indexdef as def from pg_indexes where schemaname = 'public' and indexname = $1`,
    [nama],
  );
  expect(b, `indeks ${nama} tidak ada`).toBeDefined();
  const where = b.def.slice(b.def.indexOf(" WHERE ") + 1);
  return new Set([...where.matchAll(/'([a-z_]+)'::order_status/g)].map((m) => m[1]));
}

async function statusFungsi(nama: string): Promise<Set<string>> {
  const [f] = await querySql<{ badan: string }>(
    `select regexp_replace(p.prosrc, '--[^\\n]*', '', 'g') as badan
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = $1`,
    [nama],
  );
  expect(f, `fungsi ${nama} tidak ada`).toBeDefined();
  const hasil = new Set<string>();
  for (const m of f.badan.matchAll(/\bo\.status\s*=\s*'([a-z_]+)'/g)) hasil.add(m[1]);
  for (const m of f.badan.matchAll(
    /\bo\.status\s*=\s*any\s*\(\s*array\s*\[([^\]]*)\]\s*::\s*public\.order_status\[\]\s*\)/g,
  )) {
    for (const x of m[1].matchAll(/'([a-z_]+)'/g)) hasil.add(x[1]);
  }
  return hasil;
}

describe("himpunan status TS terikat ke daftar SQL — untuk SETIAP nilai enum", () => {
  // Pelajaran "status adalah himpunan" dari sisi SQL: plpgsql tidak bisa
  // dipaksa kompilator. Nilai enum baru yang masuk `PESANAN_TERBUKA` tetapi
  // tidak masuk indeks "satu pesanan terbuka" (atau sebaliknya) membuat dua
  // tagihan terbuka mungkin; yang masuk `PESANAN_BERUANG` tetapi tidak masuk
  // predikat uang membuat terbit ulang menagih dua kali. Diadu per nilai
  // `order_status` dari `pg_enum`, bukan per daftar ketikan.
  //
  // STRUKTURAL, bukan perilaku. Uji perilaku per nilai enum menuntut fixture
  // pengajuan + pesanan dalam setiap status (termasuk status yang hanya bisa
  // dicapai lewat webhook/putusan staf) untuk dua indeks dan satu predikat —
  // jauh lebih berat, dan cabang-cabang SQL ini membandingkan status HANYA
  // lewat daftar literal yang dibaca di sini. Perilaku masing-masing sudah
  // diuji di berkasnya sendiri (tagihan-sesi-db, penjaga-pengajuan-db).
  const TERIKAT: { nama: string; baca: () => Promise<Set<string>>; ts: readonly string[] }[] = [
    { nama: "indeks pesanan_produk_terbuka_satu_per_klien", baca: () => statusIndeks("pesanan_produk_terbuka_satu_per_klien"), ts: PESANAN_TERBUKA },
    { nama: "indeks pesanan_sesi_terbuka_satu_per_pengajuan", baca: () => statusIndeks("pesanan_sesi_terbuka_satu_per_pengajuan"), ts: PESANAN_TERBUKA },
    { nama: "indeks orders_sapuan_idx (penyapu terbuka)", baca: () => statusIndeks("orders_sapuan_idx"), ts: PESANAN_TERBUKA },
    { nama: "indeks orders_sapuan_tutup_idx (penyapu tertutup)", baca: () => statusIndeks("orders_sapuan_tutup_idx"), ts: PESANAN_TUTUP_DISAPU },
    { nama: "predikat uang_sudah_masuk_permintaan", baca: () => statusFungsi("uang_sudah_masuk_permintaan"), ts: PESANAN_BERUANG },
    { nama: "terbitkan_tagihan_sesi (pesanan yang ditutup terbit ulang)", baca: () => statusFungsi("terbitkan_tagihan_sesi"), ts: PESANAN_TERBUKA },
    { nama: "trigger tutup_pesanan_sesi_terbuka", baca: () => statusFungsi("tutup_pesanan_sesi_terbuka"), ts: PESANAN_TERBUKA },
  ];

  it.each(TERIKAT)("$nama", async ({ baca, ts }) => {
    const sql = await baca();
    // Daftar kosong berarti regex-nya yang buta, bukan kesepakatan.
    expect(sql.size, "tidak ada literal status yang terbaca").toBeGreaterThan(0);
    const enumNyata = await nilaiEnum("order_status");
    for (const s of sql) expect(enumNyata, `literal ${s} bukan nilai order_status`).toContain(s);
    for (const nilai of enumNyata) {
      expect(sql.has(nilai), `${nilai}: SQL ${sql.has(nilai) ? "memuat" : "tidak memuat"}, TS ${ts.includes(nilai as StatusPesanan) ? "memuat" : "tidak memuat"}`).toBe(
        ts.includes(nilai as StatusPesanan),
      );
    }
  });
});
