#!/usr/bin/env node
'use strict';

const serverPort = process.env.SERVER_PORT || '3100';
const serverHost = process.env.SERVER_HOST || 'localhost';
const serverUrl = `http://${serverHost}:${serverPort}/api/auth/status`;

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await fetch(serverUrl);
      return;
    } catch {
      await wait(500);
    }
  }

  throw new Error(`后端服务 30 秒内未能启动：${serverUrl}`);
}

waitForServer().catch((error) => {
  console.error(`[dev:standalone] ${error.message}`);
  process.exit(1);
});
