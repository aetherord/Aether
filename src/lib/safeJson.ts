/**
 * Client-side fetch helper. Parses a Response as JSON without crashing on
 * non-JSON bodies — edge rate limiters (Cloudflare, our own middleware) return
 * plain-text 429s like `Too Many Requests`, and `res.json()` would throw
 * "Unexpected token 'T'..." before the caller can look at `res.ok`. A
 * non-JSON body becomes `{ error: <first 200 chars> }` so callers always get
 * something they can show the user.
 */
export async function safeJson<T = Record<string, unknown>>(
  res: Response
): Promise<T> {
  const text = await res.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return { error: text.slice(0, 200) } as unknown as T;
  }
}
