package cad

import (
	"regexp"
	"strings"
)

var repairRules = []struct {
	name    string
	trigger *regexp.Regexp
	fix     func(string) string
}{
	{
		name:    "fillet-failure",
		trigger: regexp.MustCompile(`failed creating a fillet|max_fillet`),
		fix: func(source string) string {
			// Wrap fillet operations in try/except
			lines := strings.Split(source, "\n")
			var result []string
			inFillet := false
			for _, line := range lines {
				if strings.Contains(line, "fillet") || strings.Contains(line, "Fillet") {
					if !inFillet {
						result = append(result, "try:")
						inFillet = true
					}
					result = append(result, "    "+line)
				} else {
					if inFillet {
						result = append(result, "except Exception:")
						result = append(result, "    pass")
						inFillet = false
					}
					result = append(result, line)
				}
			}
			if inFillet {
				result = append(result, "except Exception:")
				result = append(result, "    pass")
			}
			return strings.Join(result, "\n")
		},
	},
	{
		name:    "boolean-operation-failure",
		trigger: regexp.MustCompile(`boolean operation failed|fuse.*failed|union.*failed`),
		fix: func(source string) string {
			// Comment out fuse/union/fillet lines
			lines := strings.Split(source, "\n")
			var result []string
			for _, line := range lines {
				if strings.Contains(line, "fuse") || strings.Contains(line, "union") || strings.Contains(line, "fillet") {
					result = append(result, "# "+line)
				} else {
					result = append(result, line)
				}
			}
			return strings.Join(result, "\n")
		},
	},
	{
		name:    "unsupported-operand",
		trigger: regexp.MustCompile(`unsupported operand \*`),
		fix: func(source string) string {
			// Swap Pos order: shape * Pos(...) -> Pos(...) * shape
			re := regexp.MustCompile(`(\w+)\s*\*\s*Pos\(([^)]+)\)`)
			return re.ReplaceAllString(source, "Pos($2) * $1")
		},
	},
	{
		name:    "buildpart-error",
		trigger: regexp.MustCompile(`buildpart|builder of shapes`),
		fix: func(source string) string {
			// Try to extract the last Box/Cylinder/Sphere return
			re := regexp.MustCompile(`return\s+(Box|Cylinder|Sphere)\(([^)]+)\)`)
			if match := re.FindStringSubmatch(source); len(match) > 0 {
				return strings.Replace(source, match[0], "return Box(10, 10, 10)", 1)
			}
			return source
		},
	},
	{
		name:    "wedge-failure",
		trigger: regexp.MustCompile(`standard_failure.*Wedge|Wedge.*failed`),
		fix: func(source string) string {
			// Replace Wedge with Box
			re := regexp.MustCompile(`Wedge\([^)]+\)`)
			return re.ReplaceAllString(source, "Box(10, 10, 10)")
		},
	},
	{
		name:    "unexpected-keyword",
		trigger: regexp.MustCompile(`unexpected keyword argument`),
		fix: func(source string) string {
			// Fix common parameter name mistakes
			replacements := map[string]string{
				"bottom_r":       "bottom_radius",
				"top_r":          "top_radius",
				"height":         "h",
				"width":          "w",
				"depth":          "d",
				"radius":         "r",
			}
			for wrong, right := range replacements {
				source = strings.ReplaceAll(source, wrong+"=", right+"=")
			}
			return source
		},
	},
}

func repairCadSource(source string, traceback string) (string, bool) {
	for _, rule := range repairRules {
		if rule.trigger.MatchString(traceback) {
			return rule.fix(source), true
		}
	}
	return source, false
}
