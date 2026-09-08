import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Paginasi } from "@/app/_shell/panel/paginasi";
import { PER_HAL, type ParamDaftar } from "@/app/_shell/panel/daftar";

const p = (hal: number): ParamDaftar => ({ cari: "sri", saring: { aktif: "ya" }, hal });

const render = (hal: number, total: number) =>
  renderToStaticMarkup(<Paginasi basis="/admin/mitra" param={p(hal)} total={total} />);

describe("Paginasi", () => {
  it("TIDAK dirender sama sekali bila semuanya muat satu halaman", () => {
    // Bilah paginasi berisi "1 dari 1" adalah perabot yang tidak menjawab apa pun.
    expect(render(1, PER_HAL)).toBe("");
  });

  it("menyembunyikan Sebelumnya di halaman pertama dan Berikutnya di halaman terakhir", () => {
    const awal = render(1, PER_HAL * 3);
    expect(awal).not.toContain("Sebelumnya");
    expect(awal).toContain("Berikutnya");

    const akhir = render(3, PER_HAL * 3);
    expect(akhir).toContain("Sebelumnya");
    expect(akhir).not.toContain("Berikutnya");
  });

  it("tautannya MEMPERTAHANKAN cari dan saringan", () => {
    // Paginasi yang melupakan saringan mengembalikan admin ke daftar penuh
    // pada klik pertama — dan tidak ada yang memberitahunya.
    const m = render(2, PER_HAL * 3);
    expect(m).toContain("cari=sri");
    expect(m).toContain("aktif=ya");
    expect(m).toContain("hal=3");
  });

  it("menyebut posisi halaman", () => {
    expect(render(2, PER_HAL * 3)).toContain("Halaman 2 dari 3");
  });

  it("Paginasi memakai ukuran halaman yang diberikan untuk menghitung jumlah halaman", () => {
    const param = { cari: "", saring: {}, hal: 1 };
    // 9 baris, 8 per halaman => 2 halaman => "Berikutnya" harus ada.
    const markup = renderToStaticMarkup(
      <Paginasi basis="/owner/rekap" param={param} total={9} perHal={8} />,
    );
    expect(markup).toContain("Halaman 1 dari 2");
    expect(markup).toContain("Berikutnya");

    // 9 baris pada ukuran BAWAAN (25) hanya satu halaman => komponen tidak
    // merender apa pun. Ini yang membuktikan `perHal` sungguh dipakai, bukan
    // diabaikan diam-diam.
    const bawaan = renderToStaticMarkup(
      <Paginasi basis="/owner/rekap" param={param} total={9} />,
    );
    expect(bawaan).toBe("");
  });
});
