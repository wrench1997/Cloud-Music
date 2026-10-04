function isTransientError(error) {
  if (!error) return false;
  const code = String(error.code || error.error || '');
  // A network status must never override a decision requiring the user's consent.
  if (/AUTH_REQUIRED|ACCOUNT_MISMATCH|CONFIG|DENIED|CANCEL|invalid_grant|login_required|interaction_required|consent_required|account_selection_required/i.test(code)) return false;
  if (code === 'GOOGLE_AUTH_TEMPORARY' || code === 'GOOGLE_TOKEN_EXCHANGE_FAILED') return true;
  if (error.name === 'AbortError' || error.name === 'TimeoutError' || code === 'ABORT_ERR' || code === 'ETIMEDOUT') return true;
  if (error.name === 'TypeError' && /fetch|network|load failed|failed to load|网络/i.test(error.message || '')) return true;
  const status = Number(error.status ?? error.statusCode ?? error.response?.status);
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

// This controller only calls a noninteractive restore attempt. stop() is final;
// create a new controller after a deliberate account change or a new mount.
function createGoogleLoginRecovery({ attempt, onState = () => {}, schedule = setTimeout, cancel = clearTimeout, delays = [1000, 3000, 10000] }) {
  if (typeof attempt !== 'function') throw new TypeError('A login recovery attempt is required.');
  const retryDelays = [...delays];
  let started = false;
  let stopped = false;
  let connected = false;
  let retryable = false;
  let retryCount = 0;
  let pendingTimer;
  let inFlight;
  let lastResult;

  function clearPendingTimer() {
    if (!pendingTimer) return;
    const timer = pendingTimer;
    pendingTimer = undefined;
    timer.active = false;
    cancel(timer.handle);
  }

  function emit(state, error, delay) {
    if (!stopped) onState({ state, error, retryCount, ...(delay === undefined ? {} : { delay }) });
  }

  function finish(record, result) {
    if (stopped || inFlight !== record) return false;
    inFlight = undefined;
    lastResult = result;
    if (!result?.cancelled && !result?.canceled && (result === true || result?.connected === true)) {
      connected = true;
      retryable = false;
      emit('connected');
      return result;
    }
    const error = result?.error;
    retryable = !result?.cancelled && !result?.canceled && isTransientError(error);
    if (retryable && retryCount < retryDelays.length) {
      const delay = retryDelays[retryCount++];
      const timer = { active: true };
      pendingTimer = timer;
      timer.handle = schedule(() => {
        // Cancelled callbacks can still be delivered by an event-loop scheduler.
        if (stopped || !timer.active || pendingTimer !== timer) return;
        pendingTimer = undefined;
        timer.active = false;
        return runAttempt();
      }, delay);
      emit('retrying', error, delay);
    } else emit('failed', error);
    return result;
  }

  function runAttempt() {
    if (stopped || connected) return Promise.resolve(stopped ? false : lastResult);
    if (inFlight) return inFlight.promise;
    const record = {};
    record.promise = Promise.resolve()
      .then(() => stopped ? undefined : attempt())
      .then((result) => finish(record, result), (error) => finish(record, { error }));
    inFlight = record;
    emit('connecting');
    return record.promise;
  }

  function start() {
    if (stopped || connected) return Promise.resolve(stopped ? false : lastResult);
    if (inFlight) return inFlight.promise;
    if (started) return Promise.resolve(lastResult);
    started = true;
    return runAttempt();
  }

  function retry() {
    if (stopped || connected) return Promise.resolve(stopped ? false : lastResult);
    if (inFlight) return inFlight.promise;
    if (!started) return start();
    // Going online can accelerate a pending retry, but cannot replenish its budget.
    if (pendingTimer) {
      clearPendingTimer();
      return runAttempt();
    }
    if (!retryable) return Promise.resolve(lastResult);
    // A foreground/online event can start a fresh bounded cycle after exhaustion.
    retryCount = 0;
    return runAttempt();
  }

  function stop() {
    stopped = true;
    clearPendingTimer();
    inFlight = undefined;
  }

  return { start, retry, stop };
}

module.exports = { createGoogleLoginRecovery };
