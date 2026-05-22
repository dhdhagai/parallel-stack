#!/usr/bin/env node

import { promises as fs } from 'fs';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import readline from 'readline';
import inquirer from 'inquirer';
import { pathToFileURL } from 'url';

const projectRoot = process.cwd();
const MAX_PARALLEL_TASKS = 4;
const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
let activeIndex = 0;
let renderTimeout = null;
const debugMessages = [];

const isDirectExecution = process.argv[1]
  ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  : false;

function debugLog(message) {
  const line = `[debug] ${message}`;
  debugMessages.push(line);
  if (debugMessages.length > 8) {
    debugMessages.shift();
  }
  // Only write debug to an actual log file if needed in production, 
  // writing to stderr here can corrupt the dashboard layout.
}

// --- HELPERS FOR FILE DISCOVERY ---
export async function readPackageJsonFiles(rootDir, relativeBase = '') {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.run-parallel-cache') {
      continue;
    }

    const absolutePath = path.join(rootDir, entry.name);
    const relativePath = path.join(relativeBase, entry.name);

    if (entry.isDirectory()) {
      const nestedFiles = await readPackageJsonFiles(absolutePath, relativePath);
      files.push(...nestedFiles);
      continue;
    }

    if (entry.isFile() && entry.name === 'package.json') {
      files.push(relativePath);
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

export async function readManifest(packageJsonPath) {
  const raw = await fs.readFile(packageJsonPath, 'utf8');
  return JSON.parse(raw);
}

export async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function resolveMainFile(packageJsonPath) {
  const packageDir = path.dirname(packageJsonPath);
  const manifest = await readManifest(packageJsonPath);
  const candidates = [];

  if (typeof manifest.main === 'string' && manifest.main.trim()) {
    candidates.push(path.resolve(packageDir, manifest.main));
  }

  candidates.push(
    path.resolve(packageDir, 'index.js'),
    path.resolve(packageDir, 'src/index.js'),
    path.resolve(packageDir, 'main.js'),
    path.resolve(packageDir, 'app.js'),
    path.resolve(packageDir, 'server.js'),
    path.resolve(packageDir, 'dist/index.js')
  );

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

export async function readPackageScripts(packageJsonPath) {
  const manifest = await readManifest(packageJsonPath);

  if (!manifest.scripts || typeof manifest.scripts !== 'object') {
    return [];
  }

  return Object.entries(manifest.scripts)
    .filter(([, command]) => typeof command === 'string' && command.trim())
    .map(([scriptName, command]) => ({
      name: `${scriptName}  ${command}`,
      value: scriptName,
    }))
    .sort((left, right) => left.value.localeCompare(right.value));
}

export async function choosePackageJsonPaths(rootDir) {
  const packageJsonFiles = await readPackageJsonFiles(rootDir);

  if (packageJsonFiles.length === 0) {
    console.log('No package.json files found in this project.');
    return [];
  }

  const { packageJsonPaths } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'packageJsonPaths',
      message: `Select up to ${MAX_PARALLEL_TASKS} packages to run in parallel`,
      choices: packageJsonFiles,
      validate(selectedPaths) {
        if (selectedPaths.length === 0) return 'Select at least one package.json file.';
        if (selectedPaths.length > MAX_PARALLEL_TASKS) return `Select no more than ${MAX_PARALLEL_TASKS} packages.`;
        return true;
      },
    },
  ]);

  return packageJsonPaths.map((relativePath) => path.join(rootDir, relativePath));
}

export async function chooseTask(packageJsonPath) {
  const packageDir = path.dirname(packageJsonPath);
  const packageName = path.basename(packageDir);
  const mainFile = await resolveMainFile(packageJsonPath);

  if (mainFile) {
    return {
      id: packageJsonPath,
      name: packageName,
      command: process.execPath, // Node executable
      args: [mainFile],
      cwd: packageDir,
      kind: 'main',
      shell: false,
    };
  }

  const scripts = await readPackageScripts(packageJsonPath);

  if (scripts.length === 0) {
    throw new Error(`No main file or runnable scripts found in ${path.relative(projectRoot, packageJsonPath)}`);
  }

  const { scriptName } = await inquirer.prompt([
    {
      type: 'list',
      name: 'scriptName',
      message: `No main file found in ${path.relative(projectRoot, packageJsonPath)}. Select a script to run`,
      choices: scripts,
    },
  ]);

  return {
    id: `${packageJsonPath}:${scriptName}`,
    name: `${packageName}:${scriptName}`,
    command: npmExecutable,
    args: ['run', scriptName],
    cwd: packageDir,
    // Windows requires shell: true for .cmd files, Mac/Linux should use false for safety
    shell: process.platform === 'win32', 
    kind: 'script',
  };
}

export async function buildTasks() {
  const packageJsonPaths = await choosePackageJsonPaths(projectRoot);
  const tasks = [];
  for (const packageJsonPath of packageJsonPaths) {
    tasks.push(await chooseTask(packageJsonPath));
  }
  return tasks;
}

// --- HELPERS FOR TERMINAL STYLING ---
const CLEAR_SCREEN = '\x1B[2J\x1B[H';
const COLOR_GREEN = '\x1B[32m';
const COLOR_YELLOW = '\x1B[33m';
const COLOR_RED = '\x1B[31m';
const COLOR_DIM = '\x1B[2m';
const COLOR_RESET = '\x1B[0m';

// --- RENDER REFRESH LOOP ---
export function renderDashboard(state, activeIndex) {
  let output = CLEAR_SCREEN;
  output += `${COLOR_GREEN}=== PARALLEL-STACK DASHBOARD ===${COLOR_RESET}\n\n`;

  state.forEach((task, idx) => {
    const isSelected = idx === activeIndex;
    const marker = isSelected ? '👉 ' : '   ';
    let statusColor = COLOR_YELLOW;
    if (task.status === 'RUNNING') statusColor = COLOR_GREEN;
    if (task.status.startsWith('FAILED')) statusColor = COLOR_RED;

    output += `${marker}${task.name}: ${statusColor}[${task.status}]${COLOR_RESET}\n`;
  });

  output += `\n${COLOR_DIM}------------------------------------------------------------${COLOR_RESET}\n`;
  output += ` Showing active logs for: ${COLOR_GREEN}${state[activeIndex].name}${COLOR_RESET}\n`;
  output += `${COLOR_DIM}------------------------------------------------------------${COLOR_RESET}\n\n`;

  const activeLogs = state[activeIndex].logs.slice(-14);
  if (activeLogs.length === 0) {
    output += `${COLOR_DIM}(No log outputs yet)${COLOR_RESET}\n`;
  } else {
    output += activeLogs.join('\n') + '\n';
  }

  output += `\n${COLOR_DIM}[▲/▼ Arrow Keys: Change Target View | Ctrl+C: Safe Kill & Exit]${COLOR_RESET}\n`;
  process.stdout.write(output);
}

export function scheduleRender(state) {
  // Throttle renders to ~16 FPS. Fixes CPU thrashing from noisy loggers.
  if (renderTimeout) return;
  
  renderTimeout = setTimeout(() => {
    renderTimeout = null;
    renderDashboard(state, activeIndex);
  }, 60); 
}

export function killTaskProcess(task) {
  if (!task.process || task.process.killed) {
    return;
  }

  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(task.process.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }

  task.process.kill('SIGINT');
}

// --- PROCESS LIFECYCLE ---
export function startTasks(state) {
  state.forEach((task) => {
    const child = spawn(task.command, task.args, {
      cwd: task.cwd,
      shell: task.shell,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: 'true' },
    });

    task.process = child;
    task.status = 'RUNNING';

    const handleLogData = (data) => {
      const lines = data.toString().trim().split('\n');
      lines.forEach((line) => {
        if (line) {
          task.logs.push(line);
          // OOM Fix: Keep array size capped to prevent memory leaks over time
          if (task.logs.length > 100) task.logs.shift();
        }
      });
      scheduleRender(state);
    };

    child.stdout.on('data', handleLogData);
    child.stderr.on('data', (data) => handleLogData(`${COLOR_RED}[ERR] ${data.toString()}`));

    child.on('close', (code) => {
      task.status = code === 0 ? 'EXITED' : `FAILED (Code ${code})`;
      scheduleRender(state);
    });
  });
}

// --- KEYBOARD INTERACTION HANDLER ---
export function setupKeyboard(state) {
  // Inquirer pauses stdin. We MUST resume it to capture arrow keys.
  process.stdin.resume(); 
  
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  process.stdin.on('keypress', (str, key) => {
    if (key.ctrl && key.name === 'c') {
      state.forEach(killTaskProcess);
      process.exit(0);
    }

    if (key.name === 'up') {
      activeIndex = (activeIndex - 1 + state.length) % state.length;
      scheduleRender(state);
    } else if (key.name === 'down') {
      activeIndex = (activeIndex + 1) % state.length;
      scheduleRender(state);
    }
  });
}

// --- MAIN ---
export async function main() {
  const tasks = await buildTasks();

  if (tasks.length === 0) return;

  const state = tasks.map((task) => ({
    ...task,
    status: 'STARTING',
    logs: [],
    process: null,
  }));

  setupKeyboard(state);
  startTasks(state);
  renderDashboard(state, activeIndex);
}

if (isDirectExecution) {
  main().catch((error) => {
    console.error('Failed to start the package launcher:');
    console.error(error);
    process.exitCode = 1;
  });
}