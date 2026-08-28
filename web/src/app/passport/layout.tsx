import { requireRole } from "@/lib/auth/require-role";

export default async function PassportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole(["klien"]);
  return <>{children}</>;
}
