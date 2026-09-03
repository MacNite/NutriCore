import { flag } from "@/lib/env";
import type { SessionUser } from "./session";

/**
 * Whether this user may start an AI run at all.
 *
 * Both switches, read the same way wherever a run is queued: the user's own
 * "KI-Funktionen aktivieren" and the deployment's `AI_ENABLED`. The recipe
 * import checked them and the quick meal did not, so a user who had turned AI
 * off in their settings could still queue an extraction from the floating
 * button - the one place in the app where that switch was not honoured.
 *
 * `flag` rather than the whole configuration, so this stays readable from a
 * process that holds no `APP_SECRET`, and reads `AI_ENABLED` exactly as the
 * schema does.
 *
 * `researchAvailability` is the same question for the research feature, kept
 * separate because it has to name which of the two switches said no.
 */
export const aiAvailable = (user: Pick<SessionUser, "aiEnabled">) => user.aiEnabled && flag("AI_ENABLED", true);
