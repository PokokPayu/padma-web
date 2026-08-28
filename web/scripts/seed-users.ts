import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

// Kredensial dev ada di .env.local (lihat vitest.config.ts yang memakai
// DOTENV_CONFIG_PATH=".env.local"); .env dipakai sebagai cadangan.
config({ path: [".env.local", ".env"] });

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const PASSWORD = "padma-dev-123";

async function ensureUser(email: string, nama: string, role: "klien" | "admin" | "owner") {
  const { data: list } = await admin.auth.admin.listUsers();
  let user = list.users.find((u) => u.email === email);
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: nama },
    });
    if (error) throw error;
    user = data.user;
  }
  const { error: pErr } = await admin
    .from("profiles")
    .upsert({ id: user!.id, role, nama });
  if (pErr) throw pErr;
  return user!;
}

async function main() {
  await ensureUser("owner@padma.test", "Pemilik PADMA", "owner");
  await ensureUser("admin@padma.test", "Admin PADMA", "admin");
  const ananda = await ensureUser("ananda@padma.test", "Ananda Putri", "klien");

  // Klien tertaut (Ananda) + klien belum tertaut (Rina, bahan test penautan).
  const { error: cErr } = await admin.from("clients").upsert(
    [
      {
        id: "44444444-4444-4444-4444-444444444401",
        padma_id: "PAD-2607-0012",
        nama: "Ananda Putri",
        email: "ananda@padma.test",
        no_hp: "0812-3456-7890",
        phase_id: "prekonsepsi",
        user_id: ananda.id,
      },
      {
        id: "44444444-4444-4444-4444-444444444402",
        padma_id: "PAD-2608-0019",
        nama: "Rina Hapsari",
        email: "rina@padma.test",
        no_hp: "0857-0000-1111",
        phase_id: "kehamilan",
        user_id: null,
      },
    ],
    { onConflict: "padma_id" },
  );
  if (cErr) throw cErr;

  const { error: cpErr } = await admin.from("client_packages").upsert(
    {
      id: "55555555-5555-5555-5555-555555555501",
      client_id: "44444444-4444-4444-4444-444444444401",
      package_id: "22222222-2222-2222-2222-222222222201",
      tanggal_mulai: "2026-07-06",
      status_bayar: "lunas",
    },
    { onConflict: "id" },
  );
  if (cpErr) throw cpErr;

  const { error: sErr } = await admin.from("sessions").upsert(
    [
      {
        id: "66666666-6666-6666-6666-666666666601",
        client_id: "44444444-4444-4444-4444-444444444401",
        service_id: "11111111-1111-1111-1111-111111111101",
        client_package_id: "55555555-5555-5555-5555-555555555501",
        partner_id: "33333333-3333-3333-3333-333333333301",
        tanggal: "2026-07-08",
        status: "selesai",
        catatan: "Sesi perkenalan; pemetaan kondisi awal.",
        rekomendasi: "Jaga tidur 7-8 jam; mulai catat siklus.",
      },
      {
        id: "66666666-6666-6666-6666-666666666602",
        client_id: "44444444-4444-4444-4444-444444444401",
        service_id: "11111111-1111-1111-1111-111111111101",
        client_package_id: "55555555-5555-5555-5555-555555555501",
        partner_id: "33333333-3333-3333-3333-333333333301",
        tanggal: "2026-09-04",
        status: "terjadwal",
        // Wajib eksplisit: upsert massal PostgREST mengisi kolom yang tidak
        // disebut dengan NULL (bukan DEFAULT), sedangkan kedua kolom NOT NULL.
        catatan: "",
        rekomendasi: "",
      },
    ],
    { onConflict: "id" },
  );
  if (sErr) throw sErr;

  console.log("Seed pengguna & data demo selesai.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
