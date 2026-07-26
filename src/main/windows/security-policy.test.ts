import { describe, expect, it } from "vitest";

import { contentSecurityPolicy } from "./security-policy";

describe("renderer content security policy", () => {
  it("keeps packaged builds free of development script and network allowances", () => {
    const policy = contentSecurityPolicy(false);
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("style-src 'self'");
    expect(policy).not.toContain("unsafe-inline");
    expect(policy).not.toContain("localhost");
    expect(policy).not.toContain("ws:");
    expect(policy).toContain("img-src 'self' data:");
    expect(policy).not.toContain("img-src https:");
  });

  it("allows only the Vite development preamble and localhost HMR socket", () => {
    const policy = contentSecurityPolicy(true);
    expect(policy).toContain("script-src 'self' 'unsafe-inline'");
    expect(policy).toContain("style-src 'self' 'unsafe-inline'");
    expect(policy).toContain("connect-src 'self' ws://localhost:*");
  });
});
