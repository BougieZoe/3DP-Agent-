package llm

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
)

var defaultEndpoints = map[string]string{
	"claude":    "https://api.anthropic.com/v1/messages",
	"openai":    "https://api.openai.com/v1/chat/completions",
	"deepseek":  "https://api.deepseek.com/v1/chat/completions",
	"kimi":      "https://api.moonshot.cn/v1/chat/completions",
	"fireworks": "https://api.fireworks.ai/inference/v1/chat/completions",
	"zhipu":     "https://open.bigmodel.cn/api/paas/v4/chat/completions",
	"gemini":    "https://generativelanguage.googleapis.com/v1beta",
	"nemotron":  "https://integrate.api.nvidia.com/v1/chat/completions",
}

func isModelAllowed(provider, model string) bool {
	keysMu.RLock()
	defer keysMu.RUnlock()

	if provider == "gemini" {
		return true
	}

	providerConfig, ok := keysConfig.Providers[provider]
	if !ok {
		return false
	}

	if providerConfig.Model == "" {
		return true
	}
	return providerConfig.Model == model
}

func resolveEndpoint(provider, model string) string {
	keysMu.RLock()
	defer keysMu.RUnlock()

	if provider == "gemini" {
		return fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent", model)
	}

	if p, ok := keysConfig.Providers[provider]; ok && p.BaseURL != "" {
		return p.BaseURL + "/chat/completions"
	}
	return defaultEndpoints[provider]
}

func resolveStreamEndpoint(provider, model string) string {
	keysMu.RLock()
	defer keysMu.RUnlock()

	if provider == "gemini" {
		return fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models/%s:streamGenerateContent?alt=sse", model)
	}

	if p, ok := keysConfig.Providers[provider]; ok && p.BaseURL != "" {
		return p.BaseURL + "/chat/completions"
	}
	return defaultEndpoints[provider]
}

type RelayRequest struct {
	Provider string      `json:"provider"`
	APIKey   string      `json:"apiKey"`
	Model    string      `json:"model"`
	Body     interface{} `json:"body"`
	Bearer   string      `json:"bearer,omitempty"`
}

type RelayResult struct {
	Status   int
	Body     string
	Provider string // which provider actually handled the request
}

// shouldRetry returns true if the error is retryable (balance/rate limit/auth issues)
func shouldRetry(status int) bool {
	// 401: Unauthorized (invalid key)
	// 402: Payment Required (balance exhausted)
	// 429: Too Many Requests (rate limited)
	// 500-599: Server errors (transient)
	return status == 401 || status == 402 || status == 429 || (status >= 500 && status < 600)
}

// fallbackProviders defines the order to try providers when the primary fails
var fallbackProviders = []string{
	"deepseek", "zhipu", "kimi", "fireworks", "nemotron", "openai", "gemini", "claude",
}

func validateProviderModel(provider, model string) error {
	if provider == "" {
		return fmt.Errorf("provider is required")
	}
	if !isModelAllowed(provider, model) {
		return fmt.Errorf("model not allowed: %s for provider %s", model, provider)
	}
	return nil
}

func buildAuthHeaders(provider, apiKey string) map[string]string {
	headers := map[string]string{
		"Content-Type": "application/json",
	}
	switch provider {
	case "claude":
		headers["x-api-key"] = apiKey
		headers["anthropic-version"] = "2023-06-01"
	case "gemini":
		headers["x-goog-api-key"] = apiKey
	default:
		headers["Authorization"] = "Bearer " + apiKey
	}
	return headers
}

func RelayLLM(req RelayRequest) RelayResult {
	jsonMarshal := func(v interface{}) string {
		b, _ := json.Marshal(v)
		return string(b)
	}

	if req.Provider == "" {
		return RelayResult{Status: 400, Body: jsonMarshal(map[string]string{"error": "provider is required"})}
	}
	if req.APIKey == "" {
		return RelayResult{Status: 400, Body: jsonMarshal(map[string]string{"error": "provider and apiKey are required"})}
	}

	model := ""
	if bodyMap, ok := req.Body.(map[string]interface{}); ok {
		if m, ok := bodyMap["model"].(string); ok {
			model = m
		}
	}
	if err := validateProviderModel(req.Provider, model); err != nil {
		return RelayResult{Status: 400, Body: jsonMarshal(map[string]string{"error": err.Error()})}
	}

	endpoint := resolveEndpoint(req.Provider, model)
	headers := buildAuthHeaders(req.Provider, req.APIKey)

	bodyBytes, _ := json.Marshal(req.Body)
	client := &http.Client{Timeout: 120 * time.Second}
	httpReq, err := http.NewRequest("POST", endpoint, strings.NewReader(string(bodyBytes)))
	if err != nil {
		return RelayResult{Status: 500, Body: jsonMarshal(map[string]string{"error": "failed to create request"})}
	}
	for k, v := range headers {
		httpReq.Header.Set(k, v)
	}

	resp, err := client.Do(httpReq)
	if err != nil {
		if strings.Contains(err.Error(), "timeout") || strings.Contains(err.Error(), "deadline") {
			return RelayResult{Status: 504, Body: jsonMarshal(map[string]string{"error": "LLM proxy timeout"})}
		}
		return RelayResult{Status: 500, Body: jsonMarshal(map[string]string{"error": "LLM proxy failed: " + err.Error()})}
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if len(respBody) == 0 {
		respBody = []byte("{}")
	}

	return RelayResult{Status: resp.StatusCode, Body: string(respBody), Provider: req.Provider}
}

// RelayLLMWithFallback tries the primary provider, then falls back to others on 402/429/5xx
func RelayLLMWithFallback(req RelayRequest) RelayResult {
	// Try the requested provider first
	result := RelayLLM(req)
	if !shouldRetry(result.Status) {
		return result
	}

	log.Printf("[llm] Provider %s returned %d, trying fallback...", req.Provider, result.Status)

	// Build list of fallback providers (excluding the one we already tried)
	tried := map[string]bool{req.Provider: true}
	for _, fallbackProvider := range fallbackProviders {
		if tried[fallbackProvider] {
			continue
		}

		// Get a key for this fallback provider
		keys := GetProviderKeys(fallbackProvider)
		if len(keys) == 0 {
			continue
		}

		// Try the first available key
		fallbackReq := RelayRequest{
			Provider: fallbackProvider,
			APIKey:   keys[0].Key,
			Model:    req.Model,
			Body:     req.Body,
		}

		// Update model in body for the new provider
		if bodyMap, ok := fallbackReq.Body.(map[string]interface{}); ok {
			// Get default model for this provider
			providerConfig, exists := keysConfig.Providers[fallbackProvider]
			if exists && providerConfig.Model != "" {
				bodyMap["model"] = providerConfig.Model
			}
		}

		result = RelayLLM(fallbackReq)
		if !shouldRetry(result.Status) {
			log.Printf("[llm] Fallback to %s succeeded (status %d)", fallbackProvider, result.Status)
			return result
		}

		log.Printf("[llm] Fallback %s also returned %d, trying next...", fallbackProvider, result.Status)
		tried[fallbackProvider] = true
	}

	// All providers failed, return the last error
	return result
}

func RelayLLMStream(w http.ResponseWriter, req RelayRequest) {
	if req.Provider == "" {
		http.Error(w, `{"error":"provider is required"}`, http.StatusBadRequest)
		return
	}
	if req.APIKey == "" {
		http.Error(w, `{"error":"provider and apiKey are required"}`, http.StatusBadRequest)
		return
	}

	model := ""
	if bodyMap, ok := req.Body.(map[string]interface{}); ok {
		if m, ok := bodyMap["model"].(string); ok {
			model = m
		}
	}
	if err := validateProviderModel(req.Provider, model); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusBadRequest)
		return
	}

	endpoint := resolveStreamEndpoint(req.Provider, model)
	headers := buildAuthHeaders(req.Provider, req.APIKey)

	bodyBytes, _ := json.Marshal(req.Body)
	client := &http.Client{Timeout: 120 * time.Second}
	httpReq, err := http.NewRequest("POST", endpoint, strings.NewReader(string(bodyBytes)))
	if err != nil {
		http.Error(w, `{"error":"failed to create request"}`, http.StatusInternalServerError)
		return
	}
	for k, v := range headers {
		httpReq.Header.Set(k, v)
	}

	resp, err := client.Do(httpReq)
	if err != nil {
		if strings.Contains(err.Error(), "timeout") || strings.Contains(err.Error(), "deadline") {
			http.Error(w, `{"error":"LLM stream timeout"}`, http.StatusGatewayTimeout)
			return
		}
		http.Error(w, fmt.Sprintf(`{"error":"LLM stream failed: %s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		errBody, _ := io.ReadAll(resp.Body)
		http.Error(w, fmt.Sprintf(`{"error":"Upstream error: %s"}`, string(errBody)), resp.StatusCode)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	buf := make([]byte, 4096)
	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			w.Write(buf[:n])
			flusher.Flush()
		}
		if readErr != nil {
			break
		}
	}
}
