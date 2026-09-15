package step

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

type GeometryModel struct {
	Positions     []float32 `json:"positions"`
	Normals       []float32 `json:"normals"`
	Indices       []uint32  `json:"indices"`
	VertexCount   int       `json:"vertexCount"`
	TriangleCount int       `json:"triangleCount"`
	Units         string    `json:"units"`
}

type StepParseResult struct {
	Model          GeometryModel `json:"model"`
	SolidCount     int           `json:"solidCount"`
	FaceCount      int           `json:"faceCount"`
	BoundingBox    [6]float64    `json:"boundingBox"`
	VolumeMm3      float64       `json:"volumeMm3"`
	SurfaceAreaMm2 float64       `json:"surfaceAreaMm2"`
	Warnings       []string      `json:"warnings"`
}

type stepCliResult struct {
	Positions     []float32 `json:"positions"`
	Normals       []float32 `json:"normals"`
	Indices       []uint32  `json:"indices"`
	VertexCount   int       `json:"vertexCount"`
	TriangleCount int       `json:"triangleCount"`
	SolidCount    int       `json:"solidCount"`
	FaceCount     int       `json:"faceCount"`
	BoundingBox   [6]float64 `json:"boundingBox"`
	VolumeMm3     float64   `json:"volumeMm3"`
	SurfaceAreaMm2 float64  `json:"surfaceAreaMm2"`
	Warnings      []string  `json:"warnings"`
}

func parseStepFile(pythonPath, cadDir string, stepBytes []byte, linearDeflection, angularDeflection float64) (*StepParseResult, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	// Create temp directory
	tmpDir, err := os.MkdirTemp("", "3dp-step-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tmpDir)

	// Write STEP file
	stepPath := filepath.Join(tmpDir, "input.step")
	if err := os.WriteFile(stepPath, stepBytes, 0644); err != nil {
		return nil, err
	}

	// Output JSON
	outPath := filepath.Join(tmpDir, "result.json")

	// Find STEP CLI script
	scriptPath := findStepScript(cadDir)
	if scriptPath == "" {
		return nil, fmt.Errorf("STEP CLI script not found")
	}

	// Build command
	args := []string{
		pythonPath, scriptPath,
		stepPath, outPath,
	}
	if linearDeflection > 0 {
		args = append(args, fmt.Sprintf("%f", linearDeflection))
	}
	if angularDeflection > 0 {
		args = append(args, fmt.Sprintf("%f", angularDeflection))
	}

	cmd := exec.CommandContext(ctx, args[0], args[1:]...)
	cmd.Env = sandboxEnv()

	output, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("STEP parse failed: %v, output: %s", err, string(output))
	}

	// Read result JSON
	data, err := os.ReadFile(outPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read STEP result: %v", err)
	}

	var cliResult stepCliResult
	if err := json.Unmarshal(data, &cliResult); err != nil {
		return nil, fmt.Errorf("failed to parse STEP result JSON: %v", err)
	}

	return &StepParseResult{
		Model: GeometryModel{
			Positions:     cliResult.Positions,
			Normals:       cliResult.Normals,
			Indices:       cliResult.Indices,
			VertexCount:   cliResult.VertexCount,
			TriangleCount: cliResult.TriangleCount,
			Units:         "mm",
		},
		SolidCount:     cliResult.SolidCount,
		FaceCount:      cliResult.FaceCount,
		BoundingBox:    cliResult.BoundingBox,
		VolumeMm3:      cliResult.VolumeMm3,
		SurfaceAreaMm2: cliResult.SurfaceAreaMm2,
		Warnings:       cliResult.Warnings,
	}, nil
}

func findStepScript(cadDir string) string {
	// Try multiple locations
	locations := []string{
		filepath.Join(cadDir, "..", "scripts", "step", "step_cli.py"),
		filepath.Join(cadDir, "scripts", "step", "step_cli.py"),
		"scripts/step/step_cli.py",
		".agents/skills/cad/scripts/step/step_cli.py",
	}

	for _, loc := range locations {
		if _, err := os.Stat(loc); err == nil {
			return loc
		}
	}

	return ""
}

func sandboxEnv() []string {
	return []string{
		"PATH=/usr/local/bin:/usr/bin:/bin",
		"HOME=" + os.Getenv("HOME"),
		"LANG=en_US.UTF-8",
		"TMPDIR=" + os.TempDir(),
		"PYTHONUNBUFFERED=1",
		"PYTHONDONTWRITEBYTECODE=1",
	}
}
