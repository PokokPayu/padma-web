/**
 * KLIEN MEMBATALKAN PENGAJUANNYA SENDIRI (spec C1 J8).
 *
 * Empat pagar berlapis diuji satu per satu, karena masing-masing bisa hilang
 * sendiri-sendiri: policy RLS (baris siapa), `guard_booking_klien_batal` (medan
 * mana), `guard_booking_status` (status tujuan mana), dan
 * `guard_booking_perpindahan` (dari keadaan mana).
 *
 * SETIAP pagar diuji lewat SESI JWT SUNGGUHAN, bukan service role: di bawah
 * service role "pagar bekerja" dan "pagar tidak ada" terlihat identik.
 * PostgREST menjawab tulisan yang tertahan RLS dengan 200 + [], bukan 403 —
 * karena itu setiap uji membaca ULANG barisnya dengan service role. "Tidak ada
 * error" bukan bukti apa pun.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { varianBaku } from "./helpers/varian";
import { BATAS_PERMINTAAN_MENUNGGU as BATAS } from "@/lib/passport/batas";

const admin = createAdminSupabase();
const AKAR = path.resolve(__dirname, "..");

const ANANDA = "44444444-4444-4444-4444-444444444401";
/**
 * Klien KEDUA. Barisnya sengaja BELUM tertaut ke akun auth mana pun (fixture
 * "klien yang belum mengaktifkan akunnya"), jadi ia tidak punya sesi untuk
 * dipakai login. Pagar kepemilikan karena itu diuji dari arah sebaliknya: sesi
 * ANANDA menembak baris milik RINA. Yang dibuktikan sama persis — policy
 * `using` hanya memperlihatkan baris milik pemanggil.
 */
const RINA = "44444444-4444-4444-4444-444444444402";
const SVC = "11111111-1111-1111-1111-111111111101";
const MITRA = "33333333-3333-3333-3333-333333333301";
const TGL = "2026-12-28";
const JAM = "09:00";

const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: async () => ref.sesi! }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NOTFOUND");
  },
}));

const { batalkanPengajuan } = await import("@/lib/passport/aksi");

let VARIAN: string;
let sesiAnanda: SupabaseClient;

async function bersihkan() {
  await admin.from("sessions").delete().eq("tanggal", TGL);
  await admin.from("booking_requests").delete().eq("tanggal", TGL);
  await admin.from("booking_requests").delete().gte("tanggal", "2027-01-01").lte("tanggal", "2027-01-31");
}

async function permintaanPada(
  status: string,
  clientId: string = ANANDA,
  tanggal: string = TGL,
): Promise<string> {
  const { data, error } = await admin
    .from("booking_requests")
    .insert({
      client_id: clientId,
      service_id: SVC,
      variant_id: VARIAN,
      partner_id: status === "mitra_siap" || status === "dikonfirmasi" ? MITRA : null,
      tanggal,
      jam_mulai: JAM,
      preferensi_waktu: "pagi",
      alamat: "Jl. Uji Batal No. 3",
      status,
    })
    .select("id")
    .single<{ id: string }>();
  if (error) throw error;
  return data.id;
}

async function bacaBaris(id: string) {
  const { data } = await admin
    .from("booking_requests")
    .select("status, tanggal, jam_mulai, alamat")
    .eq("id", id)
    .maybeSingle<{ status: string; tanggal: string; jam_mulai: string; alamat: string }>();
  return data;
}

beforeAll(async () => {
  sesiAnanda = await signInAs("ananda@padma.test");
  ref.sesi = sesiAnanda;
  VARIAN = await varianBaku(admin, SVC);
  await bersihkan();
});

beforeEach(async () => {
  ref.sesi = sesiAnanda;
  await bersihkan();
});

afterAll(bersihkan);

describe("klien membatalkan pengajuannya sendiri", () => {
  it("berhasil dari KETIGA keadaan antrean", async () => {
    for (const dari of ["diminta", "mencari_mitra", "mitra_siap"]) {
      await bersihkan();
      const id = await permintaanPada(dari);
      expect(await batalkanPengajuan(id), `dari ${dari}`).toEqual({ ok: true });
      expect((await bacaBaris(id))?.status).toBe("dibatalkan_klien");
    }
  });

  it("antrean berkurang, sehingga klien bisa mengajukan lagi", async () => {
    // INILAH alasan seluruh tugas ini ada. Tanpa jalan keluar ini, klien yang
    // mengajukan lima tanggal yang tidak bisa dilayani terkunci selamanya —
    // admin tidak lagi menolak, dan batasnya tetap lima.
    const ids: string[] = [];
    for (let i = 0; i < BATAS; i++) {
      ids.push(
        await permintaanPada("diminta", ANANDA, `2027-01-${String(i + 1).padStart(2, "0")}`),
      );
    }
    const { count: sebelum } = await admin
      .from("booking_requests")
      .select("id", { count: "exact", head: true })
      .eq("client_id", ANANDA)
      .in("status", ["diminta", "mencari_mitra", "mitra_siap"]);
    expect(sebelum).toBe(BATAS);

    expect(await batalkanPengajuan(ids[0])).toEqual({ ok: true });

    const { count: sesudah } = await admin
      .from("booking_requests")
      .select("id", { count: "exact", head: true })
      .eq("client_id", ANANDA)
      .in("status", ["diminta", "mencari_mitra", "mitra_siap"]);
    expect(sesudah).toBe(BATAS - 1);
  });

  it("pengajuan yang sudah DIKONFIRMASI tidak bisa dibatalkan lewat jalur ini", async () => {
    // Sesinya sudah lahir; pembatalan sesi menyangkut uang dan tenggat waktu,
    // dan seluruhnya milik C3 — ia bekerja pada `sessions`, bukan di sini.
    const id = await permintaanPada("dikonfirmasi");
    const hasil = await batalkanPengajuan(id);
    expect(hasil.ok).toBe(false);
    expect((await bacaBaris(id))?.status).toBe("dikonfirmasi");
  });
});

describe("pagar ditembak LANGSUNG ke PostgREST, tanpa server action", () => {
  it("klien tidak bisa membatalkan pengajuan MILIK ORANG LAIN", async () => {
    const id = await permintaanPada("diminta", RINA);
    const { data } = await sesiAnanda
      .from("booking_requests")
      .update({ status: "dibatalkan_klien" })
      .eq("id", id)
      .select("id");
    expect(data ?? []).toEqual([]);
    expect((await bacaBaris(id))?.status).toBe("diminta");
  });

  it("klien tidak bisa menumpangi UPDATE ini untuk mengubah medan LAIN", async () => {
    // Lubang yang paling mudah terlewat: policy UPDATE membuka SELURUH kolom
    // yang boleh ditulis peran itu, bukan hanya `status`. Tanpa kunci kolom,
    // klien bisa menggeser tanggal, jam, atau alamat sambil berpura-pura
    // membatalkan.
    const id = await permintaanPada("diminta", ANANDA);
    const { error } = await sesiAnanda
      .from("booking_requests")
      .update({ status: "dibatalkan_klien", tanggal: "2027-06-01", jam_mulai: "16:00" })
      .eq("id", id)
      .select("id");
    expect(error).not.toBeNull();

    const baris = await bacaBaris(id);
    expect(baris?.tanggal).toBe(TGL);
    expect(baris?.jam_mulai).toBe("09:00:00");
    expect(baris?.status).toBe("diminta");
  });

  it("klien tidak bisa menulis status selain dibatalkan_klien", async () => {
    const id = await permintaanPada("mitra_siap", ANANDA);
    const { error } = await sesiAnanda
      .from("booking_requests")
      .update({ status: "dikonfirmasi" })
      .eq("id", id)
      .select("id");
    expect(error).not.toBeNull();
    expect((await bacaBaris(id))?.status).toBe("mitra_siap");
  });
});

describe("penolakan admin tidak lagi terjangkau dari layar (spec J8)", () => {
  function berkasTsx(dir: string): string[] {
    const hasil: string[] = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) hasil.push(...berkasTsx(p));
      else if (e.name.endsWith(".tsx")) hasil.push(p);
    }
    return hasil;
  }

  it("tidak ada berkas di src/ yang MEMANGGIL tolakPermintaan", () => {
    // Nilai enum `ditolak` dan penjaganya TETAP di tempatnya — hanya tidak
    // lagi terjangkau dari layar, persis pola saklar paket (lib/paket-tampil.ts).
    // Yang dijaga di sini pemanggilannya, bukan keberadaan fungsinya.
    const pemanggil = berkasTsx(path.join(AKAR, "src")).filter((f) =>
      readFileSync(f, "utf8").includes("tolakPermintaan("),
    );
    expect(pemanggil).toEqual([]);
  });

  it("action-nya SENDIRI masih ada, beserta alasannya tertulis", () => {
    const sumber = readFileSync(path.join(AKAR, "src/app/admin/sesi/aksi.ts"), "utf8");
    expect(sumber).toContain("export async function tolakPermintaan");
    expect(sumber).toMatch(/J8/);
  });
});
