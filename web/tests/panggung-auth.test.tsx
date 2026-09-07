import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PanggungAuth } from "@/app/_auth/panggung";
import MasukPage from "@/app/masuk/page";

describe("panggung auth", () => {
  it("menampilkan kalimat sisi kiri dan isi sisi kanan", () => {
    const m = renderToStaticMarkup(
      <PanggungAuth judul="Passport Anda menunggu." kalimat="Riwayat sesi.">
        <p>isi kanan</p>
      </PanggungAuth>,
    );
    expect(m).toContain("Passport Anda menunggu.");
    expect(m).toContain("isi kanan");
  });

  it("membawa logo PADMA di sisi gelap", () => {
    const m = renderToStaticMarkup(
      <PanggungAuth judul="X" kalimat="Y"><span /></PanggungAuth>,
    );
    expect(m).toContain("logo-padma.png");
  });
});

describe("halaman /masuk", () => {
  const m = renderToStaticMarkup(<MasukPage />);

  // PAGAR E2E: tests/e2e/access-matrix.e2e.ts mengisi formulir ini lewat
  // getByLabel("Email"), getByLabel("Kata sandi"), dan tombol persis "Masuk".
  // Mengganti ketiga nama itu memerahkan matriks akses tanpa menyentuh satu
  // pun test unit — jadi pagarnya dipasang di sini.
  it("mempertahankan label yang dipakai skrip E2E", () => {
    expect(m).toContain("Email");
    expect(m).toContain("Kata sandi");
    expect(m).toMatch(/>Masuk</);
  });

  it("menawarkan daftar dan lupa sandi", () => {
    expect(m).toContain('href="/daftar"');
    expect(m).toContain('href="/lupa-sandi"');
  });
});
