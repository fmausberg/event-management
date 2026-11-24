// Shared by Company event lists, event details/editors and account management.
export const eventStatusLabels = {
  DRAFT: "Entwurf",
  PENDING_TRAINER_CONFIRMATION: "Trainerfreigabe",
  PENDING_VENUE_CONFIRMATION: "Ortsfreigabe",
  PUBLISHED: "Veröffentlicht",
  CANCELLED: "Abgesagt",
  COMPLETED: "Abgeschlossen",
} as const;

export const eventStatusColors = {
  DRAFT: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  PENDING_TRAINER_CONFIRMATION: "bg-yellow-100 text-yellow-800",
  PENDING_VENUE_CONFIRMATION: "bg-yellow-100 text-yellow-800",
  PUBLISHED: "bg-green-100 text-green-800",
  CANCELLED: "bg-red-100 text-red-800",
  COMPLETED: "bg-zinc-200 text-zinc-700",
} as const;
