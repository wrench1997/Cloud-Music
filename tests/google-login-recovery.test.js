const test = require('node:test');
const assert = require('node:assert/strict');
const { createGoogleLoginRecovery } = require('../src/lib/google-login-recovery');

function fixture(attempt, delays) {
  const timers = [];
  const states = [];
  const controller = createGoogleLoginRecovery({
    attempt,
    onState: (state) => states.push(state),
    ...(delays ? { delays } : {}),
    schedule: (callback, delay) => {
      const timer = { callback, delay, cancelled: false };
      timers.push(timer);
      return timer;
    },
    cancel: (timer) => { timer.cancelled = true; },
  });
  return { controller, timers, states };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

test('startup retries a temporary outage and stops permanently after reconnecting', async () => {
  let attempts = 0;
  const error = Object.assign(new Error('Service unavailable'), { status: 503 });
  const { controller, timers, states } = fixture(async () => ++attempts === 1 ? { error } : { connected: true });
  await controller.start();
  assert.equal(attempts, 1);
  assert.equal(timers[0].delay, 1000);
  assert.equal(states.at(-1).state, 'retrying');
  assert.equal(states.at(-1).error, error);
  await timers[0].callback();
  assert.equal(states.at(-1).state, 'connected');
  await Promise.all([controller.start(), controller.retry()]);
  await timers[0].callback();
  assert.equal(attempts, 2);
  assert.equal(timers.length, 1);
});

test('retry delays are bounded and a later online event starts another bounded cycle', async () => {
  let attempts = 0;
  const { controller, timers, states } = fixture(async () => {
    attempts += 1;
    throw new TypeError('Failed to fetch');
  });
  await controller.start();
  for (let index = 0; index < 3; index += 1) await timers[index].callback();
  assert.equal(attempts, 4);
  assert.deepEqual(timers.map((timer) => timer.delay), [1000, 3000, 10000]);
  assert.equal(states.at(-1).state, 'failed');
  assert.equal(states.at(-1).retryCount, 3);
  await controller.start();
  assert.equal(attempts, 4);
  await controller.retry();
  assert.equal(attempts, 5);
  assert.equal(timers[3].delay, 1000);
  controller.stop();
});

test('concurrent startup, foreground and online calls share one restore attempt', async () => {
  const pending = deferred();
  let attempts = 0;
  const { controller, states } = fixture(() => { attempts += 1; return pending.promise; });
  const first = controller.start();
  assert.equal(controller.start(), first);
  assert.equal(controller.retry(), first);
  await Promise.resolve();
  assert.equal(attempts, 1);
  pending.resolve(true);
  assert.equal(await first, true);
  assert.deepEqual(states.map(({ state }) => state), ['connecting', 'connected']);
});

test('online events accelerate a pending retry without resetting the retry budget', async () => {
  const pending = deferred();
  let attempts = 0;
  const error = Object.assign(new Error('Temporary'), { code: 'GOOGLE_AUTH_TEMPORARY' });
  const { controller, timers, states } = fixture(() => ++attempts === 1 ? { error } : pending.promise, [10]);
  await controller.start();
  const second = controller.retry();
  assert.equal(timers[0].cancelled, true);
  assert.equal(controller.retry(), second);
  await timers[0].callback();
  await Promise.resolve();
  assert.equal(attempts, 2);
  pending.resolve({ error });
  await second;
  assert.equal(timers.length, 1);
  assert.equal(states.at(-1).state, 'failed');
});

test('authorization, account, configuration and cancellation errors never retry even with a transient status', async () => {
  for (const code of ['GOOGLE_AUTH_REQUIRED', 'GOOGLE_ACCOUNT_MISMATCH', 'GOOGLE_CONFIG_REQUIRED', 'GOOGLE_AUTH_DENIED', 'GOOGLE_LOGIN_CANCELLED', 'invalid_grant', 'access_denied']) {
    let attempts = 0;
    const error = Object.assign(new Error(code), { code, status: 503 });
    const { controller, timers, states } = fixture(() => { attempts += 1; throw error; });
    await controller.start();
    await controller.retry();
    assert.equal(attempts, 1, code);
    assert.equal(timers.length, 0, code);
    assert.equal(states.at(-1).state, 'failed', code);
    assert.equal(states.at(-1).error, error, code);
  }
  const { controller, timers } = fixture(async () => ({ error: Object.assign(new Error('Cancelled'), { status: 503 }), cancelled: true }));
  await controller.start();
  await controller.retry();
  assert.equal(timers.length, 0);
});

test('no cached account, permission failure and unrelated programming errors do not schedule login attempts', async () => {
  for (const result of [false, undefined, { connected: false }, { error: { status: 401 } }, { error: { status: 403 } }, { error: new TypeError('Cannot read properties of undefined') }]) {
    let attempts = 0;
    const { controller, timers, states } = fixture(() => { attempts += 1; return result; });
    await controller.start();
    await controller.retry();
    assert.equal(attempts, 1);
    assert.equal(timers.length, 0);
    assert.equal(states.at(-1).state, 'failed');
    assert.equal(states.at(-1).error, result?.error);
  }
});

test('temporary native exchange, aborted or timed out requests and retryable HTTP statuses are retried', async () => {
  for (const error of [
    { code: 'GOOGLE_AUTH_TEMPORARY' },
    { code: 'GOOGLE_TOKEN_EXCHANGE_FAILED' },
    { name: 'AbortError' },
    { name: 'TimeoutError' },
    { status: 408 },
    { status: 429 },
    { statusCode: 500 },
    { response: { status: 599 } },
  ]) {
    const { controller, timers, states } = fixture(async () => ({ error }));
    await controller.start();
    assert.equal(timers.length, 1, JSON.stringify(error));
    assert.equal(states.at(-1).state, 'retrying', JSON.stringify(error));
    controller.stop();
  }
});

test('logging out during a restore ignores both late success and late failure and cannot be restarted', async () => {
  for (const success of [true, false]) {
    const pending = deferred();
    let attempts = 0;
    const { controller, timers, states } = fixture(() => { attempts += 1; return pending.promise; });
    const running = controller.start();
    await Promise.resolve();
    controller.stop();
    const statesAtLogout = states.length;
    if (success) pending.resolve({ connected: true });
    else pending.reject(Object.assign(new Error('Temporary'), { status: 503 }));
    assert.equal(await running, false);
    assert.equal(await controller.start(), false);
    assert.equal(await controller.retry(), false);
    assert.equal(attempts, 1);
    assert.equal(states.length, statesAtLogout);
    assert.equal(timers.length, 0);
  }
});

test('logging out cancels the next retry and ignores already queued timer callbacks', async () => {
  let attempts = 0;
  const { controller, timers, states } = fixture(async () => { attempts += 1; return { error: { status: 503 } }; });
  await controller.start();
  controller.stop();
  const statesAtLogout = states.length;
  assert.equal(timers[0].cancelled, true);
  await timers[0].callback();
  assert.equal(attempts, 1);
  assert.equal(states.length, statesAtLogout);
});

test('a controller stopped immediately after start never initiates a queued restore', async () => {
  let attempts = 0;
  const { controller } = fixture(async () => { attempts += 1; return true; });
  const running = controller.start();
  controller.stop();
  assert.equal(await running, false);
  assert.equal(attempts, 0);
});
