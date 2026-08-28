import { describe, it, expect, afterAll } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { linkClientByEmail } from "@/lib/auth/link-client";

const admin = createAdminSupabase();
const RINA_CLIENT_ID = "44444444-4444-4444-4444-444444444402";
let createdUserId: string | null = null;

afterAll(async () => {
  // bersihkan: lepaskan tautan & hapus user uji agar test idempoten
  await admin.from("clients").update({ user_id: null }).eq("id", RINA_CLIENT_ID);
  if (createdUserId) await admin.auth.admin.deleteUser(createdUserId);
});

describe("penautan akun klien by email", () => {
  it("user baru dengan email klien terdaftar otomatis tertaut", async () => {
    const { data, error } = await admin.auth.admin.createUser({
      email: "rina@padma.test",
      password: "padma-dev-123",
      email_confirm: true,
    });
    expect(error).toBeNull();
    createdUserId = data.user!.id;

    const linked = await linkClientByEmail(data.user!.id, "rina@padma.test");
    expect(linked).toBe(true);

    const { data: c } = await admin
      .from("clients").select("user_id").eq("id", RINA_CLIENT_ID).single();
    expect(c!.user_id).toBe(data.user!.id);
  });

  it("email tanpa data klien mengembalikan false", async () => {
    const linked = await linkClientByEmail(createdUserId!, "tidak-ada@padma.test");
    expect(linked).toBe(false);
  });
});
