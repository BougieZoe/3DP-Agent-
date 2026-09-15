package thermal

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
)

type ThermalRouter struct {
	model *ThermalModel
}

func NewThermalRouter() *ThermalRouter {
	return &ThermalRouter{
		model: NewThermalModel(),
	}
}

func (r *ThermalRouter) Routes() chi.Router {
	router := chi.NewRouter()
	router.Get("/materials", r.materialsHandler)
	router.Post("/calculate", r.calculateHandler)
	router.Post("/check-risks", r.checkRisksHandler)
	return router
}

func (r *ThermalRouter) materialsHandler(w http.ResponseWriter, req *http.Request) {
	materials := make(map[string]interface{})
	for name, mat := range Materials {
		materials[name] = mat
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"ok":        true,
		"materials": materials,
	})
}

func (r *ThermalRouter) calculateHandler(w http.ResponseWriter, req *http.Request) {
	var body struct {
		MaterialName   string    `json:"materialName"`
		Params         PrintParams `json:"params"`
		BboxMin        [3]float64  `json:"bboxMin"`
		BboxMax        [3]float64  `json:"bboxMax"`
		ResolutionMm   float64     `json:"resolutionMm"`
	}

	if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"ok":    false,
			"error": "invalid JSON body",
		})
		return
	}

	material, ok := Materials[body.MaterialName]
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"ok":    false,
			"error": "unknown material: " + body.MaterialName,
		})
		return
	}

	if body.ResolutionMm <= 0 {
		body.ResolutionMm = 2.0
	}

	result := r.model.CalculateThermalDistribution(
		material,
		&body.Params,
		body.BboxMin,
		body.BboxMax,
		body.ResolutionMm,
	)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"ok":     true,
		"result": result,
	})
}

func (r *ThermalRouter) checkRisksHandler(w http.ResponseWriter, req *http.Request) {
	var body struct {
		Result ThermalResult `json:"result"`
	}

	if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"ok":    false,
			"error": "invalid JSON body",
		})
		return
	}

	risks := r.model.CheckThermalRisks(&body.Result)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"ok":    true,
		"risks": risks,
	})
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}
