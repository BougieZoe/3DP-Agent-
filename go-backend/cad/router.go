package cad

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
)

type CadRouter struct {
	pythonPath   string
	cadBridgeDir string
	stepCLIDir   string
	khanaPath    string
}

func NewCadRouter(pythonPath, cadBridgeDir string) *CadRouter {
	stepCLI := findStepCLI()
	khana := findKhana()
	return &CadRouter{
		pythonPath:   pythonPath,
		cadBridgeDir: cadBridgeDir,
		stepCLIDir:   stepCLI,
		khanaPath:    khana,
	}
}

func findStepCLI() string {
	// Check common locations
	paths := []string{
		"/Users/bougiezoe/.agents/skills/cad/scripts/step",
		filepath.Join(os.Getenv("HOME"), ".agents/skills/cad/scripts/step"),
		"/usr/local/bin/step",
	}
	for _, p := range paths {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

func (r *CadRouter) Routes() chi.Router {
	router := chi.NewRouter()
	router.Route("/generate", func(gr chi.Router) {
		gr.Get("/health", r.healthHandler)
		gr.Post("/", r.generateHandler)
		gr.Post("/edit", r.editHandler)
		gr.Get("/{id}/step", r.stepHandler)
	})
	router.Post("/khana/generate", r.khanaGenerateHandler)
	router.Post("/khana/check", r.khanaCheckHandler)
	router.Post("/khana/export", r.khanaExportHandler)
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
		"khana": map[string]interface{}{
			"available": r.khanaPath != "",
			"path":      r.khanaPath,
		},
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
	r.editHandlerImpl(w, req)
}

func generateEditPrompt(originalSource string, editInstructions string, originalPrompt string) string {
	var lines []string
	lines = append(lines, "You are modifying an existing build123d CAD model.")
	lines = append(lines, "")
	if originalPrompt != "" {
		lines = append(lines, "Original design intent: "+originalPrompt)
		lines = append(lines, "")
	}
	lines = append(lines, "Current source code:")
	lines = append(lines, "```python")
	lines = append(lines, originalSource)
	lines = append(lines, "```")
	lines = append(lines, "")
	lines = append(lines, "Edit instructions: "+editInstructions)
	lines = append(lines, "")
	lines = append(lines, "Rules:")
	lines = append(lines, "- Output ONLY the modified Python code. No explanations.")
	lines = append(lines, "- Keep the gen_step() function structure.")
	lines = append(lines, "- Preserve the original design intent unless the edit explicitly changes it.")
	lines = append(lines, "- Do NOT use BuildPart, BuildLine, BuildSketch, or context managers.")
	lines = append(lines, "- Do NOT use fillet/chamfer on shapes with holes.")
	return strings.Join(lines, "\n")
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
