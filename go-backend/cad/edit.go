package cad

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/BougieZoe/3dp-agent-go/llm"
)

// editHandler processes CAD edit requests: takes existing source code +
// natural language edit instructions, uses LLM to modify the code,
// regenerates the STL, and returns the updated model.
func (r *CadRouter) editHandlerImpl(w http.ResponseWriter, req *http.Request) {
	startedAt := time.Now()
	id := generateID()

	var body BridgeEditBody
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"ok": false,
			"error": map[string]string{
				"code":   "invalid-input",
				"detail": "Invalid JSON body",
			},
		})
		return
	}

	log.Printf("[cad:%s] POST /generate/edit — instructions=%q", id[:8], truncate(body.EditInstructions, 80))

	if body.Source == "" || body.EditInstructions == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"ok": false,
			"error": map[string]string{
				"code":   "invalid-input",
				"detail": "source and editInstructions are required",
			},
		})
		return
	}

	python, ready, reason := r.checkReady()
	if !ready {
		writeJSON(w, http.StatusServiceUnavailable, map[string]interface{}{
			"ok": false,
			"error": map[string]string{
				"code":   "transport-unavailable",
				"detail": reason,
			},
		})
		return
	}

	candidates := llm.BuildAllCandidates("", nil)
	if len(candidates) == 0 {
		writeJSON(w, http.StatusBadGateway, map[string]interface{}{
			"ok": false,
			"error": map[string]string{
				"code":   "edit-failed",
				"detail": "No LLM provider configured",
			},
		})
		return
	}

	runDir := filepath.Join(r.cadBridgeDir, "runs", id)
	os.MkdirAll(runDir, 0755)

	userMsg := generateEditPrompt(body.Source, body.EditInstructions, body.OriginalPrompt)
	ctx, cancel := context.WithTimeout(req.Context(), 150*time.Second)
	defer cancel()

	llmStart := time.Now()
	source, err := generateSourceViaLLM(ctx, candidates, userMsg)
	if err != nil {
		log.Printf("[cad:%s] LLM edit failed after %v: %v", id[:8], time.Since(llmStart), err)
		writeJSON(w, http.StatusBadGateway, map[string]interface{}{
			"ok": false,
			"error": map[string]string{
				"code":   "edit-failed",
				"detail": fmt.Sprintf("LLM source generation failed: %v", err),
			},
		})
		return
	}
	log.Printf("[cad:%s] LLM edit responded in %v (%d chars)", id[:8], time.Since(llmStart), len(source))

	safety := scanSourceSafety(source)
	if !safety.Safe {
		writeJSON(w, http.StatusBadGateway, map[string]interface{}{
			"ok": false,
			"error": map[string]string{
				"code":   "edit-failed",
				"detail": fmt.Sprintf("Edited code contained a forbidden operation (%v)", safety.Violations),
			},
		})
		return
	}

	os.WriteFile(filepath.Join(runDir, "model.py"), []byte(source), 0644)

	args := []string{"model.py", "--stl", "model.stl"}
	if body.MeshTolerance != nil {
		if body.MeshTolerance.Linear > 0 {
			args = append(args, "--mesh-tolerance", fmt.Sprintf("%g", body.MeshTolerance.Linear))
		}
		if body.MeshTolerance.Angular > 0 {
			args = append(args, "--mesh-angular-tolerance", fmt.Sprintf("%g", body.MeshTolerance.Angular))
		}
	}

	timeoutMs := defaultTimeoutMs
	if body.TimeoutMs > 0 {
		timeoutMs = min(body.TimeoutMs, maxTimeoutMs)
	}

	log.Printf("[cad:%s] Running: python %s", id[:8], joinArgs(args))
	code, stdout, stderr, timedOut := runStepCli(python, r.stepCLIDir, runDir, args, timeoutMs)

	repairAttempts := 0
	llmFixAttempts := 0

	for code != 0 && !timedOut && repairAttempts < maxRepairAtts {
		combined := stdout + stderr
		repairedSource, repaired := repairCadSource(source, combined)
		if !repaired {
			break
		}
		source = repairedSource
		repairAttempts++
		os.WriteFile(filepath.Join(runDir, "model.py"), []byte(source), 0644)
		log.Printf("[cad:%s] Repair %d/%d", id[:8], repairAttempts, maxRepairAtts)
		code, stdout, stderr, timedOut = runStepCli(python, r.stepCLIDir, runDir, args, timeoutMs)
	}

	if code != 0 && !timedOut && len(candidates) > 0 {
		for code != 0 && !timedOut && llmFixAttempts < maxLLMFixAtts {
			combined := stdout + stderr
			llmFixAttempts++
			fixed, fixErr := generateFixViaLLM(req.Context(), candidates, source, combined, body.EditInstructions)
			if fixErr != nil {
				break
			}
			s2 := scanSourceSafety(fixed)
			if !s2.Safe {
				break
			}
			source = fixed
			os.WriteFile(filepath.Join(runDir, "model.py"), []byte(source), 0644)
			code, stdout, stderr, timedOut = runStepCli(python, r.stepCLIDir, runDir, args, timeoutMs)
		}
	}

	if timedOut {
		writeJSON(w, http.StatusGatewayTimeout, map[string]interface{}{
			"ok": false,
			"error": map[string]string{
				"code":   "edit-timeout",
				"detail": fmt.Sprintf("scripts/step exceeded %dms", timeoutMs),
			},
		})
		return
	}

	if code != 0 {
		combined := tailStr(stdout+stderr, stderrTail)
		writeJSON(w, http.StatusBadGateway, map[string]interface{}{
			"ok": false,
			"error": map[string]string{
				"code":   "edit-failed",
				"detail": fmt.Sprintf("scripts/step exited with code %d", code),
				"stderr": combined,
			},
		})
		return
	}

	stlPath := filepath.Join(runDir, "model.stl")
	stl, err := os.ReadFile(stlPath)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]interface{}{
			"ok": false,
			"error": map[string]string{
				"code":   "invalid-artifact",
				"detail": "scripts/step completed but produced no STL",
			},
		})
		return
	}
	if len(stl) <= 84 {
		writeJSON(w, http.StatusBadGateway, map[string]interface{}{
			"ok": false,
			"error": map[string]string{
				"code":   "invalid-artifact",
				"detail": fmt.Sprintf("STL artifact too small (%d bytes)", len(stl)),
			},
		})
		return
	}

	duration := time.Since(startedAt)
	log.Printf("[cad:%s] Edit done in %v (%d bytes STL)", id[:8], duration, len(stl))

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"ok": true,
		"model": map[string]interface{}{
			"id":         id,
			"prompt":     body.EditInstructions,
			"createdAt":  startedAt.Format(time.RFC3339),
			"durationMs": duration.Milliseconds(),
		},
		"stlBase64": encodeBase64(stl),
		"source":    source,
		"repaired":  repairAttempts > 0,
		"attempts":  repairAttempts + llmFixAttempts + 1,
		"edited":    true,
	})
}
