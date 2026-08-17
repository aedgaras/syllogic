import { createTranslator } from "next-intl";
import { defaultLocale } from "./config";
import messages from "@/messages/en.json";

type TranslationKey = keyof typeof messages;
type TranslationValues = Record<string, string | number | Date | null | undefined>;

const translate = createTranslator({ locale: defaultLocale, messages });

/**
 * Translate copy that is shared by server and client modules.
 * React components that need a request-selected locale can use next-intl's
 * `useTranslations`/`getTranslations` APIs directly.
 */
export function t(key: TranslationKey, values?: TranslationValues): string {
  return translate(key, values as never) as string;
}
