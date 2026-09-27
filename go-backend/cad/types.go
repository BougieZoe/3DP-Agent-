package cad

type BridgeGenerateBody struct {
	Prompt            string           `json:"prompt"`
	Locale            string           `json:"locale,omitempty"`
	Constraints       *Constraints     `json:"constraints,omitempty"`
	LLM               *LLMConfig       `json:"llm,omitempty"`
	GeneratorSource   string           `json:"generatorSource,omitempty"`
	MeshTolerance     *MeshTolerance   `json:"meshTolerance,omitempty"`
	TimeoutMs         int              `json:"timeoutMs,omitempty"`
	AnalysisContext   *AnalysisContext `json:"analysisContext,omitempty"`
	RequestDiagnostics bool            `json:"requestDiagnostics,omitempty"`
}

type BridgeEditBody struct {
	/** The existing source code to edit. */
	Source string `json:"source"`
	/** Natural language edit instructions. */
	EditInstructions string `json:"editInstructions"`
	/** Optional: original prompt for context. */
	OriginalPrompt string `json:"originalPrompt,omitempty"`
	/** Optional: mesh tolerance for the regenerated STL. */
	MeshTolerance *MeshTolerance `json:"meshTolerance,omitempty"`
	/** Optional: timeout override. */
	TimeoutMs int `json:"timeoutMs,omitempty"`
}

type Constraints struct {
	TargetPrinter  string  `json:"targetPrinter,omitempty"`
	MaterialName   string  `json:"materialName,omitempty"`
	MaxDimensionMm float64 `json:"maxDimensionMm,omitempty"`
}

type LLMConfig struct {
	BaseURL string `json:"baseUrl,omitempty"`
	APIKey  string `json:"apiKey,omitempty"`
	Model   string `json:"model,omitempty"`
}

type MeshTolerance struct {
	Linear  float64 `json:"linear,omitempty"`
	Angular float64 `json:"angular,omitempty"`
}

type AnalysisContext struct {
	Issues            []DfAIssue `json:"issues,omitempty"`
	OriginalPrompt    string     `json:"originalPrompt,omitempty"`
	PrintabilityScore float64    `json:"printabilityScore,omitempty"`
}

type DfAIssue struct {
	Type           string `json:"type"`
	Priority       string `json:"priority,omitempty"`
	Description    string `json:"description"`
	Implementation string `json:"implementation,omitempty"`
	Recommendation string `json:"recommendation,omitempty"`
}

type GeneratedModel struct {
	ID    string `json:"id"`
	STL   string `json:"stlBase64"`
	STEP  string `json:"stepBase64,omitempty"`
}
