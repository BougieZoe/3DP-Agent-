package models

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
)

type ModelRouter struct {
	registry *ModelRegistry
}

func NewModelRouter(registry *ModelRegistry) *ModelRouter {
	return &ModelRouter{registry: registry}
}

func (r *ModelRouter) Routes() chi.Router {
	router := chi.NewRouter()
	router.Get("/", r.listModels)
	router.Get("/providers", r.listProviders)
	router.Post("/refresh", r.refreshModels)
	return router
}

// GET /api/models — returns all discovered models
func (r *ModelRouter) listModels(w http.ResponseWriter, req *http.Request) {
	provider := req.URL.Query().Get("provider")

	var models []ModelInfo
	if provider != "" {
		models = r.registry.GetModelsByProvider(provider)
	} else {
		models = r.registry.GetModels()
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"ok":        true,
		"models":    models,
		"count":     len(models),
		"cached":    !r.registry.IsStale(),
		"updatedAt": r.registry.lastRefresh.Format(time.RFC3339),
	})
}

// GET /api/models/providers — returns provider metadata
func (r *ModelRouter) listProviders(w http.ResponseWriter, req *http.Request) {
	providers := r.registry.GetProviderMeta()

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"ok":        true,
		"providers": providers,
		"count":     len(providers),
	})
}

// POST /api/models/refresh — force refresh model cache
func (r *ModelRouter) refreshModels(w http.ResponseWriter, req *http.Request) {
	// TODO: Get API keys from request context or config
	// For now, refresh with empty keys (hardcoded only)
	err := r.registry.Refresh(nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"ok":    false,
			"error": err.Error(),
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"ok":    true,
		"count": len(r.registry.GetModels()),
	})
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}
