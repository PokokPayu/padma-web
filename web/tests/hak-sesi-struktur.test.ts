/**
 * BENTUK & HAK TABEL C3-a (spec C3 P3, P4, P6).
 *
 * Yang dijaga di sini adalah struktur, bukan perilaku: perilaku RPC diuji di
 * `tests/pembatalan-rpc.test.ts`. Pemisahannya disengaja — struktur yang salah
 * membuat seluruh uji perilaku gagal dengan pesan yang menunjuk ke tempat yang
 * salah.
 */
import { describe, it, expect, afterAll } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { querySql } from "./helpers/db";

const admin = createAdminSupabase();

const ANANDA = "44444444-4444-4444-4444-444444444401";
// Klien KEDUA. Rina punya baris `clients` tetapi SENGAJA tanpa akun auth
// (`scripts/seed-users.ts` menegakkan itu), jadi ia tidak bisa login — dan
// memang tidak perlu: yang diuji adalah Ananda yang login MENCOBA menyentuh
// baris milik orang lain, bukan Rina yang mencoba apa pun.
const RINA = "44444444-4444-4444-4444-444444444402";
const SVC = "11111111-1111-1111-1111-111111111101";

afterAll(async () => {
  await admin.from("hak_sesi").delete().eq("client_id", ANANDA);
  await admin.from("hak_sesi").delete().eq("client_id", RINA);
});

describe("hak_sesi tidak punya satu pun kolom uang", () => {
  it("kolomnya hanya identitas, tanggal, dan rujukan", async () => {
    // Bila kelak seseorang menambahkan `nilai_kredit`, money firewall akan
    // merah lebih dulu. Uji ini menyebut alasannya dengan kalimat, supaya yang
    // membacanya tahu bahwa ketiadaan nominal adalah keputusan.
    const kolom = await querySql<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'hak_sesi'`,
    );
    expect(kolom.map((k) => k.column_name).sort()).toEqual(
      [
        "client_id",
        "created_at",
        "dipakai_sesi_id",
        "id",
        "kedaluwarsa",
        "service_id",
        "sesi_asal_id",
      ].sort(),
    );
  });
});

describe("satu hak hanya bisa dipakai sekali", () => {
  it("indeks uniknya PARSIAL — dua hak yang belum dipakai boleh hidup bersama", async () => {
    // Tanpa `where dipakai_sesi_id is not null`, hanya SATU hak di seluruh
    // tabel yang boleh belum terpakai, dan klien kedua yang membatalkan akan
    // ditolak dengan galat yang tidak masuk akal.
    const { error: e1 } = await admin.from("hak_sesi").insert({
      client_id: ANANDA,
      service_id: SVC,
      kedaluwarsa: "2027-12-31",
    });
    const { error: e2 } = await admin.from("hak_sesi").insert({
      client_id: ANANDA,
      service_id: SVC,
      kedaluwarsa: "2027-12-31",
    });
    expect(e1).toBeNull();
    expect(e2).toBeNull();
  });

  it("dua hak TIDAK bisa menunjuk sesi terpakai yang sama", async () => {
    const sesiPalsu = "99999999-9999-9999-9999-999999999901";
    const { data } = await admin
      .from("hak_sesi")
      .select("id")
      .eq("client_id", ANANDA)
      .limit(2);
    const [a, b] = data as { id: string }[];

    const { error: ea } = await admin
      .from("hak_sesi")
      .update({ dipakai_sesi_id: sesiPalsu })
      .eq("id", a.id);
    const { error: eb } = await admin
      .from("hak_sesi")
      .update({ dipakai_sesi_id: sesiPalsu })
      .eq("id", b.id);

    expect(ea).toBeNull();
    expect(eb, "satu sesi bisa lahir dari dua hak sekaligus").not.toBeNull();

    await admin.from("hak_sesi").update({ dipakai_sesi_id: null }).eq("id", a.id);
  });
});

describe("klien tidak bisa mencetak haknya sendiri", () => {
  it("klien MEMBACA miliknya", async () => {
    const sesi = await signInAs("ananda@padma.test");
    const { data, error } = await sesi.from("hak_sesi").select("id");
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("klien TIDAK bisa menyisipkan hak", async () => {
    // Klien yang bisa menyisipkan barisnya sendiri adalah klien yang bisa
    // mencetak sesi gratis tanpa batas.
    const sesi = await signInAs("ananda@padma.test");
    const { error } = await sesi.from("hak_sesi").insert({
      client_id: ANANDA,
      service_id: SVC,
      kedaluwarsa: "2099-12-31",
    });
    expect(error).not.toBeNull();
  });

  it("klien TIDAK bisa memperpanjang kedaluwarsa haknya", async () => {
    const sesi = await signInAs("ananda@padma.test");
    const { data } = await sesi.from("hak_sesi").select("id").limit(1);
    const { data: sesudah, error } = await sesi
      .from("hak_sesi")
      .update({ kedaluwarsa: "2099-12-31" })
      .eq("id", (data as { id: string }[])[0].id)
      .select("id");
    // RLS tanpa policy UPDATE memulangkan NOL BARIS, bukan galat — bentuk
    // kegagalan yang paling mudah dikira berhasil.
    expect(error === null ? (sesudah ?? []).length : 0).toBe(0);
  });

  it("klien TIDAK bisa melihat hak milik klien lain", async () => {
    await admin.from("hak_sesi").insert({
      client_id: RINA,
      service_id: SVC,
      kedaluwarsa: "2027-12-31",
    });
    const sesi = await signInAs("ananda@padma.test");
    const { data } = await sesi.from("hak_sesi").select("client_id");
    expect((data ?? []).every((h) => h.client_id === ANANDA)).toBe(true);
  });
});

describe("jejak jadwal tidak bisa dihapus oleh yang diaudit", () => {
  it("`authenticated` tidak memegang DELETE", async () => {
    const baris = await querySql<{ ada: boolean }>(
      `select has_table_privilege('authenticated', 'public.jejak_jadwal', 'delete') as ada`,
    );
    expect(baris[0].ada).toBe(false);
  });

  it("tidak punya foreign key ke sessions — cascade akan menghapus buktinya", async () => {
    const fk = await querySql<{ jml: string }>(
      `select count(*) as jml from information_schema.table_constraints
        where table_schema = 'public' and table_name = 'jejak_jadwal'
          and constraint_type = 'FOREIGN KEY'`,
    );
    expect(Number(fk[0].jml)).toBe(0);
  });
});

describe("jatah jadwal ulang lahir kosong", () => {
  it("kolomnya not null dengan default false", async () => {
    const baris = await querySql<{ is_nullable: string; column_default: string }>(
      `select is_nullable, column_default from information_schema.columns
        where table_schema = 'public' and table_name = 'sessions'
          and column_name = 'jadwal_ulang_terpakai'`,
    );
    expect(baris[0].is_nullable).toBe("NO");
    expect(baris[0].column_default).toBe("false");
  });
});
