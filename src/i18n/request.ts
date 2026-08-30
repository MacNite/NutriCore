import { getRequestConfig } from "next-intl/server";
import { resolveLocale } from "@/server/session";

export default getRequestConfig(async () => {
  const locale = await resolveLocale();
  return { locale, messages: (await import(`../../messages/${locale}.json`)).default };
});
