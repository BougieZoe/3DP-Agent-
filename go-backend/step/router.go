package step

import (
	"encoding/base64"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
)

type StepRouter struct {
	pythonPath string
	cadDir     string
}

func NewStepRouter(pythonPath, cadDir string) *StepRouter {
	return &StepRouter{pythonPath: pythonPath, cadDir: cadDir}
}

func (r *StepRouter) Routes() chi.Router {
	router := chi.NewRouter()
	router.Get("/health", r.healthHandler)
	router.Post("/", r.parseHandler)
	return router
}

func (r *StepRouter) healthHandler(w http.ResponseWriter, req *http.Request) {
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"ok":        true,
		"available": true,
	})
}

func (r *StepRouter) parseHandler(w http.ResponseWriter, req *http.Request) {
	var body struct {
		STEPBase64        string  `json:"stepBase64"`
		FileName          string  `json:"fileName,omitempty"`
		LinearDeflection  float64 `json:"linearDeflection,omitempty"`
		AngularDeflection float64 `json:"angularDeflection,omitempty"`
	}
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

	if body.STEPBase64 == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"ok": false,
			"error": map[string]string{
				"code":   "invalid-input",
				"detail": "stepBase64 is required",
			},
		})
		return
	}

	// Decode base64 STEP
	stepBytes, err := base64.StdEncoding.DecodeString(body.STEPBase64)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"ok": false,
			"error": map[string]string{
				"code":   "invalid-input",
				"detail": "Invalid base64 STEP data",
			},
		})
		return
	}

	// Validate STEP file
	if !isValidStepFile(stepBytes) {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"ok": false,
			"error": map[string]string{
				"code":   "invalid-step",
				"detail": "Not a valid STEP file",
			},
		})
		return
	}

	// Extract header info
	header := extractStepHeaderInfo(stepBytes)

	// Parse STEP file
	result, err := parseStepFile(r.pythonPath, r.cadDir, stepBytes, body.LinearDeflection, body.AngularDeflection)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"ok": false,
			"error": map[string]string{
				"code":   "parse-failed",
				"detail": err.Error(),
			},
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"ok": true,
		"result": map[string]interface{}{
			"model":          result.Model,
			"solidCount":     result.SolidCount,
			"faceCount":      result.FaceCount,
			"boundingBox":    result.BoundingBox,
			"volumeMm3":      result.VolumeMm3,
			"surfaceAreaMm2": result.SurfaceAreaMm2,
			"warnings":       result.Warnings,
			"header":         header,
			"fileName":       body.FileName,
		},
	})
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}
