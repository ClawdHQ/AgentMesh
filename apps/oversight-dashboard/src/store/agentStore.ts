import { create } from 'zustand';
import type { AgentState, IntentEntry, AuditEntry, PaymentEvent, HaltState, AutonomyLevel, DemoResult } from '../types';

interface AgentStore {
  // Agent states
  agents: AgentState[];
  setAgent: (agent: AgentState) => void;
  setAgents: (agents: AgentState[]) => void;

  // Intent feed
  intents: IntentEntry[];
  addIntent: (intent: IntentEntry) => void;
  clearIntents: () => void;

  // Audit log
  auditEntries: AuditEntry[];
  setAuditEntries: (entries: AuditEntry[]) => void;
  addAuditEntry: (entry: AuditEntry) => void;

  // Payment events
  payments: PaymentEvent[];
  addPayment: (payment: PaymentEvent) => void;

  // Halt state
  haltState: HaltState;
  setHaltState: (state: HaltState) => void;

  // Autonomy level
  autonomyLevel: AutonomyLevel;
  setAutonomyLevel: (level: AutonomyLevel) => void;

  // Demo state
  demoRunning: boolean;
  demoResult: DemoResult | null;
  setDemoRunning: (running: boolean) => void;
  setDemoResult: (result: DemoResult | null) => void;

  // Human approval
  pendingApproval: { description: string; amount?: string } | null;
  setPendingApproval: (approval: { description: string; amount?: string } | null) => void;

  // Connected
  wsConnected: boolean;
  setWsConnected: (connected: boolean) => void;

  // Total stats
  totalSpent: number;
  totalSaved: number;
  addSpending: (amount: number) => void;
  addSavings: (amount: number) => void;
}

export const useAgentStore = create<AgentStore>((set) => ({
  agents: [],
  setAgent: (agent) =>
    set((state) => ({
      agents: state.agents.some((a) => a.agentId === agent.agentId)
        ? state.agents.map((a) => (a.agentId === agent.agentId ? { ...a, ...agent } : a))
        : [...state.agents, agent],
    })),
  setAgents: (agents) => set({ agents }),

  intents: [],
  addIntent: (intent) =>
    set((state) => {
      const newIntents = [intent, ...state.intents].slice(0, 100); // Keep last 100
      return { intents: newIntents };
    }),
  clearIntents: () => set({ intents: [] }),

  auditEntries: [],
  setAuditEntries: (entries) => set({ auditEntries: entries }),
  addAuditEntry: (entry) =>
    set((state) => ({ auditEntries: [entry, ...state.auditEntries] })),

  payments: [],
  addPayment: (payment) =>
    set((state) => ({ payments: [payment, ...state.payments] })),

  haltState: { halted: false },
  setHaltState: (haltState) => set({ haltState }),

  autonomyLevel: (parseInt(localStorage.getItem('autonomyLevel') ?? '2') as AutonomyLevel) || 2,
  setAutonomyLevel: (level) => {
    localStorage.setItem('autonomyLevel', String(level));
    set({ autonomyLevel: level });
  },

  demoRunning: false,
  demoResult: null,
  setDemoRunning: (demoRunning) => set({ demoRunning }),
  setDemoResult: (demoResult) => set({ demoResult }),

  pendingApproval: null,
  setPendingApproval: (pendingApproval) => set({ pendingApproval }),

  wsConnected: false,
  setWsConnected: (wsConnected) => set({ wsConnected }),

  totalSpent: 0,
  totalSaved: 0,
  addSpending: (amount) => set((state) => ({ totalSpent: state.totalSpent + amount })),
  addSavings: (amount) => set((state) => ({ totalSaved: state.totalSaved + amount })),
}));
