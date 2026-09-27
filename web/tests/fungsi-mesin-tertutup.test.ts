/**
 * PAGAR: fungsi mesin pembayaran TERTUTUP bagi `authenticated`, dan setiap
 * fungsi yang menulis tabel pesanan ada di TEPAT SATU daftar putih bernama.
 *
 * ===== DIAGNOSIS, DAN KENAPA TEMPLAT RUMAH SENDIRI MELUBANGINYA =====
 * Fungsi baru LAHIR TERBUKA untuk setiap pengguna login. Itu bukan dugaan:
 * `tests/hak-default-sequence-fungsi.test.ts:158` meng-assert default ACL memberi
 * `authenticated` EXECUTE, dan `:253` membuktikannya atas fungsi yang BARU dibuat.
 * Sementara itu templat aturan [F] repo ini —
 * `supabase/migrations/20260828230000_fail_closed_sequence_fungsi.sql:176-177` —
 * menulis `revoke ... from public, anon` TANPA `authenticated`. Implementer yang
 * mengikuti templat rumah karena itu membuka pintu, dan suite tetap hijau.
 *
 * Bentuk revoke ketatnya sudah jadi preseden migrasi:
 * `revoke all on function ... from public, anon, authenticated`
 * (`20260830150000_pengerasan_tabel_uang.sql:197,249,319,360`).
 *
 * Yang pagar ini ubah: hak `authenticated` per-fungsi hari ini dijaga di DUA
 * tempat saja — `tests/tenggat-bayar.test.ts:155` dan
 * `tests/varian-struktur.test.ts:105` — yaitu dua contoh yang harus diingat satu
 * per satu. Berkas ini mengubahnya menjadi DAFTAR YANG DIPAKSA LENGKAP.
 *
 * ===== KENAPA DAFTAR PUTIH BERNAMA, BUKAN ATURAN OTOMATIS =====
 * "Fungsi yang menulis tabel uang harus tertutup" akan melarang persis fungsi
 * yang P1 BUTUHKAN terbuka (`buat_pesanan` dipanggil rute checkout dengan sesi
 * pemanggil), merah sejak commit pertama, dan satu-satunya penyembuhnya melanggar
 * cakupan. Yang dipaksa di sini bukan pilihannya, melainkan pilihannya diambil
 * SADAR: fungsi penulis baru yang lahir tanpa masuk salah satu daftar = merah.
 *
 * Kolom kedua `TERBUKA_SADAR` adalah pengikat yang sesungguhnya: fungsi boleh
 * terbuka bagi `authenticated` ASAL ia memeriksa sendiri siapa pemanggilnya —
 * `auth.uid()` (memilih client_id-nya sendiri alih-alih memercayai payload) atau
 * `user_role()` (gerbang peran staf).
 *
 * ===== YANG BUKAN URUSAN BERKAS INI =====
 * Hak `anon` TIDAK diperiksa di sini. Ia sudah dijaga menyeluruh oleh
 * `tests/hak-default-sequence-fungsi.test.ts` ("tidak ada fungsi/prosedur public
 * yang bisa dieksekusi anon", diperiksa atas OBJEK NYATA). Satu batas, satu
 * pemilik.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { querySql } from "./helpers/db";

/**
 * Jantung mesin pembayaran. Ketiga yang pertama menulis uang orang; yang keempat
 * adalah penjaga transisinya. Tidak satu pun boleh bisa dipanggil dari PostgREST
 * oleh pemegang sesi mana pun — vonis Midtrans tidak boleh menjadi parameter
 * yang dikirim pemanggil bersesi, atau admin mana pun bisa mencetak `lunas`
 * dengan satu `curl`.
 */
const MESIN_TERTUTUP = [
  "perpindahan_pesanan_sah",
  "salurkan_pesanan",
  "terapkan_notifikasi_midtrans",
  "terbitkan_akses_item",
] as const;

/**
 * Terbuka bagi `authenticated` — SADAR, dan masing-masing menggerbangi dirinya
 * sendiri. Urut abjad supaya penambahan berikutnya punya satu tempat yang jelas.
 *
 * ===== KENAPA PETA NAMA -> GERBANG, BUKAN DAFTAR NAMA =====
 * Versi pertama pagar ini memindai badan fungsi untuk `auth.uid()` ATAU
 * `user_role()`, dan itu tidak bisa membedakan GERBANG dari PENYEBUTAN. Sudah
 * ada satu kecocokan yang kebetulan hari ini: `putuskan_pesanan_ditahan`
 * memuat `where p.id = auth.uid()` — baris yang mengambil NAMA PEMUTUS untuk
 * jejak, sama sekali bukan gerbang. Gerbangnya yang sesungguhnya `user_role()`.
 * Dengan "salah satu dari dua", menghapus gerbang yang benar tetap hijau lewat
 * penyebutan yang lain; pengikatnya tidak mengikat apa pun.
 *
 * Yang dinyatakan di sini karena itu gerbang MANA yang diharapkan per nama.
 */
const TERBUKA_SADAR = {
  // Memilih `client_id`-nya sendiri dari sesi, alih-alih memercayai payload.
  ambil_produk_gratis: "auth.uid",
  batalkan_pesanan_saya: "auth.uid",
  buat_pesanan: "auth.uid",
  catat_token_snap: "auth.uid",
  // Gerbang PERAN. `auth.uid()` juga muncul di badan keduanya, tapi hanya
  // untuk mengambil nama pemutus/penutup — dan itulah sebabnya kolom ini
  // menyebut gerbang yang diharapkan, bukan menerima salah satu dari dua.
  putuskan_pesanan_ditahan: "user_role",
  tutup_tinjauan: "user_role",
} as const;

type Gerbang = (typeof TERBUKA_SADAR)[keyof typeof TERBUKA_SADAR];

const NAMA_TERBUKA_SADAR = Object.keys(TERBUKA_SADAR) as Array<keyof typeof TERBUKA_SADAR>;

/**
 * Predikat gerbang, DIEKSTRAK supaya bisa diadu dengan literal — lihat
 * describe "kontrol positif predikat gerbang" di bawah.
 *
 * `prosrc` MEMUAT KOMENTAR, jadi pemindaian mentah dipuaskan satu baris
 * `-- gerbangnya lewat user_role(), lihat migrasi 2026xxxx`. Rencana ini
 * sendiri tahu bahayanya: komentar `tolak_ubah_item_pesanan` di migrasi Tugas 2
 * sengaja ditaruh DI LUAR badan `$$` supaya tidak memalsukan kecocokan
 * POLA_PENULIS. Kesadaran yang sama diterapkan di sini, pada pengikat yang
 * jauh lebih penting.
 */
export function bergerbang(badan: string, gerbang: Gerbang): boolean {
  const tanpaKomentar = badan.replace(/--[^\n]*/g, "");
  return gerbang === "auth.uid"
    ? /auth\.uid\s*\(\s*\)/.test(tanpaKomentar)
    : /user_role\s*\(\s*\)/.test(tanpaKomentar);
}

/**
 * "Menulis tabel pesanan." TANPA flag `g` — `RegExp.test()` pada regex ber-`g`
 * menyimpan `lastIndex` dan memulangkan false bergantian pada pemanggilan
 * berikutnya. Pagar yang hijau setiap baris genap adalah pagar yang lebih buruk
 * daripada tidak ada.
 */
const POLA_PENULIS =
  /(insert\s+into|update)\s+(public\.)?(orders|order_items|jejak_pesanan|digital_entitlements)\b/i;

type Fungsi = {
  nama: string;
  tanda_tangan: string;
  badan: string;
  authenticated_bisa: boolean;
};

let katalog: Fungsi[] = [];

beforeAll(async () => {
  // Dibaca lewat `p.oid`, BUKAN lewat string `'nama(tipe,tipe)'::regprocedure`:
  // fungsi berargumen default punya satu tanda tangan identitas yang gampang
  // salah ketik, dan salah ketik pada regprocedure melempar galat yang terbaca
  // seperti "fungsinya tidak ada" — bukan seperti "ujinya yang salah".
  katalog = await querySql<Fungsi>(
    `select p.proname as nama,
            p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as tanda_tangan,
            -- KOMENTAR DIBUANG DI SINI JUGA, bukan hanya di \`bergerbang()\`:
            -- POLA_PENULIS di bawah juga dijalankan atas kolom ini, dan satu
            -- baris \`-- update public.orders ...\` di dalam badan $$ sudah
            -- cukup menyeret fungsi yang bukan penulis ke daftar yatim.
            regexp_replace(coalesce(p.prosrc, ''), '--[^\n]*', '', 'g') as badan,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_bisa
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.prokind = 'f'
      order by 1`,
  );
});

/** Semua overload bernama `nama`. Kosong berarti fungsinya memang tidak ada. */
function cari(nama: string): Fungsi[] {
  return katalog.filter((f) => f.nama === nama);
}

describe("katalog fungsi terbaca", () => {
  it("kueri katalog benar-benar memulangkan fungsi", () => {
    // Anti-hampa. Kueri yang rusak memulangkan nol baris, dan nol baris membuat
    // SELURUH assertion di bawah lolos tanpa memeriksa apa pun.
    expect(katalog.length).toBeGreaterThanOrEqual(20);
  });
});

describe("MESIN_TERTUTUP — tidak bisa dipanggil pemegang sesi", () => {
  it.each(MESIN_TERTUTUP)("fungsi %s ada di basis data", (nama) => {
    // Nama yang salah ketik akan membuat seluruh assertion hak di bawahnya
    // hampa: tidak ada baris untuk diperiksa, jadi tidak ada yang bisa merah.
    expect(cari(nama).length, `fungsi public.${nama} tidak ada di basis data`)
      .toBeGreaterThan(0);
  });

  it.each(MESIN_TERTUTUP)("authenticated TIDAK bisa mengeksekusi %s", (nama) => {
    const terbuka = cari(nama).filter((f) => f.authenticated_bisa);
    expect(
      terbuka.map((f) => f.tanda_tangan),
      terbuka.length === 0
        ? ""
        : `public.${nama} masih bisa dipanggil pemegang sesi mana pun lewat PostgREST.\n` +
          `Templat rumah (20260828230000:176-177) menulis "revoke ... from public, anon"\n` +
          `TANPA authenticated. Yang dipakai untuk fungsi mesin adalah bentuk ketatnya:\n` +
          `  revoke all on function public.${nama}(...) from public, anon, authenticated;`,
    ).toEqual([]);
  });
});

describe("kontrol positif predikat gerbang — PERMANEN, nol basis data", () => {
  // Pagar yang lahir hijau dan tidak pernah dibuktikan bisa merah terbaca
  // persis seperti pagar yang bekerja. Step 7 membuktikannya sekali, secara
  // manual, lalu buktinya dibuang bersama suntingan sementaranya — yang
  // tertinggal di repo hanya pagar yang lahir hijau. KETIGA kasus di bawah
  // adalah bukti yang TERTINGGAL, dan ia murni: nol sentuhan basis data
  // bersama, jadi sesi lain tidak terganggu.
  it("badan yang HANYA menyebut gerbang di dalam KOMENTAR ditolak", () => {
    const palsu = "begin\n  -- gerbangnya lewat auth.uid(), lihat migrasi 2026\n  return 1;\nend;";
    expect(bergerbang(palsu, "auth.uid")).toBe(false);
  });

  it("badan yang benar-benar memanggil gerbangnya diterima", () => {
    expect(bergerbang("select 1 from clients where user_id = auth.uid()", "auth.uid")).toBe(true);
    expect(bergerbang("if public.user_role() not in ('admin') then", "user_role")).toBe(true);
  });

  it("gerbang yang SALAH ditolak walau gerbang lain ada di badannya", () => {
    // Inilah yang membuat kolom "gerbang yang diharapkan" berarti:
    // `putuskan_pesanan_ditahan` memuat auth.uid() untuk mengambil nama
    // pemutus, dan itu TIDAK boleh menggantikan gerbang perannya.
    const badan = "select p.nama from profiles p where p.id = auth.uid();";
    expect(bergerbang(badan, "user_role")).toBe(false);
  });
});

describe("TERBUKA_SADAR — terbuka, tetapi menggerbangi dirinya sendiri", () => {
  it.each(NAMA_TERBUKA_SADAR)("fungsi %s ada di basis data", (nama) => {
    expect(cari(nama).length, `fungsi public.${nama} tidak ada di basis data`)
      .toBeGreaterThan(0);
  });

  it.each(NAMA_TERBUKA_SADAR)("authenticated BISA mengeksekusi %s", (nama) => {
    const tertutup = cari(nama).filter((f) => !f.authenticated_bisa);
    expect(
      tertutup.map((f) => f.tanda_tangan),
      tertutup.length === 0
        ? ""
        : `public.${nama} tertutup bagi authenticated, padahal ia memang harus\n` +
          `bisa dipanggil klien/staf lewat PostgREST. Menutupnya mematikan fitur\n` +
          `yang hidup — termasuk pengambilan produk gratis di produksi.`,
    ).toEqual([]);
  });

  it.each(NAMA_TERBUKA_SADAR)("%s memasang gerbang yang DIHARAPKAN untuknya", (nama) => {
    // INILAH pengikat yang sesungguhnya, dan ia menyebut gerbang MANA.
    // "auth.uid() atau user_role()" tidak bisa membedakan gerbang dari
    // penyebutan: `putuskan_pesanan_ditahan` memuat KEDUANYA hari ini, dan
    // yang kedua cuma mengambil nama pemutus untuk jejak. Dengan "salah satu",
    // menghapus gerbang yang benar tetap hijau lewat sisa yang lain.
    const gerbang = TERBUKA_SADAR[nama];
    const buta = cari(nama).filter((f) => !bergerbang(f.badan, gerbang));
    expect(
      buta.map((f) => f.tanda_tangan),
      buta.length === 0
        ? ""
        : `public.${nama} terbuka bagi authenticated TAPI badannya tidak memanggil\n` +
          `${gerbang}() — gerbang yang daftar ini nyatakan untuknya. Komentar tidak\n` +
          `dihitung: pemindainya membuang komentar lebih dulu. Fungsi terbuka yang\n` +
          `memercayai payload adalah fungsi yang bisa dipakai memberi produk kepada\n` +
          `orang lain.`,
    ).toEqual([]);
  });
});

describe("pengikat: setiap penulis tabel pesanan ada di TEPAT SATU daftar", () => {
  it("cetakan POLA_PENULIS mengenali penulis dan tidak menuduh pembaca", () => {
    // Pagar yang menguji pagarnya sendiri — pola yang salah menggandakan dirinya
    // diam-diam dan terbaca persis seperti pola yang bekerja.
    expect(POLA_PENULIS.test("insert into public.digital_entitlements (client_id) values ($1)")).toBe(true);
    expect(POLA_PENULIS.test("update public.orders set status = 'lunas'")).toBe(true);
    expect(POLA_PENULIS.test("insert into jejak_pesanan (pesanan_id) values ($1)")).toBe(true);
    expect(POLA_PENULIS.test("select * from public.orders where id = $1")).toBe(false);
    expect(POLA_PENULIS.test("update public.booking_requests set status = 'x'")).toBe(false);
    // Tanpa flag `g`: dua pemanggilan berturut-turut atas masukan yang sama
    // harus memberi jawaban yang sama.
    expect(POLA_PENULIS.test("update public.orders set status = 'lunas'")).toBe(true);
  });

  it("ada sekurangnya satu penulis yang terdeteksi", () => {
    // Anti-hampa kedua: `ambil_produk_gratis` sudah menulis
    // `digital_entitlements` sejak 20260921150000, jadi daftar kosong di sini
    // berarti pemindainya rusak, bukan repo yang bersih.
    const penulis = katalog.filter((f) => POLA_PENULIS.test(f.badan));
    expect(penulis.map((f) => f.nama)).toContain("ambil_produk_gratis");
  });

  it("tidak ada penulis yang berada di LUAR kedua daftar", () => {
    const daftar = new Set<string>([...MESIN_TERTUTUP, ...NAMA_TERBUKA_SADAR]);
    const yatim = [
      ...new Set(
        katalog.filter((f) => POLA_PENULIS.test(f.badan)).map((f) => f.nama),
      ),
    ]
      .filter((n) => !daftar.has(n))
      .sort();

    expect(
      yatim,
      yatim.length === 0
        ? ""
        : `Fungsi ini menulis orders/order_items/jejak_pesanan/digital_entitlements\n` +
          `tetapi tidak ada di daftar mana pun: ${yatim.join(", ")}.\n` +
          `Pilih SATU, dan pilihlah sadar:\n` +
          `  MESIN_TERTUTUP — tidak boleh dipanggil pemegang sesi; revoke ... from\n` +
          `                   public, anon, authenticated di migrasinya.\n` +
          `  TERBUKA_SADAR  — boleh dipanggil pemegang sesi, ASAL badannya memilih\n` +
          `                   barisnya dari auth.uid() atau bergerbang user_role().`,
    ).toEqual([]);
  });

  it("kedua daftar tidak beririsan", () => {
    const irisan = MESIN_TERTUTUP.filter((n) => (NAMA_TERBUKA_SADAR as readonly string[]).includes(n));
    expect(irisan, `nama ini ada di KEDUA daftar: ${irisan.join(", ")}`).toEqual([]);
  });

  it("nama di dalam daftar boleh BUKAN penulis — dan itu disengaja", () => {
    // `perpindahan_pesanan_sah` tidak menulis apa pun; ia penjaga transisi murni.
    // Ia tetap di MESIN_TERTUTUP karena membukanya berarti memberi tahu dunia
    // bentuk mesin statusnya secara cuma-cuma. Assertion ini mengunci bahwa
    // pengikat di atas TIDAK menuntut sebaliknya (yaitu: bukan `toEqual` atas
    // himpunan penulis), supaya `tolak_ubah_item_pesanan`,
    // `catat_notifikasi_ditolak`, dan `catat_notifikasi_tak_dikenal` —
    // ketiganya tertutup tetapi bukan penulis — tidak perlu masuk daftar mana
    // pun.
    const f = cari("perpindahan_pesanan_sah");
    expect(f.length).toBeGreaterThan(0);
    expect(f.every((x) => !POLA_PENULIS.test(x.badan))).toBe(true);
  });
});
