#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

function fail(msg) {
  console.error(`[tauri-wrapper] ${msg}`);
  process.exit(1);
}

function resolveTargetTriple(args) {
  const eq = args.find(arg => arg.startsWith('--target='));
  if (eq) return eq.split('=')[1];
  const idx = args.findIndex(arg => arg === '--target');
  if (idx >= 0 && args[idx + 1]) return args[idx + 1];
  return '';
}

function run(cmd, args, env) {
  const label = `${cmd} ${args.join(' ')}`.trim();
  let result;
  if (process.platform === 'win32' && cmd.toLowerCase().endsWith('.cmd')) {
    const quotedArgs = args.map(a => `"${String(a).replace(/"/g, '\\"')}"`).join(' ');
    const full = `"${cmd}" ${quotedArgs}`.trim();
    result = spawnSync(full, {
      stdio: 'inherit',
      shell: true,
      env
    });
  } else {
    result = spawnSync(cmd, args, {
      stdio: 'inherit',
      shell: false,
      env
    });
  }

  if (result.error) fail(result.error.message);
  if (result.status !== 0) {
    fail(`${label} failed with exit code ${result.status}`);
  }
}

const args = process.argv.slice(2);
const targetTriple = resolveTargetTriple(args);
const env = { ...process.env, BUNDLED_TARGET_TRIPLE: targetTriple };
const tauriBin = process.platform === 'win32'
  ? path.join(__dirname, '..', 'node_modules', '.bin', 'tauri.cmd')
  : path.join(__dirname, '..', 'node_modules', '.bin', 'tauri');

run(tauriBin, args, env);
