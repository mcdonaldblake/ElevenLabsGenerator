export type PublicApiError = {
  code: string;
  message: string;
  retryable: boolean;
  provider?: "elevenlabs";
  providerRequestId?: string;
  details?: Record<string, unknown>;
};

export class ApiError extends Error {
  readonly status: number;
  readonly publicError: PublicApiError;

  constructor(
    status: number,
    code: string,
    message: string,
    options: {
      retryable?: boolean;
      provider?: "elevenlabs";
      providerRequestId?: string | undefined;
      details?: Record<string, unknown>;
    } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.publicError = {
      code,
      message,
      retryable: options.retryable ?? false,
      ...(options.provider ? { provider: options.provider } : {}),
      ...(options.providerRequestId ? { providerRequestId: options.providerRequestId } : {}),
      ...(options.details ? { details: options.details } : {}),
    };
  }
}

export class ProviderError extends ApiError {
  readonly retryAfterMs: number | null;

  constructor(
    status: number,
    code: string,
    message: string,
    options: {
      retryable: boolean;
      providerRequestId?: string | undefined;
      retryAfterMs?: number | null;
    },
  ) {
    super(status, code, message, {
      retryable: options.retryable,
      provider: "elevenlabs",
      ...(options.providerRequestId ? { providerRequestId: options.providerRequestId } : {}),
    });
    this.name = "ProviderError";
    this.retryAfterMs = options.retryAfterMs ?? null;
  }
}
