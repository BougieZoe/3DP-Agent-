package auth

import (
	"strings"
)

func IsLoopback(ip string) bool {
	return ip == "127.0.0.1" || ip == "::1" || ip == "::ffff:127.0.0.1"
}

func EffectiveClientIp(socketIp string, forwardedHeader string) string {
	// Only trust x-forwarded-for when socket peer is loopback
	if IsLoopback(socketIp) && forwardedHeader != "" {
		// Take the first IP from x-forwarded-for
		parts := strings.Split(forwardedHeader, ",")
		if len(parts) > 0 {
			ip := strings.TrimSpace(parts[0])
			if ip != "" {
				return ip
			}
		}
	}
	return socketIp
}

func BridgeAuthDecision(socketIp, forwardedHeader, token string, isProduction bool) bool {
	if !isProduction {
		// Dev mode: allow loopback
		clientIp := EffectiveClientIp(socketIp, forwardedHeader)
		return IsLoopback(clientIp)
	}

	// Production: require token
	if token == "" {
		return false
	}
	return true
}
