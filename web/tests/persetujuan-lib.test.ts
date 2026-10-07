/**
 * Modul persetujuan S&K + Kebijakan Privasi (spec 2026-10-06) — uji MURNI.
 *
 * Klien Supabase diganti tiruan kecil yang mencatat panggilan. Yang dijaga:
 * versi dicap dari konstanta, pembacaan gagal-TERBUKA, bentrok kunci dianggap
 * sukses, cookie berversi lama tidak dicatat, dan `lanjut` tidak bisa menjadi
 * open redirect.
 */
import { describe, it, expect, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { VERSI_DOKUMEN } from "@/lib/persetujuan/versi";
import { bacaStatusPersetujuan } from "@/lib/persetujuan/status";
import { catatPersetujuan, catatPersetujuanDariCookie } from "@/lib/persetujuan/catat";
import { COOKIE_SETUJU, buangPersetujuanDiPeramban, titipPersetujuanDiPeramban } from "@/lib/persetujuan/cookie";
import { tujuanPersetujuanAman } from "@/lib/persetujuan/tujuan";
import { capPersetujuanSkrining } from "@/lib/persetujuan/skrining";

type Galat = { code?: string; message: string } | null;

function tiruan(
  opsi: { baris?: { versi: string }[]; galatBaca?: Galat; galatTulis?: Galat; lempar?: boolean } = {},
) {
  const log = { tabel: [] as string[], eq: [] as [string, unknown][], insert: [] as unknown[] };
  const kueri = {
    eq(kolom: string, nilai: unknown) {
      log.eq.push([kolom, nilai]);
      return kueri;
    },
    then<T>(selesai: (v: { data: unknown; error: Galat }) => T) {
      return Promise.resolve({
        data: opsi.galatBaca ? null : (opsi.baris ?? []),
        error: opsi.galatBaca ?? null,
      }).then(selesai);
    },
  };
  const klien = {
    from(tabel: string) {
      log.tabel.push(tabel);
      return {
        select: () => kueri,
        insert: async (baris: unknown) => {
          if (opsi.lempar) throw new TypeError("fetch failed (disengaja oleh uji)");
          log.insert.push(baris);
          return { error: opsi.galatTulis ?? null };
        },
      };
    },
  };
  return { klien: klien as unknown as SupabaseClient, log };
}

describe("VERSI_DOKUMEN", () => {
  it("berbentuk YYYY-MM-DD — sama dengan CHECK di persetujuan_akun.versi", () => {
    expect(VERSI_DOKUMEN).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("bacaStatusPersetujuan", () => {
  it("belum pernah setuju apa pun", async () => {
    const { klien, log } = tiruan({ baris: [] });
    expect(await bacaStatusPersetujuan(klien, "u-1")).toEqual({ sudahSetuju: false, pernahSetuju: false });
    expect(log.tabel).toEqual(["persetujuan_akun"]);
    expect(log.eq).toContainEqual(["user_id", "u-1"]);
  });

  it("pernah setuju versi LAMA — belum setuju versi berlaku", async () => {
    const { klien } = tiruan({ baris: [{ versi: "2000-01-01" }] });
    expect(await bacaStatusPersetujuan(klien, "u-1")).toEqual({ sudahSetuju: false, pernahSetuju: true });
  });

  it("sudah setuju versi berlaku", async () => {
    const { klien } = tiruan({ baris: [{ versi: "2000-01-01" }, { versi: VERSI_DOKUMEN }] });
    expect(await bacaStatusPersetujuan(klien, "u-1")).toEqual({ sudahSetuju: true, pernahSetuju: true });
  });

  it("GAGAL-TERBUKA: galat baca (mis. migrasi belum diterapkan) tidak mengunci Passport", async () => {
    const { klien } = tiruan({ galatBaca: { code: "42P01", message: "relation does not exist" } });
    expect(await bacaStatusPersetujuan(klien, "u-1")).toEqual({ sudahSetuju: true, pernahSetuju: true });
  });
});

describe("catatPersetujuan", () => {
  it("mencap VERSI_DOKUMEN dan jalurnya", async () => {
    const { klien, log } = tiruan();
    expect(await catatPersetujuan(klien, "u-1", "gerbang")).toBe(true);
    expect(log.tabel).toEqual(["persetujuan_akun"]);
    expect(log.insert).toEqual([{ user_id: "u-1", versi: VERSI_DOKUMEN, jalur: "gerbang" }]);
  });

  it("bentrok kunci (23505) = sudah tercatat = sukses", async () => {
    const { klien } = tiruan({ galatTulis: { code: "23505", message: "duplicate key" } });
    expect(await catatPersetujuan(klien, "u-1", "daftar")).toBe(true);
  });

  it("galat lain = gagal, tanpa melempar", async () => {
    const { klien } = tiruan({ galatTulis: { code: "42501", message: "permission denied" } });
    expect(await catatPersetujuan(klien, "u-1", "daftar")).toBe(false);
  });

  it("jaringan putus = gagal, tanpa melempar (login tidak boleh ikut gagal)", async () => {
    const { klien } = tiruan({ lempar: true });
    expect(await catatPersetujuan(klien, "u-1", "daftar")).toBe(false);
  });
});

describe("catatPersetujuanDariCookie", () => {
  const SEKARANG = new Date("2026-10-07T03:00:00Z");
  // Akun yang lahir satu jam lalu — pendaftar baru yang cookienya memang miliknya.
  const BARU = { id: "u-1", created_at: "2026-10-07T02:00:00Z" };

  it("tanpa cookie: tidak mencatat apa pun", async () => {
    const { klien, log } = tiruan();
    expect(await catatPersetujuanDariCookie(klien, BARU, undefined, SEKARANG)).toBe(false);
    expect(log.insert).toEqual([]);
  });

  it("cookie berversi LAMA tidak dicatat — klien itu menyetujui teks yang sudah diganti", async () => {
    const { klien, log } = tiruan();
    expect(await catatPersetujuanDariCookie(klien, BARU, "2000-01-01", SEKARANG)).toBe(false);
    expect(log.insert).toEqual([]);
  });

  it("cookie berversi berlaku dicatat sebagai jalur daftar", async () => {
    const { klien, log } = tiruan();
    expect(await catatPersetujuanDariCookie(klien, BARU, VERSI_DOKUMEN, SEKARANG)).toBe(true);
    expect(log.insert).toEqual([{ user_id: "u-1", versi: VERSI_DOKUMEN, jalur: "daftar" }]);
  });

  // Temuan review akhir #1: cookie tidak terikat identitas. Sisa cookie dari
  // pendaftaran orang LAIN di peramban bersama (signUp gagal, Google batal,
  // konfirmasi di perangkat lain) tidak boleh menjadi persetujuan akun lama
  // yang kebetulan masuk sesudahnya.
  it("akun LAMA tidak dicatat dari cookie — cookie itu milik pendaftar lain", async () => {
    const { klien, log } = tiruan();
    const lama = { id: "u-2", created_at: "2026-09-01T00:00:00Z" };
    expect(await catatPersetujuanDariCookie(klien, lama, VERSI_DOKUMEN, SEKARANG)).toBe(false);
    expect(log.insert).toEqual([]);
  });

  it("akun tanpa created_at tidak dicatat (tidak bisa dibuktikan baru)", async () => {
    const { klien, log } = tiruan();
    expect(await catatPersetujuanDariCookie(klien, { id: "u-3" }, VERSI_DOKUMEN, SEKARANG)).toBe(false);
    expect(log.insert).toEqual([]);
  });
});

describe("titipPersetujuanDiPeramban", () => {
  const asli = (globalThis as { document?: unknown }).document;
  afterEach(() => {
    (globalThis as { document?: unknown }).document = asli;
  });

  it("menulis cookie berversi, umur 1 hari, untuk seluruh situs", () => {
    const dok = { cookie: "" };
    (globalThis as { document?: unknown }).document = dok;
    titipPersetujuanDiPeramban();
    expect(dok.cookie).toContain(`${COOKIE_SETUJU}=${VERSI_DOKUMEN}`);
    expect(dok.cookie).toContain("Max-Age=86400");
    expect(dok.cookie).toContain("Path=/");
    expect(dok.cookie).toContain("SameSite=Lax");
  });

  it("buangPersetujuanDiPeramban mengosongkan cookie seketika", () => {
    const dok = { cookie: "" };
    (globalThis as { document?: unknown }).document = dok;
    buangPersetujuanDiPeramban();
    expect(dok.cookie).toContain(`${COOKIE_SETUJU}=;`);
    expect(dok.cookie).toContain("Max-Age=0");
    expect(dok.cookie).toContain("Path=/");
  });
});

describe("tujuanPersetujuanAman", () => {
  it.each([
    ["/produk/abc", "/produk/abc"],
    ["/produk/kelas-pijat-bayi", "/produk/kelas-pijat-bayi"],
    ["//evil.com", "/passport"],
    ["https://evil.com", "/passport"],
    ["/\\evil", "/passport"],
    ["/admin", "/passport"],
    ["/produk/../admin", "/passport"],
    ["", "/passport"],
    [undefined, "/passport"],
    [null, "/passport"],
    [["/produk/abc"], "/passport"],
  ])("%j → %s", (masuk, keluar) => {
    expect(tujuanPersetujuanAman(masuk)).toBe(keluar);
  });
});

describe("capPersetujuanSkrining", () => {
  it("mencap versi dari konstanta dan waktu dari server", () => {
    expect(capPersetujuanSkrining(new Date("2026-10-06T03:00:00Z"))).toEqual({
      persetujuan_versi: VERSI_DOKUMEN,
      persetujuan_pada: "2026-10-06T03:00:00.000Z",
    });
  });
});
