const state = {
  token: localStorage.getItem('adminToken') || 'dev-admin-token',
  settings: { providerGroupJid: '', providerGroupJids: [], defaultGroupActaLimit: 0 },
  groups: [],
  groupLimits: [],
  dashboard: null
};

const els = {
  tokenForm: document.querySelector('#token-form'),
  token: document.querySelector('#token'),
  waState: document.querySelector('#wa-state'),
  qrBox: document.querySelector('#qr-box'),
  deliveries: document.querySelector('#deliveries'),
  metricGroups: document.querySelector('#metric-groups'),
  metricDocs: document.querySelector('#metric-docs'),
  metricCounter: document.querySelector('#metric-counter'),
  metricPending: document.querySelector('#metric-pending'),
  providerForm: document.querySelector('#provider-form'),
  providerGroup: document.querySelector('#provider-group'),
  providerGroupManual: document.querySelector('#provider-group-manual'),
  providerNote: document.querySelector('#provider-note'),
  providerLoad: document.querySelector('#provider-load'),
  refreshGroups: document.querySelector('#refresh-groups'),
  restartWa: document.querySelector('#restart-wa'),
  logoutWa: document.querySelector('#logout-wa'),
  clearPending: document.querySelector('#clear-pending'),
  defaultLimitForm: document.querySelector('#default-limit-form'),
  defaultGroupLimit: document.querySelector('#default-group-limit'),
  groupLimitForm: document.querySelector('#group-limit-form'),
  limitGroup: document.querySelector('#limit-group'),
  limitGroupManual: document.querySelector('#limit-group-manual'),
  limitName: document.querySelector('#limit-name'),
  limitValue: document.querySelector('#limit-value'),
  limitUsed: document.querySelector('#limit-used'),
  groupLimits: document.querySelector('#group-limits')
};

els.token.value = state.token;

function headers(extra = {}) {
  return { Authorization: `Bearer ${state.token}`, ...extra };
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: options.body instanceof FormData
      ? headers(options.headers)
      : headers({ 'Content-Type': 'application/json', ...options.headers })
  });
  if (!response.ok) throw new Error((await response.json()).error || 'Error');
  return response.json();
}

async function refresh() {
  const status = await api('/api/status');
  state.settings = normalizeSettings(status.settings);
  state.groups = status.whatsapp?.connected ? await loadGroups() : [];
  await loadGroupLimits();
  renderStatus(status.whatsapp);
  renderDashboard(status.dashboard);
  renderProvider();
  renderGroupLimitOptions();
  renderGroupLimits();
}

async function loadGroups() {
  return api('/api/whatsapp/groups').catch(() => []);
}

function renderStatus(status) {
  els.waState.textContent = status.message;
  els.qrBox.innerHTML = status.qr
    ? `<img src="${status.qr}" alt="QR de WhatsApp">`
    : `<span>${status.connected ? 'Conectado' : 'Esperando QR'}</span>`;
}

function renderDashboard(dashboard) {
  state.dashboard = dashboard;
  const pendingCount = dashboard.pendingRequests || 0;
  els.metricGroups.textContent = dashboard.activeGroups || 0;
  els.metricDocs.textContent = dashboard.totalDeliveries || dashboard.deliveries.length || 0;
  els.metricCounter.textContent = dashboard.todayCounter;
  els.metricPending.textContent = pendingCount;
  els.clearPending.disabled = pendingCount === 0;
  els.deliveries.innerHTML = dashboard.deliveries.length
    ? dashboard.deliveries.map((delivery) => `
      <div class="delivery">
        <strong>#${delivery.actaNumber}</strong>
        <span>${escapeHtml(delivery.requesterName || delivery.clientName || delivery.phone)}<br>${escapeHtml(delivery.phone)}</span>
        <span>${escapeHtml(delivery.documentTitle)}</span>
        <span>${new Date(delivery.createdAt).toLocaleString()}</span>
      </div>
    `).join('')
    : '<span>No hay envios registrados.</span>';
  renderProviderLoad();
}

function renderProvider() {
  const selected = normalizeProviderGroupJids(state.settings.providerGroupJids?.length
    ? state.settings.providerGroupJids
    : state.settings.providerGroupJid);
  const selectedSet = new Set(selected);
  const missingSelected = selected.filter((jid) => !state.groups.some((group) => group.id === jid));
  els.providerGroup.innerHTML = [
    '<option value="">Sin grupo proveedor</option>',
    ...state.groups.map((group) => `
      <option value="${escapeHtml(group.id)}">${escapeHtml(group.name)} (${group.participants})</option>
    `),
    ...missingSelected.map((jid) => `<option value="${escapeHtml(jid)}">Proveedor actual: ${escapeHtml(jid)}</option>`)
  ].join('');
  for (const option of els.providerGroup.options) {
    option.selected = selectedSet.has(option.value);
  }
  els.providerGroupManual.value = '';
  if (!state.groups.length) {
    els.providerNote.textContent = 'Conecta WhatsApp y pulsa Actualizar grupos para elegir los proveedores.';
    return;
  }
  els.providerNote.textContent = missingSelected.length
    ? 'Hay proveedores que no aparecen en la lista de grupos de esta sesion. Revisa que la cuenta conectada este dentro de esos grupos o pulsa Actualizar grupos.'
    : '';
  renderProviderLoad();
}

function renderProviderLoad() {
  if (!els.providerLoad) return;
  const counts = state.dashboard?.pendingRequestsByProvider || {};
  const selected = normalizeProviderGroupJids(state.settings.providerGroupJids?.length
    ? state.settings.providerGroupJids
    : state.settings.providerGroupJid);
  const providerIds = [...new Set([...selected, ...Object.keys(counts)])];

  els.providerLoad.innerHTML = providerIds.length
    ? providerIds.map((jid) => {
      const group = state.groups.find((item) => item.id === jid);
      const name = group?.name || jid;
      const pending = counts[jid] || 0;
      return `
        <div class="provider-load-row">
          <span>${escapeHtml(name)}</span>
          <strong>${pending} pendiente${pending === 1 ? '' : 's'}</strong>
        </div>
      `;
    }).join('')
    : '<span class="hint">No hay proveedores configurados.</span>';
}

async function loadGroupLimits() {
  const result = await api('/api/groups/limits');
  state.settings.defaultGroupActaLimit = normalizeLimit(result.defaultGroupActaLimit);
  state.groupLimits = result.groups || [];
}

function renderGroupLimitOptions() {
  if (!els.limitGroup) return;
  const knownJids = new Set(state.groupLimits.map((group) => group.jid));
  const missingGroups = state.groupLimits.filter((group) => (
    !state.groups.some((item) => item.id === group.jid)
  ));
  els.limitGroup.innerHTML = [
    '<option value="">Selecciona un grupo</option>',
    ...state.groups.map((group) => `
      <option value="${escapeHtml(group.id)}" data-name="${escapeHtml(group.name)}">${escapeHtml(group.name)} (${group.participants})</option>
    `),
    ...missingGroups
      .filter((group) => knownJids.has(group.jid))
      .map((group) => `<option value="${escapeHtml(group.jid)}" data-name="${escapeHtml(group.name || group.jid)}">${escapeHtml(group.name || group.jid)}</option>`)
  ].join('');
}

function renderGroupLimits() {
  els.defaultGroupLimit.value = state.settings.defaultGroupActaLimit || 0;
  renderGroupLimitOptions();
  els.groupLimits.innerHTML = state.groupLimits.length
    ? state.groupLimits.map((group) => {
      const limitText = group.unlimited ? 'ilimitado' : `${group.used}/${group.effectiveLimit}`;
      const remainingText = group.unlimited ? 'Sin limite' : `${group.remaining} restantes`;
      const ownLimit = group.limit === null || group.limit === undefined ? '' : group.limit;
      return `
        <div class="group-limit" data-jid="${escapeHtml(group.jid)}">
          <strong>${escapeHtml(group.name || group.jid)}</strong>
          <span>${escapeHtml(group.jid)}</span>
          <span>${escapeHtml(limitText)}<br>${escapeHtml(remainingText)}</span>
          <div class="actions">
            <button type="button" data-action="edit" data-jid="${escapeHtml(group.jid)}" data-name="${escapeHtml(group.name || '')}" data-limit="${escapeHtml(ownLimit)}" data-used="${escapeHtml(group.used)}">Editar</button>
            <button class="danger" type="button" data-action="reset" data-jid="${escapeHtml(group.jid)}">Reiniciar</button>
          </div>
        </div>
      `;
    }).join('')
    : '<span>No hay grupos registrados. Se crean automaticamente al solicitar actas o al guardar un limite.</span>';
}

els.tokenForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  state.token = els.token.value.trim();
  localStorage.setItem('adminToken', state.token);
  await refresh().catch(showError);
});

els.providerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const manual = normalizeProviderGroupJids(els.providerGroupManual.value);
  const selected = [...els.providerGroup.selectedOptions].map((option) => option.value).filter(Boolean);
  await api('/api/settings', {
    method: 'POST',
    body: JSON.stringify({ providerGroupJids: manual.length ? manual : selected })
  });
  await refresh();
});

els.defaultLimitForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const result = await api('/api/groups/limits/default', {
    method: 'POST',
    body: JSON.stringify({ defaultGroupActaLimit: els.defaultGroupLimit.value })
  });
  state.settings.defaultGroupActaLimit = normalizeLimit(result.defaultGroupActaLimit);
  state.groupLimits = result.groups || [];
  renderGroupLimits();
});

els.groupLimitForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const selectedOption = els.limitGroup.selectedOptions[0];
  const manualJid = els.limitGroupManual.value.trim();
  const jid = manualJid || els.limitGroup.value;
  const name = els.limitName.value.trim() || selectedOption?.dataset.name || jid;
  const result = await api('/api/groups/limits', {
    method: 'POST',
    body: JSON.stringify({
      jid,
      name,
      limit: els.limitValue.value,
      used: els.limitUsed.value
    })
  });
  state.groupLimits = result.groups || [];
  els.groupLimitForm.reset();
  renderGroupLimits();
});

els.groupLimits.addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  const jid = button.dataset.jid;
  if (button.dataset.action === 'edit') {
    els.limitGroup.value = [...els.limitGroup.options].some((option) => option.value === jid) ? jid : '';
    els.limitGroupManual.value = els.limitGroup.value ? '' : jid;
    els.limitName.value = button.dataset.name || '';
    els.limitValue.value = button.dataset.limit || '';
    els.limitUsed.value = button.dataset.used || 0;
    (els.limitGroup.value ? els.limitName : els.limitGroupManual).focus();
    return;
  }
  if (button.dataset.action === 'reset') {
    const result = await api(`/api/groups/limits/${encodeURIComponent(jid)}/reset`, {
      method: 'POST',
      body: '{}'
    });
    state.groupLimits = result.groups || [];
    renderGroupLimits();
  }
});

els.refreshGroups.addEventListener('click', async () => {
  state.groups = await loadGroups();
  renderProvider();
  renderGroupLimitOptions();
});

els.restartWa.addEventListener('click', async () => {
  els.restartWa.disabled = true;
  try {
    await api('/api/whatsapp/restart', { method: 'POST', body: '{}' });
    state.groups = [];
    renderProvider();
    await refresh().catch(() => {});
  } catch (error) {
    showError(error);
  } finally {
    els.restartWa.disabled = false;
  }
});

els.logoutWa.addEventListener('click', async () => {
  els.logoutWa.disabled = true;
  try {
    await api('/api/whatsapp/logout', { method: 'POST', body: '{}' });
    state.groups = [];
    state.settings = { providerGroupJid: '', providerGroupJids: [], defaultGroupActaLimit: state.settings.defaultGroupActaLimit || 0 };
    renderProvider();
    renderGroupLimitOptions();
    await refresh().catch(() => {});
  } catch (error) {
    showError(error);
  } finally {
    els.logoutWa.disabled = false;
  }
});

els.clearPending.addEventListener('click', async () => {
  if (!confirm('Eliminar todas las solicitudes pendientes?')) return;
  els.clearPending.disabled = true;
  try {
    const result = await api('/api/pending/clear', { method: 'POST', body: '{}' });
    renderDashboard(result.dashboard);
  } catch (error) {
    showError(error);
  } finally {
    els.clearPending.disabled = Number(els.metricPending.textContent) === 0;
  }
});

function connectWs() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.type === 'status') {
      renderStatus(message.payload);
      if (!message.payload?.connected) {
        state.groups = [];
        renderProvider();
      }
    }
    if (message.type === 'dashboard') renderDashboard(message.payload);
    if (message.type === 'groups') {
      state.groups = message.payload || [];
      renderProvider();
      renderGroupLimitOptions();
    }
    if (message.type === 'settings') {
      state.settings = normalizeSettings(message.payload);
      renderProvider();
      renderGroupLimits();
    }
    if (message.type === 'groupLimits') {
      state.settings.defaultGroupActaLimit = normalizeLimit(message.payload?.defaultGroupActaLimit);
      state.groupLimits = message.payload?.groups || [];
      renderGroupLimits();
    }
  });
  ws.addEventListener('open', () => refresh().catch(() => {}));
  ws.addEventListener('close', () => setTimeout(connectWs, 2000));
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
}

function normalizeSettings(settings = {}) {
  const providerGroupJids = normalizeProviderGroupJids(settings.providerGroupJids?.length
    ? settings.providerGroupJids
    : settings.providerGroupJid);
  return {
    ...settings,
    providerGroupJid: providerGroupJids[0] || '',
    providerGroupJids,
    defaultGroupActaLimit: normalizeLimit(settings.defaultGroupActaLimit ?? settings.defaultUserActaLimit)
  };
}

function normalizeLimit(value) {
  const limit = Math.trunc(Number(value || 0));
  return Number.isFinite(limit) && limit > 0 ? limit : 0;
}

function normalizeProviderGroupJids(value = []) {
  const values = Array.isArray(value)
    ? value
    : String(value || '').split(/[\n,;]/);
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

function showError(error) {
  alert(error.message || error);
}

connectWs();
refresh().catch(showError);
