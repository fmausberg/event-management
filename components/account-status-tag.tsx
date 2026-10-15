/** Shared display for account states used by members, trainers and staff. */
export function AccountStatusTag({ status }: { status: string }) {
  const verified = status === "verified";
  const unverified = status === "unverified" || status === "not verified";
  const label = verified ? "verifiziert" : unverified ? "nicht verifiziert" : "kein Account";
  const colors = verified
    ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"
    : unverified
      ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300"
      : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300";
  return <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs ${colors}`}>{label}</span>;
}
