import { createHash, randomUUID } from 'node:crypto';
export const newId = () => randomUUID();
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export function deterministicUuid(value) {
    const hash = sha256(value).slice(0, 32).split('');
    hash[12] = '5';
    hash[16] = ((Number.parseInt(hash[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
    const hex = hash.join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function telegramId(value) {
    if (typeof value === 'bigint')
        return value;
    if (typeof value === 'number' && !Number.isSafeInteger(value)) {
        throw new TypeError('Unsafe numeric Telegram ID; parse it from the raw decimal string instead');
    }
    return BigInt(value);
}
//# sourceMappingURL=ids.js.map