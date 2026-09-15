package cad

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

type KhanaCheckRequest struct {
	Source    string `json:"source"`
	Factory   string `json:"factory,omitempty"`
	TimeoutMs int    `json:"timeoutMs,omitempty"`
}

type KhanaCheckResponse struct {
	Ok         bool            `json:"ok"`
	Status     string          `json:"status,omitempty"`
	Mechanism  json.RawMessage `json:"mechanism,omitempty"`
	Error      string          `json:"error,omitempty"`
	Stderr     string          `json:"stderr,omitempty"`
	DurationMs int64           `json:"durationMs,omitempty"`
}

type KhanaExportRequest struct {
	Source    string `json:"source"`
	Factory   string `json:"factory,omitempty"`
	TimeoutMs int    `json:"timeoutMs,omitempty"`
}

type KhanaExportResponse struct {
	Ok         bool   `json:"ok"`
	STLBase64  string `json:"stlBase64,omitempty"`
	STEPBase64 string `json:"stepBase64,omitempty"`
	Error      string `json:"error,omitempty"`
	Stderr     string `json:"stderr,omitempty"`
	DurationMs int64  `json:"durationMs,omitempty"`
}

func findKhana() string {
	path, err := exec.LookPath("khana")
	if err == nil {
		return path
	}
	home, _ := os.UserHomeDir()
	candidates := []string{
		filepath.Join(home, ".local/bin/khana"),
		filepath.Join(home, ".cargo/bin/khana"),
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c
		}
	}
	return ""
}

func runKhana(khanaPath string, args []string, dir string, timeoutMs int) (int, string, string, bool) {
	cmd := exec.Command(khanaPath, args...)
	cmd.Dir = dir
	cmd.Env = []string{
		"PATH=" + filepath.Dir(khanaPath) + ":/usr/local/bin:/usr/bin:/bin",
		"HOME=" + os.TempDir(),
		"LANG=en_US.UTF-8",
		"TMPDIR=" + os.TempDir(),
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutMs)*time.Millisecond)
	defer cancel()
	cmd = exec.CommandContext(ctx, cmd.Path, cmd.Args[1:]...)
	cmd.Dir = dir
	cmd.Env = []string{
		"PATH=" + filepath.Dir(khanaPath) + ":/usr/local/bin:/usr/bin:/bin",
		"HOME=" + os.TempDir(),
		"LANG=en_US.UTF-8",
		"TMPDIR=" + os.TempDir(),
	}

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	timedOut := ctx.Err() == context.DeadlineExceeded
	code := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			code = exitErr.ExitCode()
		} else {
			code = -1
		}
	}
	return code, stdout.String(), stderr.String(), timedOut
}

func (r *CadRouter) khanaCheckHandler(w http.ResponseWriter, req *http.Request) {
	startedAt := time.Now()

	var body KhanaCheckRequest
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"ok": false,
			"error": "invalid JSON body",
		})
		return
	}

	if body.Source == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"ok": false,
			"error": "source is required",
		})
		return
	}

	if r.khanaPath == "" {
		writeJSON(w, http.StatusServiceUnavailable, map[string]interface{}{
			"ok": false,
			"error": "khana not installed",
		})
		return
	}

	timeoutMs := body.TimeoutMs
	if timeoutMs == 0 {
		timeoutMs = 120000
	}

	runDir := filepath.Join(r.cadBridgeDir, "runs", fmt.Sprintf("khana-%d", time.Now().UnixNano()))
	os.MkdirAll(runDir, 0755)

	sourcePath := filepath.Join(runDir, "assembly.py")
	if err := os.WriteFile(sourcePath, []byte(body.Source), 0644); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"ok": false,
			"error": "failed to write source file",
		})
		return
	}

	target := "assembly.py"
	if body.Factory != "" {
		target = "assembly.py:" + body.Factory
	}

	code, _, stderr, timedOut := runKhana(r.khanaPath, []string{"check", target, "--out", runDir}, runDir, timeoutMs)

	if timedOut {
		writeJSON(w, http.StatusGatewayTimeout, map[string]interface{}{
			"ok": false,
			"error": fmt.Sprintf("khana check exceeded %dms", timeoutMs),
		})
		return
	}

	if code != 0 && code != 2 {
		mechanismPath := filepath.Join(runDir, "mechanism.json")
		mechanismData, _ := os.ReadFile(mechanismPath)
		writeJSON(w, http.StatusOK, KhanaCheckResponse{
			Ok:         true,
			Status:     "error",
			Mechanism:  mechanismData,
			Error:      fmt.Sprintf("khana check failed with code %d", code),
			Stderr:     tailStr(stderr, 2000),
			DurationMs: time.Since(startedAt).Milliseconds(),
		})
		return
	}

	mechanismPath := filepath.Join(runDir, "mechanism.json")
	mechanismData, err := os.ReadFile(mechanismPath)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"ok":     false,
			"error":  "mechanism.json not found",
			"stderr": tailStr(stderr, 2000),
		})
		return
	}

	status := "ok"
	if code == 2 {
		status = "assertion_failed"
	}

	duration := time.Since(startedAt)
	writeJSON(w, http.StatusOK, KhanaCheckResponse{
		Ok:         true,
		Status:     status,
		Mechanism:  mechanismData,
		DurationMs: duration.Milliseconds(),
	})
}

func (r *CadRouter) khanaExportHandler(w http.ResponseWriter, req *http.Request) {
	startedAt := time.Now()

	var body KhanaExportRequest
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"ok": false,
			"error": "invalid JSON body",
		})
		return
	}

	if body.Source == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"ok": false,
			"error": "source is required",
		})
		return
	}

	if r.khanaPath == "" {
		writeJSON(w, http.StatusServiceUnavailable, map[string]interface{}{
			"ok": false,
			"error": "khana not installed",
		})
		return
	}

	timeoutMs := body.TimeoutMs
	if timeoutMs == 0 {
		timeoutMs = 120000
	}

	runDir := filepath.Join(r.cadBridgeDir, "runs", fmt.Sprintf("khana-%d", time.Now().UnixNano()))
	os.MkdirAll(runDir, 0755)

	sourcePath := filepath.Join(runDir, "assembly.py")
	if err := os.WriteFile(sourcePath, []byte(body.Source), 0644); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"ok": false,
			"error": "failed to write source file",
		})
		return
	}

	target := "assembly.py"
	if body.Factory != "" {
		target = "assembly.py:" + body.Factory
	}

	code, _, stderr, timedOut := runKhana(r.khanaPath, []string{"export", target, "--out", runDir}, runDir, timeoutMs)

	if timedOut {
		writeJSON(w, http.StatusGatewayTimeout, map[string]interface{}{
			"ok": false,
			"error": fmt.Sprintf("khana export exceeded %dms", timeoutMs),
		})
		return
	}

	if code != 0 {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"ok":     false,
			"error":  fmt.Sprintf("khana export failed with code %d", code),
			"stderr": tailStr(stderr, 2000),
		})
		return
	}

	stlPath := filepath.Join(runDir, "assembly.stl")
	stepPath := filepath.Join(runDir, "assembly.step")

	var stlBase64, stepBase64 string
	if stlData, err := os.ReadFile(stlPath); err == nil {
		stlBase64 = encodeBase64(stlData)
	}
	if stepData, err := os.ReadFile(stepPath); err == nil {
		stepBase64 = encodeBase64(stepData)
	}

	duration := time.Since(startedAt)
	writeJSON(w, http.StatusOK, KhanaExportResponse{
		Ok:         true,
		STLBase64:  stlBase64,
		STEPBase64: stepBase64,
		DurationMs: duration.Milliseconds(),
	})
}
