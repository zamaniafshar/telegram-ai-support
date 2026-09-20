export const hoursFrom = (date, hours) => new Date(date.getTime() + hours * 60 * 60 * 1_000);
export const millisecondsFrom = (date, milliseconds) => new Date(date.getTime() + milliseconds);
export function remainingDuration(until, now = new Date()) {
    const milliseconds = Math.max(0, until.getTime() - now.getTime());
    const hours = Math.floor(milliseconds / 3_600_000);
    const minutes = Math.ceil((milliseconds % 3_600_000) / 60_000);
    return `${hours}h ${minutes}m`;
}
//# sourceMappingURL=time.js.map