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

	// Find mesh_process.py
	scriptPath := filepath.Join(cadDir, "..", "server", "mesh_process.py")
	if _, err := os.Stat(scriptPath); os.IsNotExist(err) {
		// Try relative to current dir
		scriptPath = "server/mesh_process.py"
		if _, err := os.Stat(scriptPath); os.IsNotExist(err) {
			return nil, nil, fmt.Errorf("mesh_process.py not found")
		}
	}

	// Build command with resource limits
	cmd := exec.CommandContext(ctx, "/bin/sh", "-c",
		fmt.Sprintf("ulimit -v 2000000; ulimit -t 120; ulimit -f 102400; exec \"%s\" \"%s\"",
			pythonPath, scriptPath))
	cmd.Args = []string{pythonPath, scriptPath, inPath, outPath, fmt.Sprintf("%d", decimateTo), diagPath}
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
