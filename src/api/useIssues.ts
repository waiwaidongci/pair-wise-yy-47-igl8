import axios from 'axios'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { Issue } from './types'

export const issuesQueryKey = ['issues'] as const

export function useIssuesQuery() {
  return useQuery({
    queryKey: issuesQueryKey,
    queryFn: async () => (await axios.get<Issue[]>('/api/issues')).data,
  })
}

/** 兼容旧页面命名：问题台账、复测队列与报告共用同一份查询缓存（同一修订结果） */
export const useIssues = useIssuesQuery

export function useMergeIssues() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (keys: string[]) => (await axios.post<{ updated: number }>('/api/issues/merge', { keys })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: issuesQueryKey }),
  })
}

/**
 * 监听其它标签页对 mock 服务端的提交：任一方发布批次或提交复测后，
 * 本页所有台账/队列/报告查询立即按最新修订重新拉取。
 */
export function useServerSync() {
  const queryClient = useQueryClient()
  useEffect(() => {
    const channel = new BroadcastChannel('a11y-remediation-server')
    const handler = () => {
      queryClient.invalidateQueries({ queryKey: ['issues'] })
      queryClient.invalidateQueries({ queryKey: ['version-diffs'] })
      queryClient.invalidateQueries({ queryKey: ['release-batches'] })
      queryClient.invalidateQueries({ queryKey: ['release-batch'] })
      queryClient.invalidateQueries({ queryKey: ['retest-tasks'] })
    }
    channel.addEventListener('message', handler)
    return () => channel.removeEventListener('message', handler)
  }, [queryClient])
}
