package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/BougieZoe/3dp-agent-go/auth"
	"github.com/BougieZoe/3dp-agent-go/cad"
	"github.com/BougieZoe/3dp-agent-go/config"
	"github.com/BougieZoe/3dp-agent-go/health"
	"github.com/BougieZoe/3dp-agent-go/llm"
	"github.com/BougieZoe/3dp-agent-go/mesh"
	"github.com/BougieZoe/3dp-agent-go/ratelimit"
	"github.com/BougieZoe/3dp-agent-go/slicer"
	"github.com/BougieZoe/3dp-agent-go/step"
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

	slicerRouter := slicer.NewSlicerRouter(cfg.SlicerPaths)
	meshRouter := mesh.NewMeshRouter(cfg.PythonPath, cfg.CadBridgeDir)
	stepRouter := step.NewStepRouter(cfg.PythonPath, cfg.CadBridgeDir)
	cadRouter := cad.NewCadRouter(cfg.PythonPath, cfg.CadBridgeDir)
	healthRouter := health.NewHealthRouter(cfg.PythonPath, cfg.SlicerPaths)

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

		r.Post("/llm", llmRelayHandler)
		r.Post("/llm/stream", llmStreamHandler)
	})

	addr := fmt.Sprintf(":%d", cfg.Port)
	log.Printf("3DP Agent Go backend starting on %s", addr)
	log.Printf("  Environment: %s", cfg.NodeEnv)
	log.Printf("  Bridge token: %v", cfg.BridgeToken != "")

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
