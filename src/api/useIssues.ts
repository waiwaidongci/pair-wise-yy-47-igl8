import { useEffect } from 'react'
import axios from 'axios'
import { useQuery } from '@tanstack/react-query'
import type { Issue } from './types'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

export function useIssues() {
  const setIssues = useWorkspaceStore((state) => state.setIssues)
  const query = useQuery({
    queryKey: ['issues'],
    queryFn: async () => (await axios.get<Issue[]>('/api/issues')).data,
  })

  useEffect(() => {
    if (query.data) setIssues(query.data)
  }, [query.data, setIssues])

  return query
}
