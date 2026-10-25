import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z, ZodError, type ZodType } from "zod";

// Conventions shared by every /api/v1 route (see docs/RESEARCH_ENVIRONMENT_SPEC.md, "HTTP conventions"):
//   * errors are { code, message, retryable, fieldErrors?, requestId } and never leak internals;
//   * lists use opaque cursors, not page numbers;
//   * concurrency-sensitive updates carry the version they were based on and get 409 on conflict.

export type ApiErrorBody = {
  code: string;
  message: string;
  retryable: boolean;
  fieldErrors?: Record<string, string[]>;
  requestId: string;
};

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly options: { retryable?: boolean; fieldErrors?: Record<string, string[]>; extra?: Record<string, unknown> } = {}
  ) {
    super(message);
  }
}

export const notFound = (what = "That item") => new ApiError(404, "not_found", `${what} was not found.`);
export const conflict = (message: string, extra?: Record<string, unknown>) => new ApiError(409, "conflict", message, { extra });

function requestIdOf(request: Request) {
  const supplied = request.headers.get("x-request-id");
  return supplied && /^[\w.-]{1,64}$/.test(supplied) ? supplied : randomUUID();
}

function errorResponse(error: ApiError, requestId: string) {
  const body: ApiErrorBody & Record<string, unknown> = {
    code: error.code,
    message: error.message,
    retryable: error.options.retryable ?? false,
    ...(error.options.fieldErrors ? { fieldErrors: error.options.fieldErrors } : {}),
    ...(error.options.extra ?? {}),
    requestId
  };
  return NextResponse.json(body, { status: error.status, headers: { "x-request-id": requestId } });
}

// Wraps a route handler: gives it a request id, turns thrown ApiErrors and validation failures
// into the standard error shape, and hides anything unexpected behind a generic 500.
export function route<Context>(handler: (request: Request, context: Context, requestId: string) => Promise<Response>) {
  return async (request: Request, context: Context): Promise<Response> => {
    const requestId = requestIdOf(request);
    try {
      const response = await handler(request, context, requestId);
      response.headers.set("x-request-id", requestId);
      return response;
    } catch (error) {
      if (error instanceof ApiError) return errorResponse(error, requestId);
      if (error instanceof ZodError) {
        const fieldErrors: Record<string, string[]> = {};
        for (const issue of error.issues) (fieldErrors[issue.path.join(".") || "_"] ??= []).push(issue.message);
        return errorResponse(new ApiError(400, "invalid_request", "The request was not valid.", { fieldErrors }), requestId);
      }
      console.error(`[${requestId}]`, error);
      return errorResponse(new ApiError(500, "internal_error", "Something went wrong on the server.", { retryable: true }), requestId);
    }
  };
}

export async function parseBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ApiError(400, "invalid_request", "The request body must be JSON.");
  }
  return schema.parse(raw);
}

export function parseQuery<T>(request: Request, schema: ZodType<T>): T {
  const params: Record<string, string> = {};
  new URL(request.url).searchParams.forEach((value, key) => { params[key] = value; });
  return schema.parse(params);
}

export function encodeCursor(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function decodeCursor<T>(cursor: string | undefined, schema: ZodType<T>): T | undefined {
  if (!cursor) return undefined;
  try {
    return schema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
  } catch {
    throw new ApiError(400, "invalid_cursor", "The page marker is not valid; start the list again.");
  }
}

export { z };
