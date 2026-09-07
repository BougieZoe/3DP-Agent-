import { describe, it, expect } from 'vitest';
import {
  BLENDER_TOOL_POLICY,
  getToolAction,
  isCodeSafe,
  formatPolicySummary,
} from '../blenderToolPolicy';

describe('blenderToolPolicy', () => {
  describe('getToolAction', () => {
    it('allows safe tools', () => {
      expect(getToolAction('render')).toBe('allow');
      expect(getToolAction('export_stl')).toBe('allow');
      expect(getToolAction('create_mesh')).toBe('allow');
      expect(getToolAction('set_material')).toBe('allow');
    });

    it('confirms risky tools', () => {
      expect(getToolAction('import_file')).toBe('confirm');
      expect(getToolAction('delete_object')).toBe('confirm');
      expect(getToolAction('execute_python_snippet')).toBe('confirm');
    });

    it('denies dangerous tools', () => {
      expect(getToolAction('shell_command')).toBe('deny');
      expect(getToolAction('network_request')).toBe('deny');
      expect(getToolAction('filesystem_write')).toBe('deny');
      expect(getToolAction('install_package')).toBe('deny');
    });

    it('defaults to deny for unknown tools', () => {
      expect(getToolAction('totally_unknown_tool_xyz')).toBe('deny');
    });
  });

  describe('isCodeSafe', () => {
    it('passes clean Blender code', () => {
      const code = `
        import bpy
        bpy.ops.mesh.primitive_cube_add(size=2)
        obj = bpy.context.active_object
        print(obj.name)
      `;
      const result = isCodeSafe(code);
      expect(result.safe).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it('blocks os.system calls', () => {
      const result = isCodeSafe('import os\nos.system("rm -rf /")');
      expect(result.safe).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
    });

    it('blocks subprocess', () => {
      const result = isCodeSafe('import subprocess\nsubprocess.run(["ls"])');
      expect(result.safe).toBe(false);
    });

    it('blocks eval/exec', () => {
      expect(isCodeSafe('eval("1+1")').safe).toBe(false);
      expect(isCodeSafe('exec("code")').safe).toBe(false);
    });

    it('blocks file operations', () => {
      expect(isCodeSafe('open("/etc/passwd")').safe).toBe(false);
      expect(isCodeSafe('import shutil\nshutil.rmtree("/tmp")').safe).toBe(false);
    });

    it('blocks network imports', () => {
      expect(isCodeSafe('import requests').safe).toBe(false);
      expect(isCodeSafe('import urllib.request').safe).toBe(false);
      expect(isCodeSafe('import socket').safe).toBe(false);
    });

    it('blocks __import__', () => {
      expect(isCodeSafe('__import__("os")').safe).toBe(false);
    });
  });

  describe('formatPolicySummary', () => {
    it('formats readable summary', () => {
      const summary = formatPolicySummary();
      expect(summary).toContain('Tool Policy v');
      expect(summary).toContain('Allow');
      expect(summary).toContain('Confirm');
      expect(summary).toContain('Deny');
    });
  });
});
