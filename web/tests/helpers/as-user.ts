import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export async function signInAs(email: string): Promise<SupabaseClient> {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  const { error } = await client.auth.signInWithPassword({
    email,
    password: "padma-dev-123",
  });
  if (error) throw new Error(`Gagal login ${email}: ${error.message}`);
  return client;
}

export function anonClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
}
