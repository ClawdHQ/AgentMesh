import { useCallback } from 'react';
import { useAgentStore } from '../store/agentStore';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

export function useKillSwitch() {
  const { haltState, setHaltState } = useAgentStore();

  const halt = useCallback(async (reason: string = 'User-initiated halt') => {
    try {
      const response = await fetch(`${API_URL}/halt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });

      if (response.ok) {
        setHaltState({ halted: true, reason });
        localStorage.setItem('meshHalted', 'true');
        localStorage.setItem('meshHaltReason', reason);
        return true;
      }
      return false;
    } catch {
      // Optimistically update state even if API is unreachable
      setHaltState({ halted: true, reason });
      return false;
    }
  }, [setHaltState]);

  const resume = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/halt/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.ok) {
        setHaltState({ halted: false, reason: undefined });
        localStorage.removeItem('meshHalted');
        localStorage.removeItem('meshHaltReason');
        return true;
      }
      return false;
    } catch {
      setHaltState({ halted: false });
      return false;
    }
  }, [setHaltState]);

  return { haltState, halt, resume };
}
