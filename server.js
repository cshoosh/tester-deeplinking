const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { URL } = require('node:url');

const configPath = path.join(__dirname, 'deep-links.config.json');

function readConfig() {
  const fallback = {
    appName: 'Deep Link Tester',
    environments: [],
    routes: []
  };

  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    return { ...fallback, ...JSON.parse(raw) };
  } catch (error) {
    return fallback;
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toQueryString(params) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      searchParams.set(key, String(value));
    }
  });
  return searchParams.toString();
}

function normalizeSuffix(value) {
  if (!value) {
    return '';
  }
  const suffix = value.startsWith('/') ? value : `/${value}`;
  return suffix === '/' ? '' : suffix;
}

function resolvePath(route, params, usePlaceholders = false) {
  const raw = route.pathTemplate || '';
  return raw.replace(/\{([^}]+)\}/g, (_, key) => {
    const value = params[key];
    if (value !== undefined && String(value).trim() !== '') {
      return String(value).trim().replace(/^\/+/, '');
    }
    return usePlaceholders ? `[${key}]` : '';
  });
}

function buildUrls(environment, route, params, usePlaceholders = false) {
  const pathSuffix = normalizeSuffix(resolvePath(route, params, usePlaceholders));
  const webBasePath = normalizeSuffix(environment.webBasePath || '/tradeapp');
  const webHost = process.env[`DEEPLINK_${environment.key.toUpperCase()}_WEB_HOST`] || environment.webHost;
  const schemeEnabled =
    process.env[`DEEPLINK_${environment.key.toUpperCase()}_SCHEME_ENABLED`] === 'true'
      ? true
      : environment.schemeEnabled !== false;
  const schemePrefix = process.env.DEEPLINK_SCHEME || environment.schemePrefix || 'tradeapp';
  const schemeHost = process.env.DEEPLINK_SCHEME_HOST || environment.schemeHost || 'tradeapp';

  const webUrl = webHost ? `https://${webHost}${webBasePath}${pathSuffix}` : '';
  const schemeUrl = schemeEnabled && schemeHost ? `${schemePrefix}://${schemeHost}${pathSuffix}` : '';

  return { webUrl, schemeUrl, pathSuffix, webBasePath, schemeHost, schemePrefix, webHost };
}

function getSelectedEnvironment(config, envKey) {
  return config.environments.find((env) => env.key === envKey) || config.environments[0];
}

function getSelectedRoute(config, routeKey) {
  return config.routes.find((route) => route.key === routeKey) || config.routes[0];
}

function buildParamState(route, searchParams) {
  return (route.params || []).reduce((acc, param) => {
    acc[param.key] = searchParams.get(param.key) || '';
    return acc;
  }, {});
}

function buildPreviewParamState(route) {
  return (route.params || []).reduce((acc, param) => {
    acc[param.key] = param.previewPlaceholder || param.placeholder || `[${param.key}]`;
    return acc;
  }, {});
}

function getMissingRequiredParams(route, params) {
  return (route.params || [])
    .filter((param) => param.required && String(params[param.key] || '').trim() === '')
    .map((param) => param.key);
}

function buildMissingParamsAlert(route, params) {
  const missing = getMissingRequiredParams(route, params);
  if (missing.length === 0) {
    return '';
  }

  const labels = (route.params || [])
    .filter((param) => missing.includes(param.key))
    .map((param) => param.label || param.key);

  return `Please enter: ${labels.join(', ')}.`;
}

function renderParamInputs(route, params) {
  if (!route.params || route.params.length === 0) {
    return '<p class="hint">This route does not require additional input.</p>';
  }

  return `
    <div class="param-grid">
      ${route.params
        .map(
          (param) => `
            <label class="field">
              <span>${escapeHtml(param.label)}${param.required ? ' *' : ''}</span>
              <input
                name="${escapeHtml(param.key)}"
                value="${escapeHtml(params[param.key] || '')}"
                placeholder="${escapeHtml(param.placeholder || '')}"
                ${param.required ? 'required' : ''}
              />
            </label>
          `
        )
        .join('')}
    </div>
  `;
}

function renderRouteCard(config, route, currentEnvironment, currentParams, activeRouteKey) {
  const routeParams = currentParams || {};
  const placeholderParams = buildPreviewParamState(route);
  const usePlaceholders = getMissingRequiredParams(route, routeParams).length > 0;
  const currentUrls = buildUrls(currentEnvironment, route, routeParams, usePlaceholders);
  const referenceParams = route.key === activeRouteKey ? routeParams : placeholderParams;
  const placeholderUrls = config.environments.map((env) => ({
    environment: env,
    ...buildUrls(env, route, referenceParams, route.key !== activeRouteKey)
  }));

  return `
    <article class="card">
      <div class="card-head">
        <div>
          <h3>${escapeHtml(route.label)}</h3>
          <p>${escapeHtml(route.description || '')}</p>
        </div>
        <span class="badge">${escapeHtml(route.key)}</span>
      </div>
      <div class="card-body">
        <div>
          <div class="mini-label">Selected env preview</div>
          <code>${escapeHtml(currentUrls.schemeUrl || currentUrls.webUrl || 'Unavailable')}</code>
        </div>
        <div>
          <div class="mini-label">Environment references</div>
          <div class="reference-list">
            ${placeholderUrls
              .map(
                (item) => `
                  <div class="reference-row">
                    <strong>${escapeHtml(item.environment.label)}</strong>
                    <code>${escapeHtml(item.schemeUrl || item.webUrl || 'Unavailable')}</code>
                  </div>
                `
              )
              .join('')}
          </div>
        </div>
      </div>
    </article>
  `;
}

function renderPage(config, requestUrl, selectedEnvKey, selectedRouteKey) {
  const selectedEnvironment = getSelectedEnvironment(config, selectedEnvKey);
  const selectedRoute = getSelectedRoute(config, selectedRouteKey);
  const currentParams = buildParamState(selectedRoute, requestUrl.searchParams);
  const currentMissingParams = getMissingRequiredParams(selectedRoute, currentParams);
  const previewUrls = config.environments.map((env) => ({
    environment: env,
    ...(currentMissingParams.length > 0
      ? buildUrls(env, selectedRoute, currentParams, true)
      : buildUrls(env, selectedRoute, currentParams, false))
  }));
  const selectedMissingAlert = buildMissingParamsAlert(selectedRoute, currentParams);
  const selectedTargetUrls = buildUrls(
    selectedEnvironment,
    selectedRoute,
    currentParams,
    currentMissingParams.length > 0
  );
  const selectedCopyUrl = selectedTargetUrls.schemeUrl || selectedTargetUrls.webUrl || '';

  const cardsHtml = config.routes
    .map((route) => renderRouteCard(config, route, selectedEnvironment, route === selectedRoute ? currentParams : {}, selectedRoute.key))
    .join('');

  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${escapeHtml(config.appName)} Deep Link Tester</title>
      <style>
        :root {
          color-scheme: light;
          --bg: #f5f1e9;
          --panel: rgba(255, 255, 255, 0.88);
          --text: #1d2329;
          --muted: #5f6b76;
          --accent: #0f766e;
          --accent-2: #134e4a;
          --border: rgba(29, 35, 41, 0.12);
          --shadow: 0 20px 50px rgba(15, 23, 42, 0.10);
        }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          background:
            radial-gradient(circle at top left, rgba(15, 118, 110, 0.15), transparent 30%),
            radial-gradient(circle at top right, rgba(250, 204, 21, 0.12), transparent 26%),
            var(--bg);
          color: var(--text);
        }
        .shell {
          max-width: 1240px;
          margin: 0 auto;
          padding: 28px 20px 48px;
        }
        .hero {
          display: grid;
          gap: 18px;
          grid-template-columns: 1.3fr 1fr;
          align-items: start;
          margin-bottom: 22px;
        }
        .panel {
          background: var(--panel);
          backdrop-filter: blur(14px);
          border: 1px solid var(--border);
          border-radius: 20px;
          box-shadow: var(--shadow);
          padding: 22px;
        }
        h1, h2, h3, p, dl, dt, dd { margin: 0; }
        h1 {
          font-size: clamp(2rem, 4vw, 3.2rem);
          line-height: 1.05;
          letter-spacing: -0.04em;
          margin-bottom: 10px;
        }
        .lede {
          color: var(--muted);
          line-height: 1.55;
          max-width: 68ch;
        }
        .layout {
          display: grid;
          gap: 16px;
          margin-top: 18px;
        }
        .builder {
          display: grid;
          gap: 14px;
        }
        .grid-2 {
          display: grid;
          gap: 12px;
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .field {
          display: grid;
          gap: 8px;
          color: var(--muted);
          font-size: 0.9rem;
        }
        .field input, .field select {
          width: 100%;
          padding: 12px 14px;
          border-radius: 12px;
          border: 1px solid var(--border);
          background: white;
          font: inherit;
        }
        .param-grid {
          display: grid;
          gap: 12px;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        }
        .actions {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }
        .button, .button-secondary {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          border-radius: 999px;
          padding: 12px 16px;
          font-weight: 600;
          text-decoration: none;
          cursor: pointer;
          border: 1px solid transparent;
        }
        .button {
          background: var(--accent);
          color: white;
        }
        .button:hover { background: var(--accent-2); }
        .button-secondary {
          background: white;
          color: var(--text);
          border-color: var(--border);
        }
        .button-secondary:hover { border-color: rgba(29, 35, 41, 0.24); }
        .meta {
          display: grid;
          gap: 12px;
        }
        .meta-row {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          padding: 10px 0;
          border-bottom: 1px solid var(--border);
        }
        .meta-row:last-child { border-bottom: 0; }
        .label { color: var(--muted); font-size: 0.9rem; }
        code {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 0.9em;
          padding: 0.15rem 0.35rem;
          border-radius: 6px;
          background: rgba(15, 23, 42, 0.06);
          overflow-wrap: anywhere;
        }
        .section {
          margin-top: 26px;
        }
        .section h2 {
          font-size: 1.1rem;
          margin-bottom: 12px;
        }
        .reference-grid {
          display: grid;
          gap: 16px;
          grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        }
        .card {
          background: rgba(255,255,255,0.9);
          border: 1px solid var(--border);
          border-radius: 18px;
          padding: 18px;
          display: grid;
          gap: 14px;
        }
        .card-head {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: start;
        }
        .card h3 { font-size: 1rem; margin-bottom: 4px; }
        .card p { color: var(--muted); line-height: 1.45; font-size: 0.93rem; }
        .card-body { display: grid; gap: 12px; }
        .mini-label {
          color: var(--muted);
          font-size: 0.82rem;
          margin-bottom: 6px;
        }
        .reference-list {
          display: grid;
          gap: 8px;
        }
        .reference-row {
          display: grid;
          gap: 4px;
        }
        .badge {
          display: inline-flex;
          align-items: center;
          border-radius: 999px;
          background: rgba(15, 118, 110, 0.12);
          color: var(--accent-2);
          padding: 6px 10px;
          font-size: 0.75rem;
          font-weight: 700;
          letter-spacing: 0.02em;
          text-transform: uppercase;
        }
        .hint {
          color: var(--muted);
          font-size: 0.92rem;
          line-height: 1.5;
        }
        .preview-list {
          display: grid;
          gap: 10px;
        }
        .preview-row {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: start;
          padding: 10px 0;
          border-bottom: 1px solid var(--border);
        }
        .preview-row:last-child { border-bottom: 0; }
        .launch {
          white-space: nowrap;
        }
        .footnote {
          margin-top: 14px;
          color: var(--muted);
          font-size: 0.92rem;
          line-height: 1.5;
        }
        @media (max-width: 920px) {
          .hero { grid-template-columns: 1fr; }
          .grid-2 { grid-template-columns: 1fr; }
          .preview-row, .card-head, .meta-row { flex-direction: column; }
        }
      </style>
    </head>
    <body>
      <main class="shell">
        <section class="hero">
          <div class="panel">
            <h1>${escapeHtml(config.appName)} deep link tester</h1>
            <p class="lede">
              Generate and launch the exact SIT, UAT, and PROD URLs from the trade app deep link guide.
              Fill in dynamic values like order IDs, order numbers, quote codes, category IDs, product SKUs, experience IDs, and list names before launching.
            </p>

            <form class="layout builder" action="/" method="get" data-live-form>
              <div class="grid-2">
                <label class="field">
                  <span>Environment</span>
                  <select name="env">
                    ${config.environments
                      .map(
                        (env) => `
                          <option value="${escapeHtml(env.key)}" ${env.key === selectedEnvironment.key ? 'selected' : ''}>
                            ${escapeHtml(env.label)}
                          </option>
                        `
                      )
                      .join('')}
                  </select>
                </label>
                <label class="field">
                  <span>Route</span>
                  <select name="route">
                    ${config.routes
                      .map(
                        (route) => `
                          <option value="${escapeHtml(route.key)}" ${route.key === selectedRoute.key ? 'selected' : ''}>
                            ${escapeHtml(route.label)}
                          </option>
                        `
                      )
                      .join('')}
                  </select>
                </label>
              </div>

              ${renderParamInputs(selectedRoute, currentParams)}

              <div class="actions">
                <button type="submit" class="button-secondary">Open selected route</button>
                <button
                  type="button"
                  class="button-secondary"
                  data-copy-url="${escapeHtml(selectedCopyUrl)}"
                >
                  Copy url
                </button>
              </div>
            </form>

            <p class="footnote">
              Selected route: <code>${escapeHtml(selectedRoute.key)}</code> in <code>${escapeHtml(selectedEnvironment.label)}</code>
            </p>
          </div>

          <aside class="panel meta">
            <div class="meta-row">
              <span class="label">Selected env</span>
              <strong>${escapeHtml(selectedEnvironment.label)}</strong>
            </div>
            <div class="meta-row">
              <span class="label">Web host</span>
              <strong><code>${escapeHtml(selectedEnvironment.webHost || 'not set')}</code></strong>
            </div>
            <div class="meta-row">
              <span class="label">Scheme</span>
              <strong><code>${escapeHtml(selectedEnvironment.schemeEnabled === false ? 'disabled' : `${selectedEnvironment.schemePrefix || 'tradeapp'}://${selectedEnvironment.schemeHost || 'tradeapp'}`)}</code></strong>
            </div>
            <div class="meta-row">
              <span class="label">Web base path</span>
              <strong><code>${escapeHtml(selectedEnvironment.webBasePath || '/tradeapp')}</code></strong>
            </div>
            <div class="meta-row">
              <span class="label">JSON endpoint</span>
              <strong><code>/api/deep-links</code></strong>
            </div>
          </aside>
        </section>

        <section class="panel">
          <h2>Preview URLs for selected route</h2>
          <div class="preview-list">
            ${previewUrls
              .map(
                (item) => `
                  <div class="preview-row">
                    <div>
                      <strong>${escapeHtml(item.environment.label)}</strong>
                      <div class="hint">${escapeHtml(item.environment.notes || '')}</div>
                    </div>
                    <div>
                      <div><code>${escapeHtml(item.schemeUrl || 'Scheme disabled')}</code></div>
                      <div style="margin-top: 6px;"><code>${escapeHtml(item.webUrl || 'Web host not set')}</code></div>
                    </div>
                    ${
                      currentMissingParams.length === 0
                        ? `<button type="button" class="button launch" data-href="${escapeHtml(`/open?${toQueryString({ env: item.environment.key, route: selectedRoute.key, ...currentParams })}`)}">Launch</button>`
                        : `<button type="button" class="button launch" data-error="${escapeHtml(selectedMissingAlert || 'Please enter the required values.')}">Enter required values</button>`
                    }
                  </div>
                `
              )
              .join('')}
          </div>
        </section>

        <section class="section">
          <h2>Route reference</h2>
          <div class="reference-grid">
            ${cardsHtml}
          </div>
        </section>
      </main>
      <script>
        (function () {
          var form = document.querySelector('[data-live-form]');
          if (!form) return;

          var timer = null;

          function buildSearchParams() {
            var formData = new FormData(form);
            var params = new URLSearchParams();

            params.set('env', String(formData.get('env') || 'sit'));
            params.set('route', String(formData.get('route') || 'dashboard'));

            formData.forEach(function (value, key) {
              if (key === 'env' || key === 'route') return;
              if (String(value).trim() !== '') {
                params.set(key, String(value));
              }
            });

            return params.toString();
          }

          function syncNow() {
            window.location.search = buildSearchParams();
          }

          function syncWithoutReload() {
            window.history.replaceState({}, '', '?' + buildSearchParams());
          }

          function syncSoon() {
            window.clearTimeout(timer);
            timer = window.setTimeout(syncWithoutReload, 1000);
          }

          function buildCurrentSearchParams() {
            var formData = new FormData(form);
            var params = new URLSearchParams();

            params.set('env', String(formData.get('env') || 'sit'));
            params.set('route', String(formData.get('route') || 'dashboard'));

            formData.forEach(function (value, key) {
              if (key === 'env' || key === 'route') return;
              if (String(value).trim() !== '') {
                params.set(key, String(value));
              }
            });

            return params;
          }

          function buildCurrentOpenUrl() {
            return '/open?' + buildCurrentSearchParams().toString();
          }

          form.addEventListener('change', function (event) {
            if (event.target && (event.target.name === 'env' || event.target.name === 'route')) {
              syncNow();
            }
          });

          form.addEventListener('input', function (event) {
            if (event.target && event.target.name && event.target.name !== 'env' && event.target.name !== 'route') {
              syncSoon();
            }
          });

          form.addEventListener('submit', function (event) {
            event.preventDefault();
            window.location.href = buildCurrentOpenUrl();
          });

        })();

        function copyToClipboard(value) {
          if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            return navigator.clipboard.writeText(value);
          }

          var textarea = document.createElement('textarea');
          textarea.value = value;
          textarea.setAttribute('readonly', '');
          textarea.style.position = 'fixed';
          textarea.style.top = '-9999px';
          textarea.style.left = '-9999px';
          document.body.appendChild(textarea);
          textarea.select();
          var copied = document.execCommand('copy');
          document.body.removeChild(textarea);
          return copied ? Promise.resolve() : Promise.reject(new Error('Copy failed'));
        }

        document.addEventListener('click', function (event) {
          var copyButton = event.target.closest('[data-copy-url]');
          if (copyButton) {
            event.preventDefault();
            if (copyButton.dataset.error) {
              alert(copyButton.dataset.error);
              return;
            }
            copyToClipboard(copyButton.dataset.copyUrl || '')
              .then(function () {
                var originalLabel = copyButton.textContent;
                copyButton.textContent = 'Copied';
                window.setTimeout(function () {
                  copyButton.textContent = originalLabel;
                }, 1200);
              })
              .catch(function () {
                alert('Unable to copy the URL.');
              });
            return;
          }

          var button = event.target.closest('[data-href], [data-error], [data-copy-url]');
          if (!button) return;
          event.preventDefault();
          if (button.matches('button[type="submit"]')) {
            return;
          }
          if (button.dataset.error) {
            alert(button.dataset.error);
            return;
          }
          if (button.dataset.href) {
            window.location.href = button.dataset.href;
          }
        });
      </script>
    </body>
  </html>`;
}

function jsonResponse(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function htmlResponse(res, statusCode, html) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html)
  });
  res.end(html);
}

function redirect(res, target) {
  res.writeHead(302, {
    Location: target,
    'Cache-Control': 'no-store'
  });
  res.end();
}

function getAllLinks(config) {
  return config.environments.flatMap((environment) =>
    config.routes.map((route) => {
      const params = buildPreviewParamState(route);
      const urls = buildUrls(environment, route, params, true);
      return {
        environment: environment.label,
        route: route.label,
        routeKey: route.key,
        schemeUrl: urls.schemeUrl || null,
        webUrl: urls.webUrl || null
      };
    })
  );
}

const handleRequest = (req, res) => {
  const config = readConfig();
  const requestUrl = new URL(req.url, 'http://localhost');
  const envKey = requestUrl.searchParams.get('env') || 'sit';
  const routeKey = requestUrl.searchParams.get('route') || 'dashboard';
  const selectedEnvironment = getSelectedEnvironment(config, envKey);
  const selectedRoute = getSelectedRoute(config, routeKey);

  if (requestUrl.pathname === '/api/deep-links') {
    return jsonResponse(res, 200, {
      appName: config.appName,
      environments: config.environments,
      routes: config.routes,
      links: getAllLinks(config)
    });
  }

  if (requestUrl.pathname === '/open') {
    const rawUrl = requestUrl.searchParams.get('url');
    if (rawUrl) {
      return redirect(res, rawUrl);
    }

    const params = buildParamState(selectedRoute, requestUrl.searchParams);
    const missing = getMissingRequiredParams(selectedRoute, params);
    if (missing.length > 0) {
      return htmlResponse(
        res,
        400,
        `<h1>Missing required values</h1><p>Please enter: ${escapeHtml(missing.join(', '))}.</p><p><a href="/">Back to tester</a></p>`
      );
    }
    const urls = buildUrls(selectedEnvironment, selectedRoute, params, false);
    const target = urls.schemeUrl || urls.webUrl;

    if (!target) {
      return htmlResponse(res, 400, '<h1>Unable to open route</h1><p>The selected environment does not support this route.</p>');
    }

    return redirect(res, target);
  }

  if (requestUrl.pathname === '/health') {
    return jsonResponse(res, 200, { ok: true });
  }

  return htmlResponse(res, 200, renderPage(config, requestUrl, envKey, routeKey));
};

function startServer(port = Number(process.env.PORT || 3000)) {
  const server = http.createServer(handleRequest);
  server.listen(port, () => {
    console.log(`Deep link tester running at http://localhost:${port}`);
  });
  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  handleRequest,
  startServer
};
