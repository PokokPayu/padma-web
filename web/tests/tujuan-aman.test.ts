import { describe, it, expect } from "vitest";
import { tujuanAman } from "@/lib/auth/tujuan-aman";

describe("tujuanAman", () => {
  it("meloloskan tujuan yang ada di daftar putih", () => {
    expect(tujuanAman("/atur-sandi")).toBe("/atur-sandi");
  });

  it("menolak host luar dalam segala bentuknya", () => {
    for (const jahat of [
      "https://jahat.com",
      "//jahat.com",
      "/\\jahat.com",
      "http:/\\jahat.com",
      "https://padma.test.jahat.com",
    ]) {
      expect(tujuanAman(jahat)).toBe("/setelah-masuk");
    }
  });

  it("menolak rute internal yang TIDAK di daftar putih", () => {
    // Daftar putih, bukan daftar hitam: rute internal mana pun yang tidak
    // disebut ikut ditolak, termasuk yang belum lahir saat ini ditulis.
    expect(tujuanAman("/admin")).toBe("/setelah-masuk");
  });

  it("menolak kosong dan null", () => {
    expect(tujuanAman(null)).toBe("/setelah-masuk");
    expect(tujuanAman("")).toBe("/setelah-masuk");
  });
});
