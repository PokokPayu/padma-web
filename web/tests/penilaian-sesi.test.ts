/**
 * PENILAIAN SESI (spec C1 J10).
 *
 * Klien memegang hak TULIS atas tabel ini — satu-satunya tabel di repo ini
 * selain `booking_requests` yang begitu. Karena itu setiap pagar diuji lewat
 * sesi JWT sungguhan, bukan service role: di bawah service role "pagar bekerja"
 * dan "pagar tidak ada" terlihat identik.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { varianBaku } from "./helpers/varian";
import { querySql } from "./helpers/db";

const admin = createAdminSupabase();

const ANANDA = "44444444-4444-4444-4444-444444444401";
const RINA = "44444444-4444-4444-4444-444444444402";
const SVC = "11111111-1111-1111-1111-111111111101";
const MITRA_A = "33333333-3333-3333-3333-333333333301";
const MITRA_B = "33333333-3333-3333-3333-333333333302";
const TGL = "2027-06-15";

let VARIAN: string;
let sesiAnanda: SupabaseClient;

async function bersihkan() {
  await admin.from("session_ratings").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await admin.from("sessions").delete().eq("tanggal", TGL);
}

/** Satu sesi milik `clientId` pada status tertentu. */
async function buatSesi(
  status: "selesai" | "terjadwal",
  clientId: string = ANANDA,
  partnerId: string = MITRA_A,
): Promise<string> {
  const { data, error } = await admin
    .from("sessions")
    .insert({
      client_id: clientId,
      service_id: SVC,
      variant_id: VARIAN,
      partner_id: partnerId,
      tanggal: TGL,
      jam_mulai: "09:00",
      status,
      catatan: "",
      rekomendasi: "",
      status_bayar: "belum",
    })
    .select("id")
    .single<{ id: string }>();
  if (error) throw error;
  return data.id;
}

function nilai(sessionId: string, ubah: Record<string, unknown> = {}) {
  return {
    session_id: sessionId,
    // Sengaja DIISI dengan nilai yang salah di beberapa uji: trigger menulis
    // ulang ketiganya dari baris sesi, jadi apa pun yang dikirim peramban di
    // sini tidak boleh berpengaruh.
    client_id: ANANDA,
    partner_id: MITRA_A,
    variant_id: VARIAN,
    bintang_layanan: 5,
    bintang_bidan: 5,
    komentar: "",
    ...ubah,
  };
}

beforeAll(async () => {
  sesiAnanda = await signInAs("ananda@padma.test");
  VARIAN = await varianBaku(admin, SVC);
  await bersihkan();
});

beforeEach(bersihkan);
afterAll(bersihkan);

describe("hanya sesi MILIKNYA yang SELESAI yang bisa dinilai", () => {
  it("sesi sendiri yang selesai: DITERIMA", async () => {
    const s = await buatSesi("selesai");
    const { error } = await sesiAnanda.from("session_ratings").insert(nilai(s));
    expect(error).toBeNull();
  });

  it("sesi yang BELUM selesai ditolak", async () => {
    // Menilai sesi yang belum terjadi adalah menilai sesuatu yang belum ada.
    const s = await buatSesi("terjadwal");
    const { error } = await sesiAnanda.from("session_ratings").insert(nilai(s));
    expect(error).not.toBeNull();
  });

  it("sesi MILIK ORANG LAIN ditolak, walau payload menyebut client_id sendiri", async () => {
    const s = await buatSesi("selesai", RINA);
    const { error } = await sesiAnanda
      .from("session_ratings")
      .insert(nilai(s, { client_id: ANANDA }));
    expect(error).not.toBeNull();

    const { count } = await admin
      .from("session_ratings")
      .select("id", { count: "exact", head: true })
      .eq("session_id", s);
    expect(count).toBe(0);
  });

  it("SATU penilaian per sesi — yang kedua ditolak", async () => {
    const s = await buatSesi("selesai");
    expect((await sesiAnanda.from("session_ratings").insert(nilai(s))).error).toBeNull();
    expect((await sesiAnanda.from("session_ratings").insert(nilai(s))).error).not.toBeNull();
  });

  it("pemiliknya BOLEH memperbarui bintangnya — orang berhak berubah pikiran", async () => {
    const s = await buatSesi("selesai");
    await sesiAnanda.from("session_ratings").insert(nilai(s, { bintang_bidan: 3 }));

    const { error } = await sesiAnanda
      .from("session_ratings")
      .update({ bintang_bidan: 5 })
      .eq("session_id", s);
    expect(error).toBeNull();

    const { data } = await admin
      .from("session_ratings")
      .select("bintang_bidan")
      .eq("session_id", s)
      .maybeSingle<{ bintang_bidan: number }>();
    expect(data?.bintang_bidan).toBe(5);
  });
});

describe("bintang dibatasi 1–5", () => {
  it("menolak 0, 6, dan negatif", async () => {
    const s = await buatSesi("selesai");
    for (const buruk of [0, 6, -1]) {
      const { error } = await sesiAnanda
        .from("session_ratings")
        .insert(nilai(s, { bintang_layanan: buruk }));
      expect(error, `bintang ${buruk} seharusnya ditolak`).not.toBeNull();
    }
  });

  it("menolak komentar yang melewati batas panjang", async () => {
    const s = await buatSesi("selesai");
    const { error } = await sesiAnanda
      .from("session_ratings")
      .insert(nilai(s, { komentar: "x".repeat(1001) }));
    expect(error).not.toBeNull();
  });
});

describe("SALINAN keadaan saat itu", () => {
  it("partner_id & variant_id ditulis ulang dari sesi, bukan dari payload", async () => {
    // Payload menyebut mitra B; sesinya milik mitra A. Yang tersimpan wajib A.
    const s = await buatSesi("selesai", ANANDA, MITRA_A);
    await sesiAnanda.from("session_ratings").insert(nilai(s, { partner_id: MITRA_B }));

    const { data } = await admin
      .from("session_ratings")
      .select("partner_id")
      .eq("session_id", s)
      .maybeSingle<{ partner_id: string }>();
    expect(data?.partner_id).toBe(MITRA_A);
  });

  it("penilaian TIDAK ikut berpindah ketika mitra pada sesinya diganti", async () => {
    // INILAH alasan kolom salinan ada. Mitra pada sebuah sesi bisa berganti —
    // bidan sakit, atau sesinya dijadwalkan ulang di C3. Penilaian yang
    // menempel lewat rujukan akan diam-diam berpindah ke orang lain, dan tidak
    // ada satu pun galat yang memberi tahu.
    const s = await buatSesi("selesai", ANANDA, MITRA_A);
    await sesiAnanda.from("session_ratings").insert(nilai(s));

    await admin.from("sessions").update({ partner_id: MITRA_B }).eq("id", s);

    const { data } = await admin
      .from("session_ratings")
      .select("partner_id")
      .eq("session_id", s)
      .maybeSingle<{ partner_id: string }>();
    expect(data?.partner_id, "penilaian berpindah ke bidan lain").toBe(MITRA_A);
  });
});

describe("siapa boleh melihat apa", () => {
  it("klien lain mendapat NOL baris", async () => {
    const s = await buatSesi("selesai", RINA, MITRA_A);
    // Ditulis service role supaya barisnya ada tanpa melewati pagar klien.
    await admin.from("session_ratings").insert({
      session_id: s,
      client_id: RINA,
      partner_id: MITRA_A,
      variant_id: VARIAN,
      bintang_layanan: 2,
      bintang_bidan: 2,
      komentar: "rahasia milik orang lain",
    });

    const { data } = await sesiAnanda.from("session_ratings").select("id").eq("session_id", s);
    expect(data ?? []).toEqual([]);
  });

  it("staf membaca semua", async () => {
    const s = await buatSesi("selesai");
    await sesiAnanda.from("session_ratings").insert(nilai(s));

    const sesiAdmin = await signInAs("admin@padma.test");
    const { data } = await sesiAdmin.from("session_ratings").select("id").eq("session_id", s);
    expect((data ?? []).length).toBe(1);
  });

  it("TIDAK ADA view agregat atas penilaian", async () => {
    // View agregat persis yang dulu membocorkan rate card lengkap ke admin di
    // repo ini: ia melewati RLS dan menyajikan angka yang sudah dijumlahkan
    // tanpa satu pun pagar per-baris.
    const baris = await querySql<{ nama: string }>(
      `select c.relname as nama
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'v'
          and pg_get_viewdef(c.oid) ilike '%session_ratings%'`,
    );
    expect(baris.map((b) => b.nama)).toEqual([]);
  });

  it("penilaian tidak bisa DIHAPUS peran API mana pun", async () => {
    const s = await buatSesi("selesai");
    await sesiAnanda.from("session_ratings").insert(nilai(s));

    const { error } = await sesiAnanda.from("session_ratings").delete().eq("session_id", s);
    expect(error).not.toBeNull();

    const { count } = await admin
      .from("session_ratings")
      .select("id", { count: "exact", head: true })
      .eq("session_id", s);
    expect(count).toBe(1);
  });
});
