package cad

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"

	"github.com/go-chi/chi/v5"
)

type CadRouter struct {
	pythonPath string
	cadDir     string
}

func NewCadRouter(pythonPath, cadDir string) *CadRouter {
	return &CadRouter{pythonPath: pythonPath, cadDir: cadDir}
}

func (r *CadRouter) Routes() chi.Router {
	router := chi.NewRouter()
	router.Get("/health", r.healthHandler)
	router.Post("/generate", r.generateHandler)
	router.Post("/edit", r.editHandler)
	router.Get("/{id}/step", r.stepHandler)
	return router
}

func (r *CadRouter) healthHandler(w http.ResponseWriter, req *http.Request) {
	python := r.pythonPath
	if python == "" {
		python = "python3"
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"ok":      true,
		"ready":   true,
		"python":  python,
		"skillDir": filepath.Join(r.cadDir, "..", "scripts", "step"),
	})
}

func (r *CadRouter) generateHandler(w http.ResponseWriter, req *http.Request) {
	var body BridgeGenerateBody
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"ok": false,
			"error": map[string]string{
				"code":   "invalid-input",
				"detail": "Invalid JSON body",
			},
		})
		return
	}

	if body.Prompt == "" && body.GeneratorSource == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"ok": false,
			"error": map[string]string{
				"code":   "invalid-input",
				"detail": "prompt or generatorSource is required",
			},
		})
		return
	}

	// TODO: Implement CAD generation
	// This requires:
	// 1. LLM call to generate build123d Python source
	// 2. Safety scan on the source
	// 3. Execute build123d in sandboxed Python
	// 4. Return STL + STEP

	writeJSON(w, http.StatusNotImplemented, map[string]interface{}{
		"ok": false,
		"error": map[string]string{
			"code":   "not-implemented",
			"detail": "CAD generation not yet implemented in Go backend",
		},
	})
}

func (r *CadRouter) editHandler(w http.ResponseWriter, req *http.Request) {
	writeJSON(w, http.StatusNotImplemented, map[string]interface{}{
		"ok": false,
		"error": map[string]string{
			"code":   "not-implemented",
			"detail": "CAD edit not yet implemented in Go backend",
		},
	})
}

func (r *CadRouter) stepHandler(w http.ResponseWriter, req *http.Request) {
	id := chi.URLParam(req, "id")
	stepPath := filepath.Join(r.cadDir, "runs", id, "model.step")

	if _, err := os.Stat(stepPath); os.IsNotExist(err) {
		writeJSON(w, http.StatusNotFound, map[string]interface{}{
			"ok": false,
			"error": map[string]string{
				"code":   "not-found",
				"detail": "STEP file not found for this ID",
			},
		})
		return
	}

	w.Header().Set("Content-Type", "application/step")
	http.ServeFile(w, req, stepPath)
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}
