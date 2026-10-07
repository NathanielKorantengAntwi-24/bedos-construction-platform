import { ApiError } from "./api-error";

export async function parseJson<T>(request: Request): Promise<T> {
  try {
    return await request.json();
  } catch {
    throw new ApiError("Invalid JSON request body", 400);
  }
}