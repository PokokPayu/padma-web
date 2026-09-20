/**
 * Medan usia kehamilan di layar intro wizard.
 *
 * Kenapa terpisah dari wizard.tsx: medan ini hanya muncul setelah tombol
 * "Kehamilan" ditekan, jadi ia tidak pernah ikut pada render statis layar intro
 * yang dipakai tests/skrining-wizard.test.ts. Dijadikan komponen sendiri supaya
 * yang dilihat klien benar-benar bisa dirender dan diperiksa, bukan hanya
 * dibaca sebagai teks sumber.
 */
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MedanUsiaKehamilan } from "@/app/skrining/medan-usia-kehamilan";
import { bacaMinggu } from "@/lib/skrining/usia-kehamilan";

const render = (props: Parameters<typeof MedanUsiaKehamilan>[0]) =>
  renderToStaticMarkup(createElement(MedanUsiaKehamilan, props));

const kosong = { minggu: null, trimester: null, onUbah: () => {} };

describe("medan usia kehamilan — tampilan", () => {
  it("menyatakan diri opsional supaya tidak terasa sebagai syarat", () => {
    expect(render(kosong).toLowerCase()).toContain("opsional");
  });

  it("menyediakan tiga jalan pintas trimester berikut rentang minggunya", () => {
    const html = render(kosong);
    for (const label of ["Trimester 1", "Trimester 2", "Trimester 3"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("0–13");
    expect(html).toContain("14–27");
    expect(html).toContain("28–42");
  });

  it("kotak minggu bertipe angka dan berbatas 0..42 di tingkat markup", () => {
    const html = render(kosong);
    expect(html).toMatch(/type="number"/);
    expect(html).toMatch(/min="0"/);
    expect(html).toMatch(/max="42"/);
  });

  it("mengetik minggu menyalakan tombol trimester yang bersangkutan", () => {
    const html = render({ minggu: 24, trimester: 2, onUbah: () => {} });
    // aria-pressed dipakai persis seperti tombol fase di wizard.
    expect(html).toMatch(/aria-pressed="true"/);
    expect((html.match(/aria-pressed="true"/g) ?? [])).toHaveLength(1);
  });

  it("tanpa isian, tidak ada trimester yang menyala", () => {
    expect(render(kosong)).not.toContain('aria-pressed="true"');
  });

  it("menampilkan trimester terbaca saat minggu terisi — bukan sekadar angka", () => {
    expect(render({ minggu: 34, trimester: 3, onUbah: () => {} })).toContain("Trimester 3");
  });
});

describe("bacaMinggu — mengubah ketikan jadi satu fakta", () => {
  it("angka wajar menghasilkan minggu berikut trimesternya", () => {
    expect(bacaMinggu("24")).toEqual({ minggu: 24, trimester: 2 });
    expect(bacaMinggu(" 8 ")).toEqual({ minggu: 8, trimester: 1 });
  });

  it("kotak dikosongkan mengembalikan keduanya ke null", () => {
    expect(bacaMinggu("")).toEqual({ minggu: null, trimester: null });
    expect(bacaMinggu("   ")).toEqual({ minggu: null, trimester: null });
  });

  it("ketikan di luar rentang tidak menyalakan trimester mana pun", () => {
    // Angkanya tetap dipegang agar yang diketik tidak hilang di bawah jari,
    // tapi tanpa trimester — dan skema akan menolaknya bila sempat terkirim.
    expect(bacaMinggu("99")).toEqual({ minggu: 99, trimester: null });
  });

  it("ketikan bukan angka diabaikan, bukan menjadi NaN", () => {
    expect(bacaMinggu("dua puluh")).toEqual({ minggu: null, trimester: null });
  });
});

describe("inbox admin — usia kehamilan terlihat staf", () => {
  const baris = {
    id: "00000000-0000-0000-0000-0000000000aa",
    kode: "PDM-260920-0001-UJIA",
    nama: "Sinta",
    no_hp: "0812-0000-0001",
    fase: "kehamilan",
    hasil: "hijau" as const,
    status_tindak_lanjut: "baru",
    created_at: "2026-09-20T03:00:00Z",
    flags: [],
    client_id: null,
    usia_kehamilan_minggu: null as number | null,
    trimester: null as 1 | 2 | 3 | null,
  };

  const render = async (r: typeof baris) => {
    const { TabelInbox } = await import("@/app/admin/skrining/tabel-inbox");
    return renderToStaticMarkup(
      createElement(TabelInbox, {
        baris: [r],
        fase: [{ id: "kehamilan", nama: "Kehamilan" }],
      }),
    );
  };

  it("menampilkan minggu dan trimester di baris klien hamil", async () => {
    // Tanpa ini usia kehamilan tersimpan tapi tak pernah terbaca siapa pun —
    // data yang dikumpulkan dari klien tetapi tidak sampai ke tim.
    const html = await render({ ...baris, usia_kehamilan_minggu: 34, trimester: 3 });
    expect(html).toContain("34 mg");
    expect(html).toContain("T3");
  });

  it("menampilkan trimester saja bila klien tidak menyebut minggunya", async () => {
    const html = await render({ ...baris, trimester: 2 });
    expect(html).toContain("T2");
    expect(html).not.toContain(" mg");
  });

  it("baris tanpa usia kehamilan tidak menumbuhkan penanda kosong", async () => {
    const html = await render(baris);
    expect(html).not.toContain("T1");
    expect(html).not.toContain("T2");
    expect(html).not.toContain("T3");
    expect(html).not.toContain(" mg");
  });
});
