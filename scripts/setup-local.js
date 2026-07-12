#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const recorderDir = path.join(projectRoot, 'tools', 'DouyinLiveRecorder');
const recorderRepository = 'https://github.com/ihmily/DouyinLiveRecorder.git';
const recorderCommit = 'add187f8d8c7ff7d231fcbee45cbb4f1ed247d3a';
const skipPython = process.argv.includes('--skip-python');

function run(command, args, cwd = projectRoot) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} 执行失败`);
  }
}

function commandExists(command, args = ['--version']) {
  const result = spawnSync(command, args, { stdio: 'ignore' });
  return !result.error && result.status === 0;
}

function prepareEnvironmentFile() {
  const localEnv = path.join(projectRoot, '.env.local');
  if (fs.existsSync(localEnv)) {
    console.log('[setup] 保留现有 .env.local');
    return;
  }
  fs.copyFileSync(path.join(projectRoot, '.env.example'), localEnv);
  console.log('[setup] 已从 .env.example 创建 .env.local');
}

function prepareRecorder() {
  fs.mkdirSync(path.dirname(recorderDir), { recursive: true });
  if (!fs.existsSync(recorderDir)) {
    run('git', ['clone', '--no-checkout', recorderRepository, recorderDir]);
  } else if (!fs.existsSync(path.join(recorderDir, '.git'))) {
    throw new Error(
      'tools/DouyinLiveRecorder 已存在但不是 Git 仓库，请移动该目录后重试。',
    );
  }

  run('git', ['fetch', '--depth', '1', 'origin', recorderCommit], recorderDir);
  run('git', ['checkout', '--detach', recorderCommit], recorderDir);
  console.log(
    `[setup] DouyinLiveRecorder 已固定到 ${recorderCommit.slice(0, 7)}`,
  );
}

function preparePython() {
  if (skipPython) {
    console.log('[setup] 已跳过 Python 虚拟环境和依赖安装');
    return;
  }

  const python = process.env.PYTHON || 'python3';
  if (!commandExists(python)) {
    throw new Error(`没有找到 ${python}，请先安装 Python 3.10+。`);
  }

  const venvPython = path.join(recorderDir, '.venv', 'bin', 'python');
  if (!fs.existsSync(venvPython)) {
    run(python, ['-m', 'venv', path.join(recorderDir, '.venv')]);
  }
  run(venvPython, [
    '-m',
    'pip',
    'install',
    '--disable-pip-version-check',
    '-r',
    path.join(recorderDir, 'requirements.txt'),
  ]);
  console.log('[setup] 录制器 Python 依赖已安装');
}

function main() {
  prepareEnvironmentFile();
  prepareRecorder();
  preparePython();

  if (!commandExists('ffmpeg', ['-version'])) {
    console.warn('[setup] 未检测到 FFmpeg，直播录制前请先安装。');
  } else {
    console.log('[setup] FFmpeg 已就绪');
  }

  console.log('\n本地工具准备完成：');
  console.log('1. 在 .env.local 中填写你自己的云服务密钥');
  console.log('2. 运行 npm run dev:standalone');
}

try {
  main();
} catch (error) {
  console.error(`[setup] ${error.message}`);
  process.exit(1);
}
