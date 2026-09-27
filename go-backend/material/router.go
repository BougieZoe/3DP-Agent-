package material

import (
	"encoding/json"
	"math"
	"net/http"
	"sort"
	"strings"
)

// Material represents a 3D printing material with all properties
type Material struct {
	Name            string  `json:"name"`
	Technology      string  `json:"technology"`
	Category        string  `json:"category"`
	Description     string  `json:"description"`
	UseCase         string  `json:"useCase"`
	DensityGPerCm3  float64 `json:"densityGPerCm3"`
	PricePerKgUsd   float64 `json:"pricePerKgUsd"`
	
	// Thermal properties
	GlassTransitionTempC     *float64 `json:"glassTransitionTempC,omitempty"`
	ThermalConductivityWPerMK *float64 `json:"thermalConductivityWPerMK,omitempty"`
	SpecificHeatJPerGK       *float64 `json:"specificHeatJPerGK,omitempty"`
	PrintTempCMin            *float64 `json:"printTempCMin,omitempty"`
	PrintTempCMax            *float64 `json:"printTempCMax,omitempty"`
	BedTempC                 *float64 `json:"bedTempC,omitempty"`
	ShrinkagePercent         *float64 `json:"shrinkagePercent,omitempty"`
	ThermalExpansionCoeff    *float64 `json:"thermalExpansionCoeff,omitempty"`
	MeltingPointC            *float64 `json:"meltingPointC,omitempty"`
	ThermalDiffusivityMm2PerS *float64 `json:"thermalDiffusivityMm2PerS,omitempty"`
	Emisivity                *float64 `json:"emisivity,omitempty"`
	OverhangThreshold        *float64 `json:"overhangThreshold,omitempty"`
	
	// Mechanical properties
	TensileStrengthMPa   *float64 `json:"tensileStrengthMPa,omitempty"`
	FlexuralModulusGPa   *float64 `json:"flexuralModulusGPa,omitempty"`
	ElasticModulusGPa    *float64 `json:"elasticModulusGPa,omitempty"`
	PoissonRatio         *float64 `json:"poissonRatio,omitempty"`
	Hardness             *string  `json:"hardness,omitempty"`
	
	// Environment
	EnclosureRequired    *bool    `json:"enclosureRequired,omitempty"`
	DraftShieldRequired  *bool    `json:"draftShieldRequired,omitempty"`
	ChamberTempC         *float64 `json:"chamberTempC,omitempty"`
	
	// Eco properties
	MoistureRisk         *float64 `json:"moistureRisk,omitempty"`
	DegradationRisk      *float64 `json:"degradationRisk,omitempty"`
	BrittlenessRisk      *float64 `json:"brittlenessRisk,omitempty"`
}

// RecommendationRequest represents a material recommendation request
type RecommendationRequest struct {
	Technology   string   `json:"technology"`
	MaxBudgetPerKg *float64 `json:"maxBudgetPerKg,omitempty"`
	Application  []string `json:"application,omitempty"`
	TopN         int      `json:"topN,omitempty"`
}

// MaterialRecommendation represents a recommended material
type MaterialRecommendation struct {
	Material     *Material `json:"material"`
	Score        float64   `json:"score"`
	Reasons      []string  `json:"reasons"`
	Warnings     []string  `json:"warnings"`
	Alternatives []*Material `json:"alternatives"`
}

// RecommendationResponse represents the recommendation response
type RecommendationResponse struct {
	Recommendations []MaterialRecommendation `json:"recommendations"`
	Filters         struct {
		Technology      string   `json:"technology"`
		ExcludedCount   int      `json:"excludedCount"`
		ExcludedReasons []string `json:"excludedReasons"`
	} `json:"filters"`
}

// MaterialRegistry is the main material database
var MaterialRegistry = map[string]*Material{
	// ── FDM — filaments ───────────────────────────────────────────────────────
	"PLA": {
		Name: "PLA", Technology: "fdm", Category: "Thermoplastic filament",
		Description: "Polylactic acid — a plant-based thermoplastic that melts at ~180-220°C. The easiest filament to print.",
		UseCase: "Prototypes, decorative parts, enclosures, lithophanes",
		DensityGPerCm3: 1.24, PricePerKgUsd: 22,
		GlassTransitionTempC: ptr(60), ThermalConductivityWPerMK: ptr(0.13),
		SpecificHeatJPerGK: ptr(1.8), PrintTempCMin: ptr(180), PrintTempCMax: ptr(220),
		BedTempC: ptr(50), ShrinkagePercent: ptr(0.3), ThermalExpansionCoeff: ptr(7e-5),
		ThermalDiffusivityMm2PerS: ptr(0.12), Emisivity: ptr(0.92), MeltingPointC: ptr(180),
		TensileStrengthMPa: ptr(50), FlexuralModulusGPa: ptr(3.5), ElasticModulusGPa: ptr(3.5),
		PoissonRatio: ptr(0.36), Hardness: strPtr("Rockwell R80"),
		EnclosureRequired: boolPtr(false), DraftShieldRequired: boolPtr(false),
	},
	"PETG": {
		Name: "PETG", Technology: "fdm", Category: "Thermoplastic filament",
		Description: "Polyethylene terephthalate glycol — tough, water- and chemical-resistant with strong layer adhesion.",
		UseCase: "Functional parts, containers, parts that flex slightly",
		DensityGPerCm3: 1.27, PricePerKgUsd: 25,
		GlassTransitionTempC: ptr(80), ThermalConductivityWPerMK: ptr(0.24),
		SpecificHeatJPerGK: ptr(1.4), PrintTempCMin: ptr(230), PrintTempCMax: ptr(250),
		BedTempC: ptr(70), ShrinkagePercent: ptr(0.4), ThermalExpansionCoeff: ptr(6e-5),
		ThermalDiffusivityMm2PerS: ptr(0.17), Emisivity: ptr(0.90), MeltingPointC: ptr(250),
		TensileStrengthMPa: ptr(53), FlexuralModulusGPa: ptr(2.1), ElasticModulusGPa: ptr(2.1),
		PoissonRatio: ptr(0.38), Hardness: strPtr("Rockwell R100"),
		EnclosureRequired: boolPtr(false), DraftShieldRequired: boolPtr(false),
	},
	"ABS": {
		Name: "ABS", Technology: "fdm", Category: "Thermoplastic filament",
		Description: "Acrylonitrile butadiene styrene — strong, impact- and heat-resistant thermoplastic (~105°C glass transition).",
		UseCase: "Mechanical parts, automotive, electronics housings",
		DensityGPerCm3: 1.04, PricePerKgUsd: 28,
		GlassTransitionTempC: ptr(105), ThermalConductivityWPerMK: ptr(0.17),
		SpecificHeatJPerGK: ptr(1.4), PrintTempCMin: ptr(230), PrintTempCMax: ptr(260),
		BedTempC: ptr(100), ShrinkagePercent: ptr(0.8), ThermalExpansionCoeff: ptr(7e-5),
		ThermalDiffusivityMm2PerS: ptr(0.12), Emisivity: ptr(0.90), MeltingPointC: ptr(230),
		TensileStrengthMPa: ptr(44), FlexuralModulusGPa: ptr(2.3), ElasticModulusGPa: ptr(2.3),
		PoissonRatio: ptr(0.40), Hardness: strPtr("Rockwell R105"),
		EnclosureRequired: boolPtr(true), DraftShieldRequired: boolPtr(true), ChamberTempC: ptr(50),
	},
	"TPU": {
		Name: "TPU", Technology: "fdm", Category: "Thermoplastic elastomer filament",
		Description: "Thermoplastic polyurethane — rubber-like elastomer that bends, stretches and absorbs shocks.",
		UseCase: "Gaskets, phone cases, shock absorbers, flexible hinges",
		DensityGPerCm3: 1.21, PricePerKgUsd: 45,
		GlassTransitionTempC: ptr(-40), ThermalConductivityWPerMK: ptr(0.25),
		SpecificHeatJPerGK: ptr(1.5), PrintTempCMin: ptr(210), PrintTempCMax: ptr(240),
		BedTempC: ptr(50), ShrinkagePercent: ptr(0.2), ThermalExpansionCoeff: ptr(8e-5),
		ThermalDiffusivityMm2PerS: ptr(0.17), Emisivity: ptr(0.90),
		TensileStrengthMPa: ptr(35), FlexuralModulusGPa: ptr(0.06), ElasticModulusGPa: ptr(0.06),
		PoissonRatio: ptr(0.45), Hardness: strPtr("Shore 85A"),
		EnclosureRequired: boolPtr(false), DraftShieldRequired: boolPtr(false),
	},
	"ASA": {
		Name: "ASA", Technology: "fdm", Category: "Thermoplastic filament",
		Description: "Acrylonitrile styrene acrylate — ABS-class strength with UV-resistant surface layer.",
		UseCase: "Outdoor parts, automotive exterior, marine hardware",
		DensityGPerCm3: 1.07, PricePerKgUsd: 30,
		GlassTransitionTempC: ptr(105), ThermalConductivityWPerMK: ptr(0.17),
		SpecificHeatJPerGK: ptr(1.4), PrintTempCMin: ptr(235), PrintTempCMax: ptr(260),
		BedTempC: ptr(100), ShrinkagePercent: ptr(0.7), ThermalExpansionCoeff: ptr(7e-5),
		ThermalDiffusivityMm2PerS: ptr(0.12), Emisivity: ptr(0.90),
		TensileStrengthMPa: ptr(44), FlexuralModulusGPa: ptr(2.3), ElasticModulusGPa: ptr(2.3),
		PoissonRatio: ptr(0.40), Hardness: strPtr("Rockwell R105"),
		EnclosureRequired: boolPtr(true), DraftShieldRequired: boolPtr(true), ChamberTempC: ptr(50),
	},
	"NYLON": {
		Name: "Nylon", Technology: "fdm", Category: "Engineering thermoplastic filament",
		Description: "Polyamide — tough, wear-resistant, low-friction engineering thermoplastic with excellent layer adhesion.",
		UseCase: "Gears, bearings, hinges, wear parts",
		DensityGPerCm3: 1.14, PricePerKgUsd: 45,
		GlassTransitionTempC: ptr(50), ThermalConductivityWPerMK: ptr(0.25),
		SpecificHeatJPerGK: ptr(1.7), PrintTempCMin: ptr(240), PrintTempCMax: ptr(270),
		BedTempC: ptr(70), ShrinkagePercent: ptr(1.5), ThermalExpansionCoeff: ptr(8e-5),
		ThermalDiffusivityMm2PerS: ptr(0.14), Emisivity: ptr(0.90), MeltingPointC: ptr(260),
		TensileStrengthMPa: ptr(85), FlexuralModulusGPa: ptr(2.8), ElasticModulusGPa: ptr(2.8),
		PoissonRatio: ptr(0.40), Hardness: strPtr("Rockwell R120"),
		EnclosureRequired: boolPtr(true), DraftShieldRequired: boolPtr(true), ChamberTempC: ptr(40),
	},
	"PC": {
		Name: "PC", Technology: "fdm", Category: "Engineering thermoplastic filament",
		Description: "Polycarbonate — amorphous engineering plastic with exceptional strength, impact resistance and heat tolerance.",
		UseCase: "Structural and load-bearing parts, high-temperature service",
		DensityGPerCm3: 1.20, PricePerKgUsd: 40,
		GlassTransitionTempC: ptr(147), ThermalConductivityWPerMK: ptr(0.20),
		SpecificHeatJPerGK: ptr(1.3), PrintTempCMin: ptr(280), PrintTempCMax: ptr(310),
		BedTempC: ptr(110), ShrinkagePercent: ptr(1.0), ThermalExpansionCoeff: ptr(6.5e-5),
		ThermalDiffusivityMm2PerS: ptr(0.14), Emisivity: ptr(0.90), MeltingPointC: ptr(267),
		TensileStrengthMPa: ptr(63), FlexuralModulusGPa: ptr(2.4), ElasticModulusGPa: ptr(2.4),
		PoissonRatio: ptr(0.37), Hardness: strPtr("Rockwell R118"),
		EnclosureRequired: boolPtr(true), DraftShieldRequired: boolPtr(true), ChamberTempC: ptr(70),
	},
	"PEEK": {
		Name: "PEEK", Technology: "fdm", Category: "High-performance thermoplastic",
		Description: "Polyether ether ketone — semi-crystalline thermoplastic with exceptional mechanical and chemical resistance at high temperatures.",
		UseCase: "Aerospace, medical implants, oil & gas, semiconductor",
		DensityGPerCm3: 1.30, PricePerKgUsd: 400,
		GlassTransitionTempC: ptr(143), ThermalConductivityWPerMK: ptr(0.25),
		SpecificHeatJPerGK: ptr(1.3), PrintTempCMin: ptr(360), PrintTempCMax: ptr(420),
		BedTempC: ptr(160), ShrinkagePercent: ptr(1.0), ThermalExpansionCoeff: ptr(4.7e-5),
		MeltingPointC: ptr(343),
		TensileStrengthMPa: ptr(100), FlexuralModulusGPa: ptr(4.1), ElasticModulusGPa: ptr(4.1),
		PoissonRatio: ptr(0.40),
		EnclosureRequired: boolPtr(true), DraftShieldRequired: boolPtr(true), ChamberTempC: ptr(120),
	},
	// ── SLA resins ───────────────────────────────────────────────────────────
	"RESIN_STD": {
		Name: "Standard Resin", Technology: "sla", Category: "UV-cured liquid photopolymer",
		Description: "The base SLA/DLP resin — liquid photopolymer that UV light cures layer by layer.",
		UseCase: "Miniatures, jewelry, dental-adjacent display models",
		DensityGPerCm3: 1.15, PricePerKgUsd: 60,
		TensileStrengthMPa: ptr(50), FlexuralModulusGPa: ptr(2.5), ElasticModulusGPa: ptr(2.5),
		PoissonRatio: ptr(0.35), Hardness: strPtr("Shore D80"),
	},
	"RESIN_TOUGH": {
		Name: "Tough Resin", Technology: "sla", Category: "UV-cured liquid photopolymer",
		Description: "Photopolymer blended with impact modifiers — higher toughness and less cracking.",
		UseCase: "Functional prototypes, snap-fit parts, consumer products",
		DensityGPerCm3: 1.17, PricePerKgUsd: 90,
		TensileStrengthMPa: ptr(55), FlexuralModulusGPa: ptr(2.3), ElasticModulusGPa: ptr(2.3),
		PoissonRatio: ptr(0.35), Hardness: strPtr("Shore D78"),
	},
	// ── SLS powders ──────────────────────────────────────────────────────────
	"PA12": {
		Name: "PA12 (Nylon 12)", Technology: "sls", Category: "Polymer powder (PBF)",
		Description: "Nylon 12 powder fused by laser — tough, fatigue-resistant, chemically stable.",
		UseCase: "Functional parts, snap-fit, batch production",
		DensityGPerCm3: 1.01, PricePerKgUsd: 45,
		MeltingPointC: ptr(178),
		TensileStrengthMPa: ptr(50), FlexuralModulusGPa: ptr(1.8), ElasticModulusGPa: ptr(1.8),
		PoissonRatio: ptr(0.40), Hardness: strPtr("Rockwell R110"),
	},
	// ── SLM metals ───────────────────────────────────────────────────────────
	"STEEL_316L": {
		Name: "316L Stainless", Technology: "slm", Category: "Metal powder (PBF)",
		Description: "316L stainless steel powder melted by laser — corrosion-resistant and weldable.",
		UseCase: "Industrial, tooling, corrosion-resistant parts",
		DensityGPerCm3: 7.98, PricePerKgUsd: 50,
		MeltingPointC: ptr(1375), ThermalConductivityWPerMK: ptr(16.3),
		SpecificHeatJPerGK: ptr(0.50), ThermalDiffusivityMm2PerS: ptr(4.1), Emisivity: ptr(0.35),
		TensileStrengthMPa: ptr(570), ElasticModulusGPa: ptr(193),
		PoissonRatio: ptr(0.27), Hardness: strPtr("Rockwell C20"),
	},
	"TI64": {
		Name: "Ti-6Al-4V", Technology: "slm", Category: "Metal powder (PBF)",
		Description: "Ti-6Al-4V titanium alloy powder — aerospace-grade strength-to-weight and biocompatible.",
		UseCase: "Aerospace, medical implants, high-performance",
		DensityGPerCm3: 4.43, PricePerKgUsd: 320,
		MeltingPointC: ptr(1660), ThermalConductivityWPerMK: ptr(6.7),
		SpecificHeatJPerGK: ptr(0.526), ThermalDiffusivityMm2PerS: ptr(2.9), Emisivity: ptr(0.30),
		TensileStrengthMPa: ptr(1100), ElasticModulusGPa: ptr(114),
		PoissonRatio: ptr(0.34), Hardness: strPtr("Rockwell C36"),
	},
	"ALSI10MG": {
		Name: "AlSi10Mg", Technology: "slm", Category: "Metal powder (PBF)",
		Description: "AlSi10Mg aluminum alloy powder — lightweight with good thermal conductivity.",
		UseCase: "Automotive, heat sinks, lightweight structures",
		DensityGPerCm3: 2.67, PricePerKgUsd: 40,
		MeltingPointC: ptr(575), ThermalConductivityWPerMK: ptr(112),
		SpecificHeatJPerGK: ptr(0.89), ThermalDiffusivityMm2PerS: ptr(47), Emisivity: ptr(0.30),
		TensileStrengthMPa: ptr(350), ElasticModulusGPa: ptr(70),
		PoissonRatio: ptr(0.33), Hardness: strPtr("Rockwell C40"),
	},
	"INCONEL718": {
		Name: "Inconel 718", Technology: "slm", Category: "Superalloy powder (PBF)",
		Description: "Inconel 718 nickel-chromium superalloy — excellent strength and corrosion resistance at high temperatures.",
		UseCase: "Aerospace, gas turbines, high-temperature engine components",
		DensityGPerCm3: 8.19, PricePerKgUsd: 120,
		MeltingPointC: ptr(1335), GlassTransitionTempC: ptr(720),
		ThermalConductivityWPerMK: ptr(11.4), SpecificHeatJPerGK: ptr(0.435),
		TensileStrengthMPa: ptr(1035), ElasticModulusGPa: ptr(205),
		PoissonRatio: ptr(0.30),
	},
	"COPPER": {
		Name: "Copper (C18400)", Technology: "slm", Category: "Metal powder (PBF)",
		Description: "Copper alloy powder — excellent thermal and electrical conductivity.",
		UseCase: "Heat exchangers, electrical contacts, thermal management",
		DensityGPerCm3: 8.96, PricePerKgUsd: 80,
		MeltingPointC: ptr(1085), ThermalConductivityWPerMK: ptr(398),
		SpecificHeatJPerGK: ptr(0.385),
		TensileStrengthMPa: ptr(310), ElasticModulusGPa: ptr(130),
		PoissonRatio: ptr(0.34),
	},
}

// Helper functions
func ptr(f float64) *float64 { return &f }
func strPtr(s string) *string { return &s }
func boolPtr(b bool) *bool { return &b }

// Handler returns an http.Handler for the material API
func Handler() http.Handler {
	mux := http.NewServeMux()
	
	// GET /api/materials - List all materials
	mux.HandleFunc("/api/materials", handleListMaterials)
	
	// GET /api/materials/{name} - Get material by name
	mux.HandleFunc("/api/materials/", handleGetMaterial)
	
	// POST /api/materials/recommend - Get material recommendations
	mux.HandleFunc("/api/materials/recommend", handleRecommend)
	
	return mux
}

func handleRecommend(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	
	var req RecommendationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	
	// Default top N
	topN := req.TopN
	if topN <= 0 {
		topN = 3
	}
	
	// Get candidates
	var candidates []*Material
	for _, m := range MaterialRegistry {
		// Filter by technology
		if req.Technology != "" && !strings.EqualFold(m.Technology, req.Technology) {
			continue
		}
		
		// Filter by budget
		if req.MaxBudgetPerKg != nil && m.PricePerKgUsd > *req.MaxBudgetPerKg {
			continue
		}
		
		candidates = append(candidates, m)
	}
	
	// Score each candidate
	type scored struct {
		material *Material
		score    float64
		reasons  []string
		warnings []string
	}
	
	var scoredList []scored
	for _, m := range candidates {
		score := 50.0 // Base score
		reasons := []string{}
		warnings := []string{}
		
		// Cost efficiency (0-20 points)
		costScore := math.Max(0, 20-(m.PricePerKgUsd/25))
		score += costScore
		if m.PricePerKgUsd < 30 {
			reasons = append(reasons, "Cost-effective")
		}
		
		// Shrinkage factor (-10 to +5)
		if m.ShrinkagePercent != nil {
			if *m.ShrinkagePercent > 1.0 {
				score -= 10
				warnings = append(warnings, "High shrinkage risk")
			} else if *m.ShrinkagePercent < 0.3 {
				score += 5
				reasons = append(reasons, "Low shrinkage")
			}
		}
		
		// Enclosure requirement (-5)
		if m.EnclosureRequired != nil && *m.EnclosureRequired {
			score -= 5
			warnings = append(warnings, "Requires enclosure")
		}
		
		// Moisture risk (-5)
		if m.MoistureRisk != nil && *m.MoistureRisk > 0.5 {
			score -= 5
			warnings = append(warnings, "Hygroscopic - dry before printing")
		}
		
		// Tensile strength bonus (+10 for strong materials)
		if m.TensileStrengthMPa != nil && *m.TensileStrengthMPa > 50 {
			score += 10
			reasons = append(reasons, "High strength")
		}
		
		// Application matching
		if len(req.Application) > 0 {
			applicationText := strings.ToLower(m.UseCase + " " + m.Description + " " + m.Category)
			matchCount := 0
			for _, app := range req.Application {
				if strings.Contains(applicationText, strings.ToLower(app)) {
					matchCount++
				}
			}
			if matchCount > 0 {
				score += float64(matchCount) * 5
				reasons = append(reasons, "Matches application requirements")
			}
		}
		
		// Clamp score
		score = math.Max(0, math.Min(100, score))
		
		scoredList = append(scoredList, scored{
			material: m,
			score:    score,
			reasons:  reasons,
			warnings: warnings,
		})
	}
	
	// Sort by score
	sort.Slice(scoredList, func(i, j int) bool {
		return scoredList[i].score > scoredList[j].score
	})
	
	// Take top N
	var recommendations []MaterialRecommendation
	for i := 0; i < topN && i < len(scoredList); i++ {
		s := scoredList[i]
		rec := MaterialRecommendation{
			Material: s.material,
			Score:    s.score,
			Reasons:  s.reasons,
			Warnings: s.warnings,
			Alternatives: []*Material{},
		}
		
		// Add alternatives
		for j := i + 1; j < len(scoredList) && len(rec.Alternatives) < 2; j++ {
			rec.Alternatives = append(rec.Alternatives, scoredList[j].material)
		}
		
		recommendations = append(recommendations, rec)
	}
	
	// Build response
	resp := RecommendationResponse{
		Recommendations: recommendations,
	}
	resp.Filters.Technology = req.Technology
	resp.Filters.ExcludedCount = len(candidates) - len(recommendations)
	if req.Technology != "" {
		resp.Filters.ExcludedReasons = append(resp.Filters.ExcludedReasons, "Technology: "+req.Technology)
	}
	if req.MaxBudgetPerKg != nil {
		resp.Filters.ExcludedReasons = append(resp.Filters.ExcludedReasons, "Budget: $"+formatFloat(*req.MaxBudgetPerKg)+"/kg")
	}
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func formatFloat(f float64) string {
	return strings.TrimRight(strings.TrimRight(
		strings.Replace(string(rune(int(f))), ".", ".", 1), 
		"0", 
	), ".")
}

func handleListMaterials(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/materials" {
		http.NotFound(w, r)
		return
	}
	
	// Optional filter by technology
	tech := r.URL.Query().Get("technology")
	
	var materials []*Material
	for _, m := range MaterialRegistry {
		if tech != "" && !strings.EqualFold(m.Technology, tech) {
			continue
		}
		materials = append(materials, m)
	}
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(materials)
}

func handleGetMaterial(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, "/api/materials/")
	if name == "" {
		http.NotFound(w, r)
		return
	}
	
	// Case-insensitive lookup
	name = strings.ToUpper(name)
	material, ok := MaterialRegistry[name]
	if !ok {
		http.NotFound(w, r)
		return
	}
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(material)
}
