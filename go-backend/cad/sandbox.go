package cad

import (
	"regexp"
	"strings"
)

type SourceSafety struct {
	Safe        bool     `json:"safe"`
	Violations  []string `json:"violations,omitempty"`
}

var (
	forbiddenImports = []string{
		"import os",
		"import subprocess",
		"import socket",
		"import ctypes",
		"import shutil",
		"import sys",
		"from os import",
		"from subprocess import",
		"from socket import",
		"from ctypes import",
		"from shutil import",
		"from sys import",
	}

	forbiddenPatterns = []*regexp.Regexp{
		regexp.MustCompile(`\beval\s*\(`),
		regexp.MustCompile(`\bexec\s*\(`),
		regexp.MustCompile(`\b__import__\s*\(`),
		regexp.MustCompile(`\bcompile\s*\(`),
		regexp.MustCompile(`\bopen\s*\(`),
		regexp.MustCompile(`\bfile\s*\(`),
		regexp.MustCompile(`\bos\.`),
		regexp.MustCompile(`\bsubprocess\.`),
		regexp.MustCompile(`\bsocket\.`),
		regexp.MustCompile(`\bctypes\.`),
		regexp.MustCompile(`\bshutil\.`),
	}
)

func scanSourceSafety(source string) SourceSafety {
	violations := []string{}

	// Check forbidden imports
	for _, imp := range forbiddenImports {
		if strings.Contains(source, imp) {
			violations = append(violations, "forbidden import: "+imp)
		}
	}

	// Check forbidden patterns
	for _, pattern := range forbiddenPatterns {
		if pattern.MatchString(source) {
			violations = append(violations, "forbidden pattern: "+pattern.String())
		}
	}

	return SourceSafety{
		Safe:       len(violations) == 0,
		Violations: violations,
	}
}
