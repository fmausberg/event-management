export function VoucherCancellationStatus({ booking }: { booking: {
  voucherRedemption?: { status: string; limitReturnedAt: Date | null } | null;
  voucherBalanceUses?: { id: string; status: string; restoredMinor: number; currency: string }[];
} }) {
  return <>
    {booking.voucherRedemption?.limitReturnedAt && <p className="text-sm">Rabattcode-Nutzung zurückgegeben. Der Rabatt wird nicht ausgezahlt.</p>}
    {booking.voucherBalanceUses?.filter(use => use.status === "REVERSED").map(use => <p key={use.id} className="text-sm">
      Wertguthaben zurückgegeben: {(use.restoredMinor / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {use.currency}.
      Die ursprüngliche Gültigkeit bleibt bestehen; eine Geld-Erstattung wird getrennt angezeigt.
    </p>)}
  </>;
}
