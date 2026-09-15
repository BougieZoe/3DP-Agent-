package cad

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/BougieZoe/3dp-agent-go/llm"
)

const (
	defaultTimeoutMs = 180_000
	maxTimeoutMs     = 600_000
	llmTimeoutMs     = 150_000
	stderrTail       = 4000
	maxRepairAtts    = 2
	maxLLMFixAtts    = 3
)

var cadSystemPrompt = `You are a build123d CAD code generator. Output ONLY valid Python.

RULES:
1. First line: from build123d import *
2. Define: def gen_step():
3. Return ONE closed solid. No type hints on def.
4. Output raw code ONLY. No markdown, no backticks, no explanations.
5. NEVER: export_*, show_*, print, CadQuery, OCP, or external libs.
6. Put Pos() LEFT of the shape: Pos(x,y,z) * Box(...) — NOT Box(...) * Pos(...)
7. Align: use align=(Align.CENTER, Align.CENTER, Align.CENTER) or Align.MIN for stacking.
8. Maximum ~20 lines of code. Keep it simple.

FORBIDDEN PATTERNS (your code WILL crash if you use these):
- DO NOT use BuildPart(), with BuildPart(), with Locations(), or any Builder pattern.
- DO NOT call fillet() or chamfer() on any shape with holes, cutouts, or lattices.
- DO NOT fillet after body -= hole (boolean subtraction).
- DO NOT use fillet on a shape made from many boolean unions.
- DO NOT write loops with more than 8 iterations.
- DO NOT use for/while loops unless absolutely needed (prefer manual unrolling).
- DO NOT use try/except in generated code.
- DO NOT use Wedge(...) — its taper parameters are 0..1 ratios, not lengths.

SAFE PATTERNS (always work):
- Simple box:  Box(w, d, h, align=(Align.CENTER, Align.CENTER, Align.CENTER))
- Cylinder:    Cylinder(radius=r, height=h, align=(Align.CENTER, Align.CENTER, Align.CENTER))
- Sphere:      Sphere(radius=r)
- Cone:        Cone(bottom_radius=r1, top_radius=r2, height=h, align=(Align.CENTER, Align.CENTER, Align.MIN))
- Subtract:    body -= Pos(x, y, z) * Cylinder(radius=r, height=h)
- Add:         body += Pos(x, y, z) * Box(w, d, h)
- Fillet (ONLY on a SINGLE primitive, no holes): body = fillet(body.edges(), radius=1)
- Hole pattern (max 4 holes, unrolled): hole = Pos(x,y,0) * Cylinder(r, h); body -= hole

EXAMPLES:

from build123d import *

def gen_step():
    body = Box(50, 50, 50, align=(Align.CENTER, Align.CENTER, Align.CENTER))
    return body

from build123d import *

def gen_step():
    body = Cylinder(radius=15, height=50, align=(Align.CENTER, Align.CENTER, Align.CENTER))
    return body

from build123d import *

def gen_step():
    body = Box(80, 60, 5, align=(Align.CENTER, Align.CENTER, Align.MIN))
    hole1 = Pos(-30, -20, 0) * Cylinder(radius=4, height=10)
    hole2 = Pos(30, -20, 0) * Cylinder(radius=4, height=10)
    hole3 = Pos(-30, 20, 0) * Cylinder(radius=4, height=10)
    hole4 = Pos(30, 20, 0) * Cylinder(radius=4, height=10)
    body -= hole1 + hole2 + hole3 + hole4
    return body

Now generate for: `

func extractPythonSource(text string) (string, error) {
	re := regexp.MustCompile("(?s)```(?:python)?\\s*\\n(.*?)```")
	match := re.FindStringSubmatch(text)
	source := text
	if match != nil {
		source = strings.TrimSpace(match[1])
	}
	if !strings.Contains(source, "def gen_step") {
		return "", fmt.Errorf("LLM output did not contain a gen_step() function")
	}
	opens := strings.Count(source, "(") + strings.Count(source, "[") + strings.Count(source, "{")
	closes := strings.Count(source, ")") + strings.Count(source, "]") + strings.Count(source, "}")
	if opens != closes {
		return "", fmt.Errorf("LLM output is truncated (unbalanced brackets)")
	}
	return source, nil
}

func composeUserMessage(body BridgeGenerateBody, priorSource string) string {
	var lines []string
	if body.Prompt != "" {
		lines = append(lines, "Part description: "+body.Prompt)
	}
	c := body.Constraints
	if c != nil {
		if c.MaxDimensionMm > 0 {
			lines = append(lines, fmt.Sprintf("Constraint: no dimension may exceed %.0f mm.", c.MaxDimensionMm))
		}
		if c.TargetPrinter != "" {
			lines = append(lines, "Constraint: must fit the "+c.TargetPrinter+" print bed.")
		}
		if c.MaterialName != "" {
			lines = append(lines, "Constraint: will be printed in "+c.MaterialName+" (FDM).")
		}
	}
	if body.AnalysisContext != nil && len(body.AnalysisContext.Issues) > 0 {
		lines = append(lines, "")
		lines = append(lines, "DfAM ANALYSIS CONTEXT (address these issues):")
		if body.AnalysisContext.PrintabilityScore > 0 {
			lines = append(lines, fmt.Sprintf("Current printability score: %.0f/100", body.AnalysisContext.PrintabilityScore))
		}
		for i, issue := range body.AnalysisContext.Issues {
			if i >= 5 {
				break
			}
			parts := []string{fmt.Sprintf("- [%s] %s: %s", issue.Priority, issue.Type, issue.Description)}
			if issue.Recommendation != "" {
				parts = append(parts, "  Fix: "+issue.Recommendation)
			} else if issue.Implementation != "" {
				parts = append(parts, "  Fix: "+issue.Implementation)
			}
			lines = append(lines, strings.Join(parts, "\n"))
		}
		lines = append(lines, "")
		lines = append(lines, "IMPORTANT: Preserve the original design intent. Only modify geometry to address the issues above.")
	}
	return strings.Join(lines, "\n")
}

func llmChatOnce(ctx context.Context, candidate llm.LLMCandidate, userMessage string) (string, error) {
	url := strings.TrimRight(candidate.BaseURL, "/") + "/chat/completions"

	messages := []llm.Message{
		{Role: "system", Content: cadSystemPrompt},
		{Role: "user", Content: userMessage},
	}

	bodyBytes, _ := json.Marshal(llm.ChatRequest{
		Model:    candidate.Model,
		Messages: messages,
		Stream:   false,
	})

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(bodyBytes))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	if candidate.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+candidate.APIKey)
	}

	client := &http.Client{Timeout: llmTimeoutMs * time.Millisecond}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode == 429 {
		return "", fmt.Errorf("LLM rate limited (429)")
	}
	if resp.StatusCode == 402 {
		return "", fmt.Errorf("LLM API key has no credits (402)")
	}
	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("LLM request failed: HTTP %d — %s", resp.StatusCode, string(body[:min(len(body), 200)]))
	}

	var llmResp llm.LLMResponse
	if err := json.Unmarshal(body, &llmResp); err != nil {
		return "", fmt.Errorf("failed to parse response: %v", err)
	}
	if llmResp.Error != nil {
		return "", fmt.Errorf("LLM error: %s", llmResp.Error.Message)
	}
	if len(llmResp.Choices) == 0 {
		return "", fmt.Errorf("no choices in response")
	}

	content := llmResp.Choices[0].Message.Content
	if content == "" {
		return "", fmt.Errorf("LLM returned empty content")
	}

	return extractPythonSource(content)
}

func llmChatWithBackoff(ctx context.Context, candidate llm.LLMCandidate, userMessage string) (string, error) {
	attempts := 3
	backoffMs := 1000
	var lastErr error
	for attempt := 1; attempt <= attempts; attempt++ {
		content, err := llmChatOnce(ctx, candidate, userMessage)
		if err == nil {
			return content, nil
		}
		lastErr = err
		msg := err.Error()
		isTransient := strings.Contains(msg, "429") || strings.Contains(msg, "5")
		if attempt == attempts || !isTransient {
			return "", err
		}
		time.Sleep(time.Duration(min(backoffMs, 5000)) * time.Millisecond)
		backoffMs *= 2
	}
	return "", lastErr
}

func generateSourceViaLLM(ctx context.Context, candidates []llm.LLMCandidate, userMessage string) (string, error) {
	var lastErr error
	for _, c := range candidates {
		content, err := llmChatWithBackoff(ctx, c, userMessage)
		if err == nil {
			return content, nil
		}
		lastErr = err
		log.Printf("[cad] candidate %s failed: %v", c.Label, err)
	}
	if lastErr != nil {
		return "", lastErr
	}
	return "", fmt.Errorf("LLM source generation failed: no candidates")
}

func generateFixViaLLM(ctx context.Context, candidates []llm.LLMCandidate, originalSource, errorOutput, userPrompt string) (string, error) {
	fixMessage := fmt.Sprintf(`The following build123d code failed to execute. Fix the code so it runs correctly.

Original user request: %s

Failed source:
`+"```python"+`
%s
`+"```"+`

Error output:
`+"```"+`
%s
`+"```"+`

Rules:
- Output ONLY the fixed Python code. No explanations.
- Keep the same gen_step() function structure.
- Fix the error while preserving the original design intent.
- Do NOT use BuildPart, BuildLine, BuildSketch, or context managers.
- Do NOT use fillet/chamfer on shapes with holes.`, userPrompt, originalSource, tailStr(errorOutput, 2000))

	return generateSourceViaLLM(ctx, candidates, fixMessage)
}

func runStepCli(pythonPath, stepCLIDir, runDir string, args []string, timeoutMs int) (int, string, string, bool) {
	fullArgs := append([]string{stepCLIDir}, args...)
	cmd := exec.Command(pythonPath, fullArgs...)
	cmd.Dir = runDir
	cmd.Env = sandboxEnv()

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutMs)*time.Millisecond)
	defer cancel()
	cmd = exec.CommandContext(ctx, cmd.Path, cmd.Args[1:]...)
	cmd.Dir = runDir
	cmd.Env = sandboxEnv()

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

func sandboxEnv() []string {
	return []string{
		"PATH=/usr/bin:/bin:/usr/sbin:/sbin",
		"HOME=" + os.TempDir(),
		"LANG=en_US.UTF-8",
		"LC_ALL=en_US.UTF-8",
		"TMPDIR=" + os.TempDir(),
	}
}

func tailStr(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[len(s)-max:]
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func (r *CadRouter) generateHandler(w http.ResponseWriter, req *http.Request) {
	startedAt := time.Now()
	id := generateID()

	var body BridgeGenerateBody
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

	log.Printf("[cad:%s] POST /generate — prompt=%q", id[:8], truncate(body.Prompt, 80))

	if body.Prompt == "" && body.GeneratorSource == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"ok": false,
			"error": map[string]string{
				"code":   "generation-failed",
				"detail": "prompt must be a non-empty string",
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

	runDir := filepath.Join(r.cadBridgeDir, "runs", id)
	os.MkdirAll(runDir, 0755)

	var source string
	var candidates []llm.LLMCandidate

	if body.GeneratorSource != "" {
		source = body.GeneratorSource
		log.Printf("[cad:%s] Using generatorSource (%d chars)", id[:8], len(source))
	} else {
		candidates = llm.BuildAllCandidates("", nil)
		if len(candidates) == 0 {
			writeJSON(w, http.StatusBadGateway, map[string]interface{}{
				"ok": false,
				"error": map[string]string{
					"code":   "generation-failed",
					"detail": "No LLM provider configured",
				},
			})
			return
		}

		userMsg := composeUserMessage(body, "")
		llmStart := time.Now()
		ctx, cancel := context.WithTimeout(req.Context(), 150*time.Second)
		defer cancel()

		var err error
		source, err = generateSourceViaLLM(ctx, candidates, userMsg)
		if err != nil {
			log.Printf("[cad:%s] LLM failed after %v: %v", id[:8], time.Since(llmStart), err)
			writeJSON(w, http.StatusBadGateway, map[string]interface{}{
				"ok": false,
				"error": map[string]string{
					"code":   "generation-failed",
					"detail": fmt.Sprintf("LLM source generation failed: %v", err),
				},
			})
			return
		}
		log.Printf("[cad:%s] LLM responded in %v (%d chars)", id[:8], time.Since(llmStart), len(source))
	}

	safety := scanSourceSafety(source)
	if !safety.Safe {
		writeJSON(w, http.StatusBadGateway, map[string]interface{}{
			"ok": false,
			"error": map[string]string{
				"code":   "generation-failed",
				"detail": fmt.Sprintf("Generated code contained a forbidden operation (%v)", safety.Violations),
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
			fixed, err := generateFixViaLLM(req.Context(), candidates, source, combined, body.Prompt)
			if err != nil {
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
				"code":   "generation-timeout",
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
				"code":   "generation-failed",
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
	log.Printf("[cad:%s] Done in %v (%d bytes STL)", id[:8], duration, len(stl))

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"ok": true,
		"model": map[string]interface{}{
			"id":         id,
			"prompt":     body.Prompt,
			"createdAt":  startedAt.Format(time.RFC3339),
			"durationMs": duration.Milliseconds(),
		},
		"stlBase64": encodeBase64(stl),
		"source":    source,
		"repaired":  repairAttempts > 0,
		"attempts":  repairAttempts + llmFixAttempts + 1,
	})
}

func generateID() string {
	return uuid.New().String()
}
