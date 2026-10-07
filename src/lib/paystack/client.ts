const PAYSTACK_BASE_URL = "https://api.paystack.co";

function getPaystackSecretKey() {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;

  if (!secretKey) {
    throw new Error("Paystack secret key is not configured");
  }

  return secretKey;
}

export async function paystackRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${getPaystackSecretKey()}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
    cache: "no-store",
  });

  const data = await response.json();

  if (!response.ok || data.status === false) {
    throw new Error(
      data.message ?? "Paystack request failed",
    );
  }

  return data.data as T;
}