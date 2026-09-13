package llm

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"

	"github.com/fsnotify/fsnotify"
	"gopkg.in/yaml.v3"
)

type LLMKeyEntry struct {
	Key      string `yaml:"key"`
	Priority int    `yaml:"priority"`
	BaseURL  string `yaml:"baseUrl,omitempty"`
	Model    string `yaml:"model,omitempty"`
}

type LLMProviderConfig struct {
	ID      string         `yaml:"id"`
	BaseURL string         `yaml:"baseUrl"`
	Model   string         `yaml:"model"`
	Keys    []LLMKeyEntry  `yaml:"keys"`
}

type LLMKeysConfig struct {
	Providers map[string]LLMProviderConfig `yaml:"providers"`
}

var (
	keysConfig   LLMKeysConfig
	keysMu       sync.RWMutex
	keysFilePath string
	watcher      *fsnotify.Watcher
)

var defaultProviderConfig = map[string]struct {
	BaseURL string
	Model   string
}{
	"openai":     {BaseURL: "https://api.openai.com/v1", Model: "gpt-4o"},
	"deepseek":   {BaseURL: "https://api.deepseek.com/v1", Model: "deepseek-chat"},
	"kimi":       {BaseURL: "https://api.moonshot.cn/v1", Model: "kimi-k3"},
	"fireworks":  {BaseURL: "https://api.fireworks.ai/inference/v1", Model: "accounts/fireworks/models/deepseek-v4-pro"},
	"zhipu":      {BaseURL: "https://open.bigmodel.cn/api/paas/v4", Model: "glm-4.7"},
	"gemini":     {BaseURL: "https://generativelanguage.googleapis.com/v1", Model: "gemini-2.5-flash"},
	"claude":     {BaseURL: "https://api.anthropic.com/v1", Model: "claude-sonnet-4-20250514"},
	"amd-cloud":  {BaseURL: "http://localhost:8000/v1", Model: "Qwen/Qwen3-8B"},
}

func LoadKeys() error {
	if keysFilePath == "" {
		return fmt.Errorf("keys file path not set")
	}

	data, err := os.ReadFile(keysFilePath)
	if err != nil {
		return err
	}

	var config LLMKeysConfig
	if err := yaml.Unmarshal(data, &config); err != nil {
		return err
	}

	// Apply defaults and sort keys
	for id, provider := range config.Providers {
		if defaults, ok := defaultProviderConfig[id]; ok {
			if provider.BaseURL == "" {
				provider.BaseURL = defaults.BaseURL
			}
			if provider.Model == "" {
				provider.Model = defaults.Model
			}
		}
		// Sort keys by priority (lower = higher priority)
		sort.Slice(provider.Keys, func(i, j int) bool {
			return provider.Keys[i].Priority < provider.Keys[j].Priority
		})
		config.Providers[id] = provider
	}

	keysMu.Lock()
	keysConfig = config
	keysMu.Unlock()

	return nil
}

func SetKeysFilePath(path string) {
	keysFilePath = path
}

func GetKeys() LLMKeysConfig {
	keysMu.RLock()
	defer keysMu.RUnlock()
	return keysConfig
}

func GetProviderKeys(providerId string) []LLMKeyEntry {
	keysMu.RLock()
	defer keysMu.RUnlock()

	provider, ok := keysConfig.Providers[providerId]
	if !ok {
		return nil
	}
	return provider.Keys
}

func BuildCandidates(providerId string, clientKey string) []LLMCandidate {
	keysMu.RLock()
	defer keysMu.RUnlock()

	provider, ok := keysConfig.Providers[providerId]
	if !ok {
		// Use defaults
		if defaults, ok := defaultProviderConfig[providerId]; ok {
			return []LLMCandidate{
				{
					ID:      providerId,
					Label:   providerId,
					BaseURL: defaults.BaseURL,
					Model:   defaults.Model,
					APIKey:  clientKey,
				},
			}
		}
		return nil
	}

	var candidates []LLMCandidate
	seen := map[string]bool{}

	// Server keys first
	for _, key := range provider.Keys {
		if key.Key == "" || key.Key == "__no_key__" {
			continue
		}
		if seen[key.Key] {
			continue
		}
		seen[key.Key] = true

		candidate := LLMCandidate{
			ID:      providerId,
			Label:   providerId,
			BaseURL: provider.BaseURL,
			Model:   provider.Model,
			APIKey:  key.Key,
		}
		if key.BaseURL != "" {
			candidate.BaseURL = key.BaseURL
		}
		if key.Model != "" {
			candidate.Model = key.Model
		}
		candidates = append(candidates, candidate)
	}

	// Client key as fallback
	if clientKey != "" && !seen[clientKey] {
		candidates = append(candidates, LLMCandidate{
			ID:      providerId,
			Label:   providerId,
			BaseURL: provider.BaseURL,
			Model:   provider.Model,
			APIKey:  clientKey,
		})
	}

	return candidates
}

func BuildAllCandidates(activeProvider string, clientKeys map[string]string) []LLMCandidate {
	keysMu.RLock()
	defer keysMu.RUnlock()

	var candidates []LLMCandidate
	seen := map[string]bool{}

	// Active provider first
	if activeProvider != "" {
		if provider, ok := keysConfig.Providers[activeProvider]; ok {
			for _, key := range provider.Keys {
				if key.Key == "" || key.Key == "__no_key__" || seen[key.Key] {
					continue
				}
				seen[key.Key] = true
				candidates = append(candidates, LLMCandidate{
					ID:      activeProvider,
					Label:   activeProvider,
					BaseURL: provider.BaseURL,
					Model:   provider.Model,
					APIKey:  key.Key,
				})
			}
		}
	}

	// Other providers
	for id, provider := range keysConfig.Providers {
		if id == activeProvider {
			continue
		}
		for _, key := range provider.Keys {
			if key.Key == "" || key.Key == "__no_key__" || seen[key.Key] {
				continue
			}
			seen[key.Key] = true
			candidates = append(candidates, LLMCandidate{
				ID:      id,
				Label:   id,
				BaseURL: provider.BaseURL,
				Model:   provider.Model,
				APIKey:  key.Key,
			})
		}
	}

	return candidates
}

func StartWatching() error {
	if keysFilePath == "" {
		return nil
	}

	dir := filepath.Dir(keysFilePath)
	var err error
	watcher, err = fsnotify.NewWatcher()
	if err != nil {
		return err
	}

	go func() {
		for {
			select {
			case event, ok := <-watcher.Events:
				if !ok {
					return
				}
				if event.Name == keysFilePath && (event.Op&fsnotify.Write != 0 || event.Op&fsnotify.Create != 0) {
					LoadKeys()
				}
			case _, ok := <-watcher.Errors:
				if !ok {
					return
				}
			}
		}
	}()

	return watcher.Add(dir)
}

func StopWatching() {
	if watcher != nil {
		watcher.Close()
	}
}
