import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const apiPort = process.env.API_PORT ?? process.env.PORT ?? '10000';
const apiHost = process.env.API_HOST ?? '0.0.0.0';
const orchestratorHost = process.env.ORCHESTRATOR_HOST ?? '127.0.0.1';
const specialistHost = process.env.SPECIALIST_AGENTS_HOST ?? '127.0.0.1';
const vendorHost = process.env.VENDOR_AGENT_HOST ?? '127.0.0.1';
const orchestratorPort = process.env.ORCHESTRATOR_PORT ?? '10001';
const specialistPort = process.env.SPECIALIST_AGENTS_PORT ?? '10002';
const vendorPort = process.env.VENDOR_AGENT_PORT ?? '10003';

const orchestratorUrl = process.env.ORCHESTRATOR_SERVICE_URL ?? `http://${orchestratorHost}:${orchestratorPort}`;
const specialistUrl = process.env.SPECIALIST_SERVICE_URL ?? `http://${specialistHost}:${specialistPort}`;
const vendorUrls = process.env.VENDOR_SERVICE_URLS ?? `http://${vendorHost}:${vendorPort}`;

const sharedEnv = {
  ...process.env,
  NODE_ENV: process.env.NODE_ENV ?? 'production',
  API_HOST: apiHost,
  API_PORT: apiPort,
  ORCHESTRATOR_HOST: orchestratorHost,
  ORCHESTRATOR_PORT: orchestratorPort,
  SPECIALIST_AGENTS_HOST: specialistHost,
  SPECIALIST_AGENTS_PORT: specialistPort,
  VENDOR_AGENT_HOST: vendorHost,
  VENDOR_AGENT_PORT: vendorPort,
  ORCHESTRATOR_SERVICE_URL: orchestratorUrl,
  SPECIALIST_SERVICE_URL: specialistUrl,
  VENDOR_SERVICE_URLS: vendorUrls,
};

const children = [];
let shuttingDown = false;

async function main() {
  const orchestrator = startNodeProcess('orchestrator', 'apps/orchestrator/dist/index.js', sharedEnv);
  const specialist = startNodeProcess('specialist', 'apps/specialist-agents/dist/index.js', sharedEnv);
  const vendor = startNodeProcess('vendor', 'apps/vendor-agent/dist/index.js', sharedEnv);

  children.push(orchestrator, specialist, vendor);

  await Promise.all([
    waitForHealth(`${orchestratorUrl}/health`, 'orchestrator'),
    waitForHealth(`${specialistUrl}/health`, 'specialist'),
    waitForHealth(`${vendorUrls.split(',')[0].trim()}/health`, 'vendor'),
  ]);

  const api = startNodeProcess('api', 'apps/api-server/dist/index.js', {
    ...sharedEnv,
    API_PORT: apiPort,
  });
  children.push(api);

  api.on('exit', (code) => {
    if (shuttingDown) {
      return;
    }
    shutdown(code ?? 0);
  });
}

function startNodeProcess(label, relativeScriptPath, env) {
  const scriptPath = path.resolve(rootDir, relativeScriptPath);
  const child = spawn(process.execPath, [scriptPath], {
    cwd: rootDir,
    env,
    stdio: 'inherit',
  });

  child.on('error', (error) => {
    console.error(`[render-stack] ${label} failed to start`, error);
    shutdown(1);
  });

  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }
    if (code === 0) {
      console.error(`[render-stack] ${label} exited unexpectedly`);
    } else {
      console.error(`[render-stack] ${label} exited with code ${code ?? 'unknown'}${signal ? ` (${signal})` : ''}`);
    }
    shutdown(code ?? 1);
  });

  return child;
}

async function waitForHealth(url, label, timeoutMs = 60000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        console.log(`[render-stack] ${label} healthy at ${url}`);
        return;
      }
    } catch {
      // Service still warming up.
    }

    await delay(1000);
  }

  throw new Error(`${label} did not become healthy within ${timeoutMs}ms`);
}

function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  for (const child of children) {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  }

  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    }
    process.exit(code);
  }, 5000).unref();
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown(0));
}

main().catch((error) => {
  console.error('[render-stack] failed to boot service mesh', error);
  shutdown(1);
});
