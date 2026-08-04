import { describe, it, expect } from "vitest";
import { signAccessToken, verifyAccessToken, generateRefreshToken, hashRefreshToken } from "./tokens.js";

const SECRET = "test-secret";

describe("access tokens", () => {
  it("round-trips a userId", () => {
    const token = signAccessToken("user-123", SECRET);
    expect(verifyAccessToken(token, SECRET)).toBe("user-123");
  });

  it("throws on a token signed with a different secret", () => {
    const token = signAccessToken("user-123", "other-secret");
    expect(() => verifyAccessToken(token, SECRET)).toThrow();
  });

  it("throws on garbage input", () => {
    expect(() => verifyAccessToken("not-a-jwt", SECRET)).toThrow();
  });
});

describe("refresh tokens", () => {
  it("generates a raw token whose hash matches hashRefreshToken(raw)", () => {
    const { raw, hash, expiresAt } = generateRefreshToken();
    expect(raw.length).toBeGreaterThan(20);
    expect(hashRefreshToken(raw)).toBe(hash);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("generates different raw tokens on each call", () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(a.raw).not.toBe(b.raw);
  });
});
