import { describe, it, expect, afterAll } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs, anonClient } from "./helpers/as-user";
import { querySql } from "./helpers/db";

/**
 * REGISTRI KUNCI PENGATURAN — menutup money firewall lewat BARIS.
 *
 * `tests/money-firewall-struktural.test.ts` menjaga satu invarian yang kuat:
 * nominal uang hanya boleh hidup sebagai KOLOM di `variant_rates` &
 * `honor_marks`. Ia buta terhadap satu bentuk: `app_settings (key text,
 * value text)` membuat nominal bisa hidup sebagai BARIS, dan tidak ada satu
 * pun nama kolom yang berubah. Direproduksi sebagai admin sungguhan sebelum
 * berkas ini ditulis:
 *
 *   POST /rest/v1/app_settings  {"key":"uji","value":"425000"}  -> HTTP 201
 *   -- nol test merah, nominal rupiah kini terbaca seluruh panel admin.
 *
 * Pagar yang dipasang bukan validasi di aplikasi (server action bisa
 * dilewati — PostgREST terbuka untuk siapa pun yang memegang JWT admin),
 * melainkan FK ke tabel registri `app_setting_keys`. Karena itu assertion di
 * bawah menembak REST langsung sebagai admin, bukan lewat server action.
 *
 * ===== KENAPA REGISTRINYA SENDIRI HARUS TERKUNCI =====
 * Tabel baru di Supabase LAHIR dengan INSERT+UPDATE untuk `authenticated`
 * (default privileges hari ini hanya mencabut ALL untuk anon, serta TRUNCATE
 * & DELETE untuk authenticated — lihat tests/hak-hapus-berlebih.test.ts).
 * Tanpa pencabutan eksplisit, admin cukup mendaftarkan kunci uangnya sendiri
 * lebih dulu dan FK di atas menjadi hiasan. Karena itu describe "registri
 * tidak bisa ditulis staf" sama pentingnya dengan describe pertama.
 */

const svc = createAdminSupabase();

/** Kunci karangan milik berkas ini; tidak pernah terdaftar. */
const KUNCI_LIAR = "PAD-UJI-tarif-sesi";
/** Kunci terdaftar yang seed TIDAK isi — aman dibuat & dibersihkan di sini. */
const KUNCI_SAH = "alamat_klinik";

afterAll(async () => {
  // Hanya baris yang dibuat berkas ini. `nomor_wa` berasal dari seed dan
  // dibutuhkan seluruh aplikasi — ia tidak pernah disentuh di sini.
  await svc.from("app_settings").delete().eq("key", KUNCI_LIAR);
  await svc.from("app_settings").delete().eq("key", KUNCI_SAH);
  await svc.from("app_setting_keys").delete().eq("key", KUNCI_LIAR);
});

// ---------------------------------------------------------------------------
// (A) HANYA KUNCI TERDAFTAR YANG BOLEH ADA
// ---------------------------------------------------------------------------
describe("app_settings hanya menerima kunci terdaftar", () => {
  it("admin ditolak menyelundupkan nominal sebagai baris (23503)", async () => {
    const a = await signInAs("admin@padma.test");
    const { error } = await a
      .from("app_settings")
      .insert({ key: KUNCI_LIAR, value: "425000" })
      .select("key");
    expect(error?.code).toBe("23503"); // foreign_key_violation

    // Kode error tanpa pembacaan ulang tidak membuktikan apa pun.
    const { data } = await svc
      .from("app_settings")
      .select("key")
      .eq("key", KUNCI_LIAR)
      .maybeSingle();
    expect(data).toBeNull();
  });

  it("upsert (bentuk yang dipakai panel) pun ditolak untuk kunci liar", async () => {
    // Panel menyimpan lewat upsert, bukan insert polos — jalur itu wajib
    // ikut tertutup, kalau tidak pagarnya hanya menutup bentuk yang tidak
    // dipakai siapa pun.
    const a = await signInAs("admin@padma.test");
    const { error } = await a
      .from("app_settings")
      .upsert({ key: KUNCI_LIAR, value: "425000" }, { onConflict: "key" });
    expect(error?.code).toBe("23503");
  });

  it("SERVICE ROLE pun ditolak — FK tidak mengenal peran", async () => {
    // Ini yang membedakan FK dari RLS: service role melewati RLS, tetapi
    // constraint integritas berlaku untuk setiap peran, termasuk seed dan
    // skrip pemulihan.
    const { error } = await svc.from("app_settings").insert({ key: KUNCI_LIAR, value: "1" });
    expect(error?.code).toBe("23503");
  });

  it("KONTROL: kunci TERDAFTAR tetap bisa ditulis admin", async () => {
    // Pagar yang menutup segalanya bukan pagar, melainkan kelumpuhan.
    const a = await signInAs("admin@padma.test");
    const { data, error } = await a
      .from("app_settings")
      .upsert({ key: KUNCI_SAH, value: "Layanan homecare Jabodetabek" }, { onConflict: "key" })
      .select("key, value");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].value).toBe("Layanan homecare Jabodetabek");
  });

  it("KONTROL: nomor_wa dari seed selamat & kuncinya terdaftar", async () => {
    // Baris registri lahir DI MIGRATION, bukan di seed: seed berjalan SESUDAH
    // migration dan sudah menyisipkan nomor_wa. Bila urutannya terbalik,
    // `db reset` mati di baris seed itu — dan test ini adalah alarmnya.
    const { data } = await svc
      .from("app_settings")
      .select("key, value")
      .eq("key", "nomor_wa")
      .maybeSingle();
    expect(data).not.toBeNull();
    expect(data!.value).toMatch(/^\d+$/);

    const { data: registri } = await svc
      .from("app_setting_keys")
      .select("key")
      .eq("key", "nomor_wa")
      .maybeSingle();
    expect(registri).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (B) REGISTRINYA SENDIRI TIDAK BISA DITULIS STAF
// ---------------------------------------------------------------------------
describe("registri tidak bisa ditulis staf (kalau tidak, FK-nya hiasan)", () => {
  it("admin ditolak mendaftarkan kunci baru (42501), dan barisnya tidak lahir", async () => {
    const a = await signInAs("admin@padma.test");
    const { error } = await a
      .from("app_setting_keys")
      .insert({ key: KUNCI_LIAR, keterangan: "diselundupkan", bentuk: "teks_polos" });
    expect(error?.code).toBe("42501");

    const { data } = await svc
      .from("app_setting_keys")
      .select("key")
      .eq("key", KUNCI_LIAR)
      .maybeSingle();
    expect(data).toBeNull();
  });

  it("owner pun ditolak (peran SQL-nya sama; ini bukan pagar khusus admin)", async () => {
    const o = await signInAs("owner@padma.test");
    const { error } = await o
      .from("app_setting_keys")
      .insert({ key: KUNCI_LIAR, keterangan: "diselundupkan", bentuk: "teks_polos" });
    expect(error?.code).toBe("42501");
  });

  it("admin ditolak mengubah & menghapus baris registri", async () => {
    const a = await signInAs("admin@padma.test");

    const { error: eUbah } = await a
      .from("app_setting_keys")
      .update({ bentuk: "teks_polos" })
      .eq("key", "nomor_wa");
    expect(eUbah?.code).toBe("42501");

    const { error: eHapus } = await a
      .from("app_setting_keys")
      .delete()
      .eq("key", "nomor_wa");
    expect(eHapus?.code).toBe("42501");

    // Dan bentuknya benar-benar tidak bergeser.
    const { data } = await svc
      .from("app_setting_keys")
      .select("bentuk")
      .eq("key", "nomor_wa")
      .single();
    expect(data!.bentuk).toBe("nomor_wa");
  });

  it("admin TETAP bisa MEMBACA registri (panel butuh label & bentuknya)", async () => {
    const a = await signInAs("admin@padma.test");
    const { data, error } = await a.from("app_setting_keys").select("key, keterangan, bentuk");
    expect(error).toBeNull();
    expect(data!.map((r) => r.key).sort()).toEqual([
      "alamat_klinik",
      "jam_layanan",
      "jam_operasional",
      "nomor_wa",
      "qris_gambar",
      "qris_merchant",
      "qris_nmid",
    ]);
    for (const r of data!) {
      expect(r.keterangan.length, `kunci ${r.key} wajib punya keterangan`).toBeGreaterThan(0);
      expect(["nomor_wa", "teks_polos", "daftar_jam"]).toContain(r.bentuk);
    }
  });

  it("hak tabel: authenticated hanya SELECT atas registri", async () => {
    // Perilaku 42501 di atas bisa saja datang dari RLS. Yang dijaga di sini
    // adalah lapis di bawahnya: haknya memang tidak pernah ada.
    const baris = await querySql<{ privilege_type: string }>(`
      select privilege_type from information_schema.role_table_grants
       where table_schema='public' and table_name='app_setting_keys'
         and grantee='authenticated'
       order by 1`);
    expect(baris.map((b) => b.privilege_type)).toEqual(["SELECT"]);
  });
});

// ---------------------------------------------------------------------------
// (C) YANG TIDAK BERHAK SAMA SEKALI
// ---------------------------------------------------------------------------
describe("registri & setelan tertutup untuk yang tidak berhak", () => {
  it("anon ditolak membaca registri (42501, bukan '0 baris')", async () => {
    const { data, error } = await anonClient().from("app_setting_keys").select("*");
    expect(data ?? []).toHaveLength(0);
    expect(error?.code).toBe("42501");
  });

  it("anon ditolak membaca app_settings (tidak ikut bergeser)", async () => {
    const { data, error } = await anonClient().from("app_settings").select("*");
    expect(data ?? []).toHaveLength(0);
    expect(error?.code).toBe("42501");
  });

  it("anon tidak memegang satu hak tabel pun atas registri", async () => {
    const baris = await querySql<{ privilege_type: string }>(`
      select privilege_type from information_schema.role_table_grants
       where table_schema='public' and table_name='app_setting_keys' and grantee='anon'`);
    expect(baris).toEqual([]);
  });

  it("klien tidak melihat isi registri (RLS menyaring, hak baca tetap ada)", async () => {
    // Klien memegang SELECT di level tabel — pembatasnya RLS. Jawaban yang
    // benar adalah 0 baris tanpa error, bukan 42501.
    const k = await signInAs("ananda@padma.test");
    const { data, error } = await k.from("app_setting_keys").select("key");
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("klien tidak bisa menulis app_settings (money firewall lewat baris)", async () => {
    const k = await signInAs("ananda@padma.test");
    const { data, error } = await k
      .from("app_settings")
      .insert({ key: "nomor_wa", value: "6280000000000" })
      .select("key");
    expect(data ?? []).toHaveLength(0);
    expect(error).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (D) INVARIAN STRUKTURAL
// ---------------------------------------------------------------------------
describe("bentuk pagar — struktural, bukan perilaku", () => {
  it("FK app_settings.key -> app_setting_keys.key benar-benar terpasang", async () => {
    const baris = await querySql<{ conname: string }>(`
      select c.conname
        from pg_constraint c
        join pg_class t on t.oid = c.conrelid
        join pg_class r on r.oid = c.confrelid
       where t.relname = 'app_settings' and c.contype = 'f' and r.relname = 'app_setting_keys'`);
    expect(baris.map((b) => b.conname)).toEqual(["app_settings_key_terdaftar"]);
  });

  it("RLS menyala pada registri", async () => {
    const baris = await querySql<{ relrowsecurity: boolean }>(`
      select c.relrowsecurity
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = 'app_setting_keys'`);
    expect(baris[0]?.relrowsecurity).toBe(true);
  });

  it("policy registri menyasar authenticated, bukan public", async () => {
    // Policy `to public` memaksa anon mengevaluasi `user_role()` dan
    // membutuhkan EXECUTE atasnya — hak yang sudah dicabut migration
    // `fail_closed_sequence_fungsi`. Lihat tests/hak-default-sequence-fungsi.
    const baris = await querySql<{ policyname: string; roles: string[]; cmd: string }>(`
      select policyname, roles::text[] as roles, cmd
        from pg_policies
       where schemaname='public' and tablename='app_setting_keys'`);
    expect(baris.length).toBeGreaterThan(0);
    for (const p of baris) {
      expect(p.roles).not.toContain("public");
      expect(p.roles).toContain("authenticated");
      expect(p.cmd).toBe("SELECT");
    }
  });

  it("bentuk hanya boleh nilai yang dikenal validator (CHECK, bukan konvensi)", async () => {
    const { error } = await svc
      .from("app_setting_keys")
      .insert({ key: KUNCI_LIAR, keterangan: "bentuk asing", bentuk: "html_bebas" });
    expect(error?.code).toBe("23514");
  });

  it("tidak ada satu baris app_settings pun yang kuncinya di luar registri", async () => {
    // Menjaga migration pembersihnya tetap bermakna: bila seseorang kelak
    // menonaktifkan FK-nya, baris liar akan muncul lagi dan tertangkap di sini.
    const baris = await querySql<{ key: string }>(`
      select key from public.app_settings
       where key not in (select key from public.app_setting_keys)
       order by 1`);
    expect(baris.map((b) => b.key)).toEqual([]);
  });
});
