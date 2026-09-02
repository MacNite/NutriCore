import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/app-shell";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/server/session";
import type { RecipeImportDraft, RecipeImportError } from "@/server/recipe-import-actions";
import { NewRecipeWorkspace } from "./new-recipe-workspace";
import { imageUploadMaxMb } from "@/lib/image-upload-limit";

export const dynamic = "force-dynamic";

/**
 * A URL failure the reader can act on. The worker's own message names the step
 * that failed - "source-no-ingredients" - which is the right thing to store and
 * the wrong thing to show, so it is translated here as the AI review page does.
 */
function sourceFailure(job: { errorMessage: string | null; failureKind: string | null } | null) {
  if (job?.errorMessage === "source-no-ingredients") return "noIngredients";
  if (job?.errorMessage === "source-unsupported-content") return "unsupportedContent";
  if (job?.errorMessage === "source-too-large" || job?.failureKind === "SOURCE_TOO_LARGE") return "oversizedPage";
  if (job?.failureKind === "SOURCE_BLOCKED") return "unsafeUrl";
  if (job?.failureKind === "SOURCE_UNAVAILABLE") return "unreachablePage";
  return null;
}

const IMPORT_ERRORS = new Set<RecipeImportError>([
  "inputRequired",
  "imageInvalid",
  "imageTooLarge",
  "aiDisabled",
  "unsafeUrl",
  "extractionFailed",
]);

export default async function NewRecipePage({
  searchParams,
}: {
  searchParams: Promise<{ import?: string; importError?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const t = await getTranslations("recipes");
  const { import: importId, importError } = await searchParams;

  // The extraction runs in the worker, so the draft is loaded here rather than
  // returned by the action that started it.
  const record = importId
    ? await prisma.recipeImport.findFirst({
        where: { id: importId, userId: user.id },
        select: { draft: true },
      })
    : null;

  const job = importId
    ? await prisma.aiJob.findFirst({
        where: { entityType: "RECIPE_IMPORT", entityId: importId, userId: user.id },
        orderBy: { createdAt: "desc" },
        select: { status: true, errorMessage: true, failureKind: true },
      })
    : null;

  const draft = (record?.draft ?? null) as unknown as RecipeImportDraft | null;
  const error = IMPORT_ERRORS.has(importError as RecipeImportError) ? (importError as RecipeImportError) : undefined;

  return (
    <AppShell displayName={user.displayName}>
      <div className="page-head">
        <h1>{t("create")}</h1>
      </div>
      <NewRecipeWorkspace
        imageMaxMb={imageUploadMaxMb()}
        draft={draft}
        error={error}
        // A finished job with no draft means the extraction produced nothing
        // usable; that is a failure to report, not a state to keep waiting in.
        pending={Boolean(importId) && !draft && (job?.status === "QUEUED" || job?.status === "RUNNING")}
        failed={job?.status === "FAILED" ? (job.errorMessage ?? job.failureKind ?? "") : null}
        sourceFailure={job?.status === "FAILED" ? sourceFailure(job) : null}
      />
    </AppShell>
  );
}
