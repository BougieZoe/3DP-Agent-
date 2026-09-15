package memory

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

type MemoryStore struct {
	db     *sql.DB
	mu     sync.RWMutex
	dbPath string
}

type GenerationRecord struct {
	ID            string    `json:"id"`
	Prompt        string    `json:"prompt"`
	Source        string    `json:"source,omitempty"`
	Status        string    `json:"status"`
	STLPath       string    `json:"stlPath,omitempty"`
	STEPPath      string    `json:"stepPath,omitempty"`
	MechanismJSON string    `json:"mechanismJson,omitempty"`
	DurationMs    int64     `json:"durationMs"`
	CreatedAt     time.Time `json:"createdAt"`
}

type SliceRecord struct {
	ID            string    `json:"id"`
	GenerationID  string    `json:"generationId,omitempty"`
	GcodePath     string    `json:"gcodePath,omitempty"`
	LayerCount    int       `json:"layerCount"`
	FilamentMm    float64   `json:"filamentMm"`
	PrintTimeSec  int       `json:"printTimeSec"`
	CreatedAt     time.Time `json:"createdAt"`
}

type MeshRecord struct {
	ID            string    `json:"id"`
	GenerationID  string    `json:"generationId,omitempty"`
	TriangleCount int       `json:"triangleCount"`
	VolumeMm3     float64   `json:"volumeMm3"`
	SurfaceMm2    float64   `json:"surfaceMm2"`
	IsWatertight  bool      `json:"isWatertight"`
	CreatedAt     time.Time `json:"createdAt"`
}

type MetricsSummary struct {
	TotalGenerations int     `json:"totalGenerations"`
	TotalSlices      int     `json:"totalSlices"`
	TotalMeshes      int     `json:"totalMeshes"`
	AvgDurationMs    float64 `json:"avgDurationMs"`
	SuccessRate      float64 `json:"successRate"`
}

func NewMemoryStore(cadBridgeDir string) (*MemoryStore, error) {
	dbPath := filepath.Join(cadBridgeDir, "memory.db")

	db, err := sql.Open("sqlite", dbPath+"?_journal_mode=WAL&_busy_timeout=5000")
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	store := &MemoryStore{
		db:     db,
		dbPath: dbPath,
	}

	if err := store.migrate(); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to migrate database: %w", err)
	}

	log.Printf("[memory] Database opened at %s", dbPath)
	return store, nil
}

func (s *MemoryStore) migrate() error {
	queries := []string{
		`CREATE TABLE IF NOT EXISTS generations (
			id TEXT PRIMARY KEY,
			prompt TEXT NOT NULL,
			source TEXT,
			status TEXT NOT NULL DEFAULT 'pending',
			stl_path TEXT,
			step_path TEXT,
			mechanism_json TEXT,
			duration_ms INTEGER DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS slices (
			id TEXT PRIMARY KEY,
			generation_id TEXT,
			gcode_path TEXT,
			layer_count INTEGER DEFAULT 0,
			filament_mm REAL DEFAULT 0,
			print_time_sec INTEGER DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (generation_id) REFERENCES generations(id)
		)`,
		`CREATE TABLE IF NOT EXISTS meshes (
			id TEXT PRIMARY KEY,
			generation_id TEXT,
			triangle_count INTEGER DEFAULT 0,
			volume_mm3 REAL DEFAULT 0,
			surface_mm2 REAL DEFAULT 0,
			is_watertight BOOLEAN DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (generation_id) REFERENCES generations(id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_generations_created ON generations(created_at)`,
		`CREATE INDEX IF NOT EXISTS idx_slices_created ON slices(created_at)`,
		`CREATE INDEX IF NOT EXISTS idx_meshes_created ON meshes(created_at)`,
	}

	for _, q := range queries {
		if _, err := s.db.Exec(q); err != nil {
			return fmt.Errorf("migration failed: %w", err)
		}
	}
	return nil
}

func (s *MemoryStore) SaveGeneration(g *GenerationRecord) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, err := s.db.Exec(`
		INSERT OR REPLACE INTO generations (id, prompt, source, status, stl_path, step_path, mechanism_json, duration_ms, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		g.ID, g.Prompt, g.Source, g.Status, g.STLPath, g.STEPPath, g.MechanismJSON, g.DurationMs, g.CreatedAt,
	)
	return err
}

func (s *MemoryStore) GetGeneration(id string) (*GenerationRecord, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	g := &GenerationRecord{}
	err := s.db.QueryRow(`
		SELECT id, prompt, source, status, stl_path, step_path, mechanism_json, duration_ms, created_at
		FROM generations WHERE id = ?`, id).Scan(
		&g.ID, &g.Prompt, &g.Source, &g.Status, &g.STLPath, &g.STEPPath, &g.MechanismJSON, &g.DurationMs, &g.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return g, nil
}

func (s *MemoryStore) ListGenerations(limit, offset int) ([]GenerationRecord, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	rows, err := s.db.Query(`
		SELECT id, prompt, source, status, stl_path, step_path, mechanism_json, duration_ms, created_at
		FROM generations ORDER BY created_at DESC LIMIT ? OFFSET ?`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var records []GenerationRecord
	for rows.Next() {
		var g GenerationRecord
		if err := rows.Scan(&g.ID, &g.Prompt, &g.Source, &g.Status, &g.STLPath, &g.STEPPath, &g.MechanismJSON, &g.DurationMs, &g.CreatedAt); err != nil {
			return nil, err
		}
		records = append(records, g)
	}
	return records, nil
}

func (s *MemoryStore) SaveSlice(sl *SliceRecord) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, err := s.db.Exec(`
		INSERT OR REPLACE INTO slices (id, generation_id, gcode_path, layer_count, filament_mm, print_time_sec, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		sl.ID, sl.GenerationID, sl.GcodePath, sl.LayerCount, sl.FilamentMm, sl.PrintTimeSec, sl.CreatedAt,
	)
	return err
}

func (s *MemoryStore) SaveMesh(m *MeshRecord) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, err := s.db.Exec(`
		INSERT OR REPLACE INTO meshes (id, generation_id, triangle_count, volume_mm3, surface_mm2, is_watertight, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		m.ID, m.GenerationID, m.TriangleCount, m.VolumeMm3, m.SurfaceMm2, m.IsWatertight, m.CreatedAt,
	)
	return err
}

func (s *MemoryStore) GetMetrics() (*MetricsSummary, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	m := &MetricsSummary{}

	s.db.QueryRow(`SELECT COUNT(*) FROM generations`).Scan(&m.TotalGenerations)
	s.db.QueryRow(`SELECT COUNT(*) FROM slices`).Scan(&m.TotalSlices)
	s.db.QueryRow(`SELECT COUNT(*) FROM meshes`).Scan(&m.TotalMeshes)
	s.db.QueryRow(`SELECT COALESCE(AVG(duration_ms), 0) FROM generations WHERE status = 'ok'`).Scan(&m.AvgDurationMs)

	if m.TotalGenerations > 0 {
		var successCount int
		s.db.QueryRow(`SELECT COUNT(*) FROM generations WHERE status = 'ok'`).Scan(&successCount)
		m.SuccessRate = float64(successCount) / float64(m.TotalGenerations) * 100
	}

	return m, nil
}

func (s *MemoryStore) DeleteGeneration(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, err := s.db.Exec(`DELETE FROM generations WHERE id = ?`, id)
	return err
}

func (s *MemoryStore) Close() error {
	return s.db.Close()
}

func (s *MemoryStore) CleanupOldRecords(days int) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	cutoff := time.Now().AddDate(0, 0, -days)

	result, err := s.db.Exec(`DELETE FROM generations WHERE created_at < ?`, cutoff)
	if err != nil {
		return 0, err
	}

	deleted, _ := result.RowsAffected()
	log.Printf("[memory] Cleaned up %d records older than %d days", deleted, days)
	return deleted, nil
}

func (s *MemoryStore) GetDatabasePath() string {
	return s.dbPath
}

func (s *MemoryStore) GetDatabaseSize() int64 {
	info, err := os.Stat(s.dbPath)
	if err != nil {
		return 0
	}
	return info.Size()
}
