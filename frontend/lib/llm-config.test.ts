import { afterEach, describe, expect, it } from "vitest";
import { getLlmConfig } from "./llm-config";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("getLlmConfig", () => {
  it("prefers provider-neutral variables", () => {
    process.env.LLM_API_KEY = "custom-key";
    process.env.OPENAI_API_KEY = "legacy-key";
    process.env.LLM_BASE_URL = "http://ollama:11434/v1";
    process.env.LLM_MODEL = "qwen3:8b";

    expect(getLlmConfig()).toEqual({
      apiKey: "custom-key",
      baseURL: "http://ollama:11434/v1",
      model: "qwen3:8b",
      configured: true,
    });
  });

  it("uses a placeholder key for an unauthenticated local endpoint", () => {
    delete process.env.LLM_API_KEY;
    delete process.env.OPENAI_API_KEY;
    process.env.LLM_BASE_URL = "http://localai:8080/v1";

    expect(getLlmConfig().apiKey).toBe("local-llm");
    expect(getLlmConfig().configured).toBe(true);
  });

  it("supports legacy OpenAI variables", () => {
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;
    process.env.OPENAI_API_KEY = "sk-legacy";
    process.env.OPENAI_BASE_URL = "https://proxy.example/v1";
    process.env.CATEGORIZATION_LLM_MODEL = "legacy-model";

    expect(getLlmConfig()).toEqual({
      apiKey: "sk-legacy",
      baseURL: "https://proxy.example/v1",
      model: "legacy-model",
      configured: true,
    });
  });
});
