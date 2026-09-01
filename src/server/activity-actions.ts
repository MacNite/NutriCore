"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "./session";
import { addActivity, deleteActivity, updateActivity } from "./activities";
import type { FormState } from "./profile-actions";

const schema = z.object({ id: z.string().min(1).optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), activityKey: z.string().min(1).max(50), intensityKey: z.string().min(1).max(50), durationMinutes: z.coerce.number().int().min(1).max(1440) });
const refresh = () => { revalidatePath("/"); revalidatePath("/diary"); };

export async function saveActivityAction(_state: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "validation" };
  try {
    if (parsed.data.id) await updateActivity({ userId: user.id, ...parsed.data, id: parsed.data.id });
    else await addActivity({ userId: user.id, ...parsed.data });
  } catch { return { error: "validation" }; }
  refresh(); return { ok: true };
}

export async function deleteActivityAction(_state: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = z.object({ id: z.string().min(1) }).safeParse({ id: formData.get("id") });
  if (!parsed.success) return { error: "validation" };
  try { await deleteActivity(user.id, parsed.data.id); } catch { return { error: "notFound" }; }
  refresh(); return { ok: true };
}
