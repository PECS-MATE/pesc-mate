import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { composePrefix, parseArguments, planFor, repository, runWorkflow } from '../verify.mjs';

test('arguments default to quick and reject unknown or ambiguous inputs before any process starts', () => {
  assert.deepEqual(parseArguments([]), { mode: 'quick', help: false, dryRun: false });
  assert.deepEqual(parseArguments(['full', '--dry-run']), { mode: 'full', help: false, dryRun: true });
  for (const args of [['production'], ['full', 'backend'], ['--project-name=production'], ['--skip-cleanup']]) {
    assert.throws(() => parseArguments(args));
  }
});

test('Compose commands require a UUID-owned project and one explicit validation file and environment file', () => {
  const project = 'pesc-verify-' + 'a'.repeat(32);
  const prefix = composePrefix(project, '/synthetic path');
  assert.deepEqual(prefix.slice(-2), ['-p', project]);
  assert.equal(prefix[prefix.indexOf('-f') + 1], path.join('/synthetic path', 'compose.verify.yaml'));
  assert.equal(prefix[prefix.indexOf('--env-file') + 1], path.join('/synthetic path', 'scripts', 'verify.env'));
  for (const name of ['pesc-mate', 'production', 'pesc-verify-', project + '-other', '../pesc-mate']) {
    assert.throws(() => composePrefix(name));
  }
});

test('presets omit the expensive browser image except in full mode', () => {
  assert.deepEqual(planFor('quick').images, ['backend', 'frontend']);
  assert.deepEqual(planFor('backend').images, ['backend']);
  assert.deepEqual(planFor('frontend').images, ['frontend']);
  assert.deepEqual(planFor('full').images, ['backend', 'frontend', 'browser']);
  assert.throws(() => planFor('arbitrary'));
});

test('full runs both independent checks then integration then healthy servers and browser before cleanup', async () => {
  const steps = [];
  assert.equal(await runWorkflow('full', async step => { steps.push(step); return true; }), true);
  assert.deepEqual(steps.map(step => step.name), [
    'runner-policy', 'compose-version', 'docker-ready', 'build', 'backend-unit', 'frontend-tests-build',
    'mongodb-start', 'mongodb-integration', 'browser-servers', 'browser-connectivity', 'browser-e2e', 'cleanup',
  ]);
  assert.ok(steps.find(step => step.name === 'backend-unit').args.includes('DEMO_ACCOUNTS_ENABLED=false'));
  assert.ok(steps.find(step => step.name === 'mongodb-integration').args.includes('--no-deps'));
  assert.deepEqual(steps.at(-1).args, ['down', '--volumes', '--remove-orphans', '--timeout', '10']);
});

for (const mode of ['quick', 'frontend', 'backend']) {
  test(`${mode} never starts DB/servers/browser and does not run the other scoped checks`, async () => {
    const steps = [];
    assert.equal(await runWorkflow(mode, async step => { steps.push(step.name); return true; }), true);
    assert.ok(!steps.some(name => /mongodb|browser/.test(name)));
    assert.equal(steps.includes('backend-unit'), mode !== 'frontend');
    assert.equal(steps.includes('frontend-tests-build'), mode !== 'backend');
    assert.equal(steps.at(-1), 'cleanup');
  });
}

for (const failed of ['runner-policy', 'compose-version', 'docker-ready', 'build', 'backend-unit',
  'frontend-tests-build', 'mongodb-start', 'mongodb-integration', 'browser-servers', 'browser-connectivity', 'browser-e2e']) {
  test(`failure in ${failed} returns nonzero outcome and cleans only after Docker work has started`, async () => {
    const steps = [];
    assert.equal(await runWorkflow('full', async step => {
      steps.push(step.name);
      return step.name !== failed;
    }), false);
    const touched = !['runner-policy', 'compose-version', 'docker-ready'].includes(failed);
    assert.equal(steps.includes('cleanup'), touched);
    assert.equal(steps.includes('service-logs'), touched);
    if (touched) assert.equal(steps.at(-1), 'cleanup');
    if (failed !== 'browser-e2e') assert.ok(!steps.includes('browser-e2e'));
  });
}

test('cleanup failure cannot become a successful validation result', async () => {
  assert.equal(await runWorkflow('quick', async step => step.name !== 'cleanup'), false);
});

test('cancellation after build skips checks but still runs scoped diagnostics and cleanup', async () => {
  const steps = [];
  let cancelled = false;
  assert.equal(await runWorkflow('full', async step => {
    steps.push(step.name);
    if (step.name === 'build') cancelled = true;
    return true;
  }, { isCancelled: () => cancelled }), false);
  assert.deepEqual(steps.slice(-2), ['service-logs', 'cleanup']);
  assert.ok(!steps.includes('browser-e2e'));
  assert.ok(!steps.includes('backend-unit'));
});

test('unexpected integration exceptions still clean up and propagate failure', async () => {
  const steps = [];
  await assert.rejects(runWorkflow('full', async step => {
    steps.push(step.name);
    if (step.name === 'mongodb-integration') throw new Error('synthetic process error');
    return true;
  }), /synthetic process error/);
  assert.equal(steps.at(-1), 'cleanup');
});

test('parallel checks both settle before cleanup even when one throws', async () => {
  let finishedFrontend = false;
  assert.equal(await runWorkflow('quick', async step => {
    if (step.name === 'backend-unit') throw new Error('synthetic unit error');
    if (step.name === 'frontend-tests-build') {
      await new Promise(resolve => setImmediate(resolve));
      finishedFrontend = true;
    }
    if (step.name === 'cleanup') assert.equal(finishedFrontend, true);
    return true;
  }), false);
});

test('dry run prints a plan without requiring Docker or starting the policy tests recursively', () => {
  const result = spawnSync(process.execPath, [path.join(repository, 'scripts', 'verify.mjs'), 'full', '--dry-run'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.dryRun, true);
  assert.equal(plan.steps.at(-1).name, 'cleanup');
  assert.ok(plan.steps.some(step => step.name === 'browser-e2e'));
});

test('validation Compose policy has no published ports, development volumes or external AI', async () => {
  const compose = await readFile(path.join(repository, 'compose.verify.yaml'), 'utf8');
  assert.doesNotMatch(compose, /^\s+(ports|container_name|external):/m);
  assert.doesNotMatch(compose, /mongodb_data|frontend_node_modules|host\.docker\.internal|\.\/backend\/app:/);
  assert.match(compose, /internal: true/);
  assert.match(compose, /network_mode: service:frontend/);
  assert.match(compose, /E2E_BASE_URL: http:\/\/127\.0\.0\.1:5173/);
  assert.doesNotMatch(compose, /allowedHosts|unsafely-treat-insecure/);
  assert.match(compose, /OLLAMA_ENABLED: "false"/);
  assert.match(compose, /tmpfs:/);
  assert.match(compose, /target: \/app\/test-results/);
  assert.match(compose, /PESC_VERIFY_RUN:\?Use the validation runner/);
  const dockerfile = await readFile(path.join(repository, 'frontend', 'Dockerfile.verify'), 'utf8');
  assert.match(dockerfile, /"--workers=1"/);
  // Browser/dependency installation stays above the source COPY for reusable build cache.
  assert.ok(dockerfile.indexOf('RUN npx playwright install') < dockerfile.lastIndexOf('COPY . .'));
  assert.match(await readFile(path.join(repository, 'frontend', '.dockerignore'), 'utf8'), /^test-results\/\r?$/m);
});
