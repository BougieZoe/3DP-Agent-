package memory

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
)

type MemoryRouter struct {
	store *MemoryStore
}

func NewMemoryRouter(store *MemoryStore) *MemoryRouter {
	return &MemoryRouter{store: store}
}

func (r *MemoryRouter) Routes() chi.Router {
	router := chi.NewRouter()
	router.Get("/metrics", r.metricsHandler)
	router.Get("/generations", r.listGenerationsHandler)
	router.Get("/generations/{id}", r.getGenerationHandler)
	router.Delete("/generations/{id}", r.deleteGenerationHandler)
	router.Post("/cleanup", r.cleanupHandler)
	return router
}

func (r *MemoryRouter) metricsHandler(w http.ResponseWriter, req *http.Request) {
	metrics, err := r.store.GetMetrics()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"ok":    false,
			"error": "failed to get metrics",
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"ok":     true,
		"metrics": metrics,
	})
}

func (r *MemoryRouter) listGenerationsHandler(w http.ResponseWriter, req *http.Request) {
	limit := 20
	offset := 0

	if l := req.URL.Query().Get("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil && v > 0 && v <= 100 {
			limit = v
		}
	}
	if o := req.URL.Query().Get("offset"); o != "" {
		if v, err := strconv.Atoi(o); err == nil && v >= 0 {
			offset = v
		}
	}

	generations, err := r.store.ListGenerations(limit, offset)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"ok":    false,
			"error": "failed to list generations",
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"ok":          true,
		"generations": generations,
		"limit":       limit,
		"offset":      offset,
	})
}

func (r *MemoryRouter) getGenerationHandler(w http.ResponseWriter, req *http.Request) {
	id := chi.URLParam(req, "id")
	generation, err := r.store.GetGeneration(id)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]interface{}{
			"ok":    false,
			"error": "generation not found",
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"ok":         true,
		"generation": generation,
	})
}

func (r *MemoryRouter) deleteGenerationHandler(w http.ResponseWriter, req *http.Request) {
	id := chi.URLParam(req, "id")
	if err := r.store.DeleteGeneration(id); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"ok":    false,
			"error": "failed to delete generation",
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"ok": true,
	})
}

func (r *MemoryRouter) cleanupHandler(w http.ResponseWriter, req *http.Request) {
	var body struct {
		Days int `json:"days"`
	}
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil || body.Days <= 0 {
		body.Days = 30
	}

	deleted, err := r.store.CleanupOldRecords(body.Days)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"ok":    false,
			"error": "cleanup failed",
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"ok":      true,
		"deleted": deleted,
	})
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}
