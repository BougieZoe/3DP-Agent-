package llm

import (
	"encoding/json"
	"fmt"
	"io"
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
	Status int
	Body   string
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

	return RelayResult{Status: resp.StatusCode, Body: string(respBody)}
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
