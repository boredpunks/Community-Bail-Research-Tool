import { Router, type IRouter, type Request, type Response, type RequestHandler } from "express";
import {
  EnterWorkspaceBody,
  EnterWorkspaceResponse,
  GetWorkspaceSessionResponse,
} from "@workspace/api-zod";
import {
  clearWorkspaceSessionCookie,
  createWorkspaceSession,
  hasValidWorkspaceSession,
  requireSameOrigin,
  setWorkspaceSessionCookie,
  workspacePasswordIsConfigured,
  workspacePasswordMatches,
  WORKSPACE_SESSION_TTL_SECONDS,
} from "../middlewares/researchAuth";

const router: IRouter = Router();

interface FailureWindow {
  failures: number;
  startedAt: number;
  blockedUntil: number;
}

const failedLogins = new Map<string, FailureWindow>();
const MAX_FAILURES = 8;
const WINDOW_MS = 15 * 60 * 1000;

router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store, no-cache, must-revalidate");
  next();
});

const limitLoginAttempts: RequestHandler = (req, res, next) => {
  const now = Date.now();
  const address = req.ip || req.socket.remoteAddress || "unknown";
  let window = failedLogins.get(address);

  if (window && window.blockedUntil > now) {
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil((window.blockedUntil - now) / 1000))));
    res.status(429).json({ error: "Too many incorrect attempts. Wait before trying again." });
    return;
  }
  if (window && now - window.startedAt >= WINDOW_MS) {
    failedLogins.delete(address);
    window = undefined;
  }

  next();
};

function noteFailedLogin(req: Request): void {
  const now = Date.now();
  const address = req.ip || req.socket.remoteAddress || "unknown";
  let window = failedLogins.get(address);
  if (!window || now - window.startedAt >= WINDOW_MS) window = { failures: 0, startedAt: now, blockedUntil: 0 };
  window.failures += 1;
  if (window.failures >= MAX_FAILURES) window.blockedUntil = now + WINDOW_MS;
  failedLogins.set(address, window);

  if (failedLogins.size > 10_000) {
    for (const [key, value] of failedLogins) {
      if (now - value.startedAt >= WINDOW_MS && value.blockedUntil <= now) failedLogins.delete(key);
    }
  }
}

router.get("/session", (req, res): void => {
  const payload = GetWorkspaceSessionResponse.parse({ authenticated: hasValidWorkspaceSession(req) });
  res.status(200).type("application/json").end(JSON.stringify(payload));
});

router.post("/enter", requireSameOrigin, limitLoginAttempts, (req, res): void => {
  if (!workspacePasswordIsConfigured()) {
    res.status(503).json({ error: "Workspace access has not been configured." });
    return;
  }

  const parsed = EnterWorkspaceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter the workspace password." });
    return;
  }
  if (!workspacePasswordMatches(parsed.data.password)) {
    noteFailedLogin(req);
    res.status(401).json({ error: "That password did not unlock the workspace." });
    return;
  }

  failedLogins.delete(req.ip || req.socket.remoteAddress || "unknown");
  try {
    setWorkspaceSessionCookie(res, req, createWorkspaceSession());
  } catch {
    res.status(503).json({ error: "Workspace access is temporarily unavailable." });
    return;
  }
  const payload = EnterWorkspaceResponse.parse({
    authenticated: true,
    expiresInSeconds: WORKSPACE_SESSION_TTL_SECONDS,
  });
  res.json(payload);
});

router.post("/lock", requireSameOrigin, (_req, res): void => {
  clearWorkspaceSessionCookie(res, _req);
  res.status(204).end();
});

export default router;
