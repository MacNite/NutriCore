"use client";

import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toBlob } from "html-to-image";
import { AppDialog } from "./app-dialog";

/** Adds image download and the platform share sheet to a progress visual. */
export function ShareablePanel({
  children,
  title,
  fileName,
  className = "",
}: {
  children: React.ReactNode;
  title: string;
  fileName: string;
  className?: string;
}) {
  const t = useTranslations("share");
  const id = useId().replaceAll(":", "");
  const target = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<"share" | "download" | null>(null);
  const [message, setMessage] = useState("");

  async function imageFile() {
    if (!target.current) throw new Error("Missing share target");
    const blob = await toBlob(target.current, {
      backgroundColor: getComputedStyle(document.documentElement).getPropertyValue("--surface").trim() || "#fff",
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      filter: (node) => !(node instanceof HTMLElement) || node.dataset.shareControl !== "true",
    });
    if (!blob) throw new Error("Unable to create image");
    return new File([blob], `${fileName}.png`, { type: "image/png" });
  }

  async function download() {
    setBusy("download");
    setMessage("");
    try {
      const file = await imageFile();
      const href = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = href;
      link.download = file.name;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(href), 1_000);
      setMessage(t("downloaded"));
    } catch {
      setMessage(t("error"));
    } finally {
      setBusy(null);
    }
  }

  async function share() {
    setBusy("share");
    setMessage("");
    try {
      const file = await imageFile();
      const data: ShareData = { title, text: t("shareText", { title }), files: [file] };
      if (!navigator.share || (navigator.canShare && !navigator.canShare({ files: [file] }))) {
        setMessage(t("unsupported"));
        return;
      }
      await navigator.share(data);
      setMessage(t("shared"));
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setMessage(t("error"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div ref={target} className={`shareable-panel ${className}`.trim()}>
      <span className="share-control" data-share-control="true">
        <AppDialog
          id={`share-${id}`}
          title={t("title", { title })}
          closeLabel={t("close")}
          triggerClassName="icon-btn share-trigger"
          trigger={<><ShareIcon /><span className="sr-only">{t("open", { title })}</span></>}
        >
          <p className="muted share-intro">{t("intro")}</p>
          <div className="share-options">
            <button className="btn btn-primary" type="button" onClick={share} disabled={busy !== null}>
              {busy === "share" ? t("preparing") : t("social")}
            </button>
            <button className="btn" type="button" disabled title={t("communitySoon")}>
              {t("community")} <span className="badge">{t("soon")}</span>
            </button>
            <button className="btn" type="button" onClick={download} disabled={busy !== null}>
              {busy === "download" ? t("preparing") : t("download")}
            </button>
          </div>
          {message ? <p className="share-status" role="status">{message}</p> : null}
        </AppDialog>
      </span>
      {children}
    </div>
  );
}

function ShareIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"/></svg>;
}
