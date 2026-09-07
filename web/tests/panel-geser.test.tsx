import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const rute = vi.hoisted(() => ({ didorong: [] as string[] }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: (h: string) => rute.didorong.push(h) }),
}));

const { PanelGeser } = await import("@/app/_shell/panel/panel-geser");

describe("PanelGeser", () => {
  it("merender ISI yang dioper dari server", () => {
    // Inilah alasan panel ini menerima `children` alih-alih mengambil datanya
    // sendiri: isinya dirender di server, jadi ia bisa diuji di sini.
    const m = renderToStaticMarkup(
      <PanelGeser judul="Ubah mitra" hrefTutup="/admin/mitra">
        <p>Bidan Ratna</p>
      </PanelGeser>,
    );
    expect(m).toContain("Bidan Ratna");
    expect(m).toContain("Ubah mitra");
  });

  it("punya jalan keluar yang bisa DIKLIK, bukan hanya Escape", () => {
    const m = renderToStaticMarkup(
      <PanelGeser judul="Ubah" hrefTutup="/admin/mitra?hal=2"><i /></PanelGeser>,
    );
    // Tautan tutup memakai href, bukan onClick: pemakai bisa membukanya di tab
    // baru, dan ia tetap bekerja bila JavaScript gagal dimuat.
    expect(m).toContain('href="/admin/mitra?hal=2"');
  });

  it("mengumumkan dirinya sebagai dialog bernama", () => {
    // Tanpa role & label, pembaca layar membacakannya sebagai tumpukan teks
    // biasa di ujung halaman, tanpa kabar bahwa sesuatu terbuka.
    const m = renderToStaticMarkup(
      <PanelGeser judul="Ubah mitra" hrefTutup="/x"><i /></PanelGeser>,
    );
    expect(m).toContain('role="dialog"');
    expect(m).toContain('aria-modal="true"');
    expect(m).toContain('aria-label="Ubah mitra"');
  });
});
