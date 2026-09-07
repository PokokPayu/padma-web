import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Bantuan } from "@/app/_shell/panel/bantuan";

describe("Bantuan", () => {
  it("penjelasannya ADA di markup meski tersembunyi — bukan dibuang", () => {
    // Spec K5: teksnya dipertahankan apa adanya, sebagian memuat pembedaan
    // yang pernah hilang dan mahal. Yang berubah cuma ia tidak lagi memakan
    // ruang setiap hari.
    const m = renderToStaticMarkup(
      <Bantuan judul="Tentang halaman Mitra">Mitra adalah data, bukan pengguna aplikasi.</Bantuan>,
    );
    expect(m).toContain("Mitra adalah data, bukan pengguna aplikasi.");
  });

  it("memakai <details> — terbuka tanpa JavaScript", () => {
    const m = renderToStaticMarkup(<Bantuan judul="X">isi</Bantuan>);
    expect(m).toContain("<details");
    expect(m).toContain("<summary");
  });

  it("mulai TERTUTUP", () => {
    // Kalau ia mulai terbuka, tidak ada satu pun masalah yang terpecahkan.
    expect(renderToStaticMarkup(<Bantuan judul="X">isi</Bantuan>)).not.toContain("open");
  });
});
