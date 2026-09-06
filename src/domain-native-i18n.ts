import { normalizeLocale, type KmerLocale } from "@kmerhosting/i18n";
import { useEffect, useState } from "react";

type NativeCopy = { activitySubtitle: string; unread: string; readAll: string; markRead: string };
const en: NativeCopy = { activitySubtitle: "Domain, transfer, renewal and account activity.", unread: "unread", readAll: "Read all", markRead: "Mark as read" };
const copies: Record<KmerLocale, NativeCopy> = {
  en,
  fr: { activitySubtitle: "Activité des domaines, transferts, renouvellements et du compte.", unread: "non lues", readAll: "Tout lire", markRead: "Marquer comme lue" },
  es: { activitySubtitle: "Actividad de dominios, transferencias, renovaciones y cuenta.", unread: "sin leer", readAll: "Leer todo", markRead: "Marcar como leída" },
  pt: { activitySubtitle: "Atividade de domínios, transferências, renovações e conta.", unread: "não lidas", readAll: "Ler tudo", markRead: "Marcar como lida" },
  de: { activitySubtitle: "Aktivitäten zu Domains, Transfers, Verlängerungen und Konto.", unread: "ungelesen", readAll: "Alle lesen", markRead: "Als gelesen markieren" },
  "zh-Hans": { activitySubtitle: "域名、转移、续费和账户活动。", unread: "未读", readAll: "全部读取", markRead: "标记为已读" },
  ar: { activitySubtitle: "نشاط النطاقات والنقل والتجديد والحساب.", unread: "غير مقروءة", readAll: "قراءة الكل", markRead: "تحديد كمقروءة" },
  hi: { activitySubtitle: "डोमेन, ट्रांसफ़र, नवीनीकरण और खाते की गतिविधि।", unread: "अपठित", readAll: "सभी पढ़ें", markRead: "पढ़ा हुआ चिह्नित करें" },
  bn: { activitySubtitle: "ডোমেইন, ট্রান্সফার, নবায়ন ও অ্যাকাউন্ট কার্যকলাপ।", unread: "অপঠিত", readAll: "সব পড়ুন", markRead: "পঠিত হিসেবে চিহ্নিত করুন" },
  id: { activitySubtitle: "Aktivitas domain, transfer, perpanjangan, dan akun.", unread: "belum dibaca", readAll: "Baca semua", markRead: "Tandai sudah dibaca" },
  ja: { activitySubtitle: "ドメイン、移管、更新、アカウントのアクティビティ。", unread: "未読", readAll: "すべて読む", markRead: "既読にする" },
  ru: { activitySubtitle: "Активность доменов, переносов, продлений и аккаунта.", unread: "непрочитано", readAll: "Прочитать всё", markRead: "Отметить прочитанным" },
  it: { activitySubtitle: "Attività di domini, trasferimenti, rinnovi e account.", unread: "non lette", readAll: "Leggi tutto", markRead: "Segna come letto" },
  ko: { activitySubtitle: "도메인, 이전, 갱신 및 계정 활동입니다.", unread: "읽지 않음", readAll: "모두 읽기", markRead: "읽음으로 표시" },
  tr: { activitySubtitle: "Alan adı, transfer, yenileme ve hesap etkinliği.", unread: "okunmamış", readAll: "Tümünü oku", markRead: "Okundu olarak işaretle" },
  vi: { activitySubtitle: "Hoạt động tên miền, chuyển, gia hạn và tài khoản.", unread: "chưa đọc", readAll: "Đọc tất cả", markRead: "Đánh dấu đã đọc" },
  ur: { activitySubtitle: "ڈومین، منتقلی، تجدید اور اکاؤنٹ کی سرگرمی۔", unread: "غیر مقروء", readAll: "سب پڑھیں", markRead: "پڑھا ہوا نشان زد کریں" },
  nl: { activitySubtitle: "Activiteit voor domeinen, transfers, verlengingen en account.", unread: "ongelezen", readAll: "Alles lezen", markRead: "Als gelezen markeren" },
  pl: { activitySubtitle: "Aktywność domen, transferów, odnowień i konta.", unread: "nieprzeczytane", readAll: "Przeczytaj wszystko", markRead: "Oznacz jako przeczytane" },
  fa: { activitySubtitle: "فعالیت دامنه، انتقال، تمدید و حساب.", unread: "خوانده‌نشده", readAll: "خواندن همه", markRead: "علامت‌گذاری به‌عنوان خوانده‌شده" },
};

export function domainNativeCopy(locale: string): NativeCopy {
  return copies[normalizeLocale(locale) || "en"] || en;
}

export function useDomainNativeCopy() {
  const [locale, setLocale] = useState<KmerLocale>(() => normalizeLocale(typeof document === "undefined" ? "en" : document.documentElement.lang) || "en");
  useEffect(() => {
    const onChange = (event: Event) => setLocale(normalizeLocale(event instanceof CustomEvent ? event.detail : document.documentElement.lang) || "en");
    window.addEventListener("kmerhosting:language-change", onChange);
    return () => window.removeEventListener("kmerhosting:language-change", onChange);
  }, []);
  return domainNativeCopy(locale);
}
