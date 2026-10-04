import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { BatchItem, BatchItemChange, Issue, ReleaseBatch } from '../api/types'
import { seedIssues } from '../api/seed'

type SavedFilter = { id: string; name: string; query: string; site: string; status: string; priority: string }

type WorkspaceState = {
  issues: Issue[]
  selectedKeys: string[]
  savedFilters: SavedFilter[]
  draft: string
  mergeKeys: string[]
  batches: ReleaseBatch[]
  setIssues: (issues: Issue[]) => void
  setSelectedKeys: (keys: string[]) => void
  saveFilter: (filter: Omit<SavedFilter, 'id'>) => void
  removeFilter: (id: string) => void
  setDraft: (draft: string) => void
  mergeIssues: (keys: string[]) => void
  updateIssue: (issue: Issue) => void
  bulkAssign: (keys: string[], team: string, owner: string, dueDate: string, priority: string) => void
  /** 暂存所选变更为一个发布批次，记录各项的基础修订号 */
  stageBatch: (items: Array<{ key: string; field: string; baseline: string; candidate: string; change: BatchItemChange }>) => string
  /**
   * 发布批次：按问题最新修订检测冲突，只重放无冲突项。
   * 已重放项不会重复生成（幂等），接口失败后批次与选择保留，可重试。
   */
  releaseBatch: (batchId: string, simulateFailure?: boolean) => Promise<{ replayed: number; conflicts: number }>
}

const STORAGE_KEY = 'accessibility-remediation-v1'

/** 对问题应用批次变更并自增修订号 */
function applyChange(issue: Issue, change: BatchItemChange): Issue {
  return {
    ...issue,
    ...change,
    rev: issue.rev + 1,
    history: [
      ...issue.history,
      { at: '刚刚', actor: '当前用户', action: '发布批次采纳', detail: `应用变更：${change.status ?? change.fixNote ?? '字段更新'}` },
    ],
  }
}

/** 合并两个问题，取修订号更高者 */
function mergeIssue(current: Issue, incoming: Issue): Issue {
  return incoming.rev > current.rev ? incoming : current
}

/** 合并批次项，取进度更靠前的状态（replayed > conflict > pending） */
function mergeBatchItem(current: BatchItem, incoming: BatchItem): BatchItem {
  const rank = { pending: 0, conflict: 1, replayed: 2 }
  return rank[incoming.status] > rank[current.status] ? incoming : current
}

/** 合并批次：状态取更靠后的，项取进度更靠前的 */
function mergeBatch(current: ReleaseBatch, incoming: ReleaseBatch): ReleaseBatch {
  const statusRank = { staged: 0, released: 1 }
  const status = statusRank[incoming.status] > statusRank[current.status] ? incoming.status : current.status
  const itemMap = new Map<string, BatchItem>()
  for (const item of current.items) itemMap.set(item.key, item)
  for (const item of incoming.items) {
    const existing = itemMap.get(item.key)
    itemMap.set(item.key, existing ? mergeBatchItem(existing, item) : item)
  }
  return {
    ...current,
    status,
    items: Array.from(itemMap.values()),
    releasedAt: incoming.releasedAt ?? current.releasedAt,
    lastError: incoming.lastError ?? current.lastError,
  }
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      issues: structuredClone(seedIssues),
      selectedKeys: [],
      savedFilters: [
        { id: 'f1', name: 'P0/P1 未关闭', query: '', site: '', status: '', priority: 'P0' },
        { id: 'f2', name: '基础组件组待复测', query: '基础组件', site: '', status: '待复测', priority: '' },
      ],
      draft: 'A11Y-1048：需同时验证 Esc 关闭与 Tab/Shift+Tab 环绕顺序，移动端抽屉也需复测。',
      mergeKeys: [],
      batches: [],
      setIssues: (incoming) =>
        set((state) => {
          const map = new Map(state.issues.map((issue) => [issue.key, issue]))
          for (const issue of incoming) {
            const existing = map.get(issue.key)
            map.set(issue.key, existing ? mergeIssue(existing, issue) : issue)
          }
          return { issues: Array.from(map.values()) }
        }),
      setSelectedKeys: (selectedKeys) => set({ selectedKeys }),
      saveFilter: (filter) => set((state) => ({ savedFilters: [...state.savedFilters, { ...filter, id: crypto.randomUUID() }] })),
      removeFilter: (id) => set((state) => ({ savedFilters: state.savedFilters.filter((item) => item.id !== id) })),
      setDraft: (draft) => set({ draft }),
      mergeIssues: (keys) =>
        set((state) => {
          const primary = state.issues.find((issue) => issue.key === keys[0])
          if (!primary) return state
          return {
            issues: state.issues.map((issue) =>
              keys.includes(issue.key)
                ? {
                    ...issue,
                    rootCause: primary.rootCause,
                    status: issue.key === primary.key ? issue.status : '不适用',
                    mergedKeys: issue.key === primary.key ? keys.slice(1) : [primary.key],
                    rev: issue.rev + 1,
                    history: [...issue.history, { at: '刚刚', actor: '当前用户', action: '重复问题合并', detail: `合并至 ${primary.key}` }],
                  }
                : issue,
            ),
            selectedKeys: [],
          }
        }),
      updateIssue: (updated) =>
        set((state) => ({
          issues: state.issues.map((issue) => (issue.key === updated.key ? { ...updated, rev: issue.rev + 1 } : issue)),
        })),
      bulkAssign: (keys, team, owner, dueDate, priority) =>
        set((state) => ({
          issues: state.issues.map((issue) =>
            keys.includes(issue.key)
              ? {
                  ...issue,
                  team,
                  owner,
                  dueDate,
                  priority: priority as Issue['priority'],
                  status: '修复中',
                  rev: issue.rev + 1,
                  history: [...issue.history, { at: '刚刚', actor: '当前用户', action: '批量分配', detail: `指派至 ${team} / ${owner}` }],
                }
              : issue,
          ),
        })),
      stageBatch: (items) => {
        const id = `BATCH-${Date.now()}`
        const state = get()
        const batchItems: BatchItem[] = items.map((item) => {
          const issue = state.issues.find((i) => i.key === item.key)
          return { ...item, baseRev: issue?.rev ?? 1, status: 'pending' }
        })
        const batch: ReleaseBatch = {
          id,
          name: `发布批次 ${new Date().toLocaleString('zh-CN')}`,
          createdAt: new Date().toISOString(),
          status: 'staged',
          items: batchItems,
        }
        set((state) => ({ batches: [...state.batches, batch] }))
        return id
      },
      releaseBatch: async (batchId, simulateFailure = false) => {
        const state = get()
        const batch = state.batches.find((b) => b.id === batchId)
        if (!batch || batch.status === 'released') {
          return { replayed: 0, conflicts: 0 }
        }
        const items = batch.items.map((item) => ({ ...item }))
        let replayed = 0
        let conflicts = 0
        let failed = false

        for (const item of items) {
          if (item.status !== 'pending') continue
          const issue = get().issues.find((i) => i.key === item.key)
          if (!issue || issue.rev !== item.baseRev) {
            // 问题在暂存后被其他标签页修改 → 冲突，跳过不重放
            item.status = 'conflict'
            conflicts++
            continue
          }
          // 重放无冲突项：应用变更并自增修订号
          const updated = applyChange(issue, item.change)
          item.status = 'replayed'
          item.baseRev = updated.rev
          replayed++
          // 每项重放后立即持久化，刷新页面也不丢失进度
          set((s) => ({
            issues: s.issues.map((i) => (i.key === item.key ? updated : i)),
            batches: s.batches.map((b) => (b.id === batchId ? { ...b, items: items.map((it) => ({ ...it })) } : b)),
          }))
          // 模拟接口失败：第一项重放后抛出，批次与选择保留
          if (simulateFailure) {
            failed = true
            set((s) => ({
              batches: s.batches.map((b) => (b.id === batchId ? { ...b, lastError: '模拟接口失败：部分变更未提交' } : b)),
            }))
            break
          }
        }

        if (failed) throw new Error('模拟接口失败')

        // 标记批次已发布，旧批次不能再次发布
        set((s) => ({
          batches: s.batches.map((b) =>
            b.id === batchId
              ? { ...b, status: 'released', releasedAt: new Date().toISOString(), lastError: undefined, items: items.map((it) => ({ ...it })) }
              : b,
          ),
        }))
        return { replayed, conflicts }
      },
    }),
    {
      name: STORAGE_KEY,
      version: 1,
    },
  ),
)

// 跨标签页同步：监听 localStorage 事件，按修订号合并问题、按进度合并批次
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return
    try {
      const incoming = JSON.parse(event.newValue)?.state as { issues?: Issue[]; batches?: ReleaseBatch[] } | undefined
      if (!incoming) return
      useWorkspaceStore.setState((current) => {
        let nextIssues = current.issues
        let nextBatches = current.batches
        if (incoming.issues) {
          const map = new Map(current.issues.map((i) => [i.key, i]))
          for (const issue of incoming.issues) {
            const existing = map.get(issue.key)
            map.set(issue.key, existing ? mergeIssue(existing, issue) : issue)
          }
          nextIssues = Array.from(map.values())
        }
        if (incoming.batches) {
          const map = new Map(current.batches.map((b) => [b.id, b]))
          for (const batch of incoming.batches) {
            const existing = map.get(batch.id)
            map.set(batch.id, existing ? mergeBatch(existing, batch) : batch)
          }
          nextBatches = Array.from(map.values())
        }
        return { issues: nextIssues, batches: nextBatches }
      })
    } catch {
      // 忽略解析错误
    }
  })
}
