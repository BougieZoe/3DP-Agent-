// client/src/lib/config.ts
//
// Holds values that change over time — currently just the AMD Cloud endpoint.
// Every time you destroy and recreate your AMD Droplet, you get a new IP.
// This is the ONLY place you need to update it — apiKeys.ts imports from here
// instead of hardcoding the address.
//
// Claude / OpenAI / Gemini / DeepSeek don't need this treatment: their URLs
// are permanent addresses maintained by those companies, not infrastructure
// you personally spin up and tear down.

export const AMD_CLOUD_ENDPOINT = '/api/amd-proxy';

// Same-origin relay for ALL keyed LLM providers (claude/openai/gemini/
// deepseek/kimi/fireworks). Browser-origin calls to Anthropic/Moonshot/Gemini
// are blocked by CORS, so every provider call goes through our server, which
// forwards with the user's key attached per-request (never stored).
export const LLM_PROXY_ENDPOINT = '/api/llm';