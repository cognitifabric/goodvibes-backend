// src/middleware/Auth.middleware.ts
import "reflect-metadata";
import { injectable } from "inversify";
import { BaseMiddleware } from "inversify-express-utils";
import * as express from "express";
import jwt from "jsonwebtoken";

// augment Express.Request with a user field
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        username: string;
        plan: "free" | "pro";
      };
    }
  }
}

@injectable()
export class AuthMiddleware extends BaseMiddleware {
  public handler(req: express.Request, res: express.Response, next: express.NextFunction): void {
    try {
      const auth = req.headers.authorization || "";
      const [, token] = auth.split(" ");
      if (!token) {
        res.status(401).json({ error: "Missing bearer token" });
        return; // ensure void
      }

      const secret = process.env.JWT_SECRET || "dev-secret";
      const payload = jwt.verify(token, secret) as {
        sub: string; username: string; plan: "free" | "pro";
      };

      req.user = { id: payload.sub, username: payload.username, plan: payload.plan };
      next(); // continue

    } catch {

      res.status(401).json({ error: "Invalid or expired token" });
      return; // ensure void

    }
  }
}
