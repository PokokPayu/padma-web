/**
 * Error boundary per area (`error.tsx`) — sebelumnya NOL di seluruh aplikasi.
 *
 * Tanpa boundary, satu galat baca di server component (misalnya riwayat
 * pembelian di `Promise.all` halaman `/admin/klien/[id]`) memadamkan seluruh
 * halaman menjadi layar 500 bawaan Next, termasuk navigasi panel. Boundary di
 * `admin/`, `owner/`, dan `passport/` berada DI BAWAH layout masing-masing,
 * jadi navigasinya tetap tampil dan pengguna bisa pindah halaman.
 *
 * Next 16 memberi dua fungsi ke `error.tsx`: `retry` (mengambil ulang data
 * server lalu merender ulang) dan `reset` (merender ulang TANPA mengambil
 * ulang). Galat baca server tidak pulih lewat `reset`, jadi tombolnya harus
 * terpasang ke `retry` — salah pilih tidak memerahkan tsc.
 */
import { describe, it, expect, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LayarGalat } from "@/app/_shell/layar-galat";

const AKAR = path.resolve(__dirname, "..");

type PropsGalat = {
  error: Error & { digest?: string };
  retry: () => void;
  reset: () => void;
};

const AREA = [
  { berkas: "src/app/error.tsx", modul: () => import("@/app/error"), pulang: "/" },
  { berkas: "src/app/admin/error.tsx", modul: () => import("@/app/admin/error"), pulang: "/admin" },
  { berkas: "src/app/owner/error.tsx", modul: () => import("@/app/owner/error"), pulang: "/owner" },
  {
    berkas: "src/app/passport/error.tsx",
    modul: () => import("@/app/passport/error"),
    pulang: "/passport",
  },
] as const;

/** Galat dengan pesan yang tidak boleh pernah sampai ke layar. */
function galatRahasia(): Error & { digest?: string } {
  return Object.assign(new Error("RAHASIA: kolom clients.no_hp tidak terbaca"), {
    digest: "4021337",
  });
}

/** Menjalankan komponen fungsi berlapis sampai elemen host, lalu mencari tombol. */
function cariTombol(node: ReactNode): ReactElement<{ onClick?: () => void }> | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const anak of node) {
      const t = cariTombol(anak);
      if (t) return t;
    }
    return null;
  }
  const el = node as ReactElement<{ children?: ReactNode }>;
  if (typeof el.type === "function") {
    return cariTombol((el.type as (p: unknown) => ReactNode)(el.props));
  }
  if (el.type === "button") return el as ReactElement<{ onClick?: () => void }>;
  return cariTombol(el.props?.children);
}

describe("LayarGalat — tampilan murni", () => {
  const dasar = { pulang: { href: "/admin", label: "Ke dasbor" }, onCobaLagi: () => {} };

  it.each(["klien", "panel"] as const)("tema %s: judul, tombol coba lagi, dan jalan pulang", (tema) => {
    const m = renderToStaticMarkup(<LayarGalat {...dasar} tema={tema} kode="4021337" />);
    expect(m).toContain("gagal dimuat");
    expect(m).toContain("Coba lagi");
    expect(m).toContain('href="/admin"');
    expect(m).toContain("4021337");
  });

  it("tanpa kode: baris kode tidak dirender sama sekali", () => {
    const m = renderToStaticMarkup(<LayarGalat {...dasar} tema="panel" />);
    expect(m).not.toContain("Kode galat");
  });
});

describe.each(AREA)("$berkas", ({ berkas, modul, pulang }) => {
  it("ada dan bertanda 'use client' (syarat error boundary Next)", () => {
    const jalur = path.join(AKAR, berkas);
    expect(existsSync(jalur)).toBe(true);
    expect(readFileSync(jalur, "utf8").trimStart()).toMatch(/^["']use client["']/);
  });

  it("menampilkan digest, TIDAK PERNAH pesan galatnya", async () => {
    const { default: Galat } = (await modul()) as { default: (p: PropsGalat) => ReactNode };
    const m = renderToStaticMarkup(
      <Galat error={galatRahasia()} retry={() => {}} reset={() => {}} />,
    );
    expect(m).toContain("4021337");
    expect(m).not.toContain("RAHASIA");
    expect(m).toContain(`href="${pulang}"`);
  });

  it("tombol coba lagi memanggil retry, bukan reset", async () => {
    const { default: Galat } = (await modul()) as { default: (p: PropsGalat) => ReactNode };
    const retry = vi.fn();
    const reset = vi.fn();
    const tombol = cariTombol(Galat({ error: galatRahasia(), retry, reset }));
    expect(tombol).not.toBeNull();
    tombol!.props.onClick!();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();
  });
});
