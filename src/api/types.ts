export type IssueStatus = '待分配' | '修复中' | '待复测' | '已通过' | '已退回' | '不适用'

export type RetestTaskStatus = '待复测' | '已完成' | '已失效'

export type Issue = {
  key: string
  title: string
  site: string
  version: string
  wcag: string[]
  issueType: string
  impact: '致命' | '严重' | '中等' | '轻微'
  affected: string
  reproduction: string
  evidence: string
  rootCause: string
  status: IssueStatus
  priority: 'P0' | 'P1' | 'P2' | 'P3'
  team: string
  owner: string
  dueDate: string
  mergedKeys: string[]
  fixNote?: string
  retestEnv?: string
  /** 当前修订号，任何会改变问题状态/字段的操作都会单调递增 */
  revision: number
  /** 最近一次把该问题带入当前修订结果的发布批次 */
  lastBatchId?: string
  retestRecords: Array<{ id: string; actor: string; result: string; note: string; at: string }>
  history: Array<{ at: string; actor: string; action: string; detail: string }>
}

/** 发布批次为采纳项生成的复测任务 */
export type RetestTask = {
  id: string
  issueKey: string
  batchId: string
  /** 任务所基于的问题修订结果 */
  issueRevision: number
  title: string
  retestEnv?: string
  status: RetestTaskStatus
  /** 幂等键：同一批次同一问题只允许生成一条复测任务 */
  idempotencyKey: string
  createdAt: string
  completedAt?: string
  result?: string
}

export type BatchItemStatus = '待重放' | '已应用' | '冲突跳过'

/** 发布批次中的单个采纳项，携带暂存时的基线修订 */
export type BatchItem = {
  issueKey: string
  field: string
  baseline: string
  candidate: string
  summary: string
  risk: '低' | '中' | '高'
  baseRevision: number
  /** 发布时要应用到问题上的字段补丁 */
  patch: Partial<Issue>
  status: BatchItemStatus
  /** 发布时问题的最新修订（与 baseRevision 不同即为冲突） */
  latestRevision?: number
  conflictReason?: string
  appliedRevision?: number
}

export type BatchStatus = 'staged' | 'published' | 'abandoned'

export type ReleaseBatch = {
  id: string
  revision: string
  status: BatchStatus
  baselineVersion: string
  candidateVersion: string
  createdAt: string
  publishedAt?: string
  items: BatchItem[]
}

export type ConflictEntry = {
  issueKey: string
  field: string
  baseRevision: number
  latestRevision: number
  reason: string
  /** 问题最新修订的来源，便于在列表里说明“另一标签页做了什么” */
  latestActor: string
  latestAction: string
  at: string
}

export type PublishResult = {
  batchId: string
  revision: string
  applied: string[]
  conflicts: ConflictEntry[]
  retestTaskIds: string[]
  publishedAt: string
}
