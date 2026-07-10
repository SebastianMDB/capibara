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
    providerGroupJids: [],
    groupStates: {},
    connectedAccountJid: '',
    providerCursor: 0,
    defaultGroupActaLimit: 0
  },
  counters: {},
  deliveries: [],
  pendingRequests: [],
  groupActaLimits: {}
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
    this.normalizeSettings();
    this.normalizeGroupActaLimits();
    const pendingCutoff = Date.now() - PENDING_MAX_AGE_MS;
    this.data.deliveries = this.data.deliveries.slice(0, 100);
    this.data.pendingRequests = this.data.pendingRequests
      .filter((request) => request.status === 'pending' && new Date(request.createdAt).getTime() >= pendingCutoff)
      .slice(0, 200);
    delete this.data.actaPatterns;
    delete this.data.documents;
    delete this.data.archivedActas;
    delete this.data.userActaLimits;
    delete this.data.settings.defaultUserActaLimit;
  }

  getSettings() {
    this.normalizeSettings();
    return this.data.settings;
  }

  updateSettings(input) {
    const providerGroupJids = normalizeProviderGroupJids(
      input.providerGroupJids ?? input.providerGroupJid ?? []
    );
    this.data.settings = {
      ...this.data.settings,
      providerGroupJid: providerGroupJids[0] || '',
      providerGroupJids,
      groupStates: this.data.settings.groupStates || {},
      connectedAccountJid: this.data.settings.connectedAccountJid || '',
      providerCursor: normalizeProviderCursor(this.data.settings.providerCursor, providerGroupJids.length),
      defaultGroupActaLimit: normalizeActaLimit(
        input.defaultGroupActaLimit ??
        this.data.settings.defaultGroupActaLimit ??
        this.data.settings.defaultUserActaLimit
      )
    };
    return this.data.settings;
  }

  updateDefaultGroupActaLimit(limit) {
    this.normalizeSettings();
    this.data.settings.defaultGroupActaLimit = normalizeActaLimit(limit);
    return this.data.settings.defaultGroupActaLimit;
  }

  listGroupActaLimits() {
    this.normalizeGroupActaLimits();
    const defaultLimit = this.getDefaultGroupActaLimit();
    return Object.values(this.data.groupActaLimits)
      .map((group) => withGroupActaLimitStatus(group, defaultLimit))
      .toSorted((a, b) => {
        const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
        const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
        return bTime - aTime;
      });
  }

  getGroupActaLimitStatus(groupJid) {
    const jid = normalizeJid(groupJid);
    if (!jid) return { jid: '', limit: null, used: 0, remaining: null, unlimited: true };
    this.normalizeGroupActaLimits();
    const group = this.data.groupActaLimits[jid] || {
      jid,
      name: jid,
      limit: null,
      used: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    return withGroupActaLimitStatus(group, this.getDefaultGroupActaLimit());
  }

  upsertGroupActaLimit(input = {}) {
    const jid = normalizeJid(input.jid);
    if (!jid) throw new Error('Grupo requerido');
    this.normalizeGroupActaLimits();
    const now = new Date().toISOString();
    const previous = this.data.groupActaLimits[jid] || {
      jid,
      createdAt: now,
      used: 0
    };
    const group = {
      ...previous,
      jid,
      name: String(input.name ?? previous.name ?? jid).trim() || jid,
      limit: input.limit === '' || input.limit === null || input.limit === undefined
        ? null
        : normalizeActaLimit(input.limit),
      used: normalizeActaUsage(input.used ?? previous.used),
      updatedAt: now
    };
    this.data.groupActaLimits[jid] = group;
    return withGroupActaLimitStatus(group, this.getDefaultGroupActaLimit());
  }

  resetGroupActaUsage(groupJid) {
    const jid = normalizeJid(groupJid);
    if (!jid) throw new Error('Grupo requerido');
    this.normalizeGroupActaLimits();
    const existing = this.data.groupActaLimits[jid] || {
      jid,
      name: jid,
      limit: null,
      createdAt: new Date().toISOString()
    };
    existing.used = 0;
    existing.updatedAt = new Date().toISOString();
    this.data.groupActaLimits[jid] = existing;
    return withGroupActaLimitStatus(existing, this.getDefaultGroupActaLimit());
  }

  consumeGroupActa(groupJid, name = '') {
    const jid = normalizeJid(groupJid);
    if (!jid) return { ok: true, status: this.getGroupActaLimitStatus(groupJid) };
    this.normalizeGroupActaLimits();
    const status = this.getGroupActaLimitStatus(jid);
    if (status.remaining !== null && status.remaining <= 0) {
      return { ok: false, status };
    }

    const now = new Date().toISOString();
    const group = this.data.groupActaLimits[jid] || {
      jid,
      name: jid,
      limit: null,
      used: 0,
      createdAt: now
    };
    group.name = String(name || group.name || jid).trim();
    group.used = normalizeActaUsage(group.used) + 1;
    group.updatedAt = now;
    this.data.groupActaLimits[jid] = group;
    return { ok: true, status: withGroupActaLimitStatus(group, this.getDefaultGroupActaLimit()) };
  }

  refundGroupActa(groupJid) {
    const jid = normalizeJid(groupJid);
    if (!jid) return null;
    this.normalizeGroupActaLimits();
    const group = this.data.groupActaLimits[jid];
    if (!group) return null;
    group.used = Math.max(0, normalizeActaUsage(group.used) - 1);
    group.updatedAt = new Date().toISOString();
    return withGroupActaLimitStatus(group, this.getDefaultGroupActaLimit());
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
      providerGroupJids: [],
      groupStates: {},
      connectedAccountJid: '',
      providerCursor: 0
    };
    this.data.pendingRequests = [];
  }

  listProviderGroupJids() {
    this.normalizeSettings();
    return this.data.settings.providerGroupJids;
  }

  isProviderGroup(jid) {
    return this.listProviderGroupJids().includes(String(jid || '').trim());
  }

  hasPendingProviderGroup(jid) {
    const providerGroupJid = String(jid || '').trim();
    if (!providerGroupJid) return false;
    return this.data.pendingRequests.some((request) => (
      request.status === 'pending' && request.providerGroupJid === providerGroupJid
    ));
  }

  chooseProviderGroupJid() {
    const providerGroupJids = this.listProviderGroupJids();
    if (!providerGroupJids.length) return '';

    const pendingCounts = new Map(providerGroupJids.map((jid) => [jid, 0]));
    for (const request of this.data.pendingRequests) {
      if (request.status !== 'pending') continue;
      const providerGroupJid = request.providerGroupJid || this.data.settings.providerGroupJid || '';
      if (pendingCounts.has(providerGroupJid)) {
        pendingCounts.set(providerGroupJid, pendingCounts.get(providerGroupJid) + 1);
      }
    }

    const cursor = normalizeProviderCursor(this.data.settings.providerCursor, providerGroupJids.length);
    let selected = providerGroupJids[cursor];
    let selectedCount = pendingCounts.get(selected);

    for (let offset = 1; offset < providerGroupJids.length; offset += 1) {
      const candidate = providerGroupJids[(cursor + offset) % providerGroupJids.length];
      const candidateCount = pendingCounts.get(candidate);
      if (candidateCount < selectedCount) {
        selected = candidate;
        selectedCount = candidateCount;
      }
    }

    this.data.settings.providerCursor = (providerGroupJids.indexOf(selected) + 1) % providerGroupJids.length;
    this.data.settings.providerGroupJid = providerGroupJids[0] || '';
    return selected;
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
      providerGroupJid: '',
      providerRequestCode: buildProviderRequestCode(id),
      providerSentAt: '',
      identifiers: [],
      ...input,
      identifiers: normalizeIdentifiers(input.identifiers)
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

  findPendingRequestByProviderMessageId(providerMessageId = '') {
    if (!providerMessageId) return null;
    return this.data.pendingRequests.find((item) => (
      item.status === 'pending' && item.providerMessageId === providerMessageId
    )) || null;
  }

  findPendingRequestForProviderReply({
    quotedMessageId = '',
    providerGroupJid = '',
    text = '',
    allowQueueFallback = false,
    requireIdentifierMatch = false
  } = {}) {
    const pending = this.data.pendingRequests
      .filter((item) => item.status === 'pending' && pendingBelongsToProvider(item, providerGroupJid))
      .toReversed()
      .toSorted(comparePendingProviderOrder);
    if (!pending.length) return null;

    const normalizedText = normalizeText(text);
    if (quotedMessageId) {
      const byQuote = pending.find((item) => item.providerMessageId === quotedMessageId);
      if (byQuote && (!requireIdentifierMatch || pendingMatchesText(byQuote, normalizedText))) return byQuote;
      if (byQuote && requireIdentifierMatch) return null;
    }

    if (normalizedText) {
      const byRequestCode = pending.find((item) => (
        item.providerRequestCode && normalizedText.includes(normalizeText(item.providerRequestCode))
      ));
      if (byRequestCode && (!requireIdentifierMatch || pendingMatchesText(byRequestCode, normalizedText))) return byRequestCode;

      const byIdentifier = pending.find((item) => pendingMatchesText(item, normalizedText));
      if (byIdentifier) return byIdentifier;
    }

    if (requireIdentifierMatch) return null;
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

  clearPendingRequests(errorText = 'manual_clear') {
    const now = new Date().toISOString();
    const clearedIds = [];
    for (const request of this.data.pendingRequests) {
      if (request.status !== 'pending') continue;
      request.status = 'cancelled';
      request.completedAt = now;
      request.completedDeliveryId = '';
      request.errorText = String(errorText || '').trim();
      clearedIds.push(request.id);
    }
    return { count: clearedIds.length, ids: clearedIds };
  }

  dashboard() {
    this.normalizeSettings();
    const todayKey = mexicoDateKey();
    const todayCounters = normalizeDayCounters(this.data.counters[todayKey]);
    return {
      activeGroups: Object.values(this.data.settings.groupStates || {}).filter(Boolean).length,
      pendingRequests: this.data.pendingRequests.filter((request) => request.status === 'pending').length,
      pendingRequestsByProvider: countPendingByProvider(this.data.pendingRequests, this.data.settings.providerGroupJids),
      todayCounter: Object.values(todayCounters).reduce((total, value) => total + value, 0),
      todayCountersByGroup: todayCounters,
      totalDeliveries: this.data.deliveries.length,
      deliveries: this.data.deliveries.slice(0, 30),
      recentRequests: this.data.pendingRequests.slice(0, 30)
    };
  }

  normalizeSettings() {
    const settings = this.data.settings || {};
    const providerGroupJids = normalizeProviderGroupJids(
      settings.providerGroupJids?.length ? settings.providerGroupJids : settings.providerGroupJid
    );
    this.data.settings = {
      ...settings,
      providerGroupJid: providerGroupJids[0] || '',
      providerGroupJids,
      groupStates: settings.groupStates || {},
      connectedAccountJid: settings.connectedAccountJid || '',
      providerCursor: normalizeProviderCursor(settings.providerCursor, providerGroupJids.length),
      defaultGroupActaLimit: normalizeActaLimit(settings.defaultGroupActaLimit ?? settings.defaultUserActaLimit)
    };
    return this.data.settings;
  }

  normalizeGroupActaLimits() {
    const groups = this.data.groupActaLimits && typeof this.data.groupActaLimits === 'object'
      ? this.data.groupActaLimits
      : {};
    const normalized = {};
    for (const group of Object.values(groups)) {
      const jid = normalizeJid(group.jid);
      if (!jid) continue;
      normalized[jid] = {
        jid,
        name: String(group.name || jid).trim(),
        limit: group.limit === null || group.limit === undefined ? null : normalizeActaLimit(group.limit),
        used: normalizeActaUsage(group.used),
        createdAt: group.createdAt || new Date().toISOString(),
        updatedAt: group.updatedAt || group.createdAt || new Date().toISOString()
      };
    }
    this.data.groupActaLimits = normalized;
    return normalized;
  }

  getDefaultGroupActaLimit() {
    this.normalizeSettings();
    return normalizeActaLimit(this.data.settings.defaultGroupActaLimit);
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

function normalizeIdentifier(value = '') {
  return String(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function normalizeIdentifiers(values = []) {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => normalizeIdentifier(value))
    .filter(Boolean);
}

function normalizeProviderGroupJids(value = []) {
  const values = Array.isArray(value)
    ? value
    : String(value || '').split(/[\n,;]/);
  return [...new Set(values
    .map((item) => String(item || '').trim())
    .filter(Boolean))];
}

function normalizeJid(value = '') {
  return String(value || '').trim();
}

function normalizeProviderCursor(value, providerCount) {
  if (!providerCount) return 0;
  const cursor = Number.isInteger(value) ? value : Number(value || 0);
  return Math.max(0, cursor) % providerCount;
}

function normalizeActaLimit(value) {
  const limit = Math.trunc(Number(value || 0));
  return Number.isFinite(limit) && limit > 0 ? limit : 0;
}

function normalizeActaUsage(value) {
  const used = Math.trunc(Number(value || 0));
  return Number.isFinite(used) && used > 0 ? used : 0;
}

function withGroupActaLimitStatus(group, defaultLimit) {
  const effectiveLimit = group.limit === null || group.limit === undefined
    ? defaultLimit
    : normalizeActaLimit(group.limit);
  const used = normalizeActaUsage(group.used);
  return {
    ...group,
    limit: group.limit === null || group.limit === undefined ? null : normalizeActaLimit(group.limit),
    effectiveLimit,
    used,
    remaining: effectiveLimit > 0 ? Math.max(0, effectiveLimit - used) : null,
    unlimited: effectiveLimit <= 0
  };
}

function pendingBelongsToProvider(pending, providerGroupJid = '') {
  if (!providerGroupJid) return true;
  return (pending.providerGroupJid || '') === providerGroupJid;
}

function countPendingByProvider(pendingRequests = [], providerGroupJids = []) {
  const counts = Object.fromEntries(providerGroupJids.map((jid) => [jid, 0]));
  for (const request of pendingRequests) {
    if (request.status !== 'pending') continue;
    if (!request.providerGroupJid) continue;
    counts[request.providerGroupJid] = (counts[request.providerGroupJid] || 0) + 1;
  }
  return counts;
}

function pendingMatchesText(pending, normalizedText) {
  if (!normalizedText) return false;
  return pending.identifiers?.some((identifier) => (
    normalizedText.includes(normalizeText(identifier))
  )) || false;
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
