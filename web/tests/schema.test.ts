import { describe, it, expect } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";

const TABLES = [
  "profiles", "phases", "services", "packages", "partners", "app_settings",
  "clients", "client_packages", "sessions", "screenings", "booking_requests",
  "materials", "material_services", "material_pages", "material_assignments",
  "material_videos", "variant_rates", "honor_marks",
] as const;

describe("skema database", () => {
  it.each(TABLES)("tabel %s ada", async (table) => {
    const admin = createAdminSupabase();
    const { error } = await admin.from(table).select("*").limit(0);
    expect(error).toBeNull();
  });
});
