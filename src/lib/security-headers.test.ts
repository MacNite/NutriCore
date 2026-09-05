import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, securityHeaders } from "./security-headers";

const options = { nonce: "test-nonce", https: false, development: false };

describe("content security policy", () => {
  it("nonces scripts and allows nothing inline without one", () => {
    const csp = contentSecurityPolicy(options);
    expect(csp).toContain("script-src 'self' 'nonce-test-nonce' 'strict-dynamic'");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
  });

  it("never allows eval in production", () => {
    // Hot reloading needs it; a production bundle must not have it, and the
    // difference is one boolean that is easy to get backwards.
    expect(contentSecurityPolicy(options)).not.toContain("unsafe-eval");
    expect(contentSecurityPolicy({ ...options, development: true })).toContain("unsafe-eval");
  });

  it("permits the sources the application actually uses", () => {
    const csp = contentSecurityPolicy(options);
    // html-to-image emits data: URLs, the share and scan flows create blob: ones.
    expect(csp).toContain("img-src 'self' data: blob:");
    // Inline style attributes are used throughout the UI.
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
  });

  it("keeps the browser talking only to this origin", () => {
    // Every provider is reached from the server. If a change ever moved one into
    // the browser, this is the assertion that should stop it.
    expect(contentSecurityPolicy(options)).toContain("connect-src 'self'");
  });

  it("refuses framing and restricts form targets", () => {
    const csp = contentSecurityPolicy(options);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("object-src 'none'");
  });
});

describe("security headers", () => {
  it("sets the standard hardening headers", () => {
    const headers = securityHeaders(options);
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("same-origin");
    expect(headers["X-Frame-Options"]).toBe("DENY");
  });

  it("allows the camera, because barcode scanning and body scans need it", () => {
    // A policy that denied it would silently break the scanner, which is how
    // security headers end up being deleted wholesale.
    const policy = securityHeaders(options)["Permissions-Policy"];
    expect(policy).toContain("camera=(self)");
    expect(policy).toContain("geolocation=()");
    expect(policy).toContain("microphone=()");
  });

  it("sends HSTS only over HTTPS", () => {
    // A plain-HTTP LAN deployment must not teach the browser to refuse the only
    // scheme it speaks.
    expect(securityHeaders(options)["Strict-Transport-Security"]).toBeUndefined();
    expect(securityHeaders({ ...options, https: true })["Strict-Transport-Security"]).toContain("max-age=31536000");
  });
});
