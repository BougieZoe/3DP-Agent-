package step

import (
	"regexp"
	"strings"
)

type StepHeader struct {
	FileName            string `json:"fileName,omitempty"`
	Author              string `json:"author,omitempty"`
	Organization        string `json:"organization,omitempty"`
	PreprocessorVersion string `json:"preprocessorVersion,omitempty"`
	OriginatingSystem   string `json:"originatingSystem,omitempty"`
}

var (
	reFileName   = regexp.MustCompile(`FILE_NAME\s*\(\s*'([^']*)'`)
	reAuthor     = regexp.MustCompile(`FILE_DESCRIPTION\s*\(\s*'[^']*'\s*,\s*'[^']*'\s*\)\s*;\s*FILE_NAME[^;]*;\s*FILE_SCHEMA[^;]*;\s*FILE_NAME\s*\(\s*'[^']*'\s*,\s*'[^']*'\s*,\s*\(\s*'([^']*)'`)
	reOrganization = regexp.MustCompile(`ORGANIZATION\s*\(\s*'([^']*)'`)
	rePreprocessor = regexp.MustCompile(`PREPROCESSOR_VERSION\s*\(\s*'([^']*)'`)
	reOriginating  = regexp.MustCompile(`ORIGINATING_SYSTEM\s*\(\s*'([^']*)'`)
)

func isValidStepFile(bytes []byte) bool {
	if len(bytes) < 100 {
		return false
	}
	header := string(bytes[:100])
	return strings.Contains(header, "ISO-10303-21") || strings.Contains(header, "HEADER")
}

func extractStepHeaderInfo(stepBytes []byte) StepHeader {
	header := string(stepBytes)
	if len(header) > 10000 {
		header = header[:10000]
	}

	info := StepHeader{}

	if m := reFileName.FindStringSubmatch(header); len(m) > 1 {
		info.FileName = m[1]
	}

	if m := rePreprocessor.FindStringSubmatch(header); len(m) > 1 {
		info.PreprocessorVersion = m[1]
	}

	if m := reOriginating.FindStringSubmatch(header); len(m) > 1 {
		info.OriginatingSystem = m[1]
	}

	return info
}
