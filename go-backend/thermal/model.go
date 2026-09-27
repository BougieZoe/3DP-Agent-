package thermal

import (
	"math"
)

type Material struct {
	Name            string  `json:"name"`
	MeltingPointC   float64 `json:"meltingPointC"`
	GlassTransC     float64 `json:"glassTransC"`
	ThermalCond     float64 `json:"thermalCond"`     // W/(m·K)
	SpecificHeat    float64 `json:"specificHeat"`    // J/(kg·K)
	Density         float64 `json:"density"`         // kg/m³
	MaxBedTempC     float64 `json:"maxBedTempC"`
	RecommendedSpeed float64 `json:"recommendedSpeed"` // mm/s
}

type PrintParams struct {
	LayerHeightMm   float64 `json:"layerHeightMm"`
	NozzleTempC     float64 `json:"nozzleTempC"`
	BedTempC        float64 `json:"bedTempC"`
	PrintSpeedMmS   float64 `json:"printSpeedMmS"`
	FanSpeedPct     float64 `json:"fanSpeedPct"`
	AmbientTempC    float64 `json:"ambientTempC"`
}

type ThermalPoint struct {
	X       float64 `json:"x"`
	Y       float64 `json:"y"`
	Z       float64 `json:"z"`
	TempC   float64 `json:"tempC"`
	Risk    string  `json:"risk"` // "low", "medium", "high", "critical"
}

type ThermalResult struct {
	Points         []ThermalPoint `json:"points"`
	MaxTempC       float64        `json:"maxTempC"`
	MinTempC       float64        `json:"minTempC"`
	AvgTempC       float64        `json:"avgTempC"`
	RiskZones      int            `json:"riskZones"`
	CoolingTimeSec float64        `json:"coolingTimeSec"`
	Material       string         `json:"material"`
}

var Materials = map[string]*Material{
	// ── FDM — filaments ───────────────────────────────────────────────────────
	"PLA": {
		Name:            "PLA",
		MeltingPointC:   180,
		GlassTransC:     60,
		ThermalCond:     0.13,
		SpecificHeat:    1800,
		Density:         1240,
		MaxBedTempC:     60,
		RecommendedSpeed: 60,
	},
	"PETG": {
		Name:            "PETG",
		MeltingPointC:   250,
		GlassTransC:     80,
		ThermalCond:     0.24,
		SpecificHeat:    1400,
		Density:         1270,
		MaxBedTempC:     80,
		RecommendedSpeed: 50,
	},
	"ABS": {
		Name:            "ABS",
		MeltingPointC:   230,
		GlassTransC:     105,
		ThermalCond:     0.17,
		SpecificHeat:    1400,
		Density:         1040,
		MaxBedTempC:     110,
		RecommendedSpeed: 50,
	},
	"TPU": {
		Name:            "TPU",
		MeltingPointC:   220,
		GlassTransC:     -40, // Corrected: TPU is an elastomer with Tg well below room temperature
		ThermalCond:     0.25,
		SpecificHeat:    1500,
		Density:         1210,
		MaxBedTempC:     60,
		RecommendedSpeed: 30,
	},
	"ASA": {
		Name:            "ASA",
		MeltingPointC:   245,
		GlassTransC:     105,
		ThermalCond:     0.17,
		SpecificHeat:    1400,
		Density:         1070,
		MaxBedTempC:     110,
		RecommendedSpeed: 50,
	},
	"NYLON": {
		Name:            "Nylon",
		MeltingPointC:   260,
		GlassTransC:     50,
		ThermalCond:     0.25,
		SpecificHeat:    1700,
		Density:         1140,
		MaxBedTempC:     80,
		RecommendedSpeed: 40,
	},
	"PC": {
		Name:            "PC",
		MeltingPointC:   267,
		GlassTransC:     147,
		ThermalCond:     0.20,
		SpecificHeat:    1300,
		Density:         1200,
		MaxBedTempC:     120,
		RecommendedSpeed: 35,
	},
	"PEEK": {
		Name:            "PEEK",
		MeltingPointC:   343,
		GlassTransC:     143,
		ThermalCond:     0.25,
		SpecificHeat:    1300,
		Density:         1300,
		MaxBedTempC:     160,
		RecommendedSpeed: 25,
	},
	// ── SLA resins ───────────────────────────────────────────────────────────
	"RESIN_STD": {
		Name:            "Standard Resin",
		MeltingPointC:   60,
		GlassTransC:     60,
		ThermalCond:     0.15,
		SpecificHeat:    1600,
		Density:         1150,
		MaxBedTempC:     25,
		RecommendedSpeed: 100,
	},
	"RESIN_TOUGH": {
		Name:            "Tough Resin",
		MeltingPointC:   60,
		GlassTransC:     60,
		ThermalCond:     0.15,
		SpecificHeat:    1600,
		Density:         1170,
		MaxBedTempC:     25,
		RecommendedSpeed: 100,
	},
	"RESIN_CLEAR": {
		Name:            "Clear Resin",
		MeltingPointC:   60,
		GlassTransC:     60,
		ThermalCond:     0.15,
		SpecificHeat:    1600,
		Density:         1140,
		MaxBedTempC:     25,
		RecommendedSpeed: 100,
	},
	"RESIN_ENG": {
		Name:            "Engineering Resin",
		MeltingPointC:   60,
		GlassTransC:     60,
		ThermalCond:     0.15,
		SpecificHeat:    1600,
		Density:         1180,
		MaxBedTempC:     25,
		RecommendedSpeed: 100,
	},
	"RESIN_DENTAL": {
		Name:            "Dental Resin",
		MeltingPointC:   60,
		GlassTransC:     60,
		ThermalCond:     0.15,
		SpecificHeat:    1600,
		Density:         1200,
		MaxBedTempC:     25,
		RecommendedSpeed: 100,
	},
	// ── SLS powders ──────────────────────────────────────────────────────────
	"PA12": {
		Name:            "PA12 (Nylon 12)",
		MeltingPointC:   178,
		GlassTransC:     175,
		ThermalCond:     0.25,
		SpecificHeat:    1400,
		Density:         1010,
		MaxBedTempC:     170,
		RecommendedSpeed: 150,
	},
	"PA11": {
		Name:            "PA11 (Nylon 11)",
		MeltingPointC:   185,
		GlassTransC:     175,
		ThermalCond:     0.25,
		SpecificHeat:    1400,
		Density:         1040,
		MaxBedTempC:     170,
		RecommendedSpeed: 150,
	},
	"TPU_POWDER": {
		Name:            "TPU Powder",
		MeltingPointC:   220,
		GlassTransC:     -40,
		ThermalCond:     0.25,
		SpecificHeat:    1500,
		Density:         1200,
		MaxBedTempC:     170,
		RecommendedSpeed: 150,
	},
	// ── SLM metals ───────────────────────────────────────────────────────────
	"STEEL_316L": {
		Name:            "316L Stainless",
		MeltingPointC:   1375,
		GlassTransC:     1375,
		ThermalCond:     16.3,
		SpecificHeat:    500,
		Density:         7980,
		MaxBedTempC:     200,
		RecommendedSpeed: 800,
	},
	"TI64": {
		Name:            "Ti-6Al-4V",
		MeltingPointC:   1660,
		GlassTransC:     1660,
		ThermalCond:     6.7,
		SpecificHeat:    526,
		Density:         4430,
		MaxBedTempC:     200,
		RecommendedSpeed: 600,
	},
	"ALSI10MG": {
		Name:            "AlSi10Mg",
		MeltingPointC:   575,
		GlassTransC:     575,
		ThermalCond:     112,
		SpecificHeat:    890,
		Density:         2670,
		MaxBedTempC:     200,
		RecommendedSpeed: 1000,
	},
	"INCONEL718": {
		Name:            "Inconel 718",
		MeltingPointC:   1335,
		GlassTransC:     720,
		ThermalCond:     11.4,
		SpecificHeat:    435,
		Density:         8190,
		MaxBedTempC:     200,
		RecommendedSpeed: 500,
	},
	"COPPER": {
		Name:            "Copper (C18400)",
		MeltingPointC:   1085,
		GlassTransC:     1085,
		ThermalCond:     398,
		SpecificHeat:    385,
		Density:         8960,
		MaxBedTempC:     200,
		RecommendedSpeed: 400,
	},
	// ── FGF pellets ──────────────────────────────────────────────────────────
	"ABS_PELLET": {
		Name:            "ABS Pellet",
		MeltingPointC:   230,
		GlassTransC:     105,
		ThermalCond:     0.17,
		SpecificHeat:    1400,
		Density:         1040,
		MaxBedTempC:     110,
		RecommendedSpeed: 50,
	},
	"PETG_PELLET": {
		Name:            "PETG Pellet",
		MeltingPointC:   250,
		GlassTransC:     80,
		ThermalCond:     0.24,
		SpecificHeat:    1400,
		Density:         1270,
		MaxBedTempC:     80,
		RecommendedSpeed: 50,
	},
	"PP_PELLET": {
		Name:            "PP Pellet",
		MeltingPointC:   165,
		GlassTransC:     0,
		ThermalCond:     0.22,
		SpecificHeat:    1900,
		Density:         910,
		MaxBedTempC:     100,
		RecommendedSpeed: 60,
	},
	// ── Concrete ─────────────────────────────────────────────────────────────
	"CONCRETE_STD": {
		Name:            "Standard Concrete Mix",
		MeltingPointC:   100,
		GlassTransC:     100,
		ThermalCond:     1.5,
		SpecificHeat:    800,
		Density:         2400,
		MaxBedTempC:     25,
		RecommendedSpeed: 200,
	},
	"CONCRETE_FIBER": {
		Name:            "Fiber-Reinforced Concrete",
		MeltingPointC:   100,
		GlassTransC:     100,
		ThermalCond:     1.5,
		SpecificHeat:    800,
		Density:         2400,
		MaxBedTempC:     25,
		RecommendedSpeed: 200,
	},
	"CONCRETE_HP": {
		Name:            "High-Performance Concrete",
		MeltingPointC:   100,
		GlassTransC:     100,
		ThermalCond:     1.5,
		SpecificHeat:    800,
		Density:         2400,
		MaxBedTempC:     25,
		RecommendedSpeed: 200,
	},
	// ── Eco materials ────────────────────────────────────────────────────────
	"ECO_RPLA": {
		Name:            "Recycled PLA",
		MeltingPointC:   180,
		GlassTransC:     60,
		ThermalCond:     0.13,
		SpecificHeat:    1800,
		Density:         1240,
		MaxBedTempC:     60,
		RecommendedSpeed: 60,
	},
	"ECO_BIOPLA": {
		Name:            "PLA+Bio Blend",
		MeltingPointC:   180,
		GlassTransC:     60,
		ThermalCond:     0.13,
		SpecificHeat:    1800,
		Density:         1230,
		MaxBedTempC:     60,
		RecommendedSpeed: 60,
	},
	"ECO_RPETG": {
		Name:            "Recycled PETG",
		MeltingPointC:   250,
		GlassTransC:     80,
		ThermalCond:     0.24,
		SpecificHeat:    1400,
		Density:         1270,
		MaxBedTempC:     80,
		RecommendedSpeed: 50,
	},
	"ECO_CELLULOSE_ACETATE": {
		Name:            "Cellulose Acetate (Bio)",
		MeltingPointC:   230,
		GlassTransC:     60,
		ThermalCond:     0.15,
		SpecificHeat:    1600,
		Density:         1300,
		MaxBedTempC:     80,
		RecommendedSpeed: 50,
	},
}

func NewThermalModel() *ThermalModel {
	return &ThermalModel{}
}

type ThermalModel struct{}

func (m *ThermalModel) CalculateThermalDistribution(
	material *Material,
	params *PrintParams,
	bboxMin [3]float64,
	bboxMax [3]float64,
	resolutionMm float64,
) *ThermalResult {
	if resolutionMm <= 0 {
		resolutionMm = 2.0
	}

	width := bboxMax[0] - bboxMin[0]
	depth := bboxMax[1] - bboxMin[1]
	height := bboxMax[2] - bboxMin[2]

	if width <= 0 || depth <= 0 || height <= 0 {
		return &ThermalResult{
			Points:    []ThermalPoint{},
			MaxTempC:  params.AmbientTempC,
			MinTempC:  params.AmbientTempC,
			AvgTempC:  params.AmbientTempC,
			Material:  material.Name,
		}
	}

	cols := int(math.Ceil(width/resolutionMm)) + 1
	rows := int(math.Ceil(depth/resolutionMm)) + 1
	layers := int(math.Ceil(height/resolutionMm)) + 1

	points := make([]ThermalPoint, 0, cols*rows*layers)
	totalTemp := 0.0
	maxTemp := params.AmbientTempC
	minTemp := params.NozzleTempC
	riskZones := 0

	for iz := 0; iz < layers; iz++ {
		z := bboxMin[2] + float64(iz)*resolutionMm
		layerFraction := z / height

		for iy := 0; iy < rows; iy++ {
			y := bboxMin[1] + float64(iy)*resolutionMm

			for ix := 0; ix < cols; ix++ {
				x := bboxMin[0] + float64(ix)*resolutionMm

				temp := m.calculatePointTemp(
					material, params,
					x, y, z,
					width, depth, height,
					layerFraction,
				)

				risk := "low"
				if temp > material.MeltingPointC*0.9 {
					risk = "critical"
					riskZones++
				} else if temp > material.GlassTransC {
					risk = "high"
					riskZones++
				} else if temp > material.GlassTransC*0.8 {
					risk = "medium"
					riskZones++
				}

				points = append(points, ThermalPoint{
					X:     x,
					Y:     y,
					Z:     z,
					TempC: temp,
					Risk:  risk,
				})

				totalTemp += temp
				if temp > maxTemp {
					maxTemp = temp
				}
				if temp < minTemp {
					minTemp = temp
				}
			}
		}
	}

	totalPoints := float64(len(points))
	avgTemp := params.AmbientTempC
	if totalPoints > 0 {
		avgTemp = totalTemp / totalPoints
	}

	coolingTime := m.estimateCoolingTime(material, params, height)

	return &ThermalResult{
		Points:         points,
		MaxTempC:       maxTemp,
		MinTempC:       minTemp,
		AvgTempC:       avgTemp,
		RiskZones:      riskZones,
		CoolingTimeSec: coolingTime,
		Material:       material.Name,
	}
}

func (m *ThermalModel) calculatePointTemp(
	material *Material,
	params *PrintParams,
	x, y, z, width, depth, height, layerFraction float64,
) float64 {
	centerDist := math.Sqrt(
		math.Pow((x-width/2)/(width/2), 2)+
			math.Pow((y-depth/2)/(depth/2), 2),
	) / math.Sqrt(2)

	edgeCooling := 1.0 - centerDist*0.3

	heightFactor := 1.0 - layerFraction*0.2

	fanCooling := 1.0 - (params.FanSpeedPct / 100.0 * 0.4)

	speedFactor := params.PrintSpeedMmS / material.RecommendedSpeed
	if speedFactor > 1.5 {
		speedFactor = 1.5
	}
	if speedFactor < 0.5 {
		speedFactor = 0.5
	}

	tempRange := params.NozzleTempC - params.AmbientTempC
	temp := params.AmbientTempC + tempRange*0.5*edgeCooling*heightFactor*fanCooling

	temp += (speedFactor - 1.0) * 20

	return math.Max(params.AmbientTempC, math.Min(params.NozzleTempC, temp))
}

func (m *ThermalModel) estimateCoolingTime(
	material *Material,
	params *PrintParams,
	heightMm float64,
) float64 {
	tempDiff := params.NozzleTempC - params.AmbientTempC
	coolingRate := material.ThermalCond / (material.SpecificHeat * material.Density) * 1000

	if coolingRate <= 0 {
		coolingRate = 0.01
	}

	timeSec := tempDiff / (coolingRate * 100)

	fanFactor := 1.0 - (params.FanSpeedPct / 100.0 * 0.5)
	timeSec *= fanFactor

	timeSec *= heightMm / 10.0

	return math.Max(5, math.Min(300, timeSec))
}

func (m *ThermalModel) CheckThermalRisks(result *ThermalResult) []string {
	var risks []string

	if result.RiskZones > 0 {
		risks = append(risks, "thermal_risk_zones_detected")
	}

	if result.MaxTempC > 250 {
		risks = append(risks, "high_temperature_warning")
	}

	for _, p := range result.Points {
		if p.Risk == "critical" {
			risks = append(risks, "critical_temperature_at_point")
			break
		}
	}

	if result.CoolingTimeSec > 120 {
		risks = append(risks, "slow_cooling_detected")
	}

	return risks
}
