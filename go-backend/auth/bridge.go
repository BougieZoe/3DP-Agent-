package auth

import (
	"net/http"
	"strings"
)

type BridgeAuth struct {
	Token       string
	IsProduction bool
}

func NewBridgeAuth(token string, isProduction bool) *BridgeAuth {
	return &BridgeAuth{
		Token:       token,
		IsProduction: isProduction,
	}
}

func (a *BridgeAuth) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// In production, require token
		if a.IsProduction {
			if a.Token == "" {
				http.Error(w, "Bridge routes disabled", http.StatusForbidden)
				return
			}

			auth := r.Header.Get("Authorization")
			if !strings.HasPrefix(auth, "Bearer ") {
				http.Error(w, "Missing authorization", http.StatusUnauthorized)
				return
			}

			token := strings.TrimPrefix(auth, "Bearer ")
			if token != a.Token {
				http.Error(w, "Invalid token", http.StatusUnauthorized)
				return
			}
		}

		next.ServeHTTP(w, r)
	})
}
