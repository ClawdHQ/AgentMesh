import { useQuery } from '@tanstack/react-query';
import { useAgentStore } from '../store/agentStore';
import type { AuditEntry } from '../types';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

export function useAuditLog(agentId?: string) {
  const { setAuditEntries } = useAgentStore();

  const query = useQuery<AuditEntry[]>({
    queryKey: ['audit', agentId],
    queryFn: async () => {
      const url = agentId ? `${API_URL}/audit/${agentId}` : `${API_URL}/audit`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch audit log');
      const data = await response.json() as AuditEntry[];
      setAuditEntries(data);
      return data;
    },
    refetchInterval: 10000, // Refresh every 10 seconds
    staleTime: 5000,
  });

  return query;
}
