package config

import (
	"os"
	"strconv"
)

type Config struct {
	Port         int
	BridgeToken  string
	SlicerPaths  string
	PythonPath   string
	CadBridgeDir string
	NodeEnv      string
	IsElectron   bool
}

func Load() *Config {
	cfg := &Config{
		Port:         getEnvInt("PORT", 8080),
		BridgeToken:  os.Getenv("BRIDGE_TOKEN"),
		SlicerPaths:  os.Getenv("SLICER_PATHS"),
		PythonPath:   getEnvStr("PYTHON_PATH", "python3"),
		CadBridgeDir: getEnvStr("CAD_BRIDGE_DIR", ".cad-bridge"),
		NodeEnv:      getEnvStr("NODE_ENV", "development"),
		IsElectron:   os.Getenv("IS_ELECTRON") == "true",
	}
	return cfg
}

func (c *Config) IsProduction() bool {
	return c.NodeEnv == "production"
}

func getEnvStr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}
