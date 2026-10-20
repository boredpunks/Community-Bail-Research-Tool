import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import { bailRecordsTable, bailReviewsTable, db, discoveryJobsTable } from "@workspace/db";

export const WORKSPACE_OWNER_ID = "community-bail-research-shared-workspace";
export const WORKSPACE_COOKIE_NAME = "cbr_workspace";
export const WORKSPACE_SESSION_TTL_SECONDS = 12 * 60 * 60;
// Invalidate previously issued sessions after an acceptance-run token exposure.
export const WORKSPACE_SESSION_VERSION = 2;

export interface WorkspaceIdentity {
  ownerId: string;
  ownerIds: string[];
}

function sessionSecret(): string | null {
  const value = process.env.SESSION_SECRET;
  return value && Buffer.byteLength(value) >= 32 ? value : null;
}

function sign(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
}

export function createWorkspaceSession(nowSeconds = Math.floor(Date.now() / 1000)): string {
  const secret = sessionSecret();
  if (!secret) throw new Error("Workspace sessions are not configured.");

  const payload = Buffer.from(JSON.stringify({
    v: WORKSPACE_SESSION_VERSION,
    issuedAt: nowSeconds,
    expiresAt: nowSeconds + WORKSPACE_SESSION_TTL_SECONDS,
    nonce: randomBytes(24).toString("base64url"),
  })).toString("base64url");
  return `${payload}.${sign(payload, secret).toString("base64url")}`;
}

export function hasValidWorkspaceSession(req: Request, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  const cookieHeader = req.headers.cookie;
  if (typeof cookieHeader !== "string") return false;
  const cookie = cookieHeader.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${WORKSPACE_COOKIE_NAME}=`));
  const token = cookie?.slice(WORKSPACE_COOKIE_NAME.length + 1);
  if (!token || token.length > 2048) return false;

  const separator = token.lastIndexOf(".");
  if (separator <= 0) return false;
  const payload = token.slice(0, separator);
  const suppliedSignature = Buffer.from(token.slice(separator + 1), "base64url");
  const secret = sessionSecret();
  if (!secret || suppliedSignature.length !== 32) return false;

  const expectedSignature = sign(payload, secret);
  if (!timingSafeEqual(suppliedSignature, expectedSignature)) return false;

  try {
    const data: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data || typeof data !== "object") return false;
    const session = data as { v?: unknown; issuedAt?: unknown; expiresAt?: unknown; nonce?: unknown };
    return session.v === WORKSPACE_SESSION_VERSION
      && typeof session.issuedAt === "number"
      && Number.isSafeInteger(session.issuedAt)
      && session.issuedAt <= nowSeconds + 60
      && typeof session.expiresAt === "number"
      && Number.isSafeInteger(session.expiresAt)
      && session.expiresAt > nowSeconds
      && session.expiresAt > session.issuedAt
      && session.expiresAt - session.issuedAt <= WORKSPACE_SESSION_TTL_SECONDS
      && typeof session.nonce === "string"
      && session.nonce.length >= 32;
  } catch {
    return false;
  }
}

function configuredPassword(): string | null {
  const value = process.env.RESEARCH_WORKSPACE_PASSWORD;
  return value && value.length > 0 && value.length <= 256 ? value : null;
}

export function workspacePasswordIsConfigured(): boolean {
  return Boolean(configuredPassword() && sessionSecret());
}

export function workspacePasswordMatches(candidate: string): boolean {
  const expected = configuredPassword();
  const secret = sessionSecret();
  if (!expected || !secret) return false;
  const actualDigest = sign(candidate, secret);
  const expectedDigest = sign(expected, secret);
  return timingSafeEqual(actualDigest, expectedDigest);
}

function workspaceCookieTransportAttributes(req: Request): string {
  const forwardedProto = req.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  const secure = req.secure || forwardedProto === "https";
  return secure ? "; SameSite=None; Secure; Partitioned" : "; SameSite=Lax";
}

export function setWorkspaceSessionCookie(res: Response, req: Request, token: string): void {
  const expires = new Date((Math.floor(Date.now() / 1000) + WORKSPACE_SESSION_TTL_SECONDS) * 1000);
  res.append(
    "Set-Cookie",
    `${WORKSPACE_COOKIE_NAME}=${token}; Path=/; HttpOnly${workspaceCookieTransportAttributes(req)}; Max-Age=${WORKSPACE_SESSION_TTL_SECONDS}; Expires=${expires.toUTCString()}`,
  );
}

export function clearWorkspaceSessionCookie(res: Response, req: Request): void {
  res.append(
    "Set-Cookie",
    `${WORKSPACE_COOKIE_NAME}=; Path=/; HttpOnly${workspaceCookieTransportAttributes(req)}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`,
  );
}

function forwardedHost(req: Request): string | undefined {
  const raw = req.headers["x-forwarded-host"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.split(",")[0]?.trim() || req.get("host")?.trim();
}

export const requireSameOrigin: RequestHandler = (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    next();
    return;
  }
  const origin = req.get("origin");
  const host = forwardedHost(req);
  try {
    if (origin && host && new URL(origin).host.toLowerCase() === host.toLowerCase()) {
      next();
      return;
    }
  } catch {
    // Malformed origins are rejected, never treated as trusted.
  }
  res.status(403).json({ error: "This action must be submitted from the research app." });
};

let cachedOwnerIds: string[] | undefined;
let ownerCacheExpiresAt = 0;
let pendingOwnerLookup: Promise<string[]> | undefined;

async function getSharedWorkspaceOwnerIds(): Promise<string[]> {
  if (cachedOwnerIds && ownerCacheExpiresAt > Date.now()) return cachedOwnerIds;
  if (pendingOwnerLookup) return pendingOwnerLookup;

  pendingOwnerLookup = (async () => {
    const [recordOwners, jobOwners, reviewOwners] = await Promise.all([
      db.selectDistinct({ ownerId: bailRecordsTable.ownerId }).from(bailRecordsTable),
      db.selectDistinct({ ownerId: discoveryJobsTable.ownerId }).from(discoveryJobsTable),
      db.selectDistinct({ ownerId: bailReviewsTable.ownerId }).from(bailReviewsTable),
    ]);
    const ids = new Set([
      WORKSPACE_OWNER_ID,
      ...recordOwners.map((row) => row.ownerId),
      ...jobOwners.map((row) => row.ownerId),
      ...reviewOwners.map((row) => row.ownerId),
    ]);
    cachedOwnerIds = [...ids];
    ownerCacheExpiresAt = Date.now() + 60_000;
    return cachedOwnerIds;
  })();

  try {
    return await pendingOwnerLookup;
  } finally {
    pendingOwnerLookup = undefined;
  }
}

export const requireResearchAuth: RequestHandler = async (req, res, next) => {
  if (!hasValidWorkspaceSession(req)) {
    res.status(401).json({ error: "Enter the workspace password to continue." });
    return;
  }

  try {
    res.locals.workspaceIdentity = {
      ownerId: WORKSPACE_OWNER_ID,
      ownerIds: await getSharedWorkspaceOwnerIds(),
    } satisfies WorkspaceIdentity;
    next();
  } catch (error) {
    next(error);
  }
};

export function getWorkspaceIdentity(res: Response): WorkspaceIdentity {
  const identity = res.locals.workspaceIdentity as WorkspaceIdentity | undefined;
  if (!identity) throw new Error("Workspace identity is not available for this request.");
  return identity;
}
