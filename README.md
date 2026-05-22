# Parallel Stack

Parallel Stack is a terminal-first Node.js CLI for launching multiple JavaScript package tasks in parallel with a focused, real-time dashboard. It is designed for monorepos and multi-package codebases where teams need reliable parallel execution and clear process visibility.

## Overview

The tool recursively discovers package.json files, lets you select which packages to run, resolves a runnable target for each package, and starts all selected tasks concurrently.

For each selected package, Parallel Stack uses this strategy:

1. Attempt to run the package main entry file.
2. If no runnable main file is found, prompt for an npm script.
3. Stream outputs into a consolidated dashboard.

## Core Features

- Interactive package discovery and selection
- Parallel execution from one terminal interface
- Configured selection cap for safer local resource usage
- Automatic main file resolution with common fallback locations
- Script fallback mode when no runnable entry point exists
- Live dashboard with status indicators and focused logs
- Keyboard navigation between active task streams
- Graceful multi-process shutdown with Ctrl+C
- Cross-platform npm command handling

## How It Works

### 1. Workspace Scan

The CLI recursively scans the current working directory for package.json files.

Ignored directories:

- node_modules
- .git
- .run-parallel-cache

### 2. Package Selection

You select packages with an interactive checkbox prompt.

- Minimum selection: 1 package
- Maximum selection: 4 packages

### 3. Task Resolution

For each selected package:

- If a runnable entry file is found, the tool launches it with the current Node executable.
- If no entry file is found, the tool prompts you to choose from available npm scripts.

### 4. Parallel Runtime

Selected tasks are started in parallel and continuously rendered in a dashboard that includes:

- Task name
- Runtime status
- Active log view for the selected task

## Main File Resolution Order

When resolving a runnable entry point, the CLI checks in this order:

1. package.json main
2. index.js
3. src/index.js
4. main.js
5. app.js
6. server.js
7. dist/index.js

If none are present, the CLI falls back to npm script selection.

## Dashboard Controls

- Up Arrow: Switch focus to previous task log stream
- Down Arrow: Switch focus to next task log stream
- Ctrl+C: Terminate all running tasks and exit

## Installation

### Global Installation

```bash
npm install -g parallel-stack
```

### Local Installation

```bash
npm install parallel-stack
```

## Usage

From the workspace root you want to scan:

```bash
parallel-stack
```

If installed locally:

```bash
npx parallel-stack
```

## Requirements

- Node.js 18 or newer recommended
- npm
- ANSI-compatible terminal for dashboard rendering

## Limitations

- Maximum of 4 concurrently selected packages per run
- Script selection fallback is interactive by design
- No detached or daemon mode in current version
- NO INPUT ACCEPTED FOR THE RUNNING SCRIPTS. (WIP)
