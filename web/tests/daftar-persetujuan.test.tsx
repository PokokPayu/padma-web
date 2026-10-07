/**
 * Centang persetujuan di /daftar (spec 2026-10-06) — MURNI.
 *
 * Kedua tombol (email & Google) mati sampai dicentang, dan cookie penitip
 * dipasang SEBELUM masing-masing panggilan auth — sesudahnya, halaman sudah
 * pergi dan cookie tidak pernah tertulis.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { FormDaftar } from "@/app/daftar/form-daftar";

const sumber = readFileSync(path.resolve(__dirname, "../src/app/daftar/form-daftar.tsx"), "utf8");
const markup = renderToStaticMarkup(<FormDaftar />);

describe("/daftar — centang persetujuan", () => {
  it("menautkan kedua dokumen di tab baru", () => {
    expect(markup).toMatch(/href="\/syarat-ketentuan"[^>]*target="_blank"/);
    expect(markup).toMatch(/href="\/kebijakan-privasi"[^>]*target="_blank"/);
    expect(markup).toContain('type="checkbox"');
  });

  it("tombol Daftar (email) mati sampai dicentang", () => {
    expect(markup).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
  });

  it("tombol Daftar dengan Google juga mati sampai dicentang", () => {
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*Daftar dengan Google/);
  });

  it("cookie dititipkan SEBELUM signUp dan SEBELUM signInWithOAuth", () => {
    const titip = [...sumber.matchAll(/titipPersetujuanDiPeramban\(\)/g)].map((m) => m.index!);
    expect(titip).toHaveLength(2);
    expect(titip[0]).toBeLessThan(sumber.indexOf("supabase.auth.signUp("));
    expect(titip[1]).toBeLessThan(sumber.indexOf("supabase.auth.signInWithOAuth("));
    expect(titip[1]).toBeGreaterThan(sumber.indexOf("supabase.auth.signUp("));
  });
});
