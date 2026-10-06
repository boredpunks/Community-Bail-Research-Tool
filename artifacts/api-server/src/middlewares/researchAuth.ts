import { getAuth } from "@clerk/express";
import type { RequestHandler } from "express";
import { getClerkProxyHost } from "./clerkProxyMiddleware";

export const requireResearchAuth: RequestHandler = (req, res, next) => {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "Sign in to access your research records." });
    return;
  }
  next();
};

export const requireSameOrigin: RequestHandler = (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    next();
    return;
  }
  const origin = req.get("origin");
  const host = getClerkProxyHost(req);
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
