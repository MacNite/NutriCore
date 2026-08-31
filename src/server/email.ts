import { logger } from "@/lib/logger";

export interface Mailer { send(message: { to: string; subject: string; text: string }): Promise<void> }

/** Safe self-hosted default. Operators can replace this adapter without changing onboarding logic. */
export class LogMailer implements Mailer {
  async send(message: { to: string; subject: string; text: string }) {
    logger.info("Onboarding email queued using log transport", { to: message.to.replace(/(^.).*(@.*$)/, "$1***$2"), subject: message.subject });
    if (process.env.NODE_ENV !== "production") logger.debug(message.text);
  }
}

export const mailer = (): Mailer => new LogMailer();
