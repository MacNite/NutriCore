"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { logoutAction } from "@/server/auth-actions";
import { ThemeToggle } from "./theme-toggle";

const NAV = [
  { href: "/", key: "today", icon: "◉" },
  { href: "/diary", key: "diary", icon: "▤" },
  { href: "/foods", key: "foods", icon: "⌕" },
  { href: "/progress", key: "progress", icon: "◔" },
  { href: "/settings", key: "settings", icon: "⚙" },
] as const;

/** Bottom navigation keeps the five most-used destinations within thumb reach. */
const MOBILE_NAV = NAV;

export function AppShell({ displayName, children }: { displayName: string; children: React.ReactNode }) {
  const t = useTranslations("nav");
  const pathname = usePathname();

  const isCurrent = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <>
      <a className="skip-link" href="#main">
        {t("skipToContent")}
      </a>

      <div className="shell">
        <header className="topbar">
          <Link className="brand" href="/">
            <span className="brand-mark" aria-hidden="true">
              N
            </span>
            NutriCore
          </Link>

          <nav className="nav" aria-label={t("main")}>
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} aria-current={isCurrent(item.href) ? "page" : undefined}>
                {t(item.key)}
              </Link>
            ))}
          </nav>

          <div className="topbar-actions">
            <ThemeToggle />
            <form action={logoutAction}>
              <button className="btn btn-quiet" type="submit">
                {t("signOut")}
              </button>
            </form>
            <Link href="/settings" className="avatar" title={displayName}>
              <span aria-hidden="true">{initials || "?"}</span>
              <span className="sr-only">{t("account")}</span>
            </Link>
          </div>
        </header>

        <main id="main" tabIndex={-1}>
          {children}
        </main>
      </div>

      <nav className="bottom-nav" aria-label={t("main")}>
        {MOBILE_NAV.map((item) => (
          <Link key={item.href} href={item.href} aria-current={isCurrent(item.href) ? "page" : undefined}>
            <span aria-hidden="true">{item.icon}</span>
            {t(item.key)}
          </Link>
        ))}
      </nav>
    </>
  );
}
