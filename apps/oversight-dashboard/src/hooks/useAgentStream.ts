import { useEffect, useRef } from 'react';
import { useAgentStore } from '../store/agentStore';
import type { AgentState, IntentEntry } from '../types';

const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:3001/ws';

export function useAgentStream() {
  const { setAgent, addIntent, setHaltState, setWsConnected, setPendingApproval } = useAgentStore();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let intentCounter = 0;

    function connect() {
      try {
        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;

        ws.onopen = () => {
          setWsConnected(true);
        };

        ws.onclose = () => {
          setWsConnected(false);
          // Reconnect after 3 seconds
          reconnectTimeoutRef.current = setTimeout(connect, 3000);
        };

        ws.onerror = () => {
          setWsConnected(false);
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data as string) as Record<string, unknown>;

            switch (data.type) {
              case 'state': {
                const agentState: AgentState = {
                  agentId: String(data.agentId ?? ''),
                  agentName: String(data.agentName ?? ''),
                  status: (data.status as AgentState['status']) ?? 'idle',
                  intent: data.intent ? String(data.intent) : undefined,
                  reputationScore: typeof data.reputationScore === 'number' ? data.reputationScore : undefined,
                  taskCount: typeof data.taskCount === 'number' ? data.taskCount : undefined,
                  successRate: typeof data.successRate === 'number' ? data.successRate : undefined,
                  timestamp: typeof data.timestamp === 'number' ? data.timestamp : Date.now(),
                };
                setAgent(agentState);
                break;
              }

              case 'intent': {
                const payload = data.payload as Record<string, unknown> | undefined;
                const intent: IntentEntry = {
                  id: `intent-${++intentCounter}`,
                  agentId: String(data.from ?? payload?.agentId ?? ''),
                  agentName: String(payload?.agentName ?? data.from ?? 'Unknown'),
                  action: String(payload?.action ?? 'ACTION'),
                  description: String(payload?.description ?? ''),
                  target: payload?.target ? String(payload.target) : undefined,
                  timestamp: typeof data.timestamp === 'number' ? data.timestamp : Date.now(),
                  status: 'executing',
                };
                addIntent(intent);

                if (payload?.requiresHumanApproval) {
                  setPendingApproval({
                    description: String(payload.description ?? ''),
                    amount: payload.amount ? String(payload.amount) : undefined,
                  });
                }
                break;
              }

              case 'halt_state': {
                setHaltState({
                  halted: Boolean(data.halted),
                  reason: data.reason ? String(data.reason) : undefined,
                });
                break;
              }
            }
          } catch {
            // ignore parse errors
          }
        };
      } catch {
        setWsConnected(false);
        reconnectTimeoutRef.current = setTimeout(connect, 3000);
      }
    }

    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      wsRef.current?.close();
    };
  }, [setAgent, addIntent, setHaltState, setWsConnected, setPendingApproval]);

  return { ws: wsRef.current };
}
