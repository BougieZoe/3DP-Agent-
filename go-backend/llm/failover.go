package llm

import (
	"context"
	"sync"
	"time"
)

type BreakerState struct {
	Failures  int
	OpenUntil time.Time
}

type FailoverOptions struct {
	FailureThreshold int
	CooldownMs       int
	BudgetMs         int
	OnLog            func(string)
}

type FailoverResult struct {
	OK       bool
	Provider string
	Error    string
}

var (
	breakers   = sync.Map{}
	breakerMu  sync.Mutex
	defaultOpts = FailoverOptions{
		FailureThreshold: 3,
		CooldownMs:       30000,
		BudgetMs:         30000,
	}
)

func RunFailoverSequence(ctx context.Context, candidates []LLMCandidate, opts *FailoverOptions, fn func(LLMCandidate) (string, error)) FailoverResult {
	if opts == nil {
		opts = &defaultOpts
	}

	start := time.Now()
	budget := time.Duration(opts.BudgetMs) * time.Millisecond

	var lastErr string
	for _, c := range candidates {
		// Check budget
		if time.Since(start) > budget {
			lastErr = "budget exceeded"
			break
		}

		// Check circuit breaker
		if isCircuitOpen(c.ID) {
			if opts.OnLog != nil {
				opts.OnLog("circuit open for " + c.Label + ", skipping")
			}
			continue
		}

		// Try the candidate
		_, err := fn(c)
		if err != nil {
			recordAttempt(c.ID, false, *opts)
			lastErr = err.Error()

			if opts.OnLog != nil {
				opts.OnLog("candidate " + c.Label + " failed: " + err.Error())
			}
			continue
		}

		// Success
		recordAttempt(c.ID, true, *opts)
		return FailoverResult{
			OK:       true,
			Provider: c.Label,
		}
	}

	return FailoverResult{
		OK:    false,
		Error: lastErr,
	}
}

func isCircuitOpen(id string) bool {
	val, ok := breakers.Load(id)
	if !ok {
		return false
	}
	state := val.(*BreakerState)
	return time.Now().Before(state.OpenUntil)
}

func recordAttempt(id string, ok bool, opts FailoverOptions) {
	breakerMu.Lock()
	defer breakerMu.Unlock()

	val, _ := breakers.Load(id)
	var state *BreakerState
	if val == nil {
		state = &BreakerState{}
		breakers.Store(id, state)
	} else {
		state = val.(*BreakerState)
	}

	if ok {
		// Reset on success
		breakers.Delete(id)
		return
	}

	state.Failures++
	if state.Failures >= opts.FailureThreshold {
		state.OpenUntil = time.Now().Add(time.Duration(opts.CooldownMs) * time.Millisecond)
	}
}

func ResetFailoverState() {
	breakers = sync.Map{}
}

func BreakerFailures(id string) int {
	val, ok := breakers.Load(id)
	if !ok {
		return 0
	}
	return val.(*BreakerState).Failures
}

func BreakerOpenUntil(id string) time.Time {
	val, ok := breakers.Load(id)
	if !ok {
		return time.Time{}
	}
	return val.(*BreakerState).OpenUntil
}

func LabelFor(id string) string {
	return id
}
