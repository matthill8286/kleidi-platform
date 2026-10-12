import { eq, inArray } from "drizzle-orm";
import type { Db, Tx } from "@kleidi/db";
import { users } from "@kleidi/db/schema/identity";
import { AppError } from "@kleidi/kernel";

export const LOCALES = ["en", "el", "ru"] as const;
export type UserLocale = (typeof LOCALES)[number];

export type UserSummary = {
  id: string;
  name: string;
  email: string;
  locale: string;
  phone: string | null;
  smsReminders: boolean;
};

const summary = {
  id: users.id,
  name: users.name,
  email: users.email,
  locale: users.locale,
  phone: users.phone,
  smsReminders: users.smsReminders,
};

/** Public lookup for other modules; they never read the users table directly. */
export async function findUsersByIds(db: Db | Tx, ids: string[]): Promise<UserSummary[]> {
  if (ids.length === 0) return [];
  return db.select(summary).from(users).where(inArray(users.id, ids));
}

/** "+357 99 123456" -> "+35799123456". Null when it is not an international mobile number. */
export function normalisePhone(raw: string): string | null {
  const phone = raw.replace(/[\s().-]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
}

// Countries Kleidi texts: the EU, the UK and the places Cyprus buyers usually come from.
// Anything else is refused, so the service cannot be used to send costly texts worldwide.
const SMS_COUNTRY_CODES = [
  "+357",
  "+30",
  "+44",
  "+353",
  "+49",
  "+33",
  "+39",
  "+34",
  "+351",
  "+31",
  "+32",
  "+352",
  "+43",
  "+41",
  "+45",
  "+46",
  "+47",
  "+358",
  "+48",
  "+420",
  "+421",
  "+36",
  "+40",
  "+359",
  "+385",
  "+386",
  "+370",
  "+371",
  "+372",
  "+356",
  "+354",
  "+972",
  "+961",
  "+971",
  "+380",
  "+7",
  "+1",
];

export const smsAllowed = (phone: string) => SMS_COUNTRY_CODES.some((c) => phone.startsWith(c));

export async function updateProfile(
  db: Db,
  userId: string,
  input: {
    locale?: UserLocale | undefined;
    phone?: string | null | undefined;
    smsReminders?: boolean | undefined;
  },
): Promise<UserSummary> {
  const [current] = await findUsersByIds(db, [userId]);
  if (!current) throw new AppError("not_found", "User not found", "userNotFound");
  let phone = current.phone;
  if (input.phone !== undefined) {
    phone = input.phone === null || input.phone.trim() === "" ? null : normalisePhone(input.phone);
    if (input.phone && !phone) {
      throw new AppError(
        "invalid",
        "Enter the mobile number with its country code, such as +357 99 123456",
        "phoneInvalid",
      );
    }
  }
  if (input.phone && phone && !smsAllowed(phone)) {
    throw new AppError(
      "invalid",
      "Kleidi cannot send texts to this country yet",
      "smsCountryBlocked",
    );
  }
  const smsReminders = input.smsReminders ?? current.smsReminders;
  if (smsReminders && !phone) {
    throw new AppError("invalid", "Add a mobile number to get SMS reminders", "phoneNeeded");
  }
  const [updated] = await db
    .update(users)
    .set({ locale: input.locale ?? current.locale, phone, smsReminders, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning(summary);
  return updated!;
}
