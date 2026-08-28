import { requireRole } from "@/lib/auth/require-role";

export default async function OwnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole(["owner"]);
  return <>{children}</>;
}
