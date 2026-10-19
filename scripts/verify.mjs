import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, lstat, open, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modes = ['quick', 'frontend', 'backend', 'full'];
const unit = ['python', '-m', 'unittest', 'discover', '-s', 'tests', '-t', '.', '-p', 'test_*.py'];
const integration = ['python', '-m', 'unittest', 'discover', '-s', 'integration_tests', '-p', 'test_*.py', '-v'];
const checkBrowserOrigin = "fetch(new URL('/api/health', process.env.E2E_BASE_URL), {signal: AbortSignal.timeout(10000)}).then(r => {if (!r.ok) throw new Error('Browser origin health returned HTTP ' + r.status); console.log('Browser origin API ready');}).catch(e => {console.error(e.message); process.exitCode = 1;})";

export function parseArguments(args) {
  const positional = args.filter(arg => !arg.startsWith('--'));
  if (positional.length > 1 || args.some(arg => arg.startsWith('--') && !['--help', '--dry-run'].includes(arg))) {
    throw new Error('Usage: node scripts/verify.mjs [quick|frontend|backend|full] [--dry-run]');
  }
  const mode = positional[0] || 'quick';
  if (!modes.includes(mode)) throw new Error(`Unknown validation mode: ${mode}`);
  return { mode, help: args.includes('--help'), dryRun: args.includes('--dry-run') };
}

export function composePrefix(project, root = repository) {
  if (!/^pesc-verify-[a-f0-9]{32}$/.test(project)) throw new Error('Refusing an unowned Compose project.');
  return ['compose', '--ansi', 'never', '--project-directory', root,
    '--env-file', path.join(root, 'scripts', 'verify.env'),
    '-f', path.join(root, 'compose.verify.yaml'), '-p', project];
}

export function planFor(mode) {
  if (!modes.includes(mode)) throw new Error('Unknown validation mode.');
  const backend = mode !== 'frontend';
  const frontend = mode !== 'backend';
  const full = mode === 'full';
  return {
    images: [...(backend ? ['backend'] : []), ...(frontend ? ['frontend'] : []), ...(full ? ['browser'] : [])],
    checks: [
      ...(backend ? [{ name: 'backend-unit', docker: ['run', '--rm', '--no-deps', '-e', 'DEMO_ACCOUNTS_ENABLED=false', 'backend', ...unit] }] : []),
      ...(frontend ? [{ name: 'frontend-tests-build', docker: ['run', '--rm', '--no-deps', 'frontend', 'sh', '-c', 'npm test && npm run build'] }] : []),
    ],
    full,
  };
}

// Separate workflow policy from processes so failure/cancellation/cleanup can be tested without Docker.
export async function runWorkflow(mode, runStep, { isCancelled = () => false } = {}) {
  const plan = planFor(mode);
  let touched = false;
  let succeeded = false;
  let cleaned = true;
  const run = (name, command, args, timeoutMs = 600_000) => isCancelled()
    ? Promise.resolve(false) : runStep({ name, command, args, timeoutMs });
  const docker = (name, args, timeout) => run(name, 'docker', args, timeout);
  try {
    succeeded = await (async () => {
      if (!await run('runner-policy', process.execPath, ['--test',
        'scripts/test/verify.test.mjs', 'deployment/mongodb/config.test.cjs'])) return false;
      if (!await docker('compose-version', ['compose', 'version'], 30_000)) return false;
      if (!await docker('docker-ready', ['info', '--format', '{{.ServerVersion}}'], 30_000)) return false;
      touched = true;
      if (!await docker('build', ['build', ...plan.images], 1_200_000)) return false;
      // Unit/build jobs are independent. Finish both before running the browser on its own.
      const checks = await Promise.allSettled(plan.checks.map(check => docker(check.name, check.docker)));
      if (checks.some(result => result.status !== 'fulfilled' || result.value !== true) || isCancelled()) return false;
      if (!plan.full) return true;
      if (!await docker('mongodb-start', ['up', '-d', '--wait', '--wait-timeout', '120', 'mongodb'], 180_000)) return false;
      if (!await docker('mongodb-integration', ['run', '--rm', '--no-deps', '-e', 'DEMO_ACCOUNTS_ENABLED=false', 'backend', ...integration])) return false;
      if (!await docker('browser-servers', ['up', '-d', '--wait', '--wait-timeout', '120', 'backend', 'frontend'], 180_000)) return false;
      if (!await docker('browser-connectivity', ['run', '--rm', '--no-deps', 'browser', 'node', '-e', checkBrowserOrigin], 30_000)) return false;
      return docker('browser-e2e', ['run', '--rm', '--no-deps', 'browser'], 900_000);
    })();
  } finally {
    if (touched) {
      // Diagnostics are best effort; cleanup must still happen when logging fails.
      if (!succeeded) {
        try { await runStep({ name: 'service-logs', command: 'docker',
          args: ['logs', '--no-color', '--tail', '200'], timeoutMs: 30_000 }); } catch { /* Preserve original failure. */ }
      }
      cleaned = await runStep({ name: 'cleanup', command: 'docker',
        args: ['down', '--volumes', '--remove-orphans', '--timeout', '10'], timeoutMs: 60_000 });
    }
  }
  return succeeded && cleaned && !isCancelled();
}

function help() {
  console.log(`PESC MATE validation (Node.js + Docker Compose v2)
  npm run verify           backend/frontend unit tests + frontend build
  npm run verify:frontend  frontend only
  npm run verify:backend   backend only
  npm run verify:full      quick + isolated MongoDB integration + browser E2E
  npm run verify:security separate authenticated MongoDB smoke (PowerShell 7)
  node scripts/verify.mjs full --dry-run

First image build downloads dependencies/browsers. Later runs reuse build cache.
No development database, published ports, external AI, or source bind mounts.
Logs and browser reports stay in .local-validation/<run>/.
Full does not replace authenticated-DB, backup rehearsal or physical-device checks.`);
}

async function outputDirectory(identity) {
  const base = path.join(repository, '.local-validation');
  await mkdir(base, { recursive: true });
  if ((await lstat(base)).isSymbolicLink()) throw new Error('Validation output directory must not be a link.');
  const directory = path.join(base, `${new Date().toISOString().replaceAll(':', '-')}-${identity}`);
  await mkdir(directory);
  await mkdir(path.join(directory, 'browser'));
  return directory;
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  if (options.help) { help(); return 0; }
  if (options.dryRun) {
    const steps = [];
    await runWorkflow(options.mode, async step => { steps.push(step); return true; });
    console.log(JSON.stringify({ mode: options.mode, dryRun: true, steps }, null, 2));
    return 0;
  }
  const identity = randomUUID().replaceAll('-', '');
  const startedAt = Date.now();
  const project = `pesc-verify-${identity}`;
  const prefix = composePrefix(project);
  const output = await outputDirectory(identity);
  const env = { ...process.env, PESC_VERIFY_RUN: identity,
    PESC_VERIFY_BROWSER_RESULTS: path.join(output, 'browser'), COMPOSE_MENU: 'false', COMPOSE_PROGRESS: 'plain' };
  const children = new Set();
  const results = [];
  let cancelled = false;
  let finished = false;
  const cancel = () => {
    if (finished || cancelled) return;
    cancelled = true;
    console.log('\nCancelling validation; cleaning only this run\'s isolated stack...');
    for (const child of children) child.kill('SIGTERM');
  };
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);

  async function runStep(step) {
    const started = Date.now();
    const logfile = path.join(output, `${step.name}.log`);
    const file = await open(logfile, 'wx');
    let timedOut = false;
    let code;
    console.log(`[RUN] ${step.name}`);
    try {
      const composeArgs = step.command === 'docker' && !['compose-version', 'docker-ready'].includes(step.name)
        ? [...prefix, ...step.args] : step.args;
      code = await new Promise(resolve => {
        const child = spawn(step.command, composeArgs, {
          cwd: repository, env, stdio: ['ignore', file.fd, file.fd], windowsHide: true,
        });
        children.add(child);
        const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, step.timeoutMs);
        const heartbeat = setInterval(() => console.log(`[WAIT] ${step.name} (${Math.round((Date.now() - started) / 1000)}s); see ${path.basename(logfile)}`), 30_000);
        child.once('error', error => {
          // Do not print arguments/environment; they are not needed for a process-start diagnosis.
          console.error(`Cannot start ${step.name}: ${error.code || 'process error'}`);
        });
        child.once('close', exitCode => {
          clearTimeout(timer);
          clearInterval(heartbeat);
          children.delete(child);
          resolve(exitCode ?? 1);
        });
      });
    } finally { await file.close(); }
    const status = code === 0 && !timedOut ? 'passed' : timedOut ? 'timed-out' : 'failed';
    const seconds = Math.round((Date.now() - started) / 100) / 10;
    results.push({ name: step.name, status, exitCode: code, seconds, log: path.basename(logfile) });
    console.log(`[${status === 'passed' ? 'PASS' : 'FAIL'}] ${step.name} (${seconds}s)`);
    if (status !== 'passed') {
      const tail = (await readFile(logfile, 'utf8')).slice(-5000);
      if (tail) console.error(tail);
      console.error(`Log: ${logfile}`);
    }
    return status === 'passed';
  }

  let passed = false;
  let errorMessage;
  console.log(`Validation: ${options.mode}\nIsolated project: ${project}\nResults: ${output}`);
  try {
    passed = await runWorkflow(options.mode, runStep, { isCancelled: () => cancelled });
  } catch (error) {
    errorMessage = error.message;
    console.error(`Validation runner failed: ${errorMessage}`);
  } finally {
    finished = true;
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
    await writeFile(path.join(output, 'summary.json'), JSON.stringify({
      mode: options.mode, project, status: cancelled ? 'cancelled' : passed ? 'passed' : 'failed',
      startedAt: new Date(startedAt).toISOString(), finishedAt: new Date().toISOString(),
      seconds: Math.round((Date.now() - startedAt) / 100) / 10,
      error: errorMessage, steps: results,
    }, null, 2) + '\n');
  }
  console.log(`\n${passed ? 'PASS' : 'FAIL'}: ${options.mode}. Summary: ${path.join(output, 'summary.json')}`);
  if (results.some(result => result.name === 'cleanup' && result.status !== 'passed')) {
    console.error(`Cleanup failed. Retry only: docker ${[...prefix, 'down', '--volumes', '--remove-orphans'].map(arg => JSON.stringify(arg)).join(' ')}`);
  }
  return passed ? 0 : cancelled ? 130 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
