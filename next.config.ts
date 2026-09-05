import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";
import { requestBodyLimitMb } from "./src/lib/image-upload-limit";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  // argon2 is a native module and must not be bundled into the server chunk.
  serverExternalPackages: ["argon2"],
  experimental: {
    /* Server Actions default to 1 MB, and this raises it for the one request
       that needs more: a body scan carrying a front and a side capture.
       Application validation still enforces IMAGE_UPLOAD_MAX_MB per image
       before anything is persisted.
 
       Derived from the configured limit rather than fixed at the old flat
       "51mb", which was the largest *settable* value doubled and then some -
       and it applied to every Server Action, `loginAction` and `registerAction`
       among them. Next buffers the body before the action runs, so an
       unauthenticated stranger could post 51 MiB at /login, repeatedly, and the
       rate limiter would not have been reached yet. A default deployment now
       accepts 11 MiB rather than 51.
 
       This is read at build time, so a deployment that changes
       IMAGE_UPLOAD_MAX_MB at runtime keeps the ceiling its image was built
       with. That is the safe direction - the ceiling cannot be widened by an
       environment variable - and per-image validation is unaffected. */
    serverActions: { bodySizeLimit: `${requestBodyLimitMb()}mb` },
    /* The *other* body limit, and the one that actually bit.
 
       Because a middleware matches these routes, Next buffers the request body
       for it, under a separate cap that defaults to 10 MB - and that cap
       truncates rather than rejects: "Only the first 10MB will be available".
       A body scan carrying two 5 MiB captures is about 10.5 MiB, so it was
       silently cut short and then failed as "Failed to parse body as FormData".
 
       This predates the security headers - the password-change middleware has
       matched every app route all along - which means IMAGE_UPLOAD_MAX_MB was
       never really configurable up to the 50 the validator accepted, whatever
       `bodySizeLimit: "51mb"` claimed. Both limits now come from the same
       number, so they cannot disagree again. */
    middlewareClientMaxBodySize: `${requestBodyLimitMb()}mb`,
  },
};

export default withNextIntl(config);
