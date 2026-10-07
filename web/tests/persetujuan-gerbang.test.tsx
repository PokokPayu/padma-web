/**
 * Gerbang persetujuan (spec 2026-10-06) — MURNI.
 *
 * Layout /passport dan proxy diperiksa lewat sumbernya (pola
 * access-matrix-layouts & passport-shell). Halaman /persetujuan dan server
 * action-nya dirender/dipanggil dengan semua dependensi di-mock.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

const ref = vi.hoisted(() => ({
  status: { sudahSetuju: false, pernahSetuju: false },
  catat: vi.fn<(...a: unknown[]) => Promise<boolean>>(async () => true),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));
vi.mock("@/lib/auth/require-role", () => ({
  requireRole: async () => ({ userId: "user-uji", role: "klien", nama: "Uji" }),
}));
vi.mock("@/lib/persetujuan/status", () => ({ statusPersetujuan: async () => ref.status }));
vi.mock("@/lib/persetujuan/catat", () => ({ catatPersetujuan: (...a: unknown[]) => ref.catat(...a) }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: async () => ({}) }));

const { default: HalamanPersetujuan } = await import("@/app/persetujuan/page");
const { setujuiDokumen } = await import("@/app/persetujuan/aksi");
const { JANGKAR_PERSETUJUAN } = await import("@/app/_dokumen/bagian");

const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

async function render(sp: Record<string, string>) {
  return renderToStaticMarkup(await HalamanPersetujuan({ searchParams: Promise.resolve(sp) }));
}

function form(isian: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(isian)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  ref.status = { sudahSetuju: false, pernahSetuju: false };
  ref.catat.mockReset();
  ref.catat.mockResolvedValue(true);
});

describe("layout /passport — gerbang", () => {
  const sumber = baca("src/app/passport/layout.tsx");

  it("membelokkan klien yang belum setuju ke /persetujuan", () => {
    expect(sumber).toContain("statusPersetujuan(userId)");
    expect(sumber).toContain('redirect("/persetujuan")');
  });

  it("gerbang SESUDAH resolusi klien — akun belum tertaut tetap ke /akun-belum-terhubung", () => {
    expect(sumber.indexOf("await ambilKlien()")).toBeLessThan(sumber.indexOf("statusPersetujuan("));
  });

  it("requireRole tetap satu kali dan memasok userId", () => {
    expect([...sumber.matchAll(/requireRole\(/g)]).toHaveLength(1);
    expect(sumber).toMatch(/const\s*\{\s*userId\s*\}\s*=\s*await\s+requireRole\(/);
  });
});

describe("proxy", () => {
  it("/persetujuan butuh sesi", () => {
    expect(baca("src/proxy.ts")).toMatch(/PROTECTED_PREFIXES\s*=\s*\[[^\]]*"\/persetujuan"/);
  });
});

describe("halaman /persetujuan", () => {
  it("klien baru: kalimat 'Sebelum memakai', form dengan lanjut tersaring, centang wajib", async () => {
    const m = await render({ lanjut: "/produk/abc" });
    expect(m).toContain("Sebelum memakai Digital Passport");
    const tersembunyi = m.match(/<input[^>]*type="hidden"[^>]*>/)?.[0] ?? "";
    expect(tersembunyi).toContain('name="lanjut"');
    expect(tersembunyi).toContain('value="/produk/abc"');
    // Atribut diperiksa satu per satu: React 19 menulis `name`/`value` input
    // SESUDAH atribut lain, jadi pola berurutan rapuh.
    const centang = m.match(/<input[^>]*type="checkbox"[^>]*>/)?.[0] ?? "";
    for (const atribut of ['name="setuju"', 'value="ya"', 'required=""']) {
      expect(centang, atribut).toContain(atribut);
    }
    expect(m).toContain("Setuju &amp; lanjutkan");
  });

  it("versi lama pernah disetujui: kalimat 'Kami memperbarui'", async () => {
    ref.status = { sudahSetuju: false, pernahSetuju: true };
    expect(await render({})).toContain("Kami memperbarui");
  });

  it("menautkan kedua dokumen dan ketiga jangkar ringkasan, di tab baru", async () => {
    const m = await render({});
    for (const href of ["/syarat-ketentuan", "/kebijakan-privasi", ...Object.values(JANGKAR_PERSETUJUAN)]) {
      expect(m, `tautan ${href}`).toMatch(new RegExp(`href="${href.replace(/[#/]/g, "\\$&")}"[^>]*target="_blank"`));
    }
  });

  it("selalu ada jalan keluar", async () => {
    expect(await render({})).toMatch(/<form[^>]*action="\/auth\/keluar"[^>]*method="post"/);
  });

  it("lanjut yang berbahaya disaring ke /passport", async () => {
    const m = await render({ lanjut: "//evil.com" });
    expect(m.match(/<input[^>]*type="hidden"[^>]*>/)?.[0] ?? "").toContain('value="/passport"');
  });

  it("sudah setuju: diteruskan ke tujuan tanpa form", async () => {
    ref.status = { sudahSetuju: true, pernahSetuju: true };
    await expect(render({ lanjut: "/produk/abc" })).rejects.toThrow("REDIRECT /produk/abc");
  });

  it("gagal=1 menampilkan pesan galat", async () => {
    expect(await render({ gagal: "1" })).toContain("Persetujuan belum tersimpan");
  });
});

describe("server action setujuiDokumen", () => {
  it("tanpa centang: kembali ke gerbang, TIDAK mencatat", async () => {
    await expect(setujuiDokumen(form({ lanjut: "/produk/abc" }))).rejects.toThrow(
      "REDIRECT /persetujuan?lanjut=%2Fproduk%2Fabc",
    );
    expect(ref.catat).not.toHaveBeenCalled();
  });

  it("dicentang: mencatat jalur gerbang untuk user sesi, lalu ke tujuan", async () => {
    await expect(setujuiDokumen(form({ lanjut: "/produk/abc", setuju: "ya" }))).rejects.toThrow(
      "REDIRECT /produk/abc",
    );
    expect(ref.catat).toHaveBeenCalledTimes(1);
    expect(ref.catat.mock.calls[0][1]).toBe("user-uji");
    expect(ref.catat.mock.calls[0][2]).toBe("gerbang");
  });

  it("gagal mencatat: kembali ke gerbang dengan gagal=1", async () => {
    ref.catat.mockResolvedValue(false);
    await expect(setujuiDokumen(form({ lanjut: "/produk/abc", setuju: "ya" }))).rejects.toThrow(
      "REDIRECT /persetujuan?lanjut=%2Fproduk%2Fabc&gagal=1",
    );
  });

  it("lanjut berbahaya dari form palsu tetap disaring", async () => {
    await expect(setujuiDokumen(form({ lanjut: "https://evil.com", setuju: "ya" }))).rejects.toThrow(
      "REDIRECT /passport",
    );
  });
});
