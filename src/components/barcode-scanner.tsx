"use client";

import type { IScannerControls } from "@zxing/browser";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

export function BarcodeScanner({ onScan, compact = false }: { onScan: (barcode: string) => void; compact?: boolean }) {
  const t = useTranslations("barcodeScanner");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);

  const close = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open || !videoRef.current) return;

    let active = true;
    const video = videoRef.current;
    void import("@zxing/browser").then(({ BrowserMultiFormatReader }) => {
      if (!active) return;
      const reader = new BrowserMultiFormatReader();
      return reader.decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" } }, audio: false },
        video,
        (result) => {
          if (!active || !result) return;
          const barcode = result.getText().trim();
          if (!barcode) return;
          controlsRef.current?.stop();
          controlsRef.current = null;
          setOpen(false);
          onScan(barcode);
        },
      ).then((controls) => {
        if (active) controlsRef.current = controls;
        else controls.stop();
      });
    }).catch(() => {
      if (active) setError(t("cameraError"));
    });

    return () => {
      active = false;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [onScan, open, t]);

  return (
    <>
      <button
        type="button"
        className="btn barcode-scan-button"
        onClick={() => { setError(null); setOpen(true); }}
        aria-haspopup="dialog"
      >
        <span aria-hidden="true">▣</span> <span className={compact ? "sr-only" : undefined}>{t("open")}</span>
      </button>
      {open ? (
        <div className="scanner-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
          <section className="scanner-dialog" role="dialog" aria-modal="true" aria-labelledby="scanner-title">
            <div className="scanner-header">
              <div>
                <h2 id="scanner-title">{t("title")}</h2>
                <p className="muted">{t("hint")}</p>
              </div>
              <button type="button" className="icon-btn" onClick={close} aria-label={t("close")}>×</button>
            </div>
            {error ? <div className="notice notice-error" role="alert">{error}</div> : null}
            <div className="scanner-preview">
              <video ref={videoRef} muted playsInline aria-label={t("preview")} />
              <span className="scanner-guide" aria-hidden="true" />
            </div>
            <button type="button" className="btn btn-block" onClick={close}>{t("cancel")}</button>
          </section>
        </div>
      ) : null}
    </>
  );
}
