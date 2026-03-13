import { WebSocketServer, WebSocket } from 'ws';
import pino from 'pino';
import type { LibP2PClient } from '@agentmesh/agent-sdk';
import { TOPIC_INTENTS, TOPIC_TASKS, TOPIC_HALT } from '@agentmesh/shared';
import type { AgentMessage } from '@agentmesh/agent-sdk';

// Bridges libp2p gossipsub messages to WebSocket clients
export class IntentBroadcaster {
  private logger = pino({ level: 'info', name: 'IntentBroadcaster' });

  constructor(
    private readonly wss: WebSocketServer,
    private readonly libp2p: LibP2PClient
  ) {}

  start(): void {
    // Subscribe to libp2p topics and forward to WebSocket clients
    this.libp2p.subscribe(TOPIC_INTENTS, async (message: AgentMessage) => {
      this.broadcast(
        JSON.stringify({
          type: 'intent',
          ...message,
        })
      );
    });

    this.libp2p.subscribe(TOPIC_HALT, async (message: AgentMessage) => {
      this.broadcast(
        JSON.stringify({
          type: 'halt',
          ...message,
        })
      );
    });

    this.libp2p.subscribe(TOPIC_TASKS, async (message: AgentMessage) => {
      this.broadcast(
        JSON.stringify({
          type: 'task_update',
          ...message,
        })
      );
    });

    this.logger.info('IntentBroadcaster started, bridging libp2p → WebSocket');
  }

  // Broadcast a message to all connected WebSocket clients
  broadcast(message: string): void {
    let sent = 0;
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
        sent++;
      }
    });
    if (sent > 0) {
      this.logger.debug({ sent, messageLength: message.length }, 'Broadcast to WebSocket clients');
    }
  }

  getConnectedClients(): number {
    let count = 0;
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) count++;
    });
    return count;
  }
}
