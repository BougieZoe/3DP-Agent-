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
	"PETG": {
		Name:            "PETG",
		MeltingPointC:   250,
		GlassTransC:     80,
		ThermalCond:     0.24,
		SpecificHeat:    1200,
		Density:         1270,
		MaxBedTempC:     80,
		RecommendedSpeed: 50,
	},
	"TPU": {
		Name:            "TPU",
		MeltingPointC:   220,
		GlassTransC:     50,
		ThermalCond:     0.15,
		SpecificHeat:    2000,
		Density:         1200,
		MaxBedTempC:     60,
		RecommendedSpeed: 30,
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
