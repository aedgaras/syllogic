export const DEFAULT_LLM_MODEL = "gpt-4o-mini";

export type LlmConfig = {
  apiKey: string;
  baseURL?: string;
  model: string;
  configured: boolean;
};

/**
 * Resolve provider-neutral LLM configuration while preserving the existing
 * OpenAI environment variables for backwards compatibility.
 */
export function getLlmConfig(): LlmConfig {
  const baseURL = (
    process.env.LLM_BASE_URL ||
    process.env.OPENAI_BASE_URL ||
    ""
  ).trim();
  const configuredApiKey = (
    process.env.LLM_API_KEY ||
    process.env.OPENAI_API_KEY ||
    ""
  ).trim();
  const model = (
    process.env.LLM_MODEL ||
    process.env.CATEGORIZATION_LLM_MODEL ||
    DEFAULT_LLM_MODEL
  ).trim();

  return {
    // OpenAI-compatible SDKs require a key even when a local server ignores it.
    apiKey: configuredApiKey || (baseURL ? "local-llm" : ""),
    baseURL: baseURL || undefined,
    model: model || DEFAULT_LLM_MODEL,
    configured: Boolean(configuredApiKey || baseURL),
  };
}
