// Provider-agnostic JSON generation. LLM_PROVIDER = gemini (default) | anthropic.

export class LlmError extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
  get rateLimited() {
    return this.status === 429
  }
}

export function llmProvider(): "gemini" | "anthropic" {
  return process.env.LLM_PROVIDER === "anthropic" ? "anthropic" : "gemini"
}

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001"

// The Gemini model id is not hardcoded: GEMINI_MODEL overrides, otherwise the
// newest stable (non-lite, non-preview) "flash" model is looked up from the
// official ListModels endpoint and cached for a few hours per instance.
let cachedGeminiModel: { id: string; at: number } | null = null

async function geminiModel(key: string): Promise<string> {
  if (process.env.GEMINI_MODEL) return process.env.GEMINI_MODEL
  if (cachedGeminiModel && Date.now() - cachedGeminiModel.at < 6 * 3600_000) return cachedGeminiModel.id

  const res = await fetch(`${GEMINI_BASE}/models?pageSize=200`, { headers: { "x-goog-api-key": key } })
  if (!res.ok) throw new LlmError(`Gemini model list failed (${res.status})`, res.status)
  const { models } = (await res.json()) as {
    models?: Array<{ name: string; supportedGenerationMethods?: string[] }>
  }
  const version = (id: string) => parseFloat(id.match(/(\d+(?:\.\d+)?)/)?.[1] ?? "0")
  const candidates = (models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""))
    .filter((id) => /^gemini-[\d.]+-flash$/.test(id))
    .sort((a, b) => version(b) - version(a))
  if (candidates.length === 0) throw new LlmError("No Gemini Flash model available", 503)
  cachedGeminiModel = { id: candidates[0], at: Date.now() }
  return candidates[0]
}

function parseJson<T>(raw: string): T {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
  return JSON.parse(cleaned) as T
}

export interface LlmRequest {
  /** Stable part of the prompt (rules + knowledge base). Cached where supported. */
  system: string
  /** Per-request part (lead context + conversation). */
  user: string
  maxTokens?: number
}

export async function generateJson<T>(req: LlmRequest): Promise<T> {
  return llmProvider() === "anthropic" ? anthropicJson<T>(req) : geminiJson<T>(req)
}

async function geminiJson<T>(req: LlmRequest): Promise<T> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new LlmError("GEMINI_API_KEY not set", 500)
  const model = await geminiModel(key)
  const res = await fetch(`${GEMINI_BASE}/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: "user", parts: [{ text: req.user }] }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.4,
        maxOutputTokens: req.maxTokens ?? 1024,
      },
    }),
  })
  if (!res.ok) throw new LlmError(`Gemini error (${res.status})`, res.status)
  const data = await res.json()
  const text: string | undefined = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("")
  if (!text) throw new LlmError("Empty Gemini response", 502)
  return parseJson<T>(text)
}

async function anthropicJson<T>(req: LlmRequest): Promise<T> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new LlmError("ANTHROPIC_API_KEY not set", 500)
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: req.maxTokens ?? 1024,
      temperature: 0.4,
      // The system block (rules + KB) is identical across a call's requests,
      // so mark it cacheable.
      system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
      messages: [
        { role: "user", content: req.user },
        { role: "assistant", content: "{" },
      ],
    }),
  })
  if (!res.ok) throw new LlmError(`Anthropic error (${res.status})`, res.status)
  const data = await res.json()
  const text: string | undefined = data?.content?.[0]?.text
  if (!text) throw new LlmError("Empty Anthropic response", 502)
  return parseJson<T>("{" + text)
}
