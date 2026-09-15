package cad

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"

	"github.com/go-chi/chi/v5"
)

type CadRouter struct {
	pythonPath   string
	cadBridgeDir string
	stepCLIDir   string
}

func NewCadRouter(pythonPath, cadBridgeDir string) *CadRouter {
	stepCLI := "/Users/bougiezoe/.agents/skills/cad/scripts/step"
	return &CadRouter{
		pythonPath:   pythonPath,
		cadBridgeDir: cadBridgeDir,
		stepCLIDir:   stepCLI,
	}
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
	_, ready, reason := r.checkReady()
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"ok":       true,
		"ready":    ready,
		"reason":   reason,
		"python":   python,
		"skillDir": r.stepCLIDir,
	})
}

func (r *CadRouter) checkReady() (string, bool, string) {
	python := r.pythonPath
	if python == "" {
		python = "python3"
	}
	if _, err := os.Stat(r.stepCLIDir); os.IsNotExist(err) {
		return python, false, fmt.Sprintf("CAD skill not found at %s", r.stepCLIDir)
	}
	return python, true, ""
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
	stepPath := filepath.Join(r.cadBridgeDir, "runs", id, "model.step")

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
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.step"`, id))
	http.ServeFile(w, req, stepPath)
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max]
}

func joinArgs(args []string) string {
	result := ""
	for i, a := range args {
		if i > 0 {
			result += " "
		}
		result += a
	}
	return result
}

func encodeBase64(data []byte) string {
	return base64.StdEncoding.EncodeToString(data)
}
