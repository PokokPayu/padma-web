import { describe, it, expect } from "vitest";
import { createAdminSupabase } from "@/lib/supabase/admin";

const TABLES = [
  "profiles", "phases", "services", "packages", "partners", "app_settings",
  "clients", "client_packages", "sessions", "screenings", "booking_requests",
  "materials", "material_chapters", "material_videos", "service_rates", "honor_marks",
] as const;

describe("skema database", () => {
  it.each(TABLES)("tabel %s ada", async (table) => {
    const admin = createAdminSupabase();
    const { error } = await admin.from(table).select("*").limit(0);
    expect(error).toBeNull();
  });
});
