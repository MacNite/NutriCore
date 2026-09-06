"use client";

import { useActionState, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { HealthPlatform } from "@/lib/health-import";
import type { DeviceTokenSummary } from "@/server/health-device-tokens";
import {
  createHealthDeviceTokenAction,
  type DeviceTokenState,
  revokeHealthDeviceTokenAction,
} from "@/server/health-device-token-actions";

/**
 * Pairing a phone so it can sync on its own.
 *
 * The file import above this one is a person doing a thing. This is a person
 * setting up something that then happens without them, which makes the moment
 * the token is shown the only moment it exists in readable form. The panel is
 * built around that: the secret is displayed once, prominently, with the plain
 * warning that it will not be shown again, and the list afterwards can say only
 * when each device was last heard from.
 */

const PLATFORMS: HealthPlatform[] = ["APPLE_HEALTH", "HEALTH_CONNECT"];

export function HealthDevices({ devices, syncUrl }: { devices: DeviceTokenSummary[]; syncUrl: string }) {
  const t = useTranslations("healthDevices");
  const [state, action, pending] = useActionState<DeviceTokenState, FormData>(createHealthDeviceTokenAction, {
    status: "idle",
  });

  return (
    <section className="card">
      <h2>{t("title")}</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>
        {t("hint")}
      </p>

      {state.status === "error" ? (
        <div className="notice notice-error" role="alert" style={{ marginBottom: 14 }}>
          <span className="notice-icon" aria-hidden="true">
            !
          </span>
          <span>{t(`errors.${state.error}` as "errors.validation")}</span>
        </div>
      ) : null}

      {state.status === "created" ? <NewToken token={state.token} name={state.name} syncUrl={syncUrl} /> : null}

      <form action={action}>
        <div className="field">
          <label htmlFor="device-name">{t("name")}</label>
          <input id="device-name" name="name" maxLength={60} required placeholder={t("namePlaceholder")} />
        </div>
        <div className="field">
          <label htmlFor="device-platform">{t("platform")}</label>
          <select id="device-platform" name="platform" defaultValue="APPLE_HEALTH">
            {PLATFORMS.map((platform) => (
              <option key={platform} value={platform}>
                {t(`platformName.${platform}` as "platformName.APPLE_HEALTH")}
              </option>
            ))}
          </select>
          <div className="hint">{t("platformHint")}</div>
        </div>
        <button className="btn btn-primary" disabled={pending}>
          {t("create")}
        </button>
      </form>

      {devices.length > 0 ? <DeviceList devices={devices} /> : null}
    </section>
  );
}

/**
 * The one showing of the secret.
 *
 * Read-only rather than disabled so it can still be selected and copied on a
 * phone, and `spellCheck={false}` because a browser that "corrects" a token
 * silently produces one that does not work.
 */
function NewToken({ token, name, syncUrl }: { token: string; name: string; syncUrl: string }) {
  const t = useTranslations("healthDevices");
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
    } catch {
      /* No clipboard permission, or no clipboard. The value is on screen and
         selectable, which is the fallback this needs. */
    }
  }

  return (
    <div className="notice notice-warn" role="status" style={{ display: "block", marginBottom: 14 }}>
      <p style={{ marginTop: 0 }}>
        <strong>{t("created", { name })}</strong> {t("createdOnce")}
      </p>
      <input
        readOnly
        value={token}
        spellCheck={false}
        aria-label={t("tokenLabel")}
        onFocus={(event) => event.currentTarget.select()}
        style={{ width: "100%", fontFamily: "ui-monospace, monospace", fontSize: 13 }}
      />
      <div className="stack" style={{ gap: 8, marginTop: 8 }}>
        <button type="button" className="btn" onClick={() => void copy()}>
          {copied ? t("copied") : t("copy")}
        </button>
      </div>
      <p className="muted" style={{ marginBottom: 0, fontSize: 13.5 }}>
        {t("serverUrl")} <code>{syncUrl}</code>
      </p>
    </div>
  );
}

function DeviceList({ devices }: { devices: DeviceTokenSummary[] }) {
  const t = useTranslations("healthDevices");
  const format = useFormatter();
  const [state, action, pending] = useActionState<DeviceTokenState, FormData>(revokeHealthDeviceTokenAction, {
    status: "idle",
  });

  return (
    <>
      <h3 style={{ fontSize: 15, marginBottom: 6 }}>{t("paired")}</h3>
      {state.status === "revoked" ? (
        <div className="notice" role="status" style={{ marginBottom: 14 }}>
          <span className="notice-icon" aria-hidden="true">
            ✓
          </span>
          <span>{t("revoked")}</span>
        </div>
      ) : null}
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {devices.map((device) => (
          <li
            key={device.id}
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: "1px solid var(--line)" }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ overflowWrap: "anywhere" }}>{device.name}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                {t(`platformName.${device.platform}` as "platformName.APPLE_HEALTH")}
                {" · "}
                {device.lastUsedAt
                  ? t("lastUsed", { when: format.dateTime(device.lastUsedAt, { dateStyle: "medium", timeStyle: "short" }) })
                  : t("neverUsed")}
              </div>
            </div>
            <form action={action}>
              <input type="hidden" name="id" value={device.id} />
              <button className="btn" disabled={pending}>
                {t("revoke")}
              </button>
            </form>
          </li>
        ))}
      </ul>
    </>
  );
}
