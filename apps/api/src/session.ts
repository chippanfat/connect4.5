import type { NextFunction, Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";

import type { Auth } from "./auth";
import { AppError } from "./errors";

export interface AuthUser {
  id: string;
  username: string;
  emailVerified: boolean;
}

export async function resolveSession(
  auth: Auth,
  headers: Request["headers"],
): Promise<AuthUser | null> {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(headers) });
  if (!session) return null;
  return {
    id: session.user.id,
    username:
      session.user.displayUsername ?? session.user.username ?? session.user.name ?? "Player",
    emailVerified: session.user.emailVerified,
  };
}

export function requireAuth(auth: Auth) {
  return async (request: Request, response: Response, next: NextFunction) => {
    try {
      const authUser = await resolveSession(auth, request.headers);
      if (!authUser) throw new AppError("UNAUTHENTICATED", "Sign in to continue.");
      if (!authUser.emailVerified) {
        throw new AppError("EMAIL_NOT_VERIFIED", "Verify your email to play online.");
      }
      response.locals.authUser = authUser;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function currentUser(response: Response): AuthUser {
  const authUser = response.locals.authUser as AuthUser | undefined;
  if (!authUser) throw new AppError("UNAUTHENTICATED", "Sign in to continue.");
  return authUser;
}
