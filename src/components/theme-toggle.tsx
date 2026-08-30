"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type Theme = "light" | "dark" | "system";
const THEMES: Theme[] = ["light", "dark", "system"];
const ICONS: Record<Theme, string> = { light: "☀", dark: "☾", system: "◐" };

export function ThemeToggle() {
  const t = useTranslations("settings");
  const a11y = useTranslations("a11y");
  const [theme, setTheme] = useState<Theme>("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const stored = localStorage.getItem("nutricore-theme") as Theme | null;
      if (stored && THEMES.includes(stored)) setTheme(stored);
    } catch {
      /* Storage can be unavailable in private windows; the default still works. */
    }
  }, []);

  function apply(next: Theme) {
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("nutricore-theme", next);
    } catch {
      /* Ignore: the choice simply will not persist. */
    }
  }

  // Render a stable placeholder until mounted so SSR and client markup agree.
  if (!mounted) {
    return (
      <button type="button" className="btn btn-quiet" aria-label={a11y("toggleTheme")}>
        <span aria-hidden="true">◐</span>
      </button>
    );
  }

  return (
    <div role="group" aria-label={t("theme")} style={{ display: "flex", gap: 2 }}>
      {THEMES.map((option) => (
        <button
          key={option}
          type="button"
          className="btn btn-quiet"
          aria-pressed={theme === option}
          onClick={() => apply(option)}
          title={t(`themes.${option}`)}
          style={
            theme === option
              ? { background: "var(--accent-soft)", color: "var(--accent-soft-text)", fontWeight: 650 }
              : undefined
          }
        >
          <span aria-hidden="true">{ICONS[option]}</span>
          <span className="sr-only">{t(`themes.${option}`)}</span>
        </button>
      ))}
    </div>
  );
}
