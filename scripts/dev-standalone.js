#!/usr/bin/env node
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const dotenv = require('dotenv');

const projectRoot = path.resolve(__dirname, '..');
process.chdir(projectRoot);

const envFile = process.env.STANDALONE_ENV_FILE || '.env.local';
dotenv.config({ path: envFile, quiet: true });
dotenv.config({ path: '.env', quiet: true });

let appId = 'app_179b24s0sng';
try {
  const meta = JSON.parse(
    fs.readFileSync(path.join(projectRoot, '.spark', 'meta.json'), 'utf8'),
  );
  appId = meta.app_id || appId;
} catch {
  // Keep the public project app id as the standalone fallback.
}

process.env.MIAODA_APP_TYPE ||= '3';
process.env.MIAODA_LOCAL_DEV ||= '1';
process.env.STANDALONE_LOCAL_DEV = '1';
process.env.CLIENT_BASE_PATH ||= `/app/${appId}/`;
process.env.MIAODA_APP_ID ||= appId;
process.env.app_id ||= appId;
process.env.SUDA_WEBUSER = JSON.stringify({
  user_id: 'local-standalone-user',
  user_name: '本地体验用户',
  tenant_id: 'local-standalone-tenant',
});
process.env.SERVER_PORT ||= '3100';
process.env.CLIENT_DEV_PORT ||= '8081';
process.env.SERVER_HOST ||= 'localhost';

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const child = spawn(
  npx,
  [
    '--no-install',
    'concurrently',
    '--names',
    'server,client',
    '--prefix-colors',
    'blue,green',
    '--kill-others-on-fail',
    'npm run dev:server',
    'npm run dev:client',
  ],
  {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
  },
);

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => child.kill(signal));
}

child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (error) => {
  console.error(`[dev:standalone] 启动失败：${error.message}`);
  process.exit(1);
});
