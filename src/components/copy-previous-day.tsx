"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { copyPreviousDayAction } from "@/server/diary-actions";
import type { FormState } from "@/server/profile-actions";

export function CopyPreviousDay({ date }: { date: string }) {
  const t = useTranslations("diary");
  const [, action, pending] = useActionState<FormState, FormData>(copyPreviousDayAction, {});

  return (
    <form action={action}>
      <input type="hidden" name="date" value={date} />
      <button type="submit" className="btn btn-quiet" disabled={pending}>
        <span aria-hidden="true">⧉</span> {t("copyPreviousDay")}
      </button>
    </form>
  );
}
