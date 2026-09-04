import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateMany, findFirst, deleteJobs, deleteInputs, redirect, requireUser } = vi.hoisted(() => ({
  updateMany: vi.fn(async () => ({ count: 1 })),
  findFirst: vi.fn(async (): Promise<{ id: string; ingestionInputId: string | null } | null> => ({ id: "job-1", ingestionInputId: "input-1" })),
  deleteJobs: vi.fn(async () => ({ count: 1 })),
  deleteInputs: vi.fn(async () => ({ count: 1 })),
  // The real `redirect` throws to unwind the request; here it only records.
  redirect: vi.fn(),
  requireUser: vi.fn(async () => ({ id: "user-1", aiEnabled: true })),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    aiJob: { updateMany, findFirst, deleteMany: deleteJobs },
    aiIngestionInput: { deleteMany: deleteInputs },
  },
}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("./session", () => ({ requireUser }));

import { discardAiRunAction, retryAiRunAction } from "./ai-placeholder-actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
};

beforeEach(() => {
  updateMany.mockClear().mockResolvedValue({ count: 1 });
  findFirst.mockClear().mockResolvedValue({ id: "job-1", ingestionInputId: "input-1" });
  deleteJobs.mockClear().mockResolvedValue({ count: 1 });
  deleteInputs.mockClear().mockResolvedValue({ count: 1 });
  redirect.mockClear();
  requireUser.mockClear().mockResolvedValue({ id: "user-1", aiEnabled: true });
});

/**
 * The re-run behind a failed placeholder. It is the only way an ordinary user
 * has of restarting a run that Ollama was unreachable for - the queue panel is
 * the administrator's - so it must requeue exactly their own failed job and
 * nothing else.
 */
describe("retryAiRunAction", () => {
  it("requeues the caller's own failed run with a fresh budget", async () => {
    await retryAiRunAction(form({ jobId: "job-1", returnTo: "/foods" }));
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "job-1", userId: "user-1", status: "FAILED", entityType: "AI_INGESTION" },
      data: expect.objectContaining({ status: "QUEUED", retryCount: 0, failureKind: null, failedAt: null, startedAt: null }),
    });
    expect(redirect).toHaveBeenCalledWith("/foods");
  });

  it("never restarts a run that is not the caller's, or is not failed", async () => {
    await retryAiRunAction(form({ jobId: "someone-elses-job", returnTo: "/" }));
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: "user-1", status: "FAILED" }) }));
  });

  it("sends the browser only to a page the button is offered on", async () => {
    await retryAiRunAction(form({ jobId: "job-1", returnTo: "https://example.com/phish" }));
    expect(redirect).toHaveBeenCalledWith("/");
  });

  it("queues nothing once the user has switched AI off", async () => {
    requireUser.mockResolvedValue({ id: "user-1", aiEnabled: false });
    await retryAiRunAction(form({ jobId: "job-1", returnTo: "/foods" }));
    expect(updateMany).not.toHaveBeenCalled();
  });
});

/**
 * The × beside it. Keeping a failure visible only helps if the submitter can
 * also be done with it, and what they are throwing away is their own text, URL
 * or photo - so the input goes too, rather than being orphaned behind a row
 * nothing shows any more.
 */
describe("discardAiRunAction", () => {
  it("deletes the submitted input, which takes the run with it", async () => {
    await discardAiRunAction(form({ jobId: "job-1", returnTo: "/foods" }));
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "job-1", userId: "user-1", status: "FAILED", entityType: "AI_INGESTION" },
    }));
    expect(deleteInputs).toHaveBeenCalledWith({ where: { id: "input-1", userId: "user-1" } });
    expect(redirect).toHaveBeenCalledWith("/foods");
  });

  it("deletes the job itself when no input hangs off it", async () => {
    findFirst.mockResolvedValue({ id: "job-1", ingestionInputId: null });
    await discardAiRunAction(form({ jobId: "job-1", returnTo: "/" }));
    expect(deleteInputs).not.toHaveBeenCalled();
    expect(deleteJobs).toHaveBeenCalledWith({ where: { id: "job-1", userId: "user-1" } });
  });

  it("deletes nothing when the run is not the caller's own failed one", async () => {
    findFirst.mockResolvedValue(null);
    await discardAiRunAction(form({ jobId: "someone-elses-job", returnTo: "/" }));
    expect(deleteInputs).not.toHaveBeenCalled();
    expect(deleteJobs).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith("/");
  });

  it("sends the browser only to a page the button is offered on", async () => {
    await discardAiRunAction(form({ jobId: "job-1", returnTo: "https://example.com/phish" }));
    expect(redirect).toHaveBeenCalledWith("/");
  });
});
