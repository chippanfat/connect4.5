import type { ApiErrorCode, CommandResult } from "@four/contracts";
import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

import type { AppLogger } from "./logger";

const statusByCode: Record<ApiErrorCode, number> = {
  UNAUTHENTICATED: 401,
  EMAIL_NOT_VERIFIED: 403,
  FORBIDDEN: 403,
  GAME_NOT_FOUND: 404,
  GAME_FULL: 409,
  GAME_FINISHED: 409,
  INVITE_EXPIRED: 410,
  USER_NOT_FOUND: 404,
  CANNOT_ADD_SELF: 400,
  FRIEND_REQUEST_EXISTS: 409,
  ALREADY_FRIENDS: 409,
  RELATIONSHIP_CLOSED: 403,
  FRIENDSHIP_REQUIRED: 409,
  GAME_INVITE_EXISTS: 409,
  GAME_RESERVED: 403,
  INVITE_NOT_FOR_YOU: 403,
  NOT_YOUR_TURN: 409,
  COLUMN_FULL: 409,
  CLOCK_EXPIRED: 409,
  STALE_VERSION: 409,
  RATE_LIMITED: 429,
  VALIDATION_ERROR: 400,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ApiErrorCode,
    message: string,
    options?: { status?: number; cause?: unknown },
  ) {
    super(message, { cause: options?.cause });
    this.name = "AppError";
    this.status = options?.status ?? statusByCode[code];
  }
}

export function failure<T>(error: unknown): CommandResult<T> {
  if (error instanceof AppError) {
    return { ok: false, error: { code: error.code, message: error.message } };
  }
  if (error instanceof ZodError) {
    return {
      ok: false,
      error: { code: "VALIDATION_ERROR", message: "The request was not valid." },
    };
  }
  return {
    ok: false,
    error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." },
  };
}

export function createErrorHandler(logger: AppLogger) {
  return (error: unknown, request: Request, response: Response, _next: NextFunction) => {
    const result = failure<never>(error);
    const status = error instanceof AppError ? error.status : error instanceof ZodError ? 400 : 500;
    if (status >= 500) {
      logger.error(
        { err: error, requestId: response.locals.requestId, path: request.path },
        "Request failed",
      );
    }
    response.status(status).json(result);
  };
}
