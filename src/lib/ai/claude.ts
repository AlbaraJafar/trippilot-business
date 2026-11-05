import "server-only";

/**
 * Minimal server-side Anthropic Messages API client (fetch-based, no SDK lock-in).
 * Returns null whenever the API is not configured or fails, so callers can always
 * fall back to deterministic logic.
 */

export function claudeConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export function claudeModel(): string {
  return process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
}

interface ToolCallArgs {
  system: string;
  prompt: string;
  toolName: string;
  toolDescription: string;
  inputSchema: Record<string, unknown>;
  maxTokens?: number;
}

async function post(body: Record<string, unknown>): Promise<{ content: { type: string; text?: string; input?: unknown; name?: string }[] } | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: claudeModel(), ...body }),
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn(`[claude] API returned ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.warn("[claude] request failed:", (e as Error).message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Forces a single tool call and returns its JSON input (structured output). */
export async function claudeToolCall(args: ToolCallArgs): Promise<unknown | null> {
  const data = await post({
    max_tokens: args.maxTokens ?? 1200,
    system: args.system,
    tools: [{ name: args.toolName, description: args.toolDescription, input_schema: args.inputSchema }],
    tool_choice: { type: "tool", name: args.toolName },
    messages: [{ role: "user", content: args.prompt }],
  });
  const block = data?.content?.find((c) => c.type === "tool_use" && c.name === args.toolName);
  return block?.input ?? null;
}

export async function claudeText(system: string, prompt: string, maxTokens = 400): Promise<string | null> {
  const data = await post({ max_tokens: maxTokens, system, messages: [{ role: "user", content: prompt }] });
  const text = data?.content?.filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
  return text || null;
}
