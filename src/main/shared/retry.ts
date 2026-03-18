/**
 * Retry an async function on transient failures with exponential backoff.
 */

interface RetryOptions {
  retries?: number;
  baseDelay?: number;
  shouldRetry?: (err: Error) => boolean;
  label?: string;
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { retries = 3, baseDelay = 1000, shouldRetry = isTransientError, label = "" } = options;

  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;
      if (attempt < retries && shouldRetry(lastError)) {
        const delay = baseDelay * Math.pow(2, attempt);
        console.warn(
          `${label ? `[${label}] ` : ""}Transient error (attempt ${attempt + 1}/${retries + 1}), retrying in ${delay}ms:`,
          lastError.message,
        );
        await sleep(delay);
      }
    }
  }
  throw lastError;
}

/**
 * Determine whether an error is transient and worth retrying.
 */
export function isTransientError(err: Error & { code?: string; status?: number; response?: { status?: number } }): boolean {
  if (
    err.name === "TypeError" ||
    err.code === "ECONNRESET" ||
    err.code === "ETIMEDOUT" ||
    err.code === "ECONNABORTED" ||
    err.code === "ENOTFOUND" ||
    err.code === "ENETUNREACH" ||
    err.code === "UND_ERR_CONNECT_TIMEOUT"
  ) {
    return true;
  }
  if (err.name === "AbortError" || err.name === "TimeoutError") {
    return true;
  }
  if (
    err.message &&
    (err.message.includes("disposed") || err.message.includes("Render frame was disposed") || err.message.includes("ERR_ABORTED"))
  ) {
    return true;
  }
  const status = err.status || err.response?.status;
  if (status === 429 || status === 502 || status === 503 || status === 504) {
    return true;
  }
  return false;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
