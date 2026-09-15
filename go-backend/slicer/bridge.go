package slicer

import (
	"context"
	"encoding/binary"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// dropStlToBed translates binary STL vertices so minZ = 0
func dropStlToBed(stlBytes []byte) []byte {
	if len(stlBytes) < 84 {
		return stlBytes
	}

	result := make([]byte, len(stlBytes))
	copy(result, stlBytes)

	triangleCount := binary.LittleEndian.Uint32(result[80:84])
	if triangleCount == 0 || len(result) < 84+int(triangleCount)*50 {
		return stlBytes
	}

	// Find min Z
	minZ := float32(math.MaxFloat32)
	for i := uint32(0); i < triangleCount; i++ {
		offset := 84 + i*50 + 12 // skip normal (12 bytes)
		for v := uint32(0); v < 3; v++ {
			z := math.Float32frombits(binary.LittleEndian.Uint32(result[offset+v*12+8 : offset+v*12+12]))
			if z < minZ {
				minZ = z
			}
		}
	}

	// Translate all Z coordinates
	if minZ != 0 {
		for i := uint32(0); i < triangleCount; i++ {
			offset := 84 + i*50 + 12
			for v := uint32(0); v < 3; v++ {
				zOffset := offset + v*12 + 8
				z := math.Float32frombits(binary.LittleEndian.Uint32(result[zOffset : zOffset+4]))
				z -= minZ
				binary.LittleEndian.PutUint32(result[zOffset:zOffset+4], math.Float32bits(z))
			}
		}
	}

	return result
}

// Well-known slicer binary paths
var wellKnownPaths = map[SlicerId][]string{
	PrusaSlicer: {
		"/Applications/PrusaSlicer.app/Contents/MacOS/PrusaSlicer",
		"/usr/bin/prusaslicer",
		"/usr/local/bin/prusaslicer",
	},
	OrcaSlicer: {
		"/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer",
		"/usr/bin/orcaslicer",
		"/usr/local/bin/orcaslicer",
	},
	BambuStudio: {
		"/Applications/BambuStudio.app/Contents/MacOS/BambuStudio",
		"/usr/bin/bambustudio",
		"/usr/local/bin/bambustudio",
	},
}

// discoverSlicer finds a working slicer binary
func discoverSlicer(id SlicerId, extraPaths string) (string, bool) {
	// Check extra paths first
	if extraPaths != "" {
		for _, p := range strings.Split(extraPaths, ":") {
			p = strings.TrimSpace(p)
			if p == "" {
				continue
			}
			if trySlicer(id, p) {
				return p, true
			}
		}
	}

	// Check well-known paths
	for _, p := range wellKnownPaths[id] {
		if trySlicer(id, p) {
			return p, true
		}
	}

	return "", false
}

func trySlicer(id SlicerId, binary string) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, binary, "--help")
	cmd.Stdout = nil
	cmd.Stderr = nil

	if err := cmd.Run(); err != nil {
		return false
	}
	return true
}

// CreateSlicerAdapter creates an adapter for a given slicer profile
func CreateSlicerAdapter(profile SlicerProfile) *SlicerAdapter {
	return &SlicerAdapter{
		ID:      profile.ID,
		Binary:  profile.Binary,
		profile: profile,
	}
}

// IsAvailable checks if the slicer binary exists and works
func (a *SlicerAdapter) IsAvailable(extraPaths string) bool {
	binary, ok := discoverSlicer(a.ID, extraPaths)
	if !ok {
		return false
	}
	a.Binary = binary
	return true
}

// Slice runs the slicer and returns the result
func (a *SlicerAdapter) Slice(ctx context.Context, req SlicerRequest) (*SlicerResult, error) {
	timeout := DefaultTimeout
	if req.TimeoutMs > 0 {
		timeout = time.Duration(req.TimeoutMs) * time.Millisecond
	}
	if timeout > MaxTimeout {
		timeout = MaxTimeout
	}

	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	// Create temp directory
	tmpDir, err := os.MkdirTemp("", "3dp-slice-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tmpDir)

	// Drop STL to bed if requested
	stlBytes := req.STLBytes
	if req.AutoDropToBed {
		stlBytes = dropStlToBed(stlBytes)
	}

	// Write STL to temp file
	stlPath := filepath.Join(tmpDir, "input.stl")
	if err := os.WriteFile(stlPath, stlBytes, 0644); err != nil {
		return nil, err
	}

	// Build command args
	args := a.buildArgs(stlPath, tmpDir, req)

	// Execute slicer
	cmd := exec.CommandContext(ctx, a.Binary, args...)
	cmd.Dir = tmpDir
	_, err = cmd.CombinedOutput()
	if err != nil {
		return nil, err
	}

	// Find and read output G-code
	gcode, fileName, err := findGcodeOutput(tmpDir, req.FileName)
	if err != nil {
		return nil, err
	}

	// Parse metadata and layers
	meta := parseGCodeMetadata(gcode)
	layers := parseLayers(gcode)
	if meta.LayerHeightMm == 0 && len(layers) > 1 {
		meta.LayerHeightMm = medianLayerStepMm(layers)
	}
	meta.LayerCount = len(layers)

	return &SlicerResult{
		GCode:    gcode,
		FileName: fileName,
		Metadata: meta,
		Layers:   layers,
		Warnings: nil,
	}, nil
}

func (a *SlicerAdapter) buildArgs(stlPath, outputDir string, req SlicerRequest) []string {
	var args []string

	switch a.ID {
	case PrusaSlicer, BambuStudio:
		args = append(args, "--export-gcode")
		if a.profile.PrinterPreset != "" {
			args = append(args, "--printer", a.profile.PrinterPreset)
		}
		if a.profile.MaterialPreset != "" {
			args = append(args, "--filament", a.profile.MaterialPreset)
		}
		if a.profile.LayerHeightMm > 0 {
			args = append(args, "--layer-height", formatFloat(a.profile.LayerHeightMm))
		}
		args = append(args, "--output", filepath.Join(outputDir, "output.gcode"))
		args = append(args, stlPath)

	case OrcaSlicer:
		args = append(args, "--slice", "1", "--outputdir", outputDir)
		if a.profile.PrinterPreset != "" && a.profile.MaterialPreset != "" {
			args = append(args, "--load-settings", a.profile.PrinterPreset+";"+a.profile.MaterialPreset)
		}
		args = append(args, stlPath)
	}

	if len(a.profile.ExtraArgs) > 0 {
		args = append(args, a.profile.ExtraArgs...)
	}

	return args
}

func findGcodeOutput(dir, baseName string) (string, string, error) {
	// Look for .gcode files
	entries, err := os.ReadDir(dir)
	if err != nil {
		return "", "", err
	}

	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".gcode") {
			data, err := os.ReadFile(filepath.Join(dir, e.Name()))
			if err != nil {
				return "", "", err
			}
			return string(data), e.Name(), nil
		}
	}

	return "", "", os.ErrNotExist
}

func formatFloat(f float64) string {
	if f == float64(int(f)) {
		return strconv.Itoa(int(f))
	}
	s := strconv.FormatFloat(f, 'f', -1, 64)
	// Remove trailing zeros
	if i := strings.LastIndex(s, "."); i >= 0 {
		for len(s) > i+1 && s[len(s)-1] == '0' {
			s = s[:len(s)-1]
		}
		if len(s) == i+1 {
			s = s[:i]
		}
	}
	return s
}

func init() {
	// Suppress unused import
	_ = math.MaxFloat32
}
