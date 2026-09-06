import { describe, it, expect, beforeAll } from "vitest";
import { anonClient, signInAs } from "./helpers/as-user";
import { querySql, dalamTransaksiRollback } from "./helpers/db";

/**
 * FAIL-CLOSED DEFAULT PRIVILEGES — SEQUENCE & FUNCTION.
 *
 * Migration `cabut_grant_anon_berlebih` menutup sumber kebocoran hanya untuk
 * TABLES (`alter default privileges ... revoke all on tables from anon`).
 * SEQUENCES dan FUNCTIONS dibiarkan memakai default Supabase, dan itu
 * TERBUKTI masih memberi `anon` (diprobe langsung di Postgres lokal):
 *
 *   create table public.zz_probe(id bigserial primary key, x text);
 *   create function public.zz_probe_fn() returns int
 *     language sql security definer as $$ select 1 $$;
 *   -- has_sequence_privilege(anon, zz_probe_id_seq, USAGE/SELECT/UPDATE) = t/t/t
 *   -- has_function_privilege(anon, zz_probe_fn(), EXECUTE)               = t
 *   -- has_table_privilege(anon, zz_probe, SELECT)                        = f  <-- hanya TABEL yang sudah benar
 *
 * Kenapa ini ranjau, bukan kerapian:
 *   (a) FUNCTION. Fungsi `SECURITY DEFINER` berjalan dengan hak PEMILIKNYA
 *       (postgres) dan MENEMBUS RLS maupun seluruh pencabutan hak tabel di
 *       atasnya. Satu RPC baru di Plan 2 — `submit_screening()`,
 *       `klaim_undangan()`, apa pun — otomatis lahir bisa dipanggil `anon`,
 *       dan anon key memang tertanam di bundel browser. Semua kerja migration
 *       sebelumnya (revoke all on clients/sessions/screenings from anon) jadi
 *       tidak berarti untuk jalur itu. Perhatikan juga default Postgres
 *       memberi EXECUTE ke PUBLIC, jadi kebocorannya berlapis dua: lewat
 *       grant `anon` DAN lewat grant PUBLIC.
 *   (b) SEQUENCE. `anon=rwU` berarti anon boleh `nextval`/`setval` atas
 *       sequence tabel yang tabelnya sendiri tertutup: menggeser sequence
 *       (mis. `setval(..., 1)`) memancing tabrakan primary key alias DoS
 *       tulis, dan `currval`/`select` membocorkan laju bisnis (berapa
 *       skrining/booking masuk). RLS tidak pernah menyaring sequence.
 *
 * Invarian yang dijaga file ini:
 *   1. `pg_default_acl` untuk schema `public` (pemilik `postgres` — pembuat
 *      semua objek migration) tidak boleh memberi `anon` maupun `PUBLIC` hak
 *      apa pun pada objtype 'S' (sequence), 'f' (function), atau 'r' (tabel);
 *   2. tidak ada satu pun fungsi/prosedur di schema `public` yang bisa
 *      dieksekusi `anon`, dan tidak ada sequence yang bisa diaksesnya —
 *      diperiksa pada OBJEK NYATA, jadi berlaku juga untuk objek yang dibuat
 *      role di luar jangkauan default privileges kita (lihat catatan
 *      `supabase_admin` di bawah);
 *   3. objek yang BARU dibuat pun lahir tertutup (diprobe dalam transaksi
 *      yang di-rollback) — ini yang menjaga Plan 2, bukan hanya hari ini;
 *   4. yang TIDAK boleh ikut rusak: `authenticated` & `service_role` tetap
 *      memegang hak default dan tetap bisa memanggil `user_role()`, trigger
 *      `handle_new_user` tetap membentuk profil saat registrasi anon, dan
 *      katalog publik tetap terbaca anon tanpa error hak.
 *
 * Catatan `supabase_admin`: `pg_default_acl` juga punya baris pemilik
 * `supabase_admin` yang masih memberi anon, dan itu DI LUAR jangkauan —
 * `alter default privileges for role supabase_admin ...` sebagai `postgres`
 * ditolak ("permission denied to change default privileges", diuji langsung).
 * Karena itu invarian #2 diperiksa pada objek NYATA: apa pun yang lolos dari
 * baris default ACL yang tak bisa kita sentuh tetap tertangkap di sana.
 */

/** Hak yang mungkin dipegang atas sequence. */
const HAK_SEQUENCE = ["USAGE", "SELECT", "UPDATE"] as const;

type BarisDefaultAcl = {
  objtype: string;
  penerima: string;
  privilege_type: string;
};

/**
 * Isi `pg_default_acl` untuk schema `public`, dipecah per (objtype, penerima,
 * hak). `grantee = 0` berarti PUBLIC — pseudo-role yang mencakup `anon`, jadi
 * membiarkannya sama saja dengan memberi anon lewat pintu belakang.
 */
async function defaultAcl(
  pemilik: string,
  skema: string | null,
): Promise<BarisDefaultAcl[]> {
  return querySql<BarisDefaultAcl>(
    `select d.defaclobjtype::text as objtype,
            case when a.grantee = 0 then 'PUBLIC'
                 else a.grantee::regrole::text end as penerima,
            a.privilege_type
       from pg_default_acl d
       left join pg_namespace n on n.oid = d.defaclnamespace
       cross join aclexplode(d.defaclacl) a
      where d.defaclrole = $1::regrole
        and (($2::text is null and d.defaclnamespace = 0)
             or n.nspname = $2::text)
      order by 1, 2, 3`,
    [pemilik, skema],
  );
}

let aclPostgres: BarisDefaultAcl[] = [];
let aclGlobal: BarisDefaultAcl[] = [];

beforeAll(async () => {
  aclPostgres = await defaultAcl("postgres", "public");
  aclGlobal = await defaultAcl("postgres", null);
});

function ambilHak(
  baris: BarisDefaultAcl[],
  penerima: string,
  objtype: string,
): string[] {
  return baris
    .filter((b) => b.penerima === penerima && b.objtype === objtype)
    .map((b) => b.privilege_type)
    .sort();
}

function hakUntuk(penerima: string, objtype: string): string[] {
  return ambilHak(aclPostgres, penerima, objtype);
}

describe("default privileges — anon & PUBLIC tidak boleh disebut sama sekali", () => {
  it.each([
    ["S (sequence)", "S"],
    ["f (function)", "f"],
    ["r (tabel)", "r"],
  ])(
    "pg_default_acl objtype %s tidak memberi anon hak apa pun",
    async (_label, objtype) => {
      expect(hakUntuk("anon", objtype)).toEqual([]);
    },
  );

  it.each([
    ["S (sequence)", "S"],
    ["f (function)", "f"],
    ["r (tabel)", "r"],
  ])(
    "pg_default_acl objtype %s tidak memberi PUBLIC hak apa pun",
    async (_label, objtype) => {
      // Default Postgres memberi EXECUTE ke PUBLIC pada setiap fungsi baru.
      // PUBLIC mencakup `anon`, jadi mencabut grant `anon` saja tidak menutup
      // apa pun selama PUBLIC masih memegangnya.
      expect(hakUntuk("PUBLIC", objtype)).toEqual([]);
    },
  );

  it("baris GLOBAL pg_default_acl untuk fungsi tidak menyebut anon maupun PUBLIC", () => {
    // Baris inilah yang benar-benar membuang `=X` (EXECUTE untuk PUBLIC) dari
    // setiap fungsi baru. Baris BERSKEMA di-merge di atas `acldefault()`, jadi
    // mencabut PUBLIC di sana tidak berpengaruh sama sekali (diuji langsung —
    // lihat migration 20260828230000). Kalau seseorang "membereskan duplikat"
    // dengan menghapus baris global itu, test ini yang merah lebih dulu.
    expect(ambilHak(aclGlobal, "anon", "f")).toEqual([]);
    expect(ambilHak(aclGlobal, "PUBLIC", "f")).toEqual([]);
    expect(ambilHak(aclGlobal, "postgres", "f")).toEqual(["EXECUTE"]);
  });
});

describe("default privileges — peran yang MEMANG butuh tetap utuh", () => {
  it("authenticated tetap memegang hak default sequence, function, dan tabel", () => {
    expect(hakUntuk("authenticated", "S")).toEqual(["SELECT", "UPDATE", "USAGE"]);
    expect(hakUntuk("authenticated", "f")).toEqual(["EXECUTE"]);

    // Untuk TABEL, jumlah minimum diganti daftar per-verba: ia menjaga DUA
    // arah sekaligus, dan tidak ikut goyah saat versi Postgres menambah verba
    // baru (MAINTAIN lahir di PG17 dan sudah pernah menggeser hitungan ini).
    //
    // Arah pertama — yang WAJIB TETAP ADA. Klien, admin, dan owner login
    // sebagai peran SQL yang sama (`authenticated`); mencabut verba baca/tulis
    // di sini melumpuhkan staf, bukan menahan penyerang.
    const hakTabel = hakUntuk("authenticated", "r");
    for (const wajib of ["SELECT", "INSERT", "UPDATE", "REFERENCES", "TRIGGER"]) {
      expect(hakTabel, `authenticated wajib tetap memegang ${wajib}`).toContain(wajib);
    }

    // Arah kedua — yang WAJIB TETAP TERCABUT, supaya tabel Plan berikutnya
    // tidak lahir mewarisinya diam-diam dari default privileges Supabase:
    //   TRUNCATE — migration `pengerasan_admin`; tidak pernah difilter RLS.
    //   DELETE   — migration `cabut_hak_hapus_berlebih`; penghapusan materi,
    //              permintaan jadwal, master data, & tabel uang menghancurkan
    //              riwayat/bukti, sementara bentuk pensiunnya (`aktif = false`,
    //              status `ditolak`) sudah ada di skema.
    expect(hakTabel).not.toContain("TRUNCATE");
    expect(hakTabel).not.toContain("DELETE");
  });

  it("service_role tetap memegang hak default sequence, function, dan tabel", () => {
    expect(hakUntuk("service_role", "S")).toEqual(["SELECT", "UPDATE", "USAGE"]);
    expect(hakUntuk("service_role", "f")).toEqual(["EXECUTE"]);
    expect(hakUntuk("service_role", "r").length).toBeGreaterThanOrEqual(7);
  });
});

describe("objek NYATA di schema public tertutup untuk anon", () => {
  it("tidak ada fungsi/prosedur public yang bisa dieksekusi anon", async () => {
    const bocor = await querySql<{ fungsi: string; security_definer: boolean }>(
      `select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as fungsi,
              p.prosecdef as security_definer
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and has_function_privilege('anon', p.oid, 'EXECUTE')
        order by 1`,
    );
    // has_function_privilege sudah memperhitungkan grant PUBLIC maupun
    // keanggotaan role, jadi satu query ini menutup kedua pintu.
    expect(bocor).toEqual([]);
  });

  it("tidak ada sequence public yang bisa diakses anon", async () => {
    const bocor = await querySql<{ sequence: string; priv: string }>(
      `select c.relname as sequence, p.priv
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         cross join unnest($1::text[]) as p(priv)
        where n.nspname = 'public'
          and c.relkind = 'S'
          and has_sequence_privilege('anon', c.oid, p.priv)
        order by 1, 2`,
      [[...HAK_SEQUENCE]],
    );
    expect(bocor).toEqual([]);
  });
});

describe("objek BARU lahir tertutup — inilah yang menjaga Plan 2", () => {
  it("tabel bigserial baru: sequence-nya tidak memberi anon apa pun", async () => {
    const hasil = await dalamTransaksiRollback(async (jalankan) => {
      await jalankan(`create table public.zz_probe_seq(id bigserial primary key, x text)`);
      return jalankan(
        `select p.priv, has_sequence_privilege('anon', 'public.zz_probe_seq_id_seq'::regclass, p.priv) as bisa
           from unnest($1::text[]) as p(priv) order by 1`,
        [[...HAK_SEQUENCE]],
      );
    });
    expect(hasil.map((r) => `${r.priv}=${r.bisa}`)).toEqual([
      "SELECT=false",
      "UPDATE=false",
      "USAGE=false",
    ]);
  });

  it("fungsi SECURITY DEFINER baru: anon TIDAK bisa mengeksekusinya", async () => {
    const hasil = await dalamTransaksiRollback(async (jalankan) => {
      await jalankan(
        `create function public.zz_probe_fn() returns int
           language sql security definer as $fn$ select 1 $fn$`,
      );
      return jalankan(
        `select has_function_privilege('anon', 'public.zz_probe_fn()'::regprocedure, 'EXECUTE') as anon_bisa,
                has_function_privilege('authenticated', 'public.zz_probe_fn()'::regprocedure, 'EXECUTE') as authenticated_bisa,
                has_function_privilege('service_role', 'public.zz_probe_fn()'::regprocedure, 'EXECUTE') as service_bisa`,
      );
    });
    expect(hasil[0].anon_bisa).toBe(false);
    // Fail-close TANPA melumpuhkan peran yang memang bekerja lewat fungsi.
    expect(hasil[0].authenticated_bisa).toBe(true);
    expect(hasil[0].service_bisa).toBe(true);
  });

  it("sequence berdiri sendiri (create sequence) juga lahir tertutup", async () => {
    const hasil = await dalamTransaksiRollback(async (jalankan) => {
      await jalankan(`create sequence public.zz_probe_seq_mandiri`);
      return jalankan(
        `select has_sequence_privilege('anon', 'public.zz_probe_seq_mandiri'::regclass, 'USAGE') as anon_bisa,
                has_sequence_privilege('authenticated', 'public.zz_probe_seq_mandiri'::regclass, 'USAGE') as authenticated_bisa`,
      );
    });
    expect(hasil[0].anon_bisa).toBe(false);
    expect(hasil[0].authenticated_bisa).toBe(true);
  });
});

describe("perilaku lewat REST — anon ditolak di pintu fungsi", () => {
  it("anon memanggil RPC user_role() ditolak permission denied", async () => {
    // `user_role()` SECURITY DEFINER: ia membaca `profiles` dengan hak
    // postgres, menembus RLS. PostgREST mengekspos setiap fungsi public
    // sebagai RPC, jadi tanpa pencabutan ini anon bisa memanggilnya.
    const { error } = await anonClient().rpc("user_role");
    expect(error).not.toBeNull();
    expect(`${error?.code} ${error?.message}`).toMatch(/42501|permission denied/i);
  });

  it("authenticated tetap boleh memanggil RPC user_role()", async () => {
    const admin = await signInAs("admin@padma.test");
    const { data, error } = await admin.rpc("user_role");
    expect(error).toBeNull();
    expect(data).toBe("admin");
  });
});

describe("yang TIDAK boleh ikut rusak", () => {
  it("katalog publik tetap terbaca anon TANPA error hak fungsi", async () => {
    // Regresi nyata yang hampir terjadi: policy `staf kelola` pada
    // phases/services/packages berlaku `to public` dan memanggil
    // `user_role()`. Begitu EXECUTE dicabut dari anon, SELECT anon atas
    // katalog gagal "permission denied for function user_role" — bukan
    // 0 baris. Migration ini karena itu mempersempit policy staf menjadi
    // `to authenticated` (secara semantik identik: `user_role()` tak pernah
    // mengembalikan admin/owner untuk anon).
    for (const tabel of ["phases", "services", "packages"] as const) {
      const { error } = await anonClient().from(tabel).select("id");
      expect(error, `anon select ${tabel}`).toBeNull();
    }
  });

  it("policy yang memanggil user_role() tidak lagi menyasar peran anon", async () => {
    const menyasarPublic = await querySql<{ tabel: string; policy: string }>(
      `select tablename as tabel, policyname as policy
         from pg_policies
        where schemaname = 'public'
          and (coalesce(qual, '') like '%user_role%'
               or coalesce(with_check, '') like '%user_role%')
          and 'public' = any (roles)
        order by 1, 2`,
    );
    // `to public` = termasuk anon. Selama policy staf masih menyasar public,
    // anon terpaksa mengevaluasi `user_role()` dan butuh EXECUTE atasnya —
    // tepat hak yang sedang kita cabut.
    expect(menyasarPublic).toEqual([]);
  });

  it("registrasi anon tetap jalan: trigger handle_new_user tetap membentuk profil", async () => {
    // Trigger TIDAK memeriksa ulang hak EXECUTE saat menyala (diprobe
    // langsung), jadi mencabut EXECUTE anon atas fungsi trigger aman.
    const email = `uji-defacl-${Date.now()}@padma.test`;
    const { data, error } = await anonClient().auth.signUp({
      email,
      password: "padma-dev-123",
      options: { data: { full_name: "Uji Default ACL" } },
    });
    expect(error).toBeNull();
    const uid = data.user!.id;
    try {
      const [profil] = await querySql<{ role: string; nama: string }>(
        `select role::text, nama from public.profiles where id = $1`,
        [uid],
      );
      expect(profil?.role).toBe("klien");
      expect(profil?.nama).toBe("Uji Default ACL");
    } finally {
      await querySql(`delete from auth.users where id = $1`, [uid]);
    }
  });

  it("staf tetap bisa mengelola katalog & data lewat policy user_role()", async () => {
    const admin = await signInAs("admin@padma.test");
    const klien = await admin.from("clients").select("id");
    expect(klien.error).toBeNull();
    expect(klien.data!.length).toBeGreaterThanOrEqual(2);

    const owner = await signInAs("owner@padma.test");
    // `service_rates` dijatuhkan Task 5 — tarif kini hidup di `variant_rates`,
    // dijaga policy `user_role()` yang sama.
    const tarif = await owner.from("variant_rates").select("harga_klien");
    expect(tarif.error).toBeNull();
    expect(tarif.data!.length).toBeGreaterThanOrEqual(10);
  });
});
