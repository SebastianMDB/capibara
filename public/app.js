const state = {
  token: localStorage.getItem('adminToken') || 'dev-admin-token',
  settings: { providerGroupJid: '', providerGroupJids: [] },
  groups: []
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
  refreshGroups: document.querySelector('#refresh-groups'),
  restartWa: document.querySelector('#restart-wa'),
  logoutWa: document.querySelector('#logout-wa'),
  clearPending: document.querySelector('#clear-pending')
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
  renderStatus(status.whatsapp);
  renderDashboard(status.dashboard);
  renderProvider();
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

els.refreshGroups.addEventListener('click', async () => {
  state.groups = await loadGroups();
  renderProvider();
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
    state.settings = { providerGroupJid: '', providerGroupJids: [] };
    renderProvider();
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
    }
    if (message.type === 'settings') {
      state.settings = normalizeSettings(message.payload);
      renderProvider();
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
    providerGroupJids
  };
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
