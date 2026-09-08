/**
 * GERBANG SKRINING DI LAPIS BASIS DATA (spec C1 J3).
 *
 * Seluruh berkas ini menembak PostgREST langsung dengan sesi JWT sungguhan —
 * tidak satu pun lewat server action. Sebabnya klien memegang policy INSERT
 * atas `booking_requests` dan memang bisa melakukannya; gerbang yang hanya
 * hidup di server action adalah gerbang yang bisa dilewati satu panggilan API.
 *
 * Ini pelajaran C1-a yang tidak diulang: di sana gerbang JAM sempat hanya
 * dipasang di server action, dan tinjauan menemukannya terbuka.
 *
 * PostgREST menjawab tulisan yang tertahan RLS dengan 200 + [], bukan 403 —
 * karena itu setiap uji membaca ULANG dengan service role.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { varianBaku } from "./helpers/varian";
import { skriningHijau } from "./helpers/skrining";
import { querySql } from "./helpers/db";

const admin = createAdminSupabase();

const ANANDA = "44444444-4444-4444-4444-444444444401";
const RINA = "44444444-4444-4444-4444-444444444402";
const SVC = "11111111-1111-1111-1111-111111111101";
const TGL = "2027-04-10";

let VARIAN: string;
let sesiAnanda: SupabaseClient;

async function bersihkan() {
  await admin.from("booking_requests").delete().eq("tanggal", TGL);
  await admin.from("screenings").delete().like("kode", "UJI-%");
}

function pengajuan(screeningId: string, clientId: string = ANANDA) {
  return {
    client_id: clientId,
    service_id: SVC,
    variant_id: VARIAN,
    tanggal: TGL,
    jam_mulai: "09:00",
    preferensi_waktu: "pagi",
    alamat: "Jl. Uji Skrining No. 5",
    status: "diminta",
    screening_id: screeningId,
  };
}

async function barisPada(): Promise<number> {
  const { count } = await admin
    .from("booking_requests")
    .select("id", { count: "exact", head: true })
    .eq("tanggal", TGL);
  return count ?? 0;
}

beforeAll(async () => {
  sesiAnanda = await signInAs("ananda@padma.test");
  VARIAN = await varianBaku(admin, SVC);
  await bersihkan();
});

beforeEach(bersihkan);
afterAll(bersihkan);

describe("pengajuan wajib berdiri di atas skrining hijau MILIK PEMESANNYA", () => {
  it("skrining hijau miliknya sendiri: DITERIMA", async () => {
    const s = await skriningHijau(admin, ANANDA);
    const { error } = await sesiAnanda.from("booking_requests").insert(pengajuan(s));
    expect(error).toBeNull();
    expect(await barisPada()).toBe(1);
  });

  it("skrining MERAH ditolak", async () => {
    // Merah berarti "perlu evaluasi dokter lebih dulu", dan seluruh maksud
    // gerbang ini adalah menahan pemesanan sampai itu selesai.
    const s = await skriningHijau(admin, ANANDA, { hasil: "merah" });
    const { error } = await sesiAnanda.from("booking_requests").insert(pengajuan(s));
    expect(error).not.toBeNull();
    expect(await barisPada()).toBe(0);
  });

  it("skrining MILIK ORANG LAIN ditolak, walau hijau", async () => {
    // Tanpa syarat kepemilikan, klien bisa menumpang skrining hijau orang lain
    // yang id-nya ia ketahui — dan id itu tidak rahasia begitu ia pernah
    // muncul di layar mana pun.
    const s = await skriningHijau(admin, RINA);
    const { error } = await sesiAnanda.from("booking_requests").insert(pengajuan(s));
    expect(error).not.toBeNull();
    expect(await barisPada()).toBe(0);
  });

  it("skrining yang SUDAH DIPAKAI pengajuan lain ditolak", async () => {
    // "Hangus setelah dipakai" adalah fakta basis data (indeks unik), bukan
    // kebiasaan kode.
    const s = await skriningHijau(admin, ANANDA);
    const pertama = await sesiAnanda.from("booking_requests").insert(pengajuan(s));
    expect(pertama.error).toBeNull();

    const kedua = await sesiAnanda
      .from("booking_requests")
      .insert({ ...pengajuan(s), tanggal: TGL, preferensi_waktu: "sore" });
    expect(kedua.error).not.toBeNull();
    expect(await barisPada()).toBe(1);
  });

  it("screening_id yang tidak ada sama sekali ditolak foreign key", async () => {
    const { error } = await sesiAnanda
      .from("booking_requests")
      .insert(pengajuan("00000000-0000-0000-0000-000000000000"));
    expect(error).not.toBeNull();
    expect(await barisPada()).toBe(0);
  });
});

describe("hak baca & tulis klien atas `screenings`", () => {
  it("klien membaca skriningnya sendiri", async () => {
    const s = await skriningHijau(admin, ANANDA);
    const { data } = await sesiAnanda.from("screenings").select("id").eq("id", s);
    expect((data ?? []).map((b) => b.id)).toEqual([s]);
  });

  it("klien mendapat NOL baris untuk skrining orang lain", async () => {
    const s = await skriningHijau(admin, RINA);
    const { data } = await sesiAnanda.from("screenings").select("id").eq("id", s);
    expect(data ?? []).toEqual([]);
  });

  it("klien TIDAK punya hak menulis skrining", async () => {
    // Bila peramban boleh mengirim `hasil`, seluruh gerbang di atas runtuh
    // menjadi satu baris JSON: klien cukup menyisipkan skrining 'hijau' untuk
    // dirinya sendiri lalu memesan.
    const { error } = await sesiAnanda.from("screenings").insert({
      kode: "UJI-CURANG",
      nama: "Curang",
      no_hp: "0",
      fase: "prekonsepsi",
      jawaban: {},
      hasil: "hijau",
      flags: [],
      client_id: ANANDA,
    });
    expect(error).not.toBeNull();
  });
});

describe("tabel token klaim tertutup rapat", () => {
  it("anon & authenticated tidak punya hak tabel apa pun atas screening_claims", async () => {
    const baris = await querySql<{ grantee: string; privilege_type: string }>(
      `select grantee, privilege_type
         from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'screening_claims'
          and grantee in ('anon', 'authenticated')`,
    );
    expect(baris).toEqual([]);
  });

  it("RLS menyala dan TIDAK ada satu pun policy — nol baris untuk peran API", async () => {
    const [{ rls }] = await querySql<{ rls: boolean }>(
      "select relrowsecurity as rls from pg_class where oid = 'public.screening_claims'::regclass",
    );
    expect(rls).toBe(true);

    const policy = await querySql<{ policyname: string }>(
      "select policyname from pg_policies where schemaname = 'public' and tablename = 'screening_claims'",
    );
    expect(policy).toEqual([]);
  });
});
