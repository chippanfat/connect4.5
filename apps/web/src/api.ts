import type { CommandResult } from "@four/contracts";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const payload = (await response.json()) as CommandResult<T>;
  if (!response.ok || !payload.ok) {
    const error = payload.ok
      ? { code: "INTERNAL_ERROR", message: "The request could not be completed." }
      : payload.error;
    throw new ApiError(error.message, error.code, response.status);
  }
  return payload.data;
}
