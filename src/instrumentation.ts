/**
 * Runs once when the server process starts.
 *
 * Configuration that is only wrong in a way nobody notices belongs here:
 * `assertSecureDeployment` catches a public deployment whose `APP_URL` was left
 * at its plain-HTTP default, which otherwise works perfectly while quietly
 * issuing session cookies without `Secure`.
 *
 * Failing at start-up is the point. A warning in a log nobody reads is how the
 * misconfiguration survives to production in the first place.
 */
export async function register() {
  // The edge runtime imports this file too and has no business running any of
  // it; the check only concerns the long-running Node server.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { assertSecureDeployment } = await import("@/lib/env");
  try {
    assertSecureDeployment();
  } catch (error) {
    /* Exit rather than rethrow. Next catches a throwing instrumentation hook,
       reports "Failed to prepare server" and leaves the process running: the
       container never exits, so its restart policy never fires and the failure
       reads as a hang rather than as a misconfiguration. Exiting makes it the
       loud, ordinary start-up failure it should be. */
    console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
