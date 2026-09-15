package slicer

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
)

type SlicerRouter struct {
	extraPaths string
}

func NewSlicerRouter(extraPaths string) *SlicerRouter {
	return &SlicerRouter{extraPaths: extraPaths}
}

func (r *SlicerRouter) Routes() chi.Router {
	router := chi.NewRouter()
	router.Get("/health", r.healthHandler)
	router.Get("/profiles", r.profilesHandler)
	router.Post("/", r.sliceHandler)
	return router
}

func (r *SlicerRouter) healthHandler(w http.ResponseWriter, req *http.Request) {
	slicers := map[string]interface{}{
		"prusaslicer": nil,
		"orcaslicer":  nil,
		"bambustudio": nil,
	}

	for _, id := range []SlicerId{PrusaSlicer, OrcaSlicer, BambuStudio} {
		if path, ok := discoverSlicer(id, r.extraPaths); ok {
			slicers[string(id)] = path
		}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"ok":      true,
		"slicers": slicers,
	})
}

func (r *SlicerRouter) profilesHandler(w http.ResponseWriter, req *http.Request) {
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"ok":                 true,
		"profiles":           INDUSTRIAL_PROFILES,
		"largeFormatProfiles": LARGE_FORMAT_PROFILES,
	})
}

func (r *SlicerRouter) sliceHandler(w http.ResponseWriter, req *http.Request) {
	var body SliceBody
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, SliceResponse{
			OK: false,
			Error: &SliceError{
				Code:   "invalid-input",
				Detail: "Invalid JSON body",
			},
		})
		return
	}

	if body.STLBase64 == "" {
		writeJSON(w, http.StatusBadRequest, SliceResponse{
			OK: false,
			Error: &SliceError{
				Code:   "invalid-input",
				Detail: "stlBase64 is required",
			},
		})
		return
	}

	// Decode base64 STL
	stlBytes, err := base64.StdEncoding.DecodeString(body.STLBase64)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, SliceResponse{
			OK: false,
			Error: &SliceError{
				Code:   "invalid-input",
				Detail: "Invalid base64 STL data",
			},
		})
		return
	}

	// Determine slicer ID
	slicerID := SlicerId(body.Slicer)
	if slicerID == "" {
		slicerID = PrusaSlicer
	}

	// Find slicer binary
	binary, ok := discoverSlicer(slicerID, r.extraPaths)
	if !ok {
		writeJSON(w, http.StatusNotFound, SliceResponse{
			OK: false,
			Error: &SliceError{
				Code:   "slicer-not-found",
				Detail: fmt.Sprintf("Slicer '%s' not found", slicerID),
			},
		})
		return
	}

	// Create profile
	profile := SlicerProfile{
		ID:             slicerID,
		Binary:         binary,
		PrinterPreset:  body.PrinterPreset,
		MaterialPreset: body.MaterialPreset,
		LayerHeightMm:  body.LayerHeightMm,
	}

	// Create adapter
	adapter := CreateSlicerAdapter(profile)

	// Build request
	timeout := body.TimeoutMs
	if timeout == 0 {
		timeout = 180000
	}

	slicerReq := SlicerRequest{
		STLBytes:      stlBytes,
		FileName:      body.FileName,
		Profile:       profile,
		AutoDropToBed: body.AutoDropToBed,
		TimeoutMs:     timeout,
	}

	// Execute slice
	ctx, cancel := context.WithTimeout(req.Context(), time.Duration(timeout)*time.Millisecond)
	defer cancel()

	result, err := adapter.Slice(ctx, slicerReq)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, SliceResponse{
			OK: false,
			Error: &SliceError{
				Code:   "slice-failed",
				Detail: err.Error(),
			},
		})
		return
	}

	writeJSON(w, http.StatusOK, SliceResponse{
		OK:     true,
		Result: result,
	})
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

// Printer profiles
var INDUSTRIAL_PROFILES = map[string]interface{}{
	"formlabs-form-3": map[string]interface{}{
		"name":      "Formlabs Form 3",
		"type":      "sla",
		"buildArea": "145 × 145 × 185 mm",
	},
	"eos-m290": map[string]interface{}{
		"name":      "EOS M 290",
		"type":      "sls",
		"buildArea": "250 × 250 × 325 mm",
	},
	"desktop-metal-dm60": map[string]interface{}{
		"name":      "Desktop Metal Studio System",
		"type":      "bound-metal",
		"buildArea": "300 × 200 × 180 mm",
	},
	"hpmjf-5200": map[string]interface{}{
		"name":      "HP Multi Jet Fusion 5200",
		"type":      "mjf",
		"buildArea": "380 × 284 × 380 mm",
	},
	"markforged-mx7": map[string]interface{}{
		"name":      "Markforged MX7",
		"type":      "fff/composite",
		"buildArea": "300 × 220 × 200 mm",
	},
	"ultimaker-s7": map[string]interface{}{
		"name":      "Ultimaker S7",
		"type":      "fff",
		"buildArea": "330 × 240 × 300 mm",
	},
	"raise3d-pro3-plus": map[string]interface{}{
		"name":      "Raise3D Pro3 Plus",
		"type":      "fff",
		"buildArea": "300 × 300 × 605 mm",
	},
}

var LARGE_FORMAT_PROFILES = map[string]interface{}{
	"bambu-lab-h2d": map[string]interface{}{
		"name":      "Bambu Lab H2D",
		"widthMm":   350,
		"depthMm":   350,
		"heightMm":  350,
	},
	"bambu-lab-x1c": map[string]interface{}{
		"name":      "Bambu Lab X1C",
		"widthMm":   256,
		"depthMm":   256,
		"heightMm":  256,
	},
	"bambu-lab-p1s": map[string]interface{}{
		"name":      "Bambu Lab P1S",
		"widthMm":   256,
		"depthMm":   256,
		"heightMm":  256,
	},
	"bambu-lab-a1": map[string]interface{}{
		"name":      "Bambu Lab A1",
		"widthMm":   256,
		"depthMm":   256,
		"heightMm":  256,
	},
	"bambu-lab-a1-mini": map[string]interface{}{
		"name":      "Bambu Lab A1 Mini",
		"widthMm":   180,
		"depthMm":   180,
		"heightMm":  180,
	},
}
