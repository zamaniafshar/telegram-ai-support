export const hoursFrom = (date: Date, hours: number): Date =>
  new Date(date.getTime() + hours * 60 * 60 * 1_000);

export const millisecondsFrom = (date: Date, milliseconds: number): Date =>
  new Date(date.getTime() + milliseconds);

export function remainingDuration(until: Date, now = new Date()): string {
  const milliseconds = Math.max(0, until.getTime() - now.getTime());
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.ceil((milliseconds % 3_600_000) / 60_000);
  return `${hours}h ${minutes}m`;
}
