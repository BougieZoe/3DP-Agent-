// Package models provides auto-discovery of LLM models from provider APIs.
//
// Design:
//   - Fetches /v1/models from each provider at startup + periodic refresh
//   - Caches results with configurable TTL (default 5 minutes)
//   - Merges: Provider API (auto) > YAML config (user override) > Hardcoded (fallback)
//   - Serves via GET /api/models
//
// Adding a new provider:
//  1. Add entry to providerEndpoints map
//  2. Add to hardcodedModels as fallback
//  3. That's it — system auto-discovers models from the API

package models

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"sort"
	"sync"
	"time"
)

// ── Types ──────────────────────────────────────────────────────────────────

type ModelInfo struct {
	ID         string            `json:"id"`
	Provider   string            `json:"provider"`
	Label      string            `json:"label"`
	Released   string            `json:"released,omitempty"`
	Capabilities []string        `json:"capabilities,omitempty"`
	Pricing    *ModelPricing     `json:"pricing,omitempty"`
	Source     string            `json:"source"` // "api", "yaml", "hardcoded"
}

type ModelPricing struct {
	InputPer1K  float64 `json:"inputPer1K,omitempty"`
	OutputPer1K float64 `json:"outputPer1K,omitempty"`
	Currency    string  `json:"currency,omitempty"`
}

type ModelRegistry struct {
	mu           sync.RWMutex
	models       map[string]*ModelInfo // key: "provider/modelID"
	providerMeta map[string]*ProviderMeta
	lastRefresh  time.Time
	ttl          time.Duration
}

type ProviderMeta struct {
	ID        string `json:"id"`
	Label     string `json:"label"`
	BaseURL   string `json:"baseUrl"`
	HasAPIKey bool   `json:"hasApiKey"`
}

// ── Provider Configuration ─────────────────────────────────────────────────

// Provider API endpoints for model discovery
var providerEndpoints = map[string]string{
	"claude":    "https://api.anthropic.com/v1/models",
	"openai":    "https://api.openai.com/v1/models",
	"deepseek":  "https://api.deepseek.com/v1/models",
	"kimi":      "https://api.moonshot.cn/v1/models",
	"fireworks": "https://api.fireworks.ai/v1/models",
	"zhipu":     "https://open.bigmodel.cn/api/paas/v4/models",
	"gemini":    "https://generativelanguage.googleapis.com/v1beta/models",
}

// Hardcoded fallback models (used when API is unavailable)
var hardcodedModels = []ModelInfo{
	// Claude
	{ID: "claude-sonnet-4-20250514", Provider: "claude", Label: "Claude Sonnet 4", Released: "2025-05-14", Source: "hardcoded"},
	// OpenAI
	{ID: "gpt-5.5", Provider: "openai", Label: "GPT-5.5", Source: "hardcoded"},
	// DeepSeek
	{ID: "deepseek-chat", Provider: "deepseek", Label: "DeepSeek Chat", Source: "hardcoded"},
	// Kimi
	{ID: "kimi-k3", Provider: "kimi", Label: "Kimi K3", Source: "hardcoded"},
	// Fireworks
	{ID: "accounts/fireworks/models/deepseek-v4-pro", Provider: "fireworks", Label: "DeepSeek V4 Pro (Fireworks)", Source: "hardcoded"},
	// Zhipu
	{ID: "glm-4.7", Provider: "zhipu", Label: "GLM-4.7", Source: "hardcoded"},
	// Gemini
	{ID: "gemini-3.6-flash", Provider: "gemini", Label: "Gemini 3.6 Flash", Source: "hardcoded"},
}

// Provider labels for display
var providerLabels = map[string]string{
	"claude":    "Anthropic Claude",
	"openai":    "OpenAI",
	"deepseek":  "DeepSeek",
	"kimi":      "Moonshot Kimi",
	"fireworks": "Fireworks AI",
	"zhipu":     "Zhipu GLM",
	"gemini":    "Google Gemini",
}

// ── New Registry ───────────────────────────────────────────────────────────

func NewModelRegistry(ttl time.Duration) *ModelRegistry {
	r := &ModelRegistry{
		models:       make(map[string]*ModelInfo),
		providerMeta: make(map[string]*ProviderMeta),
		ttl:          ttl,
	}
	return r
}

// ── Public API ─────────────────────────────────────────────────────────────

// GetModels returns all discovered models, sorted by provider then ID.
func (r *ModelRegistry) GetModels() []ModelInfo {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var models []ModelInfo
	for _, m := range r.models {
		models = append(models, *m)
	}

	sort.Slice(models, func(i, j int) bool {
		if models[i].Provider != models[j].Provider {
			return models[i].Provider < models[j].Provider
		}
		return models[i].ID < models[j].ID
	})

	return models
}

// GetModelsByProvider returns models for a specific provider.
func (r *ModelRegistry) GetModelsByProvider(provider string) []ModelInfo {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var models []ModelInfo
	for _, m := range r.models {
		if m.Provider == provider {
			models = append(models, *m)
		}
	}

	sort.Slice(models, func(i, j int) bool {
		return models[i].ID < models[j].ID
	})

	return models
}

// GetProviderMeta returns metadata for all providers.
func (r *ModelRegistry) GetProviderMeta() []ProviderMeta {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var providers []ProviderMeta
	for _, p := range r.providerMeta {
		providers = append(providers, *p)
	}

	sort.Slice(providers, func(i, j int) bool {
		return providers[i].ID < providers[j].ID
	})

	return providers
}

// IsStale returns true if the cache needs refresh.
func (r *ModelRegistry) IsStale() bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return time.Since(r.lastRefresh) > r.ttl
}

// ── Refresh Logic ──────────────────────────────────────────────────────────

// Refresh fetches models from all providers and merges with hardcoded.
// Safe to call concurrently — only one refresh runs at a time.
func (r *ModelRegistry) Refresh(apiKeys map[string]string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	// If recently refreshed, skip
	if time.Since(r.lastRefresh) < r.ttl {
		return nil
	}

	log.Printf("[models] Refreshing model registry...")
	start := time.Now()

	// Start with hardcoded models
	r.models = make(map[string]*ModelInfo)
	for i := range hardcodedModels {
		m := hardcodedModels[i]
		r.models[m.Provider+"/"+m.ID] = &m
	}

	// Fetch from each provider API
	var wg sync.WaitGroup
	var mu sync.Mutex
	discovered := make(map[string]*ModelInfo)

	for provider, endpoint := range providerEndpoints {
		apiKey := apiKeys[provider]
		if apiKey == "" {
			// No API key — mark provider as unavailable
			r.providerMeta[provider] = &ProviderMeta{
				ID:        provider,
				Label:     providerLabels[provider],
				BaseURL:   endpoint,
				HasAPIKey: false,
			}
			continue
		}

		r.providerMeta[provider] = &ProviderMeta{
			ID:        provider,
			Label:     providerLabels[provider],
			BaseURL:   endpoint,
			HasAPIKey: true,
		}

		wg.Add(1)
		go func(provider, endpoint, apiKey string) {
			defer wg.Done()
			models, err := fetchModelsFromAPI(provider, endpoint, apiKey)
			if err != nil {
				log.Printf("[models] Failed to fetch from %s: %v", provider, err)
				return
			}
			mu.Lock()
			for i := range models {
				discovered[provider+"/"+models[i].ID] = &models[i]
			}
			mu.Unlock()
		}(provider, endpoint, apiKey)
	}

	wg.Wait()

	// Merge: API models override hardcoded (API is fresher)
	for key, m := range discovered {
		m.Source = "api"
		r.models[key] = m
	}

	r.lastRefresh = time.Now()
	log.Printf("[models] Refresh complete: %d models from %d providers in %v",
		len(r.models), len(r.providerMeta), time.Since(start))

	return nil
}

// ── API Fetching ───────────────────────────────────────────────────────────

func fetchModelsFromAPI(provider, endpoint, apiKey string) ([]ModelInfo, error) {
	client := &http.Client{Timeout: 10 * time.Second}

	req, err := http.NewRequest("GET", endpoint, nil)
	if err != nil {
		return nil, err
	}

	// Set auth headers based on provider
	switch provider {
	case "claude":
		req.Header.Set("x-api-key", apiKey)
		req.Header.Set("anthropic-version", "2023-06-01")
	case "gemini":
		req.Header.Set("x-goog-api-key", apiKey)
	default:
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(body[:min(len(body), 200)]))
	}

	return parseModelsResponse(provider, resp)
}

func parseModelsResponse(provider string, resp *http.Response) ([]ModelInfo, error) {
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var models []ModelInfo

	switch provider {
	case "claude":
		// Anthropic format: { "data": [{"id": "...", "type": "model"}] }
		var data struct {
			Data []struct {
				ID string `json:"id"`
			} `json:"data"`
		}
		if err := json.Unmarshal(body, &data); err != nil {
			return nil, err
		}
		for _, m := range data.Data {
			models = append(models, ModelInfo{
				ID:       m.ID,
				Provider: provider,
				Label:    formatModelLabel(m.ID),
				Source:   "api",
			})
		}

	case "openai", "deepseek", "kimi", "fireworks", "zhipu":
		// OpenAI format: { "data": [{"id": "...", "owned_by": "..."}] }
		var data struct {
			Data []struct {
				ID      string `json:"id"`
				OwnedBy string `json:"owned_by"`
			} `json:"data"`
		}
		if err := json.Unmarshal(body, &data); err != nil {
			return nil, err
		}
		for _, m := range data.Data {
			models = append(models, ModelInfo{
				ID:       m.ID,
				Provider: provider,
				Label:    formatModelLabel(m.ID),
				Source:   "api",
			})
		}

	case "gemini":
		// Google format: { "models": [{"name": "models/...", "displayName": "..."}] }
		var data struct {
			Models []struct {
				Name        string `json:"name"`
				DisplayName string `json:"displayName"`
			} `json:"models"`
		}
		if err := json.Unmarshal(body, &data); err != nil {
			return nil, err
		}
		for _, m := range data.Models {
			// Extract model ID from "models/gemini-2.5-flash" → "gemini-2.5-flash"
			id := m.Name
			if len(id) > 7 && id[:7] == "models/" {
				id = id[7:]
			}
			models = append(models, ModelInfo{
				ID:       id,
				Provider: provider,
				Label:    m.DisplayName,
				Source:   "api",
			})
		}
	}

	return models, nil
}

func formatModelLabel(id string) string {
	// Convert "claude-sonnet-4-20250514" → "Claude Sonnet 4"
	// Convert "deepseek-chat" → "DeepSeek Chat"
	// Simple heuristic: split by "-", capitalize, join
	if len(id) == 0 {
		return id
	}

	// Known mappings
	known := map[string]string{
		"deepseek-chat":               "DeepSeek Chat",
		"kimi-k3":                     "Kimi K3",
		"glm-4.7":                     "GLM-4.7",
		"gpt-4o":                      "GPT-4o",
		"gpt-4o-mini":                 "GPT-4o Mini",
		"gemini-3.6-flash":            "Gemini 3.6 Flash",
		"gemini-2.5-flash":            "Gemini 2.5 Flash",
		"claude-sonnet-4-20250514":    "Claude Sonnet 4",
		"claude-opus-4-20250901":      "Claude Opus 4",
	}
	if label, ok := known[id]; ok {
		return label
	}

	// Generic: just return the ID
	return id
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
