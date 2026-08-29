/**
 * Generator PADMA ID — `PAD-YYMM-NNNN`.
 *
 * Dua hal yang mudah salah dan mahal:
 *  1. **Kalender.** Vercel berjalan UTC; antara 17:00–24:00 UTC tanggal (dan
 *     kadang bulan, dan kadang tahun) di Jakarta sudah berganti. Prefix wajib
 *     dihitung lewat `hariIniJakarta()`, bukan `getMonth()`/`toISOString()`.
 *  2. **Urutan.** Sequence dilarang (migration `fail_closed_sequence_fungsi`),
 *     jadi nomor diambil dari nomor tertinggi yang sudah terpakai pada prefix
 *     bulan berjalan. Pemanggilan berurutan tidak boleh menghasilkan nomor
 *     yang sama dua kali.
 */
import { describe, it, expect, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { buatPadmaId, buatPrefix, formatPadmaId } from "@/lib/admin/padma-id";

const admin = createAdminSupabase();
const AKAR = path.resolve(__dirname, "..");

// Klien uji dikenali dari emailnya (padma_id-nya justru harus asli agar
// generator benar-benar diuji melompati nomor yang sudah terpakai).
const EMAIL_UJI = "padma-id-uji-";

async function bersihkan() {
  await admin.from("clients").delete().like("email", `${EMAIL_UJI}%`);
  await admin.from("clients").delete().like("padma_id", "PAD-UJI%");
}

afterAll(bersihkan);

describe("format PADMA ID", () => {
  it("PAD-YYMM-NNNN dengan nomor empat digit", () => {
    expect(formatPadmaId("2026-08-29", 12)).toBe("PAD-2608-0012");
    expect(formatPadmaId("2026-01-05", 7)).toBe("PAD-2601-0007");
    expect(formatPadmaId("2026-12-31", 1)).toBe("PAD-2612-0001");
  });

  it("memakai kalender Jakarta, bukan jam server UTC", () => {
    // 2026-08-31T18:00Z = 2026-09-01 01:00 WIB -> bulan sudah September.
    expect(buatPrefix(new Date("2026-08-31T18:00:00Z"))).toBe("PAD-2609");
    // 2026-09-30T16:59Z = 2026-09-30 23:59 WIB -> masih September.
    expect(buatPrefix(new Date("2026-09-30T16:59:00Z"))).toBe("PAD-2609");
    // 2026-09-30T17:00Z = 2026-10-01 00:00 WIB -> sudah Oktober.
    expect(buatPrefix(new Date("2026-09-30T17:00:00Z"))).toBe("PAD-2610");
    // Pergantian TAHUN sekaligus bulan.
    expect(buatPrefix(new Date("2026-12-31T17:00:00Z"))).toBe("PAD-2701");
  });

  it("tidak memakai jam mesin maupun sequence", () => {
    const sumber = readFileSync(path.join(AKAR, "src/lib/admin/padma-id.ts"), "utf8");
    expect(sumber).toContain("hariIniJakarta");
    for (const terlarang of [
      "toISOString",
      "getMonth",
      "getFullYear",
      "getDay",
      "setDate",
      "nextval",
      ".rpc(",
    ]) {
      expect(sumber).not.toContain(terlarang);
    }
  });
});

describe("buatPadmaId", () => {
  it("menghasilkan id berformat benar yang belum dipakai", async () => {
    const id = await buatPadmaId(admin);
    expect(id).toMatch(/^PAD-\d{4}-\d{4}$/);
    expect(id.startsWith(buatPrefix())).toBe(true);

    const { data } = await admin.from("clients").select("id").eq("padma_id", id);
    expect(data ?? []).toHaveLength(0);
  });

  it("melompati nomor tertinggi yang sudah terpakai pada bulan itu", async () => {
    const prefix = buatPrefix();
    const { data: terpakai } = await admin
      .from("clients")
      .select("padma_id")
      .like("padma_id", `${prefix}-%`)
      .order("padma_id", { ascending: false })
      .limit(1);

    const tertinggi = terpakai?.[0]?.padma_id
      ? Number(String(terpakai[0].padma_id).slice(-4))
      : 0;
    expect(await buatPadmaId(admin)).toBe(
      `${prefix}-${String(tertinggi + 1).padStart(4, "0")}`,
    );
  });

  it("prefix mengikuti tanggal yang diberikan, bukan hari ini", async () => {
    // Bulan yang dijamin kosong -> nomor mulai dari 0001.
    const id = await buatPadmaId(admin, new Date("2019-03-10T12:00:00Z"));
    expect(id).toBe("PAD-1903-0001");
  });

  it("20 pemanggilan berurutan tidak bentrok", async () => {
    const semua = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const id = await buatPadmaId(admin);
      semua.add(id);
      // Daftarkan supaya pemanggilan berikutnya harus melompatinya.
      const { error } = await admin.from("clients").insert({
        padma_id: id,
        nama: "Uji " + i,
        email: `${EMAIL_UJI}${i}@padma.test`,
        phase_id: "prekonsepsi",
      });
      expect(error).toBeNull();
    }
    expect(semua.size).toBe(20);
    await bersihkan();
  });
});
