import type { ApiError } from "@voice-foundry/schemas";

export class AppError extends Error {
  readonly statusCode: number;
  readonly apiError: ApiError;

  constructor(statusCode: number, code: string, message: string, options: {
    retryable?: boolean;
    provider?: string;
    providerRequestId?: string | undefined;
    details?: Record<string, unknown>;
  } = {}) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.apiError = {
      code,
      message,
      retryable: options.retryable ?? false,
      ...(options.provider ? { provider: options.provider } : {}),
      ...(options.providerRequestId ? { providerRequestId: options.providerRequestId } : {}),
      ...(options.details ? { details: options.details } : {}),
    };
  }
}

export function notFound(resource: string): AppError {
  return new AppError(404, "NOT_FOUND", `${resource} was not found.`);
}
