/**
 * Penautan akun klien — jaminan dasarnya.
 *
 * Versi pertama test ini menuntut hal yang ternyata BERBAHAYA: "user baru
 * dengan email klien terdaftar otomatis tertaut". Perilaku itulah yang membuat
 * penyerang cukup MENEBAK email klien (`rina@padma.test`), mendaftar mandiri
 * — GoTrue meng-auto-confirm tanpa bukti kepemilikan — lalu membaca PII dan
 * catatan medis korban lewat RLS `clients.user_id = auth.uid()`.
 *
 * Karena keamanannya MENGUAT, tuntutan test ini diperkuat, bukan dilonggarkan:
 * email yang cocok kini TIDAK BOLEH cukup untuk menautkan; yang menautkan
 * adalah TOKEN UNDANGAN sekali-pakai yang dikirim admin lewat WhatsApp, dengan
 * email sebagai syarat kedua.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import {
  createClientInvite,
  linkClientByInvite,
  isClientLinked,
} from "@/lib/auth/link-client";
import { TOKEN_UNDANGAN_RINA } from "../scripts/seed-users";

const admin = createAdminSupabase();
const RINA_CLIENT_ID = "44444444-4444-4444-4444-444444444402";
const EMAIL_UJI = "rina@padma.test";
let createdUserId: string | null = null;

// Bersih-bersih dijalankan SEBELUM dan SESUDAH: `npm test` harus hijau dua kali
// berturut-turut walau run sebelumnya berhenti di tengah jalan.
async function bersihkan() {
  await admin
    .from("clients")
    .update({ user_id: null, linked_at: null })
    .eq("id", RINA_CLIENT_ID);
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const u of data.users) {
    if (u.email?.toLowerCase() === EMAIL_UJI) await admin.auth.admin.deleteUser(u.id);
  }
  // pulihkan undangan seed supaya run berikutnya berangkat dari keadaan sama
  await createClientInvite(RINA_CLIENT_ID, { token: TOKEN_UNDANGAN_RINA });
}

beforeAll(bersihkan);
afterAll(bersihkan);

describe("penautan akun klien wajib token undangan", () => {
  it("user baru dengan email klien terdaftar TIDAK tertaut tanpa token", async () => {
    const { data, error } = await admin.auth.admin.createUser({
      email: "rina@padma.test",
      password: "padma-dev-123",
      email_confirm: true,
    });
    expect(error).toBeNull();
    createdUserId = data.user!.id;

    // Tidak ada lagi fungsi yang bisa dipanggil dengan email saja: satu-satunya
    // pintu adalah linkClientByInvite, dan tanpa token ia menolak.
    expect(await linkClientByInvite(createdUserId, "rina@padma.test", "")).toBe(false);
    expect(await isClientLinked(createdUserId)).toBe(false);

    const { data: c } = await admin
      .from("clients")
      .select("user_id, linked_at")
      .eq("id", RINA_CLIENT_ID)
      .single();
    expect(c!.user_id).toBeNull();
    expect(c!.linked_at).toBeNull();
  });

  it("token undangan yang sah + email cocok → tertaut", async () => {
    const { token } = await createClientInvite(RINA_CLIENT_ID);
    expect(await linkClientByInvite(createdUserId!, "rina@padma.test", token)).toBe(true);

    const { data: c } = await admin
      .from("clients")
      .select("user_id, linked_at")
      .eq("id", RINA_CLIENT_ID)
      .single();
    expect(c!.user_id).toBe(createdUserId);
    expect(c!.linked_at).not.toBeNull();
    expect(await isClientLinked(createdUserId!)).toBe(true);
  });

  it("email tanpa data klien tetap gagal, bahkan dengan token klien lain", async () => {
    const { token } = await createClientInvite(RINA_CLIENT_ID);
    expect(
      await linkClientByInvite(createdUserId!, "tidak-ada@padma.test", token),
    ).toBe(false);
    expect(await linkClientByInvite(createdUserId!, "tidak-ada@padma.test", "")).toBe(
      false,
    );
  });
});
