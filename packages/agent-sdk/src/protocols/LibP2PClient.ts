import { ok, err, Result } from 'neverthrow';
import { NetworkError, TOPIC_TASKS, TOPIC_INTENTS, TOPIC_HALT } from '@agentmesh/shared';
import { EventEmitter } from 'events';
import type { AgentMessage, MessageHandler } from '../types';

// libp2p messaging client
// In production this uses actual libp2p with gossipsub and noise encryption.
// For the demo, we use an EventEmitter-based simulation that mirrors the libp2p API.
export class LibP2PClient extends EventEmitter {
  private peerId: string;
  private peers: Set<string> = new Set();
  private subscriptions: Map<string, MessageHandler[]> = new Map();
  private isStarted = false;

  constructor(
    private readonly port: number,
    private readonly bootstrapPeers: string[],
    agentId: string
  ) {
    super();
    this.peerId = `12D3KooW${agentId.slice(0, 20).replace(/-/g, '')}`;
  }

  async start(): Promise<Result<void, NetworkError>> {
    try {
      this.isStarted = true;
      // Add bootstrap peers
      for (const peer of this.bootstrapPeers) {
        const peerId = peer.split('/p2p/').pop();
        if (peerId) this.peers.add(peerId);
      }

      // Subscribe to halt topic by default
      this.ensureTopic(TOPIC_HALT);
      this.ensureTopic(TOPIC_TASKS);
      this.ensureTopic(TOPIC_INTENTS);

      return ok(undefined);
    } catch (error) {
      return err(new NetworkError(`Failed to start libp2p: ${String(error)}`));
    }
  }

  async stop(): Promise<void> {
    this.isStarted = false;
    this.peers.clear();
    this.subscriptions.clear();
  }

  // Publish a message to a topic
  async publish(topic: string, message: AgentMessage): Promise<Result<void, NetworkError>> {
    if (!this.isStarted) {
      return err(new NetworkError('LibP2P client not started'));
    }

    try {
      this.ensureTopic(topic);
      const handlers = this.subscriptions.get(topic) ?? [];
      const messageStr = JSON.stringify(message);

      // Emit to local handlers
      for (const handler of handlers) {
        setImmediate(() => handler(message, this.peerId).catch(() => {}));
      }

      // Also emit as event for inter-process communication
      this.emit('message', { topic, message: messageStr, from: this.peerId });
      return ok(undefined);
    } catch (error) {
      return err(new NetworkError(`Failed to publish message: ${String(error)}`));
    }
  }

  // Subscribe to a topic
  subscribe(topic: string, handler: MessageHandler): void {
    this.ensureTopic(topic);
    const handlers = this.subscriptions.get(topic) ?? [];
    handlers.push(handler);
    this.subscriptions.set(topic, handlers);
  }

  // Broadcast halt signal to all agents
  async broadcastHalt(reason: string, from: string): Promise<Result<void, NetworkError>> {
    const message: AgentMessage = {
      type: 'halt',
      from,
      payload: { reason },
      timestamp: Date.now(),
    };
    return this.publish(TOPIC_HALT, message);
  }

  // Broadcast intent for human oversight
  async broadcastIntent(
    agentId: string,
    action: string,
    description: string,
    target?: string
  ): Promise<Result<void, NetworkError>> {
    const message: AgentMessage = {
      type: 'intent',
      from: agentId,
      payload: { action, description, target, agentId },
      timestamp: Date.now(),
    };
    return this.publish(TOPIC_INTENTS, message);
  }

  // Deliver a message from an external source (used for testing/bridging)
  deliverMessage(topic: string, message: AgentMessage, from: string): void {
    const handlers = this.subscriptions.get(topic) ?? [];
    for (const handler of handlers) {
      setImmediate(() => handler(message, from).catch(() => {}));
    }
  }

  getPeers(): string[] {
    return Array.from(this.peers);
  }

  getPeerId(): string {
    return this.peerId;
  }

  isConnected(): boolean {
    return this.isStarted;
  }

  private ensureTopic(topic: string): void {
    if (!this.subscriptions.has(topic)) {
      this.subscriptions.set(topic, []);
    }
  }
}
