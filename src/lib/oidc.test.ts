import { describe, expect, it } from "vitest";
import { verifyPassword } from "./auth";
import {
  SSO_ONLY_PASSWORD_HASH,
  authConfigurationProblems,
  authorizationUrl,
  baseUsername,
  createOidcFlow,
  decodeFlow,
  encodeFlow,
  endSessionUrl,
  oidcConfig,
  passwordLoginEnabled,
  pkceChallenge,
  provisionDecision,
  usernameCandidates,
} from "./oidc";

const configured = {
  OIDC_ENABLED: "true",
  OIDC_ISSUER: "https://auth.example.com/application/o/nutricore/",
  OIDC_CLIENT_ID: "nutricore",
  OIDC_CLIENT_SECRET: "s3cret",
};

describe("OIDC configuration", () => {
  it("is off unless switched on and complete", () => {
    expect(oidcConfig({})).toBeNull();
    expect(oidcConfig({ ...configured, OIDC_ENABLED: "false" })).toBeNull();
    expect(oidcConfig({ ...configured, OIDC_CLIENT_SECRET: "" })).toBeNull();
    expect(oidcConfig({ ...configured, OIDC_ISSUER: "not a url" })).toBeNull();
  });

  it("reads defaults that suit authentik", () => {
    expect(oidcConfig(configured)).toEqual({
      issuer: configured.OIDC_ISSUER,
      clientId: "nutricore",
      clientSecret: "s3cret",
      scopes: "openid email profile",
      providerName: "authentik",
      autoCreate: false,
      requireVerifiedEmail: true,
      singleLogout: true,
    });
  });

  it("reads the optional switches", () => {
    const config = oidcConfig({ ...configured, OIDC_AUTO_CREATE: "true", OIDC_REQUIRE_VERIFIED_EMAIL: "false", OIDC_SINGLE_LOGOUT: "0" });
    expect(config).toMatchObject({ autoCreate: true, requireVerifiedEmail: false, singleLogout: false });
  });
});

describe("password sign-in switch", () => {
  it("is on by default", () => {
    expect(passwordLoginEnabled({})).toBe(true);
    expect(passwordLoginEnabled(configured)).toBe(true);
  });

  it("turns off only when single sign-on can take over", () => {
    expect(passwordLoginEnabled({ ...configured, AUTH_PASSWORD_LOGIN: "false" })).toBe(false);
    // No provider: ignoring the switch is what keeps the instance reachable.
    expect(passwordLoginEnabled({ AUTH_PASSWORD_LOGIN: "false" })).toBe(true);
    expect(authConfigurationProblems({ AUTH_PASSWORD_LOGIN: "false" })).toHaveLength(1);
  });

  it("reports a half-configured provider", () => {
    expect(authConfigurationProblems({ OIDC_ENABLED: "true" })).toHaveLength(1);
    expect(authConfigurationProblems({ ...configured, AUTH_PASSWORD_LOGIN: "false" })).toEqual([]);
  });
});

describe("authorization request", () => {
  it("carries state, nonce and an S256 PKCE challenge", () => {
    const config = oidcConfig(configured)!;
    const flow = createOidcFlow();
    const url = new URL(authorizationUrl("https://auth.example.com/application/o/authorize/", config, flow, "https://nc.example.com/api/auth/oidc/callback"));
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("nutricore");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("state")).toBe(flow.state);
    expect(url.searchParams.get("nonce")).toBe(flow.nonce);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(pkceChallenge(flow.verifier));
    expect(url.searchParams.get("code_challenge")).not.toBe(flow.verifier);
  });

  it("matches the RFC 7636 test vector", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("round-trips the flow cookie and rejects tampered values", () => {
    const flow = createOidcFlow();
    expect(decodeFlow(encodeFlow(flow))).toEqual(flow);
    expect(decodeFlow(undefined)).toBeNull();
    expect(decodeFlow("garbage")).toBeNull();
    expect(decodeFlow(Buffer.from(JSON.stringify({ state: 1 })).toString("base64url"))).toBeNull();
  });

  it("builds the single-logout URL with the ID token hint", () => {
    const config = oidcConfig(configured)!;
    const url = new URL(endSessionUrl("https://auth.example.com/application/o/nutricore/end-session/", config, "id.token", "https://nc.example.com/login"));
    expect(url.searchParams.get("id_token_hint")).toBe("id.token");
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe("https://nc.example.com/login");
  });
});

describe("account provisioning policy", () => {
  const base = { hasInvitation: false, userCount: 3, registrationMode: "bootstrap" as const, autoCreate: false };

  it("refuses an unknown email when automatic creation is off", () => {
    expect(provisionDecision(base)).toEqual({ create: false });
  });

  it("creates a member when automatic creation is on", () => {
    expect(provisionDecision({ ...base, autoCreate: true })).toEqual({ create: true, role: "USER", viaInvitation: false });
  });

  it("honours an open invitation with its role, whatever the switch says", () => {
    expect(provisionDecision({ ...base, hasInvitation: true, invitationRole: "ADMIN" })).toEqual({ create: true, role: "ADMIN", viaInvitation: true });
  });

  it("lets the first sign-in on an empty instance become its administrator", () => {
    expect(provisionDecision({ ...base, userCount: 0 })).toEqual({ create: true, role: "ADMIN", viaInvitation: false });
    expect(provisionDecision({ ...base, userCount: 0, registrationMode: "disabled" })).toEqual({ create: false });
  });
});

describe("usernames from the provider", () => {
  it("prefers the provider's username and strips what NutriCore does not allow", () => {
    expect(baseUsername("Jörg Müller", "x@example.com")).toBe("JorgMuller");
    expect(baseUsername(undefined, "jane.doe+food@example.com")).toBe("jane.doefood");
    expect(baseUsername("ab", "a@example.com")).toMatch(/^[a-zA-Z0-9._-]{3,40}$/);
  });

  it("offers numbered alternatives within the length limit", () => {
    const names = [...usernameCandidates("x".repeat(31))];
    expect(names[0]).toBe("x".repeat(31));
    expect(names[1]).toBe(`${"x".repeat(31)}-2`);
    for (const name of names) expect(name).toMatch(/^[a-zA-Z0-9._-]{3,40}$/);
  });
});

describe("SSO-only accounts", () => {
  it("cannot sign in with any password", async () => {
    expect(await verifyPassword(SSO_ONLY_PASSWORD_HASH, "")).toBe(false);
    expect(await verifyPassword(SSO_ONLY_PASSWORD_HASH, SSO_ONLY_PASSWORD_HASH)).toBe(false);
  });
});
