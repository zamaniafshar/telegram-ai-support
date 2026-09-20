import { timingSafeEqual } from 'node:crypto';
export function validWebhookSecret(received, expected) {
    if (!received)
        return false;
    const receivedBytes = Buffer.from(received);
    const expectedBytes = Buffer.from(expected);
    return (receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes));
}
//# sourceMappingURL=webhook-secret.js.map