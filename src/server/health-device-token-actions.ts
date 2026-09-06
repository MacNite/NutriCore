"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { HEALTH_PLATFORMS } from "@/lib/health-import";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { createDeviceToken, revokeDeviceToken } from "./health-device-tokens";
import { requireUser } from "./session";

/**
 * Issuing and revoking a device token from the settings page.
 *
 * The created token is returned to the page and to nowhere else. It is not
 * persisted in plaintext and cannot be shown a second time, so the page has to
 * treat the value it gets back as the only copy.
 */

export type DeviceTokenState =
  | { status: "idle" }
  | { status: "created"; token: string; name: string; platform: (typeof HEALTH_PLATFORMS)[number] }
  | { status: "revoked" }
  | { status: "error"; error: "validation" | "tooMany" | "rateLimited" | "notFound" };

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  platform: z.enum(HEALTH_PLATFORMS),
});

export async function createHealthDeviceTokenAction(_previous: DeviceTokenState, form: FormData): Promise<DeviceTokenState> {
  const user = await requireUser();

  /* Shares the file-import budget deliberately: both are ways of getting health
     data into this account, and neither is something a person does often. */
  const limit = rateLimit(`healthImport:${user.id}`, RATE_LIMITS.healthImport.limit, RATE_LIMITS.healthImport.windowMs);
  if (!limit.allowed) return { status: "error", error: "rateLimited" };

  const parsed = createSchema.safeParse({ name: form.get("name"), platform: form.get("platform") });
  if (!parsed.success) return { status: "error", error: "validation" };

  const created = await createDeviceToken(user.id, parsed.data.name, parsed.data.platform);
  if ("error" in created) return { status: "error", error: created.error };

  revalidatePath("/settings");
  return { status: "created", token: created.token, name: parsed.data.name, platform: parsed.data.platform };
}

export async function revokeHealthDeviceTokenAction(_previous: DeviceTokenState, form: FormData): Promise<DeviceTokenState> {
  const user = await requireUser();

  const id = z.string().min(1).max(60).safeParse(form.get("id"));
  if (!id.success) return { status: "error", error: "validation" };

  const revoked = await revokeDeviceToken(user.id, id.data);
  if (!revoked) return { status: "error", error: "notFound" };

  revalidatePath("/settings");
  return { status: "revoked" };
}
