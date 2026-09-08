/**
 * Logout mendarat sebagai GET, bukan POST — kenapa berkas ini ada.
 *
 * Di produksi, menekan "Keluar dari akun" berakhir dengan layar HTTP 405 di
 * `/masuk`. Sesinya sebenarnya SUDAH terhapus; yang gagal hanya pendaratannya.
 * Sebabnya satu baris: `NextResponse.redirect()` tanpa status memakai 307
 * bawaan Next, dan 307 MEMPERTAHANKAN method. Karena tombolnya
 * `<form method="post">` (disengaja — lihat `_shell/tombol-keluar.tsx`),
 * peramban meneruskan POST ke `/masuk`, sebuah halaman yang hanya punya GET,
 * lalu Next menjawab 405.
 *
 * Yang benar adalah 303 See Other: satu-satunya kode redirect yang menurut
 * definisinya mengubah POST menjadi GET.
 *
 * Seluruh test logout yang sudah ada hanya memeriksa MARKUP form-nya, tidak
 * satu pun pernah memanggil handler rutenya — itulah celah yang membuat cacat
 * ini lolos ke produksi. Test ini memanggil handlernya langsung; tidak butuh
 * DB, Supabase-nya dipalsukan.
 */
import { describe, it, expect, vi } from "vitest";

const dipanggil = vi.hoisted(() => ({ signOut: 0 }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({
    auth: {
      signOut: async () => {
        dipanggil.signOut += 1;
        return { error: null };
      },
    },
  }),
}));

const { POST } = await import("@/app/auth/keluar/route");

describe("POST /auth/keluar", () => {
  it("membalas 303 agar peramban mendarat di /masuk sebagai GET", async () => {
    const res = await POST(new Request("https://padmawellnessid.com/auth/keluar", { method: "POST" }));

    // 307/308 meneruskan POST ke halaman /masuk → HTTP 405 di peramban.
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://padmawellnessid.com/masuk");
  });

  it("tetap benar-benar menghapus sesi sebelum mengalihkan", async () => {
    const sebelum = dipanggil.signOut;
    await POST(new Request("https://padmawellnessid.com/auth/keluar", { method: "POST" }));
    expect(dipanggil.signOut).toBe(sebelum + 1);
  });
});
