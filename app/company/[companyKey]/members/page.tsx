import { AccountStatusTag } from "@/components/account-status-tag";
import { ResendAssignment } from "@/components/resend-assignment";
import { notFound, redirect } from "next/navigation";
import { getCompanyMembers, MemberAccessError } from "@/lib/companies/members";
import { RemoveMember } from "./_components/remove-member";
import { RoleSwitch } from "./_components/role-switch";
import { MemberForm } from "./_components/member-form";

export default async function CompanyMembersPage({ params }: { params: Promise<{ companyKey: string }> }) {
  const { companyKey } = await params;
  let result;
  try {
    result = await getCompanyMembers(companyKey);
  } catch (error) {
    if (error instanceof MemberAccessError) {
      if (error.reason === "UNAUTHENTICATED") redirect("/login");
      notFound();
    }
    return <main className="flex-1 p-6 sm:p-10"><h1 className="text-2xl font-semibold">Mitglieder</h1><p role="alert" className="mt-4">Die Mitglieder konnten gerade nicht geladen werden.</p><a href={`/company/${encodeURIComponent(companyKey)}/members`} className="mt-4 inline-block underline">Erneut versuchen</a></main>;
  }
  return <main className="flex min-w-0 flex-1 flex-col gap-6 bg-zinc-50 p-6 sm:p-10 dark:bg-black">
    <header><h1 className="text-2xl font-semibold">Mitglieder</h1><p className="mt-1 text-sm text-zinc-500">{result.company.name} · {result.members.length} Mitglieder</p></header>
    <MemberForm companySlug={result.company.slug} />
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Mitglieder von {result.company.name} und ihr Kontostatus</caption>
        <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-900"><tr><th scope="col" className="px-4 py-3">E-Mail-Adresse</th><th scope="col" className="px-4 py-3">Status</th><th scope="col" className="px-4 py-3">Role</th><th scope="col" className="px-4 py-3 text-right">Aktionen</th></tr></thead>
        <tbody>{result.members.map((member) => <tr key={member.id} className="border-t border-zinc-100 dark:border-zinc-800"><td className="px-4 py-4">{member.email}</td><td className="px-4 py-4"><AccountStatusTag status={member.status} /></td><td className="px-4 py-4"><RoleSwitch companySlug={result.company.slug} membershipId={member.id} email={member.email} role={member.role} /></td><td className="px-4 py-4"><div className="flex items-start justify-end gap-2">{member.status !== "verified" && <ResendAssignment kind="member" slug={result.company.slug} id={member.id} iconOnly />}<RemoveMember companySlug={result.company.slug} membershipId={member.id} email={member.email} /></div></td></tr>)}</tbody>
      </table>
      {!result.members.length && <p className="p-8 text-center text-sm text-zinc-500">Noch keine Mitglieder vorhanden.</p>}
    </div>
  </main>;
}
