package main

import (
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
	// Load config
	cfg := config.Load()

	// Load LLM keys
	llm.SetKeysFilePath(cfg.CadBridgeDir + "/config/llm-keys.yaml")
	if err := llm.LoadKeys(); err != nil {
		log.Printf("Warning: failed to load LLM keys: %v", err)
	}
	llm.StartWatching()
	defer llm.StopWatching()

	// Create rate limiter (30 requests per 60 seconds per IP)
	rl := ratelimit.New(30, 60*1e9) // 60 seconds in nanoseconds

	// Create bridge auth
	ba := auth.NewBridgeAuth(cfg.BridgeToken, cfg.IsProduction())

	// Create routers
	slicerRouter := slicer.NewSlicerRouter(cfg.SlicerPaths)
	meshRouter := mesh.NewMeshRouter(cfg.PythonPath, cfg.CadBridgeDir)
	stepRouter := step.NewStepRouter(cfg.PythonPath, cfg.CadBridgeDir)
	cadRouter := cad.NewCadRouter(cfg.PythonPath, cfg.CadBridgeDir)
	healthRouter := health.NewHealthRouter(cfg.PythonPath, cfg.SlicerPaths)

	// Build main router
	r := chi.NewRouter()

	// Global middleware
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.RealIP)
	r.Use(rl.Middleware)

	// Health routes (no auth required)
	r.Route("/health", func(r chi.Router) {
		r.Mount("/", healthRouter.Routes())
	})

	// Bridge routes (auth required in production)
	r.Route("/api", func(r chi.Router) {
		r.Use(ba.Middleware)

		// Slicer
		r.Route("/slice", func(r chi.Router) {
			r.Mount("/", slicerRouter.Routes())
		})

		// Mesh processing
		r.Route("/mesh", func(r chi.Router) {
			r.Mount("/process", meshRouter.Routes())
		})

		// STEP parser
		r.Route("/step", func(r chi.Router) {
			r.Mount("/", stepRouter.Routes())
		})

		// CAD bridge
		r.Route("/cad", func(r chi.Router) {
			r.Mount("/generate", cadRouter.Routes())
		})

		// LLM relay
		r.Post("/llm", llmRelayHandler)
		r.Post("/llm/stream", llmStreamHandler)
	})

	// Start server
	addr := fmt.Sprintf(":%d", cfg.Port)
	log.Printf("3DP Agent Go backend starting on %s", addr)
	log.Printf("  Environment: %s", cfg.NodeEnv)
	log.Printf("  Bridge token: %v", cfg.BridgeToken != "")

	// Graceful shutdown
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
	// TODO: Implement LLM relay
	http.Error(w, "Not implemented", http.StatusNotImplemented)
}

func llmStreamHandler(w http.ResponseWriter, r *http.Request) {
	// TODO: Implement LLM stream
	http.Error(w, "Not implemented", http.StatusNotImplemented)
}
