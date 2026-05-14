/**
 * API client — all HTTP calls go through here.
 * Credentials (cookies) are always included.
 */

import { AppError } from "@/lib/errors";

const BASE_URL = "/api/v1";

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const json = await res.json();
      detail = json.detail || detail;
    } catch {
      // Keep the HTTP status fallback when the server returns a non-JSON error.
    }
    throw new AppError(detail, String(res.status), res.status);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

async function formRequest<T>(path: string, body: FormData): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    credentials: "include",
    body,
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const json = await res.json();
      detail = json.detail || detail;
    } catch {
      // Keep the HTTP status fallback when the server returns a non-JSON error.
    }
    throw new AppError(detail, String(res.status), res.status);
  }

  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
  form: <T>(path: string, body: FormData) => formRequest<T>(path, body),
};
