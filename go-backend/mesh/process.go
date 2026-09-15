package mesh

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

type MeshProcessDiagnostics struct {
	TriangleCount  int      `json:"triangleCount,omitempty"`
	Watertight     *bool    `json:"watertight,omitempty"`
	VolumeMm3      *float64 `json:"volumeMm3,omitempty"`
	SurfaceAreaMm2 float64  `json:"surfaceAreaMm2,omitempty"`
	BodyCount      *int     `json:"bodyCount,omitempty"`
	Repaired       bool     `json:"repaired,omitempty"`
	RepairNote     string   `json:"repairNote,omitempty"`
}

func runMeshProcess(pythonPath, cadDir string, stlBytes []byte, decimateTo int) (*MeshProcessDiagnostics, []byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Create temp directory
	tmpDir, err := os.MkdirTemp("", "3dp-mesh-*")
	if err != nil {
		return nil, nil, err
	}
	defer os.RemoveAll(tmpDir)

	// Write input STL
	inPath := filepath.Join(tmpDir, "input.stl")
	if err := os.WriteFile(inPath, stlBytes, 0644); err != nil {
		return nil, nil, err
	}

	// Output paths
	outPath := filepath.Join(tmpDir, "output.stl")
	diagPath := filepath.Join(tmpDir, "diagnostics.json")

	// Find mesh_process.py - try multiple locations
	locations := []string{
		filepath.Join(cadDir, "..", "server", "mesh_process.py"),
		"server/mesh_process.py",
		"/Users/bougiezoe/3DP-Agent-/server/mesh_process.py",
	}
	var scriptPath string
	for _, loc := range locations {
		if _, err := os.Stat(loc); err == nil {
			scriptPath = loc
			break
		}
	}
	if scriptPath == "" {
		return nil, nil, fmt.Errorf("mesh_process.py not found")
	}

	// Find mesh-venv Python (has trimesh installed)
	meshPython := filepath.Join(cadDir, "mesh-venv", "bin", "python3")
	if _, err := os.Stat(meshPython); err != nil {
		meshPython = pythonPath // fallback
	}

	// Build command - skip ulimit -v (not supported on macOS)
	shellCmd := fmt.Sprintf(
		"ulimit -t 120; ulimit -f 102400; exec \"%s\" \"%s\" \"%s\" \"%s\" \"%d\" \"%s\"",
		meshPython, scriptPath, inPath, outPath, decimateTo, diagPath,
	)
	cmd := exec.CommandContext(ctx, "/bin/sh", "-c", shellCmd)
	cmd.Env = sandboxEnv()

	// Run
	output, err := cmd.CombinedOutput()
	if err != nil {
		return nil, nil, fmt.Errorf("mesh process failed: %v, output: %s", err, string(output))
	}

	// Read diagnostics
	var diags MeshProcessDiagnostics
	if data, err := os.ReadFile(diagPath); err == nil {
		json.Unmarshal(data, &diags)
	}

	// Read output STL
	processedSTL, err := os.ReadFile(outPath)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to read output STL: %v", err)
	}

	return &diags, processedSTL, nil
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
