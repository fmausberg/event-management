import { notFound, redirect } from "next/navigation";
import { requireAdmin, AdminAccessError } from "@/lib/auth/require-admin";
import { getPrisma } from "@/lib/db/prisma";
export default async function AdminReviewsPage({ params }: { params: Promise<{ id: string }> }) {
  try { await requireAdmin(); }
  catch (error) { if (error instanceof AdminAccessError) { if (error.reason === "UNAUTHENTICATED") redirect("/login"); notFound(); } throw error; }
  const { id } = await params;
  const event = await getPrisma().event.findUnique({ where: { id }, select: { company: { select: { slug: true } } } });
  if (!event) notFound();
  redirect(`/company/${encodeURIComponent(event.company.slug)}/events/${encodeURIComponent(id)}/reviews`);
}
