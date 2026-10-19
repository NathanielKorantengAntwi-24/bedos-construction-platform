
const PAYSTACK_BASE_URL = "https://api.paystack.co";
const PAYSTACK_TIMEOUT_MS = 15_000;

export class PaystackRequestError extends Error {
  constructor(
    message: string,
    public readonly outcomeUnknown: boolean,
    public readonly code:
      | "configuration"
      | "network"
      | "http"
      | "provider"
      | "response",
  ) {
    super(message);
    this.name = "PaystackRequestError";
  }
}

function getPaystackSecretKey(): string {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;

  if (!secretKey) {
    throw new PaystackRequestError(
      "PAYSTACK_SECRET_KEY is not configured",
      false,
      "configuration",
    );
  }

  return secretKey;
}

async function requestPaystackEnvelope<T>(
  path: string,
  options: RequestInit = {},
): Promise<{ data: T; meta: unknown }> {
  const secretKey = getPaystackSecretKey();
  const timeoutSignal = AbortSignal.timeout(PAYSTACK_TIMEOUT_MS);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal;

  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${secretKey}`);

  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;

  try {
    response = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
      ...options,
      signal,
      headers,
      cache: "no-store",
    });
  } catch {
    throw new PaystackRequestError(
      "Paystack network request failed or timed out",
      true,
      "network",
    );
  }

  let data: {
    status?: boolean;
    message?: string;
    data?: T;
    meta?: unknown;
  };

  try {
    data = await response.json();
  } catch {
    throw new PaystackRequestError(
      "Paystack returned an unreadable response",
      true,
      "response",
    );
  }

  if (
    data === null ||
    typeof data !== "object" ||
    Array.isArray(data)
  ) {
    throw new PaystackRequestError(
      "Paystack returned an invalid response structure",
      true,
      "response",
    );
  }
  if (!response.ok) {
    // A server error or timeout can occur after Paystack has
    // received a request, so its outcome may be uncertain.
    const outcomeUnknown =
      response.status >= 500 ||
      response.status === 408 ||
      response.status === 429;

    throw new PaystackRequestError(
      data.message ?? "Paystack request failed",
      outcomeUnknown,
      "http",
    );
  }

  if (data.status === false) {
    throw new PaystackRequestError(
      data.message ?? "Paystack rejected the request",
      false,
      "provider",
    );
  }

  if (data.status !== true) {
    throw new PaystackRequestError(
      "Paystack response did not confirm success",
      true,
      "response",
    );
  }

  if (data.data === undefined) {
    throw new PaystackRequestError(
      "Paystack response did not contain transaction data",
      true,
      "response",
    );
  }

  return { data: data.data, meta: data.meta };
}

/**
 * Existing Paystack callers continue to receive only response data.
 */
export async function paystackRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await requestPaystackEnvelope<T>(path, options);
  return response.data;
}

/**
 * For endpoints where response metadata is needed.
 * Metadata remains unknown until validated by the caller.
 */
export async function paystackRequestWithMeta<T>(
  path: string,
  options: RequestInit = {},
): Promise<{ data: T; meta: unknown }> {
  return requestPaystackEnvelope<T>(path, options);
}