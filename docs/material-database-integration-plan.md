# Material Database Integration Plan (Updated)

## Objective
Create a unified material database that consolidates all material properties, fixes data quality issues, and provides a single source of truth for the entire system.

## Current Progress

### ✅ Completed
- **Phase 1**: Extended Material Interface with new properties (thermalDiffusivityMm2PerS, emisivity, meltingPointC, tensileStrengthMPa, flexuralModulusGPa, elasticModulusGPa, PoissonRatio, hardness)
- **Phase 2**: Fixed TPU Tg from 50°C to -40°C (correct value)
- **Phase 3**: Added missing materials (INCONEL718, COPPER, PEEK)
- **Phase 4**: Added extended properties to PLA, PETG, ABS, TPU

### 🔄 In Progress
- **Phase 4** (remaining): Add properties to NYLON, PC, ASA, SLA resins, SLS powders, metal powders, FGF pellets, concrete, eco materials

### ⏳ Pending
- **Phase 5**: Consolidate thermal properties (remove LOCAL_THERMAL_PROPS from thermal.ts)
- **Phase 6**: Consolidate metal properties (remove METAL_THERMAL_PROPS from metalAnalysis.ts)
- **Phase 7**: Sync Go backend with TypeScript material definitions
- **Phase 8**: Create material query API

---

## Phase 4: Add Missing Properties (Remaining Materials)

### FDM Materials
| Material | Key Properties to Add |
|----------|----------------------|
| NYLON | Tg=70°C, meltingPoint=260°C, thermalDiffusivity=0.14, tensileStrength=85MPa, elasticModulus=2.8GPa |
| PC | Tg=150°C, meltingPoint=267°C, thermalDiffusivity=0.14, tensileStrength=63MPa, elasticModulus=2.4GPa |
| ASA | Tg=105°C, thermalDiffusivity=0.12, tensileStrength=44MPa, elasticModulus=2.3GPa |

### SLA Resins
| Material | Key Properties to Add |
|----------|----------------------|
| Standard Resin | tensileStrength=50MPa, elasticModulus=2.5GPa |
| Tough Resin | tensileStrength=55MPa, elasticModulus=2.3GPa |
| Flexible Resin | tensileStrength=8MPa, elasticModulus=0.05GPa |
| Dental Model | tensileStrength=45MPa, elasticModulus=3.0GPa |
| High Temp | Tg=238°C, tensileStrength=60MPa, elasticModulus=3.5GPa |

### SLS Powders
| Material | Key Properties to Add |
|----------|----------------------|
| PA11 | tensileStrength=48MPa, elasticModulus=1.7GPa |
| PA12 | tensileStrength=50MPa, elasticModulus=1.8GPa |
| PA12 Glass | tensileStrength=55MPa, elasticModulus=3.5GPa |
| TPU | tensileStrength=25MPa, elasticModulus=0.1GPa |

### Metal Powders
| Material | Key Properties to Add |
|----------|----------------------|
| 316L | meltingPoint=1375°C, thermalConductivity=16.3, tensileStrength=570MPa, elasticModulus=193GPa |
| Ti6Al4V | meltingPoint=1660°C, thermalConductivity=6.7, tensileStrength=1100MPa, elasticModulus=114GPa |
| AlSi10Mg | meltingPoint=575°C, thermalConductivity=112, tensileStrength=350MPa, elasticModulus=70GPa |

---

## Phase 5: Consolidate Thermal Properties

### Current Issue
`client/src/analysis/thermal.ts` has LOCAL_THERMAL_PROPS with 10 entries that duplicate/differ from MATERIALS registry.

### Solution
1. Remove LOCAL_THERMAL_PROPS entirely
2. Update computeThermalMetrics to use material.thermalDiffusivityMm2PerS, material.emisivity, material.meltingPointC
3. Keep local overrides only for materials NOT in MATERIALS registry (none currently)

### Files to Modify
- `client/src/analysis/thermal.ts`: Remove LOCAL_THERMAL_PROPS, update computeThermalMetrics function
- `client/src/analysis/thermalSimulator.ts`: Verify it uses updated thermal function

---

## Phase 6: Consolidate Metal Properties

### Current Issue
`client/src/analysis/metalAnalysis.ts` has METAL_THERMAL_PROPS with 5 entries that duplicate/differ from MATERIALS registry.

### Solution
1. Remove METAL_THERMAL_PROPS entirely
2. Update metal analysis functions to use material properties from MATERIALS registry
3. Keep local overrides only for materials NOT in MATERIALS registry (none currently)

### Files to Modify
- `client/src/analysis/metalAnalysis.ts`: Remove METAL_THERMAL_PROPS, update metalThermalProps() function
- `client/src/analysis/metalAnalysis.ts`: Update analyzeWarpingRisk, analyzeSupportRisk, analyzeThinWallRisk to use material properties

---

## Phase 7: Sync Go Backend

### Current Issue
Go backend (`go-backend/thermal/model.go`) has:
- Only 4 materials (PLA, ABS, PETG, Nylon)
- Different units: J/(kg*K) vs J/(g*K)
- No SLA, SLS, SLM, FGF, concrete, or eco materials

### Solution
1. Add all materials from MATERIALS registry to Go backend
2. Fix units to match TypeScript (J/(g*K))
3. Create a sync script to generate Go code from TypeScript material definitions

### Files to Modify
- `go-backend/thermal/model.go`: Add all materials, fix units
- New file: `scripts/sync-materials.go` (optional, for automation)

### Materials to Add to Go Backend
- FDM: PLA, PETG, ABS, TPU, ASA, NYLON, PC, PEEK
- SLA: Standard Resin, Tough Resin, Flexible Resin, Dental Model, High Temp
- SLS: PA11, PA12, PA12 Glass, TPU
- SLM: 316L, Ti6Al4V, AlSi10Mg, Inconel 718, Copper
- FGF: rPET, rPLA, BioPETG
- Concrete: Standard, Fiber, HP
- Eco: rPLA, Bio PLA, rPETG, Cellulose Acetate

---

## Phase 8: Create Material Query API

### New File
`go-backend/material/router.go`

### Endpoints
```
GET /api/materials           → List all materials
GET /api/materials/:name     → Get material by name
GET /api/materials/search    → Search materials by properties
GET /api/materials/compare   → Compare multiple materials
```

### Integration
- Mount router in `go-backend/main.go`
- Add proxy route in `vite.config.ts`

---

## Benefits Summary

1. **Single source of truth** — All material properties in one place
2. **Improved accuracy** — Fix data quality issues (TPU Tg)
3. **Better cost calculations** — More accurate material costs
4. **Enhanced analysis** — Mechanical properties enable structural analysis
5. **Easier maintenance** — Update once, propagate everywhere
6. **API access** — External tools can query material properties
7. **Go/TypeScript sync** — Consistent data across codebase

---

## Testing Plan

1. Unit tests for material queries
2. Integration tests for thermal analysis with updated properties
3. Comparison tests: old vs new material properties
4. Docker build and run tests
5. Verify no regressions in existing analysis

---

## Timeline

| Phase | Time | Status |
|-------|------|--------|
| Phase 1 | 30 min | ✅ Done |
| Phase 2 | 10 min | ✅ Done |
| Phase 3 | 45 min | ✅ Done |
| Phase 4 | 30 min | 🔄 In Progress |
| Phase 5 | 30 min | ⏳ Pending |
| Phase 6 | 30 min | ⏳ Pending |
| Phase 7 | 30 min | ⏳ Pending |
| Phase 8 | 30 min | ⏳ Pending |
| **Total** | **~3.5 hours** | |
