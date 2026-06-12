(function () {
  const app = document.getElementById('app');
  let config = null;
  let state = {
    envKey: 'sit',
    routeKey: 'dashboard',
    params: {}
  };

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getQueryState() {
    const params = new URLSearchParams(window.location.search);
    const paramEntries = Object.fromEntries(params.entries());
    delete paramEntries.env;
    delete paramEntries.route;
    return {
      envKey: params.get('env') || 'sit',
      routeKey: params.get('route') || 'dashboard',
      params: paramEntries
    };
  }

  function getSelectedEnvironment() {
    return config.environments.find((env) => env.key === state.envKey) || config.environments[0];
  }

  function getSelectedRoute() {
    return config.routes.find((route) => route.key === state.routeKey) || config.routes[0];
  }

  function buildParamState(route) {
    return (route.params || []).reduce((acc, param) => {
      acc[param.key] = state.params[param.key] || '';
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
    const webHost = environment.webHost;
    const schemeEnabled = environment.schemeEnabled !== false;
    const schemePrefix = environment.schemePrefix || 'tradeapp';
    const schemeHost = environment.schemeHost || 'tradeapp';
    const webUrl = webHost ? `https://${webHost}${webBasePath}${pathSuffix}` : '';
    const schemeUrl = schemeEnabled && schemeHost ? `${schemePrefix}://${schemeHost}${pathSuffix}` : '';
    return { webUrl, schemeUrl };
  }

  function buildTargetUrl(environment, route, params) {
    const urls = buildUrls(environment, route, params, false);
    return urls.schemeUrl || urls.webUrl || '';
  }

  function readLiveFormState(form) {
    const formData = new FormData(form);
    const envKey = String(formData.get('env') || 'sit');
    const routeKey = String(formData.get('route') || 'dashboard');
    const params = {};

    formData.forEach((value, key) => {
      if (key === 'env' || key === 'route') {
        return;
      }
      params[key] = String(value);
    });

    return { envKey, routeKey, params };
  }

  function buildLiveCopyUrl(form) {
    const liveState = readLiveFormState(form);
    const environment = config.environments.find((env) => env.key === liveState.envKey) || config.environments[0];
    const route = config.routes.find((item) => item.key === liveState.routeKey) || config.routes[0];
    const currentParams = (route.params || []).reduce((acc, param) => {
      acc[param.key] = liveState.params[param.key] || '';
      return acc;
    }, {});
    const selectedMissingAlert = buildMissingParamsAlert(route, currentParams);
    if (selectedMissingAlert) {
      return { error: selectedMissingAlert, url: '' };
    }

    return { error: '', url: buildTargetUrl(environment, route, currentParams) };
  }

  function copyToClipboard(value) {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch (error) {
      copied = false;
    }
    document.body.removeChild(textarea);
    if (copied) {
      return Promise.resolve();
    }

    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      return navigator.clipboard.writeText(value);
    }

    window.prompt('Copy this URL', value);
    return Promise.resolve();
  }

  function captureFocusedField() {
    const activeElement = document.activeElement;
    if (!activeElement || !app.contains(activeElement) || !activeElement.name) {
      return null;
    }

    return {
      name: activeElement.name,
      selectionStart: typeof activeElement.selectionStart === 'number' ? activeElement.selectionStart : null,
      selectionEnd: typeof activeElement.selectionEnd === 'number' ? activeElement.selectionEnd : null,
      value: activeElement.value
    };
  }

  function restoreFocusedField(snapshot) {
    if (!snapshot) {
      return;
    }

    const nextElement = Array.from(app.querySelectorAll('[name]')).find((element) => element.name === snapshot.name);
    if (!nextElement || typeof nextElement.focus !== 'function') {
      return;
    }

    nextElement.focus({ preventScroll: true });
    if (
      typeof nextElement.setSelectionRange === 'function' &&
      snapshot.selectionStart !== null &&
      snapshot.selectionEnd !== null &&
      nextElement.value === snapshot.value
    ) {
      nextElement.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
    }
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
                <input name="${escapeHtml(param.key)}" value="${escapeHtml(params[param.key] || '')}" placeholder="${escapeHtml(param.placeholder || '')}" />
              </label>
            `
          )
          .join('')}
      </div>
    `;
  }

  function render() {
    const focusedField = captureFocusedField();
    const selectedEnvironment = getSelectedEnvironment();
    const selectedRoute = getSelectedRoute();
    const currentParams = buildParamState(selectedRoute);
    const currentMissingParams = getMissingRequiredParams(selectedRoute, currentParams);
    const selectedTargetUrl = buildTargetUrl(selectedEnvironment, selectedRoute, currentParams);
    const selectedMissingAlert = buildMissingParamsAlert(selectedRoute, currentParams);

    const previewUrls = config.environments.map((env) => ({
      environment: env,
      ...buildUrls(env, selectedRoute, currentParams, currentMissingParams.length > 0)
    }));

    app.innerHTML = `
      <section class="hero">
        <div class="panel">
          <h1>${escapeHtml(config.appName)} deep link tester</h1>
          <p class="lede">
            Generate and launch the exact SIT, UAT, and PROD URLs from the trade app deep link guide.
            Fill in dynamic values like order IDs, order numbers, quote codes, category IDs, product SKUs, experience IDs, and list names before launching.
          </p>

          <form class="layout builder" data-live-form>
            <div class="grid-2">
              <label class="field">
                <span>Environment</span>
                <select name="env">
                  ${config.environments
                    .map(
                      (env) => `
                        <option value="${escapeHtml(env.key)}" ${env.key === selectedEnvironment.key ? 'selected' : ''}>${escapeHtml(env.label)}</option>
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
                        <option value="${escapeHtml(route.key)}" ${route.key === selectedRoute.key ? 'selected' : ''}>${escapeHtml(route.label)}</option>
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
                data-copy-url="${escapeHtml(selectedTargetUrl)}"
                ${selectedMissingAlert ? `data-error="${escapeHtml(selectedMissingAlert)}"` : ''}
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
                      ? `<a class="button launch" href="${escapeHtml(buildTargetUrl(item.environment, selectedRoute, currentParams))}">Launch</a>`
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
          ${config.routes
            .map((route) => {
              const placeholderParams = buildPreviewParamState(route);
              const currentUrls = buildUrls(selectedEnvironment, route, route.key === selectedRoute.key ? currentParams : placeholderParams, route.key === selectedRoute.key ? getMissingRequiredParams(route, currentParams).length > 0 : true);
              const placeholderUrls = config.environments.map((env) => ({
                environment: env,
                ...buildUrls(env, route, route.key === selectedRoute.key ? currentParams : placeholderParams, route.key !== selectedRoute.key)
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
            })
            .join('')}
        </div>
      </section>
    `;
    restoreFocusedField(focusedField);
  }

  function syncFromState() {
    const search = new URLSearchParams();
    search.set('env', state.envKey);
    search.set('route', state.routeKey);
    Object.entries(state.params).forEach(([key, value]) => {
      if (String(value).trim() !== '') {
        search.set(key, value);
      }
    });
    window.history.replaceState({}, '', `?${search.toString()}`);
  }

  let timer = null;

  function scheduleRender() {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      syncFromState();
      render();
    }, 1000);
  }

  app.addEventListener('change', (event) => {
    const target = event.target;
    if (!target || !target.name) return;
    if (target.name === 'env') {
      state.envKey = target.value;
      syncFromState();
      render();
      return;
    }
    if (target.name === 'route') {
      state.routeKey = target.value;
      syncFromState();
      render();
      return;
    }
    state.params[target.name] = target.value;
    syncFromState();
    render();
  });

  app.addEventListener('input', (event) => {
    const target = event.target;
    if (!target || !target.name || target.name === 'env' || target.name === 'route') {
      return;
    }
    state.params[target.name] = target.value;
    scheduleRender();
  });

  app.addEventListener('submit', (event) => {
    const form = event.target;
    if (!form || !form.matches || !form.matches('[data-live-form]')) {
      return;
    }

    event.preventDefault();
    const selectedEnvironment = getSelectedEnvironment();
    const selectedRoute = getSelectedRoute();
    const currentParams = buildParamState(selectedRoute);
    const selectedMissingAlert = buildMissingParamsAlert(selectedRoute, currentParams);

    if (selectedMissingAlert) {
      alert(selectedMissingAlert);
      return;
    }

    window.location.href = buildTargetUrl(selectedEnvironment, selectedRoute, currentParams);
  });

  app.addEventListener('click', (event) => {
    const copyButton = event.target.closest('[data-copy-url]');
    if (copyButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const form = document.querySelector('[data-live-form]');
      if (!form) {
        if (copyButton.dataset.error) {
          alert(copyButton.dataset.error);
          return;
        }
        copyToClipboard(copyButton.dataset.copyUrl || '')
          .then(() => {
            const originalLabel = copyButton.textContent;
            copyButton.textContent = 'Copied';
            window.setTimeout(() => {
              copyButton.textContent = originalLabel;
            }, 1200);
          })
          .catch(() => {
            alert('Unable to copy the URL.');
          });
        return;
      }

      const liveCopy = buildLiveCopyUrl(form);
      if (liveCopy.error) {
        alert(liveCopy.error);
        return;
      }

      copyToClipboard(liveCopy.url || copyButton.dataset.copyUrl || '')
        .then(() => {
          const originalLabel = copyButton.textContent;
          copyButton.textContent = 'Copied';
          window.setTimeout(() => {
            copyButton.textContent = originalLabel;
          }, 1200);
        })
        .catch(() => {
          alert('Unable to copy the URL.');
        });
      return;
    }

    const button = event.target.closest('[data-error]');
    if (!button) return;
    event.preventDefault();
    if (button.dataset.error) {
      alert(button.dataset.error);
    }
  });

  fetch('./deep-links.config.json')
    .then((response) => response.json())
    .then((loadedConfig) => {
      config = loadedConfig;
      state = { ...state, ...getQueryState() };
      render();
    })
    .catch((error) => {
      app.innerHTML = `<div class="panel"><h1>Failed to load config</h1><p>${escapeHtml(error.message)}</p></div>`;
    });
})();
