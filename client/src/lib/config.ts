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

export const AMD_CLOUD_ENDPOINT = 'https://radeon-global.anruicloud.com/instances/hf-238-b30b691c/proxy/8000/v1/chat/completions';