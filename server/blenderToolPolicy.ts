export type PolicyAction = 'allow' | 'confirm' | 'deny';

export interface ToolEntry {
  name: string;
  action: PolicyAction;
  reason: string;
}

export interface ToolPolicy {
  version: string;
  tools: ToolEntry[];
  deniedCodePatterns: string[];
}

export const BLENDER_TOOL_POLICY: ToolPolicy = {
  version: '0.1.0',
  tools: [
    // ── Allow: safe, deterministic, no side effects beyond the scene ──
    { name: 'create_mesh',          action: 'allow',  reason: 'Create primitive geometry (cube, sphere, cylinder, etc.)' },
    { name: 'modify_mesh',          action: 'allow',  reason: 'Move/rotate/scale vertices, faces, edges' },
    { name: 'add_modifier',         action: 'allow',  reason: 'Boolean, bevel, subdivision, mirror — all local to scene' },
    { name: 'set_material',         action: 'allow',  reason: 'Assign material/color to objects' },
    { name: 'set_camera',           action: 'allow',  reason: 'Position and orient camera' },
    { name: 'set_light',            action: 'allow',  reason: 'Add/configure lights' },
    { name: 'render',               action: 'allow',  reason: 'Render scene to image file' },
    { name: 'export_stl',           action: 'allow',  reason: 'Export mesh to STL' },
    { name: 'export_obj',           action: 'allow',  reason: 'Export mesh to OBJ' },
    { name: 'export_glb',           action: 'allow',  reason: 'Export scene to GLB' },
    { name: 'query_scene',          action: 'allow',  reason: 'List objects, count verts/faces, get bounding box' },
    { name: 'screenshot_viewport',  action: 'allow',  reason: 'Capture current viewport as image' },

    // ── Confirm: require human approval before execution ──
    { name: 'import_file',          action: 'confirm', reason: 'Load external file into scene — verify source is trusted' },
    { name: 'export_blend',         action: 'confirm', reason: 'Save .blend file — could overwrite existing' },
    { name: 'delete_object',        action: 'confirm', reason: 'Remove object from scene — may be non-recoverable' },
    { name: 'execute_python_snippet', action: 'confirm', reason: 'Arbitrary Python — needs code review before exec' },
    { name: 'bake_simulation',      action: 'confirm', reason: 'Physics bake can be slow and memory-intensive' },

    // ── Deny: never allowed ──
    { name: 'shell_command',        action: 'deny',  reason: 'No shell access from within Blender' },
    { name: 'network_request',      action: 'deny',  reason: 'No outbound HTTP from Blender process' },
    { name: 'filesystem_write',     action: 'deny',  reason: 'No arbitrary file writes — use explicit export tools' },
    { name: 'filesystem_delete',    action: 'deny',  reason: 'No file deletion from Blender' },
    { name: 'install_package',      action: 'deny',  reason: 'No pip install — all deps must be pre-installed' },
    { name: 'access_user_data',     action: 'deny',  reason: 'Never read ~/Documents, keychain, or sensitive paths' },
  ],

  deniedCodePatterns: [
    'import os',
    'import subprocess',
    'import shutil',
    'import socket',
    'import requests',
    'import urllib',
    'eval(',
    'exec(',
    '__import__',
    'open(',
    'os.system',
    'subprocess.run',
    'subprocess.Popen',
    'shutil.rmtree',
    'pathlib.*rmdir',
  ],
};

export function getToolAction(toolName: string, policy: ToolPolicy = BLENDER_TOOL_POLICY): PolicyAction {
  const entry = policy.tools.find(t => t.name === toolName);
  return entry?.action ?? 'deny';
}

export function isCodeSafe(code: string, policy: ToolPolicy = BLENDER_TOOL_POLICY): { safe: boolean; violations: string[] } {
  const violations: string[] = [];
  for (const pattern of policy.deniedCodePatterns) {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'i');
    if (regex.test(code)) {
      violations.push(`Blocked pattern: ${pattern}`);
    }
  }
  return { safe: violations.length === 0, violations };
}

export function formatPolicySummary(policy: ToolPolicy = BLENDER_TOOL_POLICY): string {
  const allow = policy.tools.filter(t => t.action === 'allow');
  const confirm = policy.tools.filter(t => t.action === 'confirm');
  const deny = policy.tools.filter(t => t.action === 'deny');
  return [
    `Tool Policy v${policy.version}`,
    `  Allow (${allow.length}): ${allow.map(t => t.name).join(', ')}`,
    `  Confirm (${confirm.length}): ${confirm.map(t => t.name).join(', ')}`,
    `  Deny (${deny.length}): ${deny.map(t => t.name).join(', ')}`,
    `  Code patterns blocked: ${policy.deniedCodePatterns.length}`,
  ].join('\n');
}
