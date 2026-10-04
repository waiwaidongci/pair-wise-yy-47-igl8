export type IssueStatus = '待分配' | '修复中' | '待复测' | '已通过' | '已退回' | '不适用'

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
  retestRecords: Array<{ id: string; actor: string; result: string; note: string; at: string }>
  history: Array<{ at: string; actor: string; action: string; detail: string }>
  /** 修订号：每次修改自增，发布批次据此检测冲突 */
  rev: number
}

/** 批次项可重放的变更字段 */
export type BatchItemChange = {
  status?: IssueStatus
  fixNote?: string
  retestEnv?: string
}

export type BatchItemStatus = 'pending' | 'replayed' | 'conflict'

export type BatchItem = {
  key: string
  field: string
  baseline: string
  candidate: string
  change: BatchItemChange
  /** 暂存时问题的修订号，发布时与此比较以检测外部修改 */
  baseRev: number
  status: BatchItemStatus
}

export type ReleaseBatchStatus = 'staged' | 'released'

export type ReleaseBatch = {
  id: string
  name: string
  createdAt: string
  status: ReleaseBatchStatus
  items: BatchItem[]
  releasedAt?: string
  /** 最近一次发布失败的信息（用于重试提示） */
  lastError?: string
}
