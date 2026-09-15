package mesh

import (
	"encoding/base64"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
)

type MeshRouter struct {
	pythonPath string
	cadDir     string
}

func NewMeshRouter(pythonPath, cadDir string) *MeshRouter {
	return &MeshRouter{pythonPath: pythonPath, cadDir: cadDir}
}

func (r *MeshRouter) Routes() chi.Router {
	router := chi.NewRouter()
	router.Post("/process", r.processHandler)
	return router
}

func (r *MeshRouter) processHandler(w http.ResponseWriter, req *http.Request) {
	var body struct {
		STLBase64   string `json:"stlBase64"`
		DecimateTo  int    `json:"decimateTo,omitempty"`
	}
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"ok": false,
			"error": map[string]string{
				"code":   "invalid-artifact",
				"detail": "Invalid JSON body",
			},
		})
		return
	}

	if body.STLBase64 == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"ok": false,
			"error": map[string]string{
				"code":   "invalid-artifact",
				"detail": "stlBase64 is required",
			},
		})
		return
	}

	// Decode base64 STL
	stlBytes, err := base64.StdEncoding.DecodeString(body.STLBase64)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"ok": false,
			"error": map[string]string{
				"code":   "invalid-artifact",
				"detail": "Invalid base64 STL data",
			},
		})
		return
	}

	// Clamp decimateTo
	decimateTo := body.DecimateTo
	if decimateTo < 0 {
		decimateTo = 0
	}
	if decimateTo > 2000000 {
		decimateTo = 2000000
	}

	// Run mesh process
	diagnostics, processedSTL, err := runMeshProcess(r.pythonPath, r.cadDir, stlBytes, decimateTo)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"ok": false,
			"error": map[string]string{
				"code":   "generation-failed",
				"detail": err.Error(),
			},
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"ok":                true,
		"processedStlBase64": base64.StdEncoding.EncodeToString(processedSTL),
		"diagnostics":        diagnostics,
	})
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}
