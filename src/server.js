import http from 'node:http';
import express from 'express';
import { config } from './config.js';
import { EventBus } from './events.js';
import { Store } from './storage.js';
import { WhatsAppBot } from './bot.js';
import { msUntilNextMexicoDate } from './time.js';
import { cleanupRuntimeFiles, scheduleRuntimeCleanup } from './cleanup.js';

const app = express();
const server = http.createServer(app);
const events = new EventBus();
events.attach(server);

const store = new Store();
await store.init();
await cleanupRuntimeFiles();
scheduleRuntimeCleanup();
scheduleDailyDashboardRefresh();

const bot = new WhatsAppBot(store, events);
process.on('unhandledRejection', (error) => {
  if (isBaileysConnectionClosed(error)) {
    console.warn('WhatsApp cerro una operacion pendiente; se mantiene el servicio y se espera reconexion.');
    bot.scheduleReconnect();
    return;
  }
  console.error('Promesa no controlada:', error);
});

process.on('uncaughtException', (error) => {
  if (isBaileysConnectionClosed(error)) {
    console.warn('WhatsApp cerro la conexion; se mantiene el servicio y se espera reconexion.');
    bot.scheduleReconnect();
    return;
  }
  console.error('Excepcion no controlada:', error);
  process.exitCode = 1;
});

bot.start().catch((error) => {
  console.error('No se pudo iniciar WhatsApp:', error);
});

app.use(express.json());
app.use(express.static('public'));

app.use('/api', (req, res, next) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.query.token;
  if (token !== config.adminToken) {
    res.status(401).json({ error: 'No autorizado' });
    return;
  }
  next();
});

app.get('/api/status', (req, res) => {
  res.json({ whatsapp: bot.getStatus(), dashboard: store.dashboard(), settings: store.getSettings() });
});

app.get('/api/settings', (req, res) => {
  res.json(store.getSettings());
});

app.post('/api/settings', async (req, res, next) => {
  try {
    const settings = store.updateSettings(req.body);
    await store.save();
    events.broadcast('dashboard', store.dashboard());
    res.json(settings);
  } catch (error) {
    next(error);
  }
});

app.get('/api/whatsapp/groups', async (req, res, next) => {
  try {
    res.json(await bot.listGroups());
  } catch (error) {
    next(error);
  }
});

app.post('/api/whatsapp/restart', async (req, res, next) => {
  try {
    await bot.restart();
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/whatsapp/logout', async (req, res, next) => {
  try {
    await bot.logout();
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/pending/clear', async (req, res, next) => {
  try {
    const result = store.clearPendingRequests('manual_clear');
    bot.clearPendingQuoteRefs(result.ids);
    await store.save();
    const dashboard = store.dashboard();
    events.broadcast('dashboard', dashboard);
    res.json({ ok: true, cleared: result.count, dashboard });
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(400).json({ error: error.message || 'Error inesperado' });
});

server.listen(config.port, () => {
  console.log(`Panel disponible en http://localhost:${config.port}`);
  console.log(`Token admin: ${config.adminToken}`);
});

function isBaileysConnectionClosed(error) {
  return error?.output?.statusCode === 428 && /connection closed/i.test(error.message || '');
}

function scheduleDailyDashboardRefresh() {
  const delay = msUntilNextMexicoDate() + 1000;
  setTimeout(() => {
    events.broadcast('dashboard', store.dashboard());
    scheduleDailyDashboardRefresh();
  }, delay);
}
