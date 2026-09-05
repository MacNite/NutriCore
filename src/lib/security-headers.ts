/**
 * Browser-side hardening headers, in one place, applied by the middleware.
 *
 * None of these fix a vulnerability that exists today. They bound the blast
 * radius of one that turns up later - in this code or in a dependency - which
 * for an application holding diet history, body measurements and photographs is
 * worth the small amount of configuration.
 *
 * The policy is written around what the application actually does, which is why
 * a few of the obvious "just deny everything" values are absent: NutriCore
 * scans barcodes with the camera, renders panels to images on a canvas, and
 * styles a lot of elements with inline `style` attributes. A policy that broke
 * those would be removed by the first person it inconvenienced, which is worse
 * than a policy that is honest about its exceptions.
 */

export interface HeaderOptions {
  nonce: string;
  /** Whether the deployment is served over HTTPS; gates HSTS. */
  https: boolean;
  /** `next dev` needs `unsafe-eval` for hot reloading; production must not have it. */
  development: boolean;
}

export function contentSecurityPolicy({ nonce, development }: HeaderOptions): string {
  return [
    "default-src 'self'",
    /* `strict-dynamic` lets the nonced Next bootstrap load the chunks it needs
       without every chunk URL being enumerated here. `unsafe-eval` is dev-only:
       hot reloading needs it and production must never have it. */
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    /* Inline style attributes are used throughout the UI, and html-to-image
       inlines computed styles when it renders a panel to an image. Both are
       covered by this. Inline *styles* are a far smaller concern than inline
       scripts - they cannot execute - and the alternative is a policy nobody
       can keep. */
    "style-src 'self' 'unsafe-inline'",
    /* `data:` for the images html-to-image produces, `blob:` for the object
       URLs the share and scan flows create. */
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    /* The camera stream reaches a <video> through srcObject rather than a URL,
       but the rendered-panel download path does use blob URLs. */
    "media-src 'self' blob:",
    /* Everything the browser talks to is this origin. Ollama, SearXNG and every
       food provider are reached from the server, never from the page - which is
       a property worth asserting here so a future change cannot quietly break
       it. */
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // Clickjacking defence; the modern replacement for X-Frame-Options.
    "frame-ancestors 'none'",
  ].join("; ");
}

export function securityHeaders(options: HeaderOptions): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Security-Policy": contentSecurityPolicy(options),
    "X-Content-Type-Options": "nosniff",
    /* Referrers stay inside the instance. A URL here can name a recipe, a food
       or a scan, so it should not travel to a site a user follows a link to. */
    "Referrer-Policy": "same-origin",
    /* Camera is allowed because barcode scanning and body-scan capture need it.
       The rest are denied outright: none of them is used, and a nutrition
       tracker asking for geolocation would be a bug. */
    "Permissions-Policy": [
      "camera=(self)",
      "microphone=()",
      "geolocation=()",
      "payment=()",
      "usb=()",
      "magnetometer=()",
      "gyroscope=()",
      "accelerometer=()",
      "interest-cohort=()",
    ].join(", "),
    // Belt and braces alongside frame-ancestors, for anything not reading CSP.
    "X-Frame-Options": "DENY",
  };

  /* Only over HTTPS. Sending HSTS from a plain-HTTP LAN deployment would teach
     the browser to refuse the only scheme that deployment speaks. */
  if (options.https) headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";

  return headers;
}
