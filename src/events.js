import { WebSocketServer } from 'ws';

export class EventBus {
  attach(server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
  }

  broadcast(type, payload) {
    if (!this.wss) return;
    const message = JSON.stringify({ type, payload });
    for (const client of this.wss.clients) {
      if (client.readyState === client.OPEN) client.send(message);
    }
  }
}
