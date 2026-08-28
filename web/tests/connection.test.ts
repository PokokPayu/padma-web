import { describe, it, expect } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";

describe("koneksi supabase lokal", () => {
  it("service role bisa memanggil Auth Admin API", async () => {
    const admin = createAdminSupabase();
    const { data, error } = await admin.auth.admin.listUsers();
    expect(error).toBeNull();
    expect(Array.isArray(data.users)).toBe(true);
  });
});
