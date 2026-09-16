package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/BougieZoe/3dp-agent-go/auth"
	"github.com/BougieZoe/3dp-agent-go/cad"
	"github.com/BougieZoe/3dp-agent-go/config"
	"github.com/BougieZoe/3dp-agent-go/health"
	"github.com/BougieZoe/3dp-agent-go/llm"
	"github.com/BougieZoe/3dp-agent-go/material"
	"github.com/BougieZoe/3dp-agent-go/memory"
	"github.com/BougieZoe/3dp-agent-go/mesh"
	"github.com/BougieZoe/3dp-agent-go/models"
	"github.com/BougieZoe/3dp-agent-go/ratelimit"
	"github.com/BougieZoe/3dp-agent-go/slicer"
	"github.com/BougieZoe/3dp-agent-go/step"
	"github.com/BougieZoe/3dp-agent-go/thermal"
)

func main() {
	cfg := config.Load()

	llm.SetKeysFilePath(cfg.CadBridgeDir + "/config/llm-keys.yaml")
	if err := llm.LoadKeys(); err != nil {
		log.Printf("Warning: failed to load LLM keys: %v", err)
	}
	llm.StartWatching()
	defer llm.StopWatching()

	rl := ratelimit.New(30, 60*1e9)
	ba := auth.NewBridgeAuth(cfg.BridgeToken, cfg.IsProduction())

	memoryStore, err := memory.NewMemoryStore(cfg.CadBridgeDir)
	if err != nil {
		log.Printf("Warning: failed to initialize memory store: %v", err)
	} else {
		defer memoryStore.Close()
	}

	// Initialize model registry with 5-minute TTL
	modelRegistry := models.NewModelRegistry(5 * time.Minute)

	// Extract provider config and API keys from LLM config
	llmKeys := llm.GetKeys()
	providerConfig := make(map[string]models.ProviderConfig)
	apiKeys := make(map[string]string)
	for provider, config := range llmKeys.Providers {
		providerConfig[provider] = models.ProviderConfig{
			ID:      config.ID,
			BaseURL: config.BaseURL,
			Model:   config.Model,
		}
		if len(config.Keys) > 0 {
			apiKeys[provider] = config.Keys[0].Key
		}
	}
	modelRegistry.SetProviderConfig(providerConfig)

	// Initial refresh (non-blocking)
	go func() {
		if err := modelRegistry.Refresh(apiKeys); err != nil {
			log.Printf("Warning: initial model refresh failed: %v", err)
		}
	}()

	// Periodic refresh every 5 minutes
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			if err := modelRegistry.Refresh(apiKeys); err != nil {
				log.Printf("Warning: model refresh failed: %v", err)
			}
		}
	}()

	slicerRouter := slicer.NewSlicerRouter(cfg.SlicerPaths)
	meshRouter := mesh.NewMeshRouter(cfg.PythonPath, cfg.CadBridgeDir)
	stepRouter := step.NewStepRouter(cfg.PythonPath, cfg.CadBridgeDir)
	cadRouter := cad.NewCadRouter(cfg.PythonPath, cfg.CadBridgeDir)
	healthRouter := health.NewHealthRouter(cfg.PythonPath, cfg.SlicerPaths)
	thermalRouter := thermal.NewThermalRouter()
	modelRouter := models.NewModelRouter(modelRegistry)

	r := chi.NewRouter()

	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.RealIP)
	r.Use(rl.Middleware)

	r.Route("/health", func(r chi.Router) {
		r.Mount("/", healthRouter.Routes())
	})

	r.Route("/api", func(r chi.Router) {
		r.Use(ba.Middleware)

		r.Route("/slice", func(r chi.Router) {
			r.Mount("/", slicerRouter.Routes())
		})

		r.Route("/mesh", func(r chi.Router) {
			r.Mount("/", meshRouter.Routes())
		})

		r.Route("/step", func(r chi.Router) {
			r.Mount("/", stepRouter.Routes())
		})

		r.Route("/cad", func(r chi.Router) {
			r.Mount("/", cadRouter.Routes())
		})

		r.Route("/thermal", func(r chi.Router) {
			r.Mount("/", thermalRouter.Routes())
		})

		r.Route("/materials", func(r chi.Router) {
			r.Mount("/", material.Handler())
		})

		r.Route("/models", func(r chi.Router) {
			r.Mount("/", modelRouter.Routes())
		})

		if memoryStore != nil {
			memoryRouter := memory.NewMemoryRouter(memoryStore)
			r.Route("/memory", func(r chi.Router) {
				r.Mount("/", memoryRouter.Routes())
			})
		}

		r.Post("/llm", llmRelayHandler)
		r.Post("/llm/stream", llmStreamHandler)
	})

	addr := fmt.Sprintf(":%d", cfg.Port)
	log.Printf("3DP Agent Go backend starting on %s", addr)
	log.Printf("  Environment: %s", cfg.NodeEnv)
	log.Printf("  Bridge token: %v", cfg.BridgeToken != "")
	if memoryStore != nil {
		log.Printf("  Memory store: %s", memoryStore.GetDatabasePath())
	}

	go func() {
		sigChan := make(chan os.Signal, 1)
		signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
		<-sigChan
		log.Println("Shutting down...")
		os.Exit(0)
	}()

	if err := http.ListenAndServe(addr, r); err != nil {
		log.Fatal(err)
	}
}

func llmRelayHandler(w http.ResponseWriter, r *http.Request) {
	var req llm.RelayRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid JSON body"}`, http.StatusBadRequest)
		return
	}

	result := llm.RelayLLM(req)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(result.Status)
	w.Write([]byte(result.Body))
}

func llmStreamHandler(w http.ResponseWriter, r *http.Request) {
	var req llm.RelayRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid JSON body"}`, http.StatusBadRequest)
		return
	}

	llm.RelayLLMStream(w, req)
}
