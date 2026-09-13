package health

import (
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"runtime"

	"github.com/go-chi/chi/v5"
)

type HealthRouter struct {
	pythonPath string
	extraPaths string
}

func NewHealthRouter(pythonPath, extraPaths string) *HealthRouter {
	return &HealthRouter{pythonPath: pythonPath, extraPaths: extraPaths}
}

func (r *HealthRouter) Routes() chi.Router {
	router := chi.NewRouter()
	router.Get("/", r.basicHandler)
	router.Get("/detailed", r.detailedHandler)
	router.Get("/ready", r.readyHandler)
	router.Get("/live", r.liveHandler)
	return router
}

func (r *HealthRouter) basicHandler(w http.ResponseWriter, req *http.Request) {
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"ok": true,
	})
}

func (r *HealthRouter) detailedHandler(w http.ResponseWriter, req *http.Request) {
	var memStats runtime.MemStats
	runtime.ReadMemStats(&memStats)

	// Check slicer
	slicerOK := false
	if _, err := exec.LookPath("prusaslicer"); err == nil {
		slicerOK = true
	}

	// Check STEP parser
	stepOK := false
	if _, err := os.Stat(".cad-bridge"); err == nil {
		stepOK = true
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"ok": true,
		"memory": map[string]interface{}{
			"alloc":      memStats.Alloc,
			"totalAlloc": memStats.TotalAlloc,
			"sys":        memStats.Sys,
			"numGC":      memStats.NumGC,
		},
		"slicer": slicerOK,
		"stepParser": stepOK,
	})
}

func (r *HealthRouter) readyHandler(w http.ResponseWriter, req *http.Request) {
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"ok": true,
	})
}

func (r *HealthRouter) liveHandler(w http.ResponseWriter, req *http.Request) {
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"ok": true,
	})
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}
