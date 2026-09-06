import i18next from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { COMMON_MESSAGES, LOCALES, normalizeLocale, isRtl } from "@kmerhosting/i18n";

const resources = Object.fromEntries(LOCALES.map(({ code }) => [code, { translation: COMMON_MESSAGES[code] }]));
export const domainI18n = i18next.use(LanguageDetector);
export async function initDomainI18n() {
  const cookie = document.cookie.match(/(?:^|; )kh_locale=([^;]+)/)?.[1];
  const locale = normalizeLocale(cookie ? decodeURIComponent(cookie) : navigator.language) || "en";
  await domainI18n.init({ resources, lng: locale, fallbackLng: "en", supportedLngs: LOCALES.map(({ code }) => code), interpolation: { escapeValue: false } });
  document.documentElement.lang = locale;
  document.documentElement.dir = isRtl(locale) ? "rtl" : "ltr";
}
