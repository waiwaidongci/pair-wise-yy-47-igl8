import axios from 'axios'
import { useQuery } from '@tanstack/react-query'
import type { PublishResult, ReleaseBatch, RetestTask } from './types'

export type VersionDiff = {
  key: string
  title: string
  field: string
  baseline: string
  candidate: string
  risk: '低' | '中' | '高'
  summary: string
  createsRetest: boolean
  retestEnv: string
  revision: number
}

export type RetestTaskRow = RetestTask & { issue?: import('./types').Issue }

export type SubmitResult = {
  task: RetestTask
  issue?: import('./types').Issue
  idempotent: boolean
}

export function useVersionDiffs(enabled = true) {
  return useQuery({
    queryKey: ['version-diffs'],
    enabled,
    queryFn: async () => (await axios.get<VersionDiff[]>('/api/version-diffs')).data,
  })
}

export function useReleaseBatches() {
  return useQuery({
    queryKey: ['release-batches'],
    queryFn: async () => (await axios.get<ReleaseBatch[]>('/api/release-batches')).data,
  })
}

export function useReleaseBatch(id: string | null) {
  return useQuery({
    queryKey: ['release-batch', id],
    enabled: Boolean(id),
    queryFn: async () => (await axios.get<ReleaseBatch>(`/api/release-batches/${id}`)).data,
  })
}

export function useRetestTasks(status?: string) {
  return useQuery({
    queryKey: ['retest-tasks', status ?? 'all'],
    queryFn: async () => (await axios.get<RetestTaskRow[]>('/api/retest-tasks', { params: status ? { status } : {} })).data,
  })
}

export async function stageBatch(payload: { id: string; baselineVersion: string; candidateVersion: string; keys: string[] }) {
  const { data } = await axios.post<ReleaseBatch>('/api/release-batches', payload)
  return data
}

export async function abandonBatch(id: string) {
  const { data } = await axios.delete<ReleaseBatch>(`/api/release-batches/${id}`)
  return data
}

export type PublishOutcome =
  | { ok: true; result: PublishResult }
  | { ok: false; alreadyPublished: true; result: PublishResult }
  | { ok: false; alreadyPublished: false; abandoned: true }
  | { ok: false; alreadyPublished: false; abandoned: false; error: unknown }

export async function publishBatch(id: string): Promise<PublishOutcome> {
  try {
    const { data } = await axios.post<PublishResult>(`/api/release-batches/${id}/publish`)
    return { ok: true, result: data }
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 409) {
      const result = err.response.data?.result as PublishResult | undefined
      if (err.response.data?.error === 'BATCH_ALREADY_PUBLISHED' && result) {
        return { ok: false, alreadyPublished: true, result }
      }
      if (err.response.data?.error === 'BATCH_ABANDONED') {
        return { ok: false, alreadyPublished: false, abandoned: true }
      }
    }
    return { ok: false, alreadyPublished: false, abandoned: false, error: err }
  }
}

export async function submitRetest(taskId: string, payload: { result: string; note: string; environment: string; expectedRevision: number }) {
  const { data } = await axios.post<SubmitResult>(`/api/retest-tasks/${taskId}/submit`, payload)
  return data
}
