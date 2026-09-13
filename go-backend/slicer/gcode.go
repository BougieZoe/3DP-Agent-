package slicer

import (
	"math"
	"regexp"
	"strconv"
	"strings"
)

var (
	rePrintTime  = regexp.MustCompile(`; estimated printing time \(normal mode\) = (\d+)h (\d+)m (\d+)s`)
	reFilamentG  = regexp.MustCompile(`; filament used \[g\] = ([\d.]+)`)
	reFilamentCm = regexp.MustCompile(`; filament used \[cm3\] = ([\d.]+)`)
	reTotalLayers = regexp.MustCompile(`; total layers count = (\d+)`)
	reLayerHeight = regexp.MustCompile(`; layer_height = ([\d.]+)`)
	reLayerChange = regexp.MustCompile(`;LAYER_CHANGE`)
	reZValue      = regexp.MustCompile(`;Z:([[\d.]+)`)
	reLayerN      = regexp.MustCompile(`;LAYER:(\d+)`)

	plaDensity = 1.24 // g/cm³
)

func parseGCodeMetadata(gcode string) SlicerMetadata {
	meta := SlicerMetadata{}

	// Print time
	if m := rePrintTime.FindStringSubmatch(gcode); len(m) == 4 {
		h, _ := strconv.ParseFloat(m[1], 64)
		min, _ := strconv.ParseFloat(m[2], 64)
		s, _ := strconv.ParseFloat(m[3], 64)
		meta.PrintTimeMinutes = h*60 + min + s/60
	}

	// Filament grams
	if m := reFilamentG.FindStringSubmatch(gcode); len(m) == 2 {
		if v, err := strconv.ParseFloat(m[1], 64); err == nil {
			meta.FilamentGrams = v
		}
	} else if m := reFilamentCm.FindStringSubmatch(gcode); len(m) == 2 {
		if v, err := strconv.ParseFloat(m[1], 64); err == nil {
			meta.FilamentGrams = math.Round(v*plaDensity*100) / 100
		}
	}

	// Layer count
	if m := reTotalLayers.FindStringSubmatch(gcode); len(m) == 2 {
		if v, err := strconv.Atoi(m[1]); err == nil {
			meta.LayerCount = v
		}
	}

	// Layer height
	if m := reLayerHeight.FindStringSubmatch(gcode); len(m) == 2 {
		if v, err := strconv.ParseFloat(m[1], 64); err == nil {
			meta.LayerHeightMm = v
		}
	}

	return meta
}

func parseLayers(gcode string) []SlicerLayerInfo {
	lines := strings.Split(gcode, "\n")
	var layers []SlicerLayerInfo
	var currentZ float64
	var currentLayer int
	inLayerChange := false

	for _, line := range lines {
		line = strings.TrimSpace(line)

		if reLayerChange.MatchString(line) {
			inLayerChange = true
			continue
		}

		if inLayerChange {
			if m := reZValue.FindStringSubmatch(line); len(m) == 2 {
				if v, err := strconv.ParseFloat(m[1], 64); err == nil {
					currentZ = v
				}
				continue
			}
			// End of layer change block (next non-Z line or next LAYER_CHANGE)
			if !strings.HasPrefix(line, ";Z:") && line != "" && !strings.HasPrefix(line, ";") {
				inLayerChange = false
			}
		}

		if m := reLayerN.FindStringSubmatch(line); len(m) == 2 {
			if v, err := strconv.Atoi(m[1]); err == nil {
				if len(layers) > 0 {
					prev := &layers[len(layers)-1]
					prev.HeightMm = currentZ - prev.ZMm
				}
				currentLayer = v
				layers = append(layers, SlicerLayerInfo{
					LayerNumber: currentLayer,
					ZMm:         currentZ,
					HeightMm:    0,
				})
			}
		}
	}

	// Set last layer height
	if len(layers) > 1 {
		last := &layers[len(layers)-1]
		if last.HeightMm == 0 && len(layers) > 1 {
			last.HeightMm = currentZ - layers[len(layers)-2].ZMm
		}
	}

	return layers
}

func medianLayerStepMm(layers []SlicerLayerInfo) float64 {
	if len(layers) < 2 {
		return 0
	}
	var steps []float64
	for i := 1; i < len(layers); i++ {
		step := layers[i].ZMm - layers[i-1].ZMm
		if step > 0 {
			steps = append(steps, step)
		}
	}
	if len(steps) == 0 {
		return 0
	}
	// Simple median
	for i := 0; i < len(steps)-1; i++ {
		for j := i + 1; j < len(steps); j++ {
			if steps[j] < steps[i] {
				steps[i], steps[j] = steps[j], steps[i]
			}
		}
	}
	mid := len(steps) / 2
	if len(steps)%2 == 0 {
		return (steps[mid-1] + steps[mid]) / 2
	}
	return steps[mid]
}
