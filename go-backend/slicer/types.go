package slicer

import "time"

type SlicerId string

const (
	PrusaSlicer SlicerId = "prusaslicer"
	OrcaSlicer  SlicerId = "orcaslicer"
	BambuStudio SlicerId = "bambustudio"
)

var DefaultTimeout = 180 * time.Second
var MaxTimeout = 300 * time.Second

type SlicerProfile struct {
	ID             SlicerId  `json:"id"`
	Binary         string    `json:"binary"`
	PrinterPreset  string    `json:"printerPreset,omitempty"`
	MaterialPreset string    `json:"materialPreset,omitempty"`
	LayerHeightMm  float64   `json:"layerHeightMm,omitempty"`
	ExtraArgs      []string  `json:"extraArgs,omitempty"`
}

type SlicerRequest struct {
	STLBytes      []byte
	FileName      string
	Profile       SlicerProfile
	AutoDropToBed bool
	TimeoutMs     int
}

type SlicerLayerInfo struct {
	LayerNumber int     `json:"layerNumber"`
	ZMm         float64 `json:"zMm"`
	HeightMm    float64 `json:"heightMm"`
	TimeSeconds float64 `json:"timeSeconds,omitempty"`
}

type SlicerMetadata struct {
	PrintTimeMinutes float64 `json:"printTimeMinutes"`
	FilamentGrams    float64 `json:"filamentGrams"`
	LayerCount       int     `json:"layerCount"`
	LayerHeightMm    float64 `json:"layerHeightMm"`
}

type SlicerResult struct {
	GCode    string            `json:"gcode"`
	FileName string            `json:"fileName"`
	Metadata SlicerMetadata    `json:"metadata"`
	Layers   []SlicerLayerInfo `json:"layers"`
	Warnings []string          `json:"warnings"`
}

type SlicerAdapter struct {
	ID      SlicerId
	Binary  string
	profile SlicerProfile
}

type SliceBody struct {
	STLBase64      string `json:"stlBase64"`
	FileName       string `json:"fileName,omitempty"`
	Slicer         string `json:"slicer,omitempty"`
	PrinterPreset  string `json:"printerPreset,omitempty"`
	MaterialPreset string `json:"materialPreset,omitempty"`
	LayerHeightMm  float64 `json:"layerHeightMm,omitempty"`
	AutoDropToBed  bool   `json:"autoDropToBed,omitempty"`
	TimeoutMs      int    `json:"timeoutMs,omitempty"`
	LargeFormat    bool   `json:"largeFormat,omitempty"`
}

type SliceResponse struct {
	OK       bool          `json:"ok"`
	Result   *SlicerResult `json:"result,omitempty"`
	Error    *SliceError   `json:"error,omitempty"`
}

type SliceError struct {
	Code   string `json:"code"`
	Detail string `json:"detail"`
}
