const GOOGLE_LOGIN_TIMEOUT_MS = 120000;

function authError(message, code) {
  return Object.assign(new Error(message), { code });
}

function popupError(error) {
  if (error?.type === 'popup_closed') return authError('Google 登录已取消。', 'GOOGLE_LOGIN_CANCELLED');
  if (error?.type === 'popup_failed_to_open') return authError('无法打开 Google 登录窗口，请允许此页面弹出窗口后重试。', 'GOOGLE_POPUP_BLOCKED');
  return authError('Google 登录窗口发生错误，请关闭窗口后重试。', 'GOOGLE_LOGIN_FAILED');
}

function createGoogleTokenRequester({ oauth2, clientId, scopes, onToken, timeoutMs = GOOGLE_LOGIN_TIMEOUT_MS, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let pending;

  function signIn({ account } = {}) {
    if (pending) return pending.promise;
    const accountHint = typeof account === 'string' ? account.trim() : '';
    const attempt = { active: true };
    attempt.promise = new Promise((resolve, reject) => { attempt.resolve = resolve; attempt.reject = reject; });
    pending = attempt;

    const finish = (error, value) => {
      if (!attempt.active) return;
      attempt.active = false;
      clearTimer(attempt.timer);
      if (pending === attempt) pending = undefined;
      if (error) attempt.reject(error);
      else attempt.resolve(value);
    };
    attempt.cancel = (error) => finish(error);
    attempt.timer = setTimer(() => finish(authError('Google 登录等待超时，请关闭登录窗口后重试。', 'GOOGLE_LOGIN_TIMEOUT')), timeoutMs);

    try {
      // GIS takes popup error handling in the initial configuration. Each attempt
      // owns its callbacks, so a closed or timed-out popup cannot complete a retry.
      const client = oauth2.initTokenClient({
        client_id: clientId,
        scope: scopes.join(' '),
        callback: (result) => {
          if (!attempt.active) return;
          try {
            if (result?.error || typeof result?.access_token !== 'string' || !result.access_token
              || !oauth2.hasGrantedAllScopes(result, ...scopes)) {
              finish(authError('请允许读取 Google Drive 目录和音乐，以及保存应用曲库。', 'GOOGLE_AUTH_DENIED'));
              return;
            }
            finish(undefined, onToken ? onToken(result) : result.access_token);
          } catch (error) { finish(error); }
        },
        error_callback: (error) => finish(popupError(error)),
      });
      client.requestAccessToken({ prompt: accountHint ? '' : 'select_account', ...(accountHint ? { login_hint: accountHint } : {}) });
    } catch (error) { finish(error); }
    return attempt.promise;
  }

  function cancel() {
    pending?.cancel(authError('Google 登录已取消。', 'GOOGLE_LOGIN_CANCELLED'));
  }

  return { signIn, cancel };
}

module.exports = { GOOGLE_LOGIN_TIMEOUT_MS, createGoogleTokenRequester };
