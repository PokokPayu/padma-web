/**
 * Penjagaan shell passport (`src/app/passport/layout.tsx` + `nav.tsx`).
 *
 * Kenapa test ini ada: shell adalah tempat tiga kelas regresi mahal berkumpul,
 * dan ketiganya TIDAK menghasilkan error — hanya halaman yang "kelihatan jalan"
 * sambil bocor atau salah:
 *
 *  1. Resolusi klien. User berperan `klien` yang belum tertaut ke baris
 *     `clients` bukan error; tanpa `maybeSingle()` + redirect ramah, sub-rute
 *     meledak PGRST116 di produksi (keputusan G Plan 4).
 *  2. Jalur data. `createAdminSupabase()` menembus RLS, sehingga penyaringan
 *     jatuh ke UI dan isi materi terkunci ikut masuk RSC payload — tetap 200,
 *     tetap tampak benar, tetapi bocor. Karena itu seluruh `src/app/passport/**`
 *     diperiksa, bukan hanya layout.
 *  3. Cache. `unstable_cache` / `export const revalidate` di rute per-klien
 *     dapat membagikan respons satu klien ke klien lain. Logout wajib tetap
 *     `<form method="post">`: navigasi dokumen penuh yang menghapus Client Cache.
 *
 * Penanda tab aktif diuji dengan render sungguhan, bukan pembacaan sumber:
 * `pathname.startsWith("/passport")` cocok untuk SEMUA sub-rute, jadi bug
 * "semua tab menyala" adalah regresi yang paling gampang lolos.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

/** Semua berkas .ts/.tsx di bawah src/app/passport, rekursif. */
function berkasPassport(rel = "src/app/passport"): string[] {
  const hasil: string[] = [];
  for (const entri of readdirSync(path.join(AKAR, rel), { withFileTypes: true })) {
    const anak = `${rel}/${entri.name}`;
    if (entri.isDirectory()) hasil.push(...berkasPassport(anak));
    else if (/\.tsx?$/.test(entri.name)) hasil.push(anak);
  }
  return hasil;
}

const sumberLayout = baca("src/app/passport/layout.tsx");
const semuaBerkasPassport = berkasPassport();

// usePathname hanya hidup di dalam App Router; disuntik lewat objek ter-hoist
// supaya satu berkas test bisa memeriksa beberapa rute.
const rute = vi.hoisted(() => ({ kini: "/passport" }));
vi.mock("next/navigation", () => ({ usePathname: () => rute.kini }));

const { NavPassport } = await import("@/app/passport/nav");

function markupNav(pathname: string): string {
  rute.kini = pathname;
  return renderToStaticMarkup(createElement(NavPassport));
}

describe("layout passport — resolusi klien", () => {
  it("mengambil klien lewat ambilKlien(), bukan requireRole kedua", () => {
    expect(sumberLayout).toMatch(
      /import\s*\{[^}]*\bambilKlien\b[^}]*\}\s*from\s*["']@\/lib\/passport\/data["']/,
    );
    expect(sumberLayout).toContain("await ambilKlien()");
    // access-matrix-layouts.test.ts sudah menuntut TEPAT SATU requireRole;
    // ditegaskan ulang di sini karena "ambil ulang perannya saja" adalah
    // godaan paling wajar saat menambah data klien ke layout.
    expect([...sumberLayout.matchAll(/requireRole\(/g)]).toHaveLength(1);
  });

  it("klien yang belum tertaut diarahkan ke /akun-belum-terhubung, bukan dibiarkan meledak", () => {
    expect(sumberLayout).toContain('redirect("/akun-belum-terhubung")');
    // Redirect harus dijaga kondisi "tidak ada klien".
    expect(sumberLayout).toMatch(/if\s*\(!\s*klien\s*\)\s*redirect\(/);
  });

  it("nama klien tampil di shell (bukti resolusi klien benar-benar dipakai)", () => {
    expect(sumberLayout).toContain("{klien.nama}");
  });
});

describe("shell passport — pagar keamanan", () => {
  it("tidak ada service role di seluruh src/app/passport/**", () => {
    for (const berkas of semuaBerkasPassport) {
      expect(baca(berkas), `${berkas} memakai service role`).not.toContain(
        "createAdminSupabase",
      );
      expect(baca(berkas), `${berkas} memakai service role`).not.toContain(
        "SERVICE_ROLE",
      );
    }
  });

  it("tidak ada cache lintas-klien di seluruh src/app/passport/**", () => {
    for (const berkas of semuaBerkasPassport) {
      const sumber = baca(berkas);
      expect(sumber, `${berkas} memakai unstable_cache`).not.toContain(
        "unstable_cache",
      );
      expect(sumber, `${berkas} mengekspor revalidate`).not.toMatch(
        /export\s+const\s+revalidate/,
      );
    }
  });

  it("logout tetap <form method=\"post\">, bukan router.push()", () => {
    expect(sumberLayout).toMatch(
      /<form[^>]*action="\/auth\/keluar"[^>]*method="post"/,
    );
    expect(sumberLayout).not.toContain("router.push");
  });

  it("nav tidak memaksa prefetch reader materi", () => {
    for (const berkas of semuaBerkasPassport) {
      expect(baca(berkas), `${berkas} memaksa prefetch`).not.toContain(
        "prefetch={true}",
      );
    }
  });
});

describe("navigasi passport", () => {
  const sumberNav = baca("src/app/passport/nav.tsx");

  it("client component (butuh usePathname)", () => {
    expect(sumberNav.trimStart().startsWith('"use client"')).toBe(true);
  });

  it("memuat lima tujuan berbahasa Indonesia", () => {
    const m = markupNav("/passport");
    for (const [href, label] of [
      ["/passport", "Beranda"],
      ["/passport/sesi", "Sesi"],
      ["/passport/materi", "Materi"],
      ["/passport/bayar", "Bayar"],
      ["/passport/profil", "Profil"],
    ]) {
      expect(m).toContain(`href="${href}"`);
      expect(m).toContain(label);
    }
  });

  it("menyediakan tab desktop DAN bottom bar mobile", () => {
    const m = markupNav("/passport");
    expect([...m.matchAll(/<nav\b/g)]).toHaveLength(2);
    expect(m).toContain("sm:hidden"); // bottom bar mobile
    expect(m).toContain("sm:flex"); // tab desktop (hidden di mobile)
    // Setiap tujuan muncul dua kali: sekali per nav.
    expect([...m.matchAll(/href="\/passport\/sesi"/g)]).toHaveLength(2);
  });

  it("memakai lambang teratai bersama, bukan salinan path SVG", () => {
    expect(sumberNav).toMatch(
      /import\s*\{[^}]*\bLotus\b[^}]*\}\s*from\s*["']@\/app\/_landing\/lotus["']/,
    );
  });

  it("hanya SATU tujuan yang aktif di beranda", () => {
    const m = markupNav("/passport");
    // Dua nav -> dua penanda untuk satu tujuan aktif.
    expect([...m.matchAll(/aria-current="page"/g)]).toHaveLength(2);
  });

  it("sub-rute menyalakan tabnya sendiri, bukan Beranda", () => {
    const m = markupNav("/passport/sesi");
    expect([...m.matchAll(/aria-current="page"/g)]).toHaveLength(2);
    // Tautan Beranda tidak boleh membawa penanda aktif.
    for (const tag of m.match(/<a[^>]*>/g) ?? []) {
      if (tag.includes('href="/passport"')) {
        expect(tag).not.toContain('aria-current="page"');
      }
    }
  });

  it("rute anak reader materi tetap menyalakan tab Materi", () => {
    const m = markupNav("/passport/materi/77777777-7777-7777-7777-777777777702");
    for (const tag of m.match(/<a[^>]*>/g) ?? []) {
      if (tag.includes('href="/passport/materi"')) {
        expect(tag).toContain('aria-current="page"');
      }
    }
    expect([...m.matchAll(/aria-current="page"/g)]).toHaveLength(2);
  });

  it("/passport/ajukan tetap berada di bawah Beranda (tidak ada tab sendiri)", () => {
    const m = markupNav("/passport/ajukan");
    expect([...m.matchAll(/aria-current="page"/g)]).toHaveLength(2);
    for (const tag of m.match(/<a[^>]*>/g) ?? []) {
      if (tag.includes('href="/passport"') && !tag.includes("/passport/")) {
        expect(tag).toContain('aria-current="page"');
      }
    }
  });

  it("kedua nav punya label aksesibilitas", () => {
    const m = markupNav("/passport");
    expect([...m.matchAll(/aria-label="[^"]+"/g)].length).toBeGreaterThanOrEqual(2);
  });
});
