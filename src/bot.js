import fs from 'node:fs/promises';
import path from 'node:path';
import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState
} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import { Boom } from '@hapi/boom';
import { config } from './config.js';
import { normalizePhone } from './storage.js';
import { mexicoNowLabel } from './time.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const MAX_BATCH_ACTA_REQUESTS = 50;

export class WhatsAppBot {
  constructor(store, events) {
    this.store = store;
    this.events = events;
    this.sock = null;
    this.status = {
      connected: false,
      qr: null,
      message: 'Sin conectar',
      updatedAt: new Date().toISOString()
    };
    this.starting = false;
    this.reconnectTimer = null;
    this.pendingQuotes = new Map();
  }

  getStatus() {
    return this.status;
  }

  clearPendingQuoteRefs(pendingIds = []) {
    for (const id of pendingIds) {
      this.pendingQuotes.delete(id);
    }
  }

  async listGroups() {
    if (!this.sock || !this.status.connected) return [];
    const groups = await this.sock.groupFetchAllParticipating();
    return Object.values(groups)
      .map((group) => ({
        id: group.id,
        name: group.subject || group.id,
        participants: group.participants?.length || 0
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async start() {
    if (this.starting || this.sock) return;
    this.starting = true;
    await fs.mkdir(config.sessionsDir, { recursive: true });
    try {
      const { state, saveCreds } = await useMultiFileAuthState(path.join(config.sessionsDir, 'default'));
      const { version } = await fetchLatestBaileysVersion();

      const sock = makeWASocket({
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, logger)
        },
        browser: ['Capibara Bot', 'Chrome', '1.0.0'],
        logger,
        version
      });
      this.sock = sock;

      sock.ev.on('creds.update', saveCreds);
      sock.ev.on('connection.update', (update) => this.handleConnection(update, sock));
      sock.ev.on('messages.upsert', (event) => this.handleMessages(event).catch((error) => {
        logger.error({ error }, 'Error procesando mensaje');
      }));
    } finally {
      this.starting = false;
    }
  }

  async restart() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const previousSock = this.sock;
    this.sock = null;
    this.status = {
      connected: false,
      qr: null,
      message: 'Reconectando...',
      updatedAt: new Date().toISOString()
    };
    this.events.broadcast('status', this.status);
    this.events.broadcast('groups', []);
    if (previousSock) {
      try {
        previousSock.end(new Error('Reinicio manual'));
      } catch (error) {
        logger.warn({ error }, 'No se pudo cerrar el socket anterior durante el reinicio');
      }
    }
    await this.start();
  }

  async logout() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const previousSock = this.sock;
    this.sock = null;
    this.status = {
      connected: false,
      qr: null,
      message: 'Cerrando sesion...',
      updatedAt: new Date().toISOString()
    };
    this.events.broadcast('status', this.status);
    this.events.broadcast('groups', []);

    if (previousSock) {
      try {
        await previousSock.logout();
      } catch (error) {
        logger.warn({ error }, 'No se pudo cerrar sesion en WhatsApp, se limpiara la sesion local');
      }
    }
    await this.clearSessionBindings();
    await fs.rm(path.join(config.sessionsDir, 'default'), { recursive: true, force: true });
    this.status = {
      connected: false,
      qr: null,
      message: 'Sesion cerrada',
      updatedAt: new Date().toISOString()
    };
    this.events.broadcast('status', this.status);
    await this.start();
  }

  async clearSessionBindings() {
    this.pendingQuotes.clear();
    this.store.resetWhatsAppBindings();
    await this.store.save();
    this.events.broadcast('dashboard', this.store.dashboard());
    this.events.broadcast('settings', this.store.getSettings());
  }

  scheduleReconnect(delayMs = 2500) {
    if (this.reconnectTimer || this.starting) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.start().catch((error) => logger.error({ error }, 'Error reconectando WhatsApp'));
    }, delayMs);
  }

  async handleConnection(update, sock = this.sock) {
    if (sock !== this.sock) return;

    if (update.qr) {
      this.status = {
        connected: false,
        qr: await QRCode.toDataURL(update.qr),
        message: 'Escanea el QR con WhatsApp',
        updatedAt: new Date().toISOString()
      };
      this.events.broadcast('status', this.status);
      this.events.broadcast('groups', []);
    }

    if (update.connection === 'open') {
      const accountChanged = this.store.updateConnectedAccount(normalizeAccountJid(this.sock?.user?.id));
      if (accountChanged) {
        this.pendingQuotes.clear();
        await this.store.save();
        this.events.broadcast('dashboard', this.store.dashboard());
        this.events.broadcast('settings', this.store.getSettings());
      } else {
        await this.store.save();
      }

      this.status = {
        connected: true,
        qr: null,
        message: 'Conectado',
        updatedAt: new Date().toISOString()
      };
      this.events.broadcast('status', this.status);
      this.broadcastGroups();
    }

    if (update.connection === 'close') {
      if (sock !== this.sock) return;
      const code = new Boom(update.lastDisconnect?.error).output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      this.sock = null;
      this.status = {
        connected: false,
        qr: null,
        message: shouldReconnect ? 'Reconectando...' : 'Sesion cerrada',
        updatedAt: new Date().toISOString()
      };
      this.events.broadcast('status', this.status);
      this.events.broadcast('groups', []);
      if (shouldReconnect) this.scheduleReconnect();
    }
  }

  async broadcastGroups() {
    try {
      this.events.broadcast('groups', await this.listGroups());
    } catch (error) {
      logger.warn({ error }, 'No se pudo cargar la lista de grupos');
      this.events.broadcast('groups', []);
    }
  }

  async handleMessages({ messages, type }) {
    if (type !== 'notify') return;

    for (const message of messages) {
      if (!message.message) continue;

      const jid = message.key.remoteJid;
      const text = readText(message);
      const groupCommand = parseGroupStateCommand(text);
      if (groupCommand !== null) {
        if (!message.key.fromMe && !this.store.isGroupEnabled(jid)) continue;
        await this.setGroupStateFromMessage(jid, groupCommand, message);
        continue;
      }

      if (message.key.fromMe) continue;

      if (this.store.isProviderGroup(jid) || this.store.hasPendingProviderGroup(jid)) {
        await this.processProviderMessage(message);
        continue;
      }

      if (!this.store.isGroupEnabled(jid)) continue;

      if (!text) continue;

      const senderJid = getSenderJid(message) || jid;
      const phone = normalizePhone(senderJid.split('@')[0]);
      await this.processCommand(jid, phone, text, message);
    }
  }

  async processCommand(jid, phone, text, message) {
    const command = text.trim();

    if (!this.store.isGroupEnabled(jid)) return;

    const batchRequests = parseBatchActaRequests(command);
    if (batchRequests.length > 1) {
      const limitStatus = this.store.getUserActaLimitStatus(phone);
      if (limitStatus.remaining !== null && limitStatus.remaining <= 0) {
        await this.sock.sendMessage(jid, {
          text: buildActaLimitText(limitStatus)
        }, { quoted: message });
        return;
      }

      const quotaMax = limitStatus.remaining === null ? MAX_BATCH_ACTA_REQUESTS : limitStatus.remaining;
      const selectedRequests = batchRequests.slice(0, Math.min(MAX_BATCH_ACTA_REQUESTS, quotaMax));
      let sent = 0;

      for (const actaRequest of selectedRequests) {
        const result = await this.forwardActaRequest({
          jid,
          phone,
          command: actaRequest.identifierText,
          actaRequest,
          message,
          notifyProcessing: false
        });
        if (result?.ok) sent += 1;
      }

      if (sent) {
        const skipped = batchRequests.length - selectedRequests.length;
        await this.sock.sendMessage(jid, {
          text: buildBatchProcessingText(sent, skipped, limitStatus.remaining !== null)
        }, { quoted: message });
      }
      return;
    }

    const actaRequest = batchRequests[0] || parseActaRequest(command, this.store.listActaPatterns());

    if (actaRequest) {
      const invalidCurp = findInvalidCurp(actaRequest);
      if (invalidCurp) {
        await this.sock.sendMessage(jid, {
          text: 'No se detectó ninguna CURP válida en su mensaje. Por favor, envíe su CURP para iniciar el proceso.'
        }, { quoted: message });
          return;
        }
      await this.forwardActaRequest({ jid, phone, command, actaRequest, message });
      return;
    }

    if (command.toLowerCase() === 'saldo') {
      const limitStatus = this.store.getUserActaLimitStatus(phone);
      await this.sock.sendMessage(jid, {
        text: buildSaldoText(limitStatus)
      });
      return;
    }
  }

  async setGroupStateFromMessage(jid, enabled, message) {
    if (!isGroupJid(jid)) return;
    if (!message.key.fromMe) {
      await this.sock.sendMessage(jid, {
        text: 'Solo la cuenta conectada al bot puede activar o desactivar este grupo.'
      }, { quoted: message });
      return;
    }
    this.store.setGroupEnabled(jid, enabled);
    await this.store.save();
    await this.sock.sendMessage(jid, {
      text: enabled ? '✅ Grupo ACTIVADO para bot.' : '⛔ Grupo DESACTIVADO.'
    }, { quoted: message });
    this.events.broadcast('dashboard', this.store.dashboard());
  }

  async forwardActaRequest({ jid, phone, command, actaRequest, message, notifyProcessing = true }) {
    if (!this.store.listProviderGroupJids().length) {
      await this.sock.sendMessage(jid, { text: 'No hay grupo proveedor configurado para solicitar actas.' }, { quoted: message });
      return { ok: false };
    }

    const quota = this.store.consumeUserActa(phone, phone);
    if (!quota.ok) {
      await this.sock.sendMessage(jid, {
        text: buildActaLimitText(quota.status)
      }, { quoted: message });
      return { ok: false, limitExceeded: true };
    }

    const providerGroupJid = this.store.chooseProviderGroupJid();

    const pending = this.store.addPendingRequest({
      requestText: command,
      requestType: actaRequest.type,
      identifiers: actaRequest.identifiers,
      originJid: jid,
      providerGroupJid,
      requesterPhone: phone,
      requesterName: phone
    });
    this.pendingQuotes.set(pending.id, message);

    let providerMessage;
    try {
      providerMessage = await this.sock.sendMessage(providerGroupJid, {
        text: buildProviderRequestText(actaRequest, command)
      });
    } catch (error) {
      this.store.refundUserActa(phone);
      this.store.completePendingRequest(pending.id, null, 'error', error.message || 'provider_send_failed');
      await this.store.save();
      logger.warn({
        error,
        originJid: jid,
        providerGroupJid
      }, 'No se pudo reenviar la solicitud al grupo proveedor');
      await this.sock.sendMessage(jid, {
        text: isForbiddenError(error)
          ? 'No pude enviar la solicitud al grupo proveedor. Revisa que la cuenta conectada al bot este dentro del grupo proveedor configurado.'
          : 'No pude enviar la solicitud al grupo proveedor. Revisa la configuracion del proveedor.'
      }, { quoted: message });
      this.events.broadcast('dashboard', this.store.dashboard());
      this.events.broadcast('userLimits', this.buildUserLimitsPayload());
      return { ok: false };
    }
    this.store.attachProviderMessage(pending.id, providerMessage?.key?.id);
    await this.store.save();

    if (notifyProcessing) {
      await this.sock.sendMessage(jid, {
        text: buildProcessingText(actaRequest)
      }, { quoted: message });
    }
    this.events.broadcast('dashboard', this.store.dashboard());
    this.events.broadcast('userLimits', this.buildUserLimitsPayload());
    return { ok: true, pending };
  }

  async processProviderMessage(message) {
    const document = getDocumentMessage(message);
    const text = [
      document?.fileName,
      document?.caption,
      readText(message)
    ].filter(Boolean).join(' ');

    if (!document || !isPdfDocument(document)) {
      await this.processProviderTextReply(message, text);
      return;
    }

    const buffer = await downloadMediaMessage(
      message,
      'buffer',
      {},
      { logger, reuploadRequest: this.sock.updateMediaMessage }
    );

    const safeName = sanitizeFileName(document.fileName || 'acta.pdf');
    const outputName = `${Date.now()}-${message.key.id || 'acta'}-${safeName}`;
    const outputPath = path.join(config.tmpDir, outputName);
    await fs.writeFile(outputPath, buffer);

    const quotedMessageId = getQuotedMessageId(message);
    const pending = this.store.findPendingRequestForProviderReply({
      quotedMessageId,
      providerGroupJid: message.key.remoteJid,
      text,
      requireIdentifierMatch: true
    });
    if (!pending) {
      const quotedPending = this.store.findPendingRequestByProviderMessageId(quotedMessageId);
      if (quotedPending && quotedPending.providerGroupJid === message.key.remoteJid) {
        this.store.completePendingRequest(quotedPending.id, null, 'error', 'provider_pdf_identifier_mismatch');
        await this.store.save();
        await this.sock.sendMessage(quotedPending.originJid, {
          text: buildMismatchText(quotedPending)
        }, quoteOptions(this.pendingQuotes.get(quotedPending.id)));
        this.pendingQuotes.delete(quotedPending.id);
        this.events.broadcast('dashboard', this.store.dashboard());
      }
      await fs.rm(outputPath, { force: true });
      return;
    }

    const counter = this.store.nextActaNumber(pending.originJid);
    const delivery = this.store.addDelivery({
      phone: pending.requesterPhone,
      requesterName: pending.requesterName,
      documentId: '',
      documentTitle: pending.requestText,
      actaNumber: counter.number,
      dateKey: counter.dateKey,
      counterGroupJid: counter.groupJid,
      providerGroupJid: message.key.remoteJid,
      originJid: pending.originJid
    });
    this.store.completePendingRequest(pending.id, delivery);
    await this.sock.sendMessage(pending.originJid, {
      document: { url: outputPath },
      fileName: safeName,
      mimetype: document.mimetype || 'application/pdf',
      caption: buildDeliveryCaption(pending, delivery)
    }, quoteOptions(this.pendingQuotes.get(pending.id)));
    this.pendingQuotes.delete(pending.id);
    await fs.rm(outputPath, { force: true });
    await this.store.save();
    this.events.broadcast('dashboard', this.store.dashboard());
  }

  async processProviderTextReply(message, text) {
    const responseText = String(text || '').trim();
    if (!responseText) return;
    if (!isProviderUnavailableText(responseText) && isProviderAcknowledgementText(responseText)) return;

    const quotedMessageId = getQuotedMessageId(message);
    const pending = this.store.findPendingRequestForProviderReply({
      quotedMessageId,
      providerGroupJid: message.key.remoteJid,
      text: responseText,
      allowQueueFallback: isProviderUnavailableText(responseText)
    });
    if (!pending) return;

    this.store.completePendingRequest(pending.id, null, 'error', responseText);
    await this.store.save();

    await this.sock.sendMessage(pending.originJid, {
      text: buildUnavailableText(pending)
    }, quoteOptions(this.pendingQuotes.get(pending.id)));
    this.pendingQuotes.delete(pending.id);
    this.events.broadcast('dashboard', this.store.dashboard());
  }

  buildUserLimitsPayload() {
    return {
      defaultUserActaLimit: this.store.getSettings().defaultUserActaLimit,
      users: this.store.listUserActaLimits()
    };
  }
}

function readText(message) {
  const payload = unwrapMessage(message.message);
  return payload.conversation ||
    payload.extendedTextMessage?.text ||
    payload.imageMessage?.caption ||
    payload.documentMessage?.caption ||
    payload.documentWithCaptionMessage?.message?.documentMessage?.caption ||
    '';
}

function unwrapMessage(payload = {}) {
  return payload.ephemeralMessage?.message ||
    payload.viewOnceMessage?.message ||
    payload.viewOnceMessageV2?.message ||
    payload.documentWithCaptionMessage?.message ||
    payload;
}

function getDocumentMessage(message) {
  return unwrapMessage(message.message).documentMessage || null;
}

function isPdfDocument(document) {
  const mimeType = String(document.mimetype || '').toLowerCase();
  const fileName = String(document.fileName || '').toLowerCase();
  return mimeType === 'application/pdf' || fileName.endsWith('.pdf');
}

function getQuotedMessageId(message) {
  const payload = unwrapMessage(message.message);
  return payload.documentMessage?.contextInfo?.stanzaId ||
    payload.extendedTextMessage?.contextInfo?.stanzaId ||
    payload.imageMessage?.contextInfo?.stanzaId ||
    '';
}

function getSenderJid(message) {
  return message.key.participantPn ||
    message.key.senderPn ||
    message.key.participant ||
    message.key.senderLid ||
    message.key.participantLid ||
    message.key.remoteJid ||
    '';
}

function isProviderAcknowledgementText(text) {
  const normalized = normalizeCommand(text).replace(/\s+/g, '');
  if (!normalized) return true;
  if (['.', ',', '-', '_', '*', '+', '!', '?', '/', '\\', '|'].includes(normalized)) return true;
  if (/^[^\p{L}\p{N}]{1,3}$/u.test(normalized)) return true;
  if (/^[a-z]$/i.test(normalized)) return true;
  if (/^\d{1,3}$/.test(normalized)) return true;
  if (/^(ok|va|listo|visto|recibido)$/i.test(normalized)) return true;
  return false;
}

function isProviderUnavailableText(text) {
  const normalized = normalizeCommand(text).replace(/\s+/g, ' ');
  return /\b(no existe|no esta|no disponible|no se encontro|no aparece|sin resultado|sin resultados)\b/.test(normalized);
}

function parseGroupStateCommand(command) {
  const normalized = normalizeCommand(command);
  if (normalized === 'activar') return true;
  if (normalized === 'desactivar') return false;
  return null;
}

function normalizeCommand(value = '') {
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function isGroupJid(value = '') {
  return String(value).endsWith('@g.us');
}

function parseActaRequest(text, patterns = []) {
  const value = text.trim();
  const flexible = parseFlexibleActaRequest(value);
  if (flexible) return flexible;

  for (const pattern of patterns) {
    if (!pattern.active) continue;
    const regex = compilePattern(pattern);
    if (!regex) continue;
    const match = value.match(regex);
    if (!match) continue;
    const identifierText = match.slice(1).filter(Boolean).join(' ') || match[0];
    const identifiers = canonicalizeIdentifiers(
      identifierText.split(/\s+/).filter((part) => part.length >= 4)
    );
    return { type: pattern.type, name: pattern.name, identifierText, identifiers };
  }

  return null;
}

function parseBatchActaRequests(text) {
  const value = String(text || '').toUpperCase();
  const identifiers = [...new Set(value.match(/\b[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d\b/g) || [])];
  if (!identifiers.length) return [];

  const normalized = normalizeCommand(text);
  const typeParts = providerActaTypes(text);
  const type = typeParts.length
    ? typeParts.join('_')
    : /\bacta\b/.test(normalized) || identifiers.length > 1
      ? 'nacimiento'
      : '';
  if (!type) return [];

  const name = typeParts.length ? typeParts.join(' ') : 'nacimiento';
  return identifiers.map((identifier) => ({
    type,
    name,
    identifierText: identifier,
    identifiers: [identifier]
  }));
}

function parseFlexibleActaRequest(value) {
  const normalized = normalizeCommand(value);
  const identifier = value.toUpperCase().match(/\b[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d\b/)?.[0];

  if (!identifier) {
    const chain = value.toUpperCase().match(/\b[A-Z0-9]{15,25}\b/)?.[0];
    if (chain && /\bcadena\b/.test(normalized)) {
      return {
        type: 'acta_cadena',
        name: 'acta cadena',
        identifierText: chain,
        identifiers: [chain]
      };
    }
    return null;
  }

  const typeParts = providerActaTypes(value);
  if (!typeParts.length && /\bacta\b/.test(normalized)) {
    return {
      type: 'nacimiento',
      name: 'nacimiento',
      identifierText: identifier,
      identifiers: [identifier]
    };
  }

  if (!typeParts.length) return null;

  return {
    type: typeParts.join('_'),
    name: typeParts.join(' '),
    identifierText: identifier,
    identifiers: [identifier]
  };
}

function compilePattern(pattern) {
  try {
    return new RegExp(pattern.pattern, pattern.flags || 'i');
  } catch {
    return null;
  }
}

function buildProviderRequestText(actaRequest, command) {
  const identifier = actaRequest.identifiers.join(' ') || command;
  const types = providerActaTypes(actaRequest.type);
  return types.length ? `${identifier} ${types.join(' ')}` : identifier;
}

function buildProcessingText(actaRequest) {
  return `⏳ Procesando acta para\n${requestIdentifier(actaRequest)}...`;
}

function buildBatchProcessingText(count, skipped = 0, skippedByLimit = false) {
  const base = `⏳ Procesando ${count} acta${count === 1 ? '' : 's'} solicitada${count === 1 ? '' : 's'}...`;
  if (!skipped) return base;
  const reason = skippedByLimit ? 'por el limite disponible del usuario' : `porque el maximo por mensaje es ${MAX_BATCH_ACTA_REQUESTS}`;
  return `${base}\nSe omitieron ${skipped} ${reason}.`;
}

function buildSaldoText(status) {
  if (status.unlimited) {
    return `Actas usadas: ${status.used}. Limite: ilimitado.`;
  }
  return `Actas usadas: ${status.used}/${status.effectiveLimit}. Restantes: ${status.remaining}.`;
}

function buildActaLimitText(status) {
  const limit = status.effectiveLimit || 0;
  return `Limite de actas alcanzado. Uso: ${status.used}/${limit}. Contacta al administrador para ampliar o reiniciar tu limite.`;
}

function buildDeliveryCaption(pending, delivery) {
  return [
    `Acta #${delivery.actaNumber}`,
    `Solicitud: ${pending.requestText}`,
    `Enviado: ${mexicoNowLabel()}`
  ].join('\n');
}

function buildUnavailableText(pending) {
  return `❌ El acta para\n${requestIdentifier(pending)} no está disponible.`;
}

function buildMismatchText(pending) {
  return `❌ El PDF recibido no coincide con\n${requestIdentifier(pending)}.\nSe eliminó la solicitud pendiente.`;
}

function requestIdentifier(request) {
  return request.identifiers?.join(' ') || request.requestText || request.identifierText || '';
}

function quoteOptions(quoted) {
  return quoted ? { quoted } : undefined;
}

function isForbiddenError(error) {
  return error?.data === 403 || error?.output?.statusCode === 403;
}

function normalizeAccountJid(value = '') {
  return String(value).replace(/:\d+(?=@)/, '');
}

function providerActaTypes(type) {
  const normalized = String(type || '').toLowerCase();
  const types = [];
  if (normalized.includes('matrimonio')) types.push('matrimonio');
  if (normalized.includes('divorcio')) types.push('divorcio');
  if (normalized.includes('defuncion') || normalized.includes('defunción')) types.push('defuncion');
  if (normalized.includes('nacimiento')) types.push('nacimiento');
  if (normalized.includes('foliada')) types.push('foliada');
  else if (normalized.includes('folio')) types.push('folio');
  return types;
}

function findInvalidCurp(actaRequest) {
  const values = actaRequest.identifiers.length
    ? actaRequest.identifiers
    : String(actaRequest.identifierText || '').split(/\s+/).filter(Boolean);

  for (const value of values) {
    const normalized = normalizeIdentifier(value);
    if (!shouldValidateAsCurp(normalized, actaRequest.type)) continue;
    if (!isValidCurp(normalized)) return value;
  }

  return '';
}

function shouldValidateAsCurp(value, requestType) {
  if (!value) return false;
  if (requestType !== 'acta_cadena') return true;
  return /[A-Z]/.test(value);
}

function isValidCurp(value) {
  return /^[A-Z][AEIOUX][A-Z]{2}\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[HM](AS|BC|BS|CC|CL|CM|CS|CH|DF|DG|GT|GR|HG|JC|MC|MN|MS|NT|NL|OC|PL|QT|QR|SP|SL|SR|TC|TS|TL|VZ|YN|ZS|NE)[B-DF-HJ-NP-TV-Z]{3}[A-Z0-9]\d$/.test(value);
}

function normalizeIdentifier(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function canonicalizeIdentifiers(values = []) {
  return values
    .map((value) => normalizeIdentifier(value))
    .filter(Boolean);
}

function sanitizeFileName(value) {
  return String(value)
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'acta.pdf';
}
