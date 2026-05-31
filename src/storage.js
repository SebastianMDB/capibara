import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { mexicoDateKey } from './time.js';

const PENDING_MAX_AGE_MS = Number(process.env.PENDING_MAX_AGE_HOURS || 24) * 60 * 60 * 1000;

const defaultActaPatterns = [
  {
    id: 'default-nacimiento-folio',
    name: 'Nacimiento por folio',
    type: 'nacimiento_folio',
    pattern: '^nacimiento\\s+folio\\s+(.+)$',
    flags: 'i',
    active: true,
    system: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'default-folio',
    name: 'Folio',
    type: 'folio',
    pattern: '^folio\\s+(.+)$',
    flags: 'i',
    active: true,
    system: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'default-folio-sufijo',
    name: 'Folio al final',
    type: 'folio',
    pattern: '^([A-Z0-9]{18})\\s+folio$',
    flags: 'i',
    active: true,
    system: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'default-foliada',
    name: 'Foliada',
    type: 'foliada',
    pattern: '^foliada\\s+(.+)$',
    flags: 'i',
    active: true,
    system: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'default-foliada-sufijo',
    name: 'Foliada al final',
    type: 'foliada',
    pattern: '^([A-Z0-9]{18})\\s+foliada$',
    flags: 'i',
    active: true,
    system: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'default-nacimiento',
    name: 'Nacimiento',
    type: 'nacimiento',
    pattern: '^nacimiento\\s+(.+)$',
    flags: 'i',
    active: true,
    system: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'default-matrimonio',
    name: 'Matrimonio',
    type: 'matrimonio',
    pattern: '^matrimonio\\s+(.+)$',
    flags: 'i',
    active: true,
    system: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'default-matrimonio-sufijo',
    name: 'Matrimonio al final',
    type: 'matrimonio',
    pattern: '^([A-Z0-9]{18})\\s+matrimonio$',
    flags: 'i',
    active: true,
    system: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'default-defuncion',
    name: 'Defuncion',
    type: 'defuncion',
    pattern: '^defuncion\\s+(.+)$',
    flags: 'i',
    active: true,
    system: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'default-defuncion-sufijo',
    name: 'Defuncion al final',
    type: 'defuncion',
    pattern: '^([A-Z0-9]{18})\\s+defunci[oó]n$',
    flags: 'i',
    active: true,
    system: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'default-divorcio',
    name: 'Divorcio',
    type: 'divorcio',
    pattern: '^divorcio\\s+(.+)$',
    flags: 'i',
    active: true,
    system: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'default-divorcio-sufijo',
    name: 'Divorcio al final',
    type: 'divorcio',
    pattern: '^([A-Z0-9]{18})\\s+divorcio$',
    flags: 'i',
    active: true,
    system: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'default-nacimiento-sufijo',
    name: 'Nacimiento al final',
    type: 'nacimiento',
    pattern: '^([A-Z0-9]{18})\\s+nacimiento$',
    flags: 'i',
    active: true,
    system: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'default-acta-cadena',
    name: 'Acta por cadena',
    type: 'acta_cadena',
    pattern: '^acta\\s+cadena:?\\s+(.+)$',
    flags: 'i',
    active: true,
    system: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'default-cadena-directa',
    name: 'Cadena directa',
    type: 'acta_cadena',
    pattern: '^([A-Z0-9]{15,25})$',
    flags: 'i',
    active: true,
    system: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
];

const defaultStore = {
  settings: {
    providerGroupJid: '',
    groupStates: {},
    connectedAccountJid: ''
  },
  counters: {},
  deliveries: [],
  pendingRequests: []
};

export class Store {
  constructor(filePath = path.join(config.dataDir, 'store.json')) {
    this.filePath = filePath;
    this.data = structuredClone(defaultStore);
    this.writeQueue = Promise.resolve();
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.mkdir(config.tmpDir, { recursive: true });

    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      this.data = { ...structuredClone(defaultStore), ...JSON.parse(raw) };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await this.save();
    }
  }

  async save() {
    this.compact();
    this.writeQueue = this.writeQueue.then(async () => {
      const tmp = `${this.filePath}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(this.data, null, 2));
      await fs.rename(tmp, this.filePath);
    });
    return this.writeQueue;
  }

  compact() {
    const pendingCutoff = Date.now() - PENDING_MAX_AGE_MS;
    this.data.deliveries = this.data.deliveries.slice(0, 100);
    this.data.pendingRequests = this.data.pendingRequests
      .filter((request) => request.status === 'pending' && new Date(request.createdAt).getTime() >= pendingCutoff)
      .slice(0, 200);
    delete this.data.actaPatterns;
    delete this.data.documents;
    delete this.data.archivedActas;
  }

  getSettings() {
    return this.data.settings;
  }

  updateSettings(input) {
    this.data.settings = {
      ...this.data.settings,
      providerGroupJid: String(input.providerGroupJid || '').trim(),
      groupStates: this.data.settings.groupStates || {},
      connectedAccountJid: this.data.settings.connectedAccountJid || ''
    };
    return this.data.settings;
  }

  updateConnectedAccount(jid) {
    const connectedAccountJid = String(jid || '').trim();
    if (!connectedAccountJid) return false;

    const previous = this.data.settings.connectedAccountJid || '';
    const changed = Boolean(previous && previous !== connectedAccountJid);

    if (changed) {
      this.resetWhatsAppBindings();
    }

    this.data.settings.connectedAccountJid = connectedAccountJid;
    return changed;
  }

  resetWhatsAppBindings() {
    this.data.settings = {
      ...this.data.settings,
      providerGroupJid: '',
      groupStates: {},
      connectedAccountJid: ''
    };
    this.data.pendingRequests = [];
  }

  isGroupEnabled(jid) {
    if (!isGroupJid(jid)) return true;
    return this.data.settings.groupStates?.[jid] === true;
  }

  setGroupEnabled(jid, enabled) {
    if (!isGroupJid(jid)) throw new Error('Este comando solo aplica en grupos');
    this.data.settings.groupStates = {
      ...(this.data.settings.groupStates || {}),
      [jid]: Boolean(enabled)
    };
    return this.data.settings.groupStates[jid];
  }

  listActaPatterns() {
    return mergeDefaultActaPatterns(this.data.actaPatterns || []).toSorted((a, b) => {
      if (a.system !== b.system) return a.system ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  nextActaNumber(groupJid = '') {
    const key = mexicoDateKey();
    const groupKey = String(groupJid || 'default');
    const dayCounters = normalizeDayCounters(this.data.counters[key]);
    const current = dayCounters[groupKey] || 0;
    const next = current + 1;
    dayCounters[groupKey] = next;
    this.data.counters[key] = dayCounters;
    return { dateKey: key, groupJid: groupKey, number: next };
  }

  addDelivery(delivery) {
    const saved = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      ...delivery
    };
    this.data.deliveries.unshift(saved);
    this.data.deliveries = this.data.deliveries.slice(0, 500);
    return saved;
  }

  addPendingRequest(input) {
    const id = crypto.randomUUID();
    const pending = {
      id,
      status: 'pending',
      createdAt: new Date().toISOString(),
      providerMessageId: '',
      providerRequestCode: buildProviderRequestCode(id),
      providerSentAt: '',
      identifiers: [],
      ...input
    };
    this.data.pendingRequests.unshift(pending);
    this.data.pendingRequests = this.data.pendingRequests.slice(0, 300);
    return pending;
  }

  attachProviderMessage(requestId, providerMessageId) {
    const request = this.data.pendingRequests.find((item) => item.id === requestId);
    if (request) {
      request.providerMessageId = providerMessageId || '';
      request.providerSentAt = new Date().toISOString();
    }
    return request;
  }

  findPendingRequestForProviderReply({ quotedMessageId = '', text = '', allowQueueFallback = false } = {}) {
    const pending = this.data.pendingRequests
      .filter((item) => item.status === 'pending')
      .toReversed()
      .toSorted(comparePendingProviderOrder);
    if (!pending.length) return null;

    if (quotedMessageId) {
      const byQuote = pending.find((item) => item.providerMessageId === quotedMessageId);
      if (byQuote) return byQuote;
    }

    const normalizedText = normalizeText(text);
    if (normalizedText) {
      const byRequestCode = pending.find((item) => (
        item.providerRequestCode && normalizedText.includes(normalizeText(item.providerRequestCode))
      ));
      if (byRequestCode) return byRequestCode;

      const byIdentifier = pending.find((item) => (
        item.identifiers?.some((identifier) => normalizedText.includes(normalizeText(identifier)))
      ));
      if (byIdentifier) return byIdentifier;
    }

    if (pending.length === 1) return pending[0];
    if (allowQueueFallback) return pending[0];
    return null;
  }

  completePendingRequest(id, delivery, status = 'completed', errorText = '') {
    const request = this.data.pendingRequests.find((item) => item.id === id);
    if (!request) return null;
    request.status = status;
    request.completedAt = new Date().toISOString();
    request.completedDeliveryId = delivery?.id || '';
    request.errorText = String(errorText || '').trim();
    return request;
  }

  dashboard() {
    const todayKey = mexicoDateKey();
    const todayCounters = normalizeDayCounters(this.data.counters[todayKey]);
    return {
      activeGroups: Object.values(this.data.settings.groupStates || {}).filter(Boolean).length,
      pendingRequests: this.data.pendingRequests.filter((request) => request.status === 'pending').length,
      todayCounter: Object.values(todayCounters).reduce((total, value) => total + value, 0),
      todayCountersByGroup: todayCounters,
      totalDeliveries: this.data.deliveries.length,
      deliveries: this.data.deliveries.slice(0, 30),
      recentRequests: this.data.pendingRequests.slice(0, 30)
    };
  }
}

export function normalizePhone(value = '') {
  const digits = String(value).replace(/\D/g, '');
  if (digits.startsWith('521') && digits.length === 13) {
    return `52${digits.slice(3)}`;
  }
  return digits;
}

function normalizeText(value = '') {
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function isGroupJid(value = '') {
  return String(value).endsWith('@g.us');
}

function normalizeDayCounters(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return { ...value };
  if (Number.isFinite(value) && value > 0) return { default: value };
  return {};
}

function buildProviderRequestCode(id) {
  return `CAP-${String(id || crypto.randomUUID()).replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

function comparePendingProviderOrder(a, b) {
  const aTime = new Date(a.providerSentAt || a.createdAt || 0).getTime();
  const bTime = new Date(b.providerSentAt || b.createdAt || 0).getTime();
  return aTime - bTime;
}

function mergeDefaultActaPatterns(patterns = []) {
  const merged = [...patterns];
  for (const defaultPattern of defaultActaPatterns) {
    const existing = merged.find((pattern) => pattern.id === defaultPattern.id);
    if (existing?.system) {
      Object.assign(existing, defaultPattern);
      continue;
    }
    if (!existing) merged.push(structuredClone(defaultPattern));
  }
  return merged;
}
