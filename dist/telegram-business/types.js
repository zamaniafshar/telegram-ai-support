import { z } from 'zod';
const safeTelegramInteger = z
    .number()
    .int()
    .refine(Number.isSafeInteger, 'Telegram numeric identifier exceeds JavaScript safe integer range');
const telegramUserSchema = z
    .object({
    id: safeTelegramInteger,
    is_bot: z.boolean(),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    username: z.string().optional(),
    language_code: z.string().optional(),
})
    .loose();
const telegramChatSchema = z
    .object({
    id: safeTelegramInteger,
    type: z.enum(['private', 'group', 'supergroup', 'channel']),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    username: z.string().optional(),
})
    .loose();
export const businessConnectionSchema = z
    .object({
    id: z.string().min(1).max(128),
    user: telegramUserSchema,
    user_chat_id: safeTelegramInteger,
    date: safeTelegramInteger,
    can_reply: z.boolean().optional(),
    rights: z
        .object({
        can_reply: z.boolean().optional(),
        can_read_messages: z.boolean().optional(),
        can_delete_sent_messages: z.boolean().optional(),
        can_delete_all_messages: z.boolean().optional(),
        can_edit_name: z.boolean().optional(),
        can_edit_bio: z.boolean().optional(),
        can_edit_profile_photo: z.boolean().optional(),
        can_edit_username: z.boolean().optional(),
        can_change_gift_settings: z.boolean().optional(),
        can_view_gifts_and_stars: z.boolean().optional(),
        can_convert_gifts_to_stars: z.boolean().optional(),
        can_transfer_and_upgrade_gifts: z.boolean().optional(),
        can_transfer_stars: z.boolean().optional(),
        can_manage_stories: z.boolean().optional(),
    })
        .loose()
        .optional(),
    is_enabled: z.boolean(),
})
    .loose();
export const telegramMessageSchema = z
    .object({
    message_id: safeTelegramInteger,
    date: safeTelegramInteger,
    chat: telegramChatSchema,
    from: telegramUserSchema.optional(),
    sender_business_bot: telegramUserSchema.optional(),
    business_connection_id: z.string().min(1).max(128).optional(),
    text: z.string().optional(),
    caption: z.string().optional(),
})
    .loose();
const deletedBusinessMessagesSchema = z
    .object({
    business_connection_id: z.string().min(1).max(128),
    chat: telegramChatSchema,
    message_ids: z.array(safeTelegramInteger).max(1_000),
})
    .loose();
export const telegramUpdateSchema = z
    .object({
    update_id: safeTelegramInteger,
    business_connection: businessConnectionSchema.optional(),
    business_message: telegramMessageSchema.optional(),
    edited_business_message: telegramMessageSchema.optional(),
    deleted_business_messages: deletedBusinessMessagesSchema.optional(),
    message: telegramMessageSchema.optional(),
})
    .loose();
export function businessCanReply(connection) {
    return connection.rights?.can_reply ?? connection.can_reply ?? false;
}
export function businessCanReadMessages(connection) {
    return connection.rights?.can_read_messages ?? false;
}
//# sourceMappingURL=types.js.map