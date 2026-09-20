export interface EventCapacity {
  maxSeats: number;
  confirmedSeats: number;
  remainingSeats: number;
}

export function calculateEventCapacity(
  maxSeats: number,
  confirmedSeats: number,
): EventCapacity {
  return {
    maxSeats,
    confirmedSeats,
    remainingSeats: Math.max(0, maxSeats - confirmedSeats),
  };
}
