import { http, HttpResponse } from 'msw'
import { seedIssues } from './seed'
import type { BatchItem, ConflictEntry, Issue, PublishResult, ReleaseBatch, RetestTask } from './types'

/**
 * Mock 服务端存储。
 * 每个标签页各自运行一个 MSW 实例，内存互不共享，因此把权威状态落到 localStorage，
 * 并通过 BroadcastChannel 广播提交事件，让两个标签页对同一份修订数据并发读写。
 */
export const DB_KEY = 'a11y-remediation-db-v1'
export const SYNC_CHANNEL = 'a11y-remediation-server'

export type DB = {
  issues: Issue[]
  batches: Record<string, ReleaseBatch>
  tasks: Record<string, RetestTask>
  publishResults: Record<string, PublishResult>
}

type StorageLike = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

export function seedDB(): DB {
  const issues = structuredClone(seedIssues)
  const find = (key: string) => issues.find((item) => item.key === key)!
  const tasks: RetestTask[] = [
    {
      id: 'TASK-1074-1',
      issueKey: 'A11Y-1074',
      batchId: 'seed',
      issueRevision: find('A11Y-1074').revision,
      title: '图表高对比色板首轮复测',
      retestEnv: find('A11Y-1074').retestEnv,
      status: '待复测',
      idempotencyKey: 'seed:A11Y-1074',
      createdAt: '09-29 09:30',
    },
    {
      id: 'TASK-1083-2',
      issueKey: 'A11Y-1083',
      batchId: 'seed',
      issueRevision: find('A11Y-1083').revision,
      title: '错误提示 aria-live 退回后复测',
      retestEnv: find('A11Y-1083').retestEnv,
      status: '待复测',
      idempotencyKey: 'seed:A11Y-1083',
      createdAt: '09-29 10:05',
    },
  ]
  return {
    issues,
    batches: {},
    tasks: Object.fromEntries(tasks.map((task) => [task.id, task])),
    publishResults: {},
  }
}

const label = () => '刚刚'

export function createServerStore(storage: StorageLike) {
  const readDB = (): DB => {
    const raw = storage.getItem(DB_KEY)
    if (raw) {
      try {
        return JSON.parse(raw) as DB
      } catch {
        // 落到损坏数据时重新播种
      }
    }
    const db = seedDB()
    storage.setItem(DB_KEY, JSON.stringify(db))
    return db
  }

  const writeDB = (db: DB) => storage.setItem(DB_KEY, JSON.stringify(db))
  return { readDB, writeDB, label }
}

/** 版本差异候选方案：服务端持有采纳后要重放的字段补丁，发布时按修订号决定是否可重放 */
export type DiffPlanEntry = {
  key: string
  field: string
  baseline: string
  candidate: string
  risk: '低' | '中' | '高'
  summary: string
  createsRetest: boolean
  retestEnv: string
  patch: Partial<Issue>
}

export const DIFF_PLAN: Record<string, DiffPlanEntry> = {
  'A11Y-1048': {
    key: 'A11Y-1048',
    field: '修复状态',
    baseline: '待复测',
    candidate: '已提交复测材料',
    risk: '低',
    summary: '补齐 Drawer Esc 退出与焦点回归逻辑，键盘陷阱修复进入复测。',
    createsRetest: true,
    retestEnv: 'Chrome 140 / NVDA 2026.1 / 商城 v4.18-rc2',
    patch: {
      status: '待复测',
      fixNote: '补充 Esc 退出、Tab/Shift+Tab 边界处理与关闭后焦点回归。',
      retestEnv: 'Chrome 140 / NVDA 2026.1 / 商城 v4.18-rc2',
    },
  },
  'A11Y-1074': {
    key: 'A11Y-1074',
    field: '图表色板',
    baseline: '#98B7AF / 对比度 2.6:1',
    candidate: '#1D6570 / 对比度 5.1:1 + 纹理',
    risk: '低',
    summary: '更换高对比色板，趋势线增加虚线纹理并提供可切换数据表。',
    createsRetest: true,
    retestEnv: 'Safari 26 / 对比度工具 / admin-v2.7.5-rc2',
    patch: {
      fixNote: '更换色板并增加虚线纹理和可切换数据表（对比度 5.1:1）。',
      retestEnv: 'Safari 26 / 对比度工具 / admin-v2.7.5-rc2',
    },
  },
  'A11Y-1083': {
    key: 'A11Y-1083',
    field: '错误提示实现',
    baseline: '视觉错误颜色',
    candidate: 'aria-live + aria-describedby',
    risk: '中',
    summary: '错误提示接入 aria-live 区域，字段补充 aria-describedby 描述。',
    createsRetest: true,
    retestEnv: 'Chrome 140 / JAWS 2026 / 采购门户 v1.12-rc3',
    patch: {
      status: '待复测',
      fixNote: '错误提示接入 role=alert 与 aria-live，字段补充 aria-describedby。',
      retestEnv: 'Chrome 140 / JAWS 2026 / 采购门户 v1.12-rc3',
    },
  },
}

export function buildHandlers(storage: StorageLike, apiPrefix = '') {
  const { readDB, writeDB } = createServerStore(storage)
  const api = (path: string) => `${apiPrefix}${path}`

  return [
    http.get(api('/api/issues'), ({ request }) => {
      const url = new URL(request.url)
      const query = url.searchParams.get('query')?.toLowerCase() ?? ''
      const status = url.searchParams.get('status') ?? ''
      const site = url.searchParams.get('site') ?? ''
      const db = readDB()
      const filtered = db.issues.filter(
        (issue) =>
          (!query || `${issue.key}${issue.title}${issue.rootCause}`.toLowerCase().includes(query)) &&
          (!status || issue.status === status) &&
          (!site || issue.site === site),
      )
      return HttpResponse.json(filtered)
    }),

    http.post(api('/api/issues/bulk-assign'), async ({ request }) => {
      const body = (await request.json()) as { keys: string[]; team: string; owner: string; dueDate: string; priority: string }
      const db = readDB()
      db.issues = db.issues.map((issue) =>
        body.keys.includes(issue.key)
          ? {
              ...issue,
              team: body.team,
              owner: body.owner,
              dueDate: body.dueDate,
              priority: body.priority as Issue['priority'],
              status: '修复中',
              revision: issue.revision + 1,
              history: [...issue.history, { at: label(), actor: '当前用户', action: '批量分配', detail: `指派至 ${body.team} / ${body.owner}（修订 ${issue.revision + 1}）` }],
            }
          : issue,
      )
      writeDB(db)
      return HttpResponse.json({ updated: body.keys.length })
    }),

    http.post(api('/api/issues/merge'), async ({ request }) => {
      const body = (await request.json()) as { keys: string[] }
      if (!body.keys?.length) return HttpResponse.json({ error: 'KEYS_REQUIRED' }, { status: 400 })
      const db = readDB()
      const primary = db.issues.find((issue) => issue.key === body.keys[0])
      if (!primary) return HttpResponse.json({ error: 'PRIMARY_NOT_FOUND' }, { status: 404 })
      db.issues = db.issues.map((issue) => {
        if (!body.keys.includes(issue.key)) return issue
        const nextRevision = issue.revision + 1
        return {
          ...issue,
          rootCause: primary.rootCause,
          status: issue.key === primary.key ? issue.status : '不适用',
          mergedKeys: issue.key === primary.key ? body.keys.slice(1) : [primary.key],
          revision: nextRevision,
          history: [...issue.history, { at: label(), actor: '当前用户', action: '重复问题合并', detail: `合并至 ${primary.key}（修订 ${nextRevision}）` }],
        }
      })
      writeDB(db)
      return HttpResponse.json({ merged: body.keys.length })
    }),

    /** 版本差异清单：返回每个候选项对应问题的最新修订号 */
    http.get(api('/api/version-diffs'), () => {
      const db = readDB()
      const diffs = Object.values(DIFF_PLAN).map((plan) => {
        const issue = db.issues.find((item) => item.key === plan.key)
        return {
          key: plan.key,
          title: issue?.title ?? '',
          field: plan.field,
          baseline: plan.baseline,
          candidate: plan.candidate,
          risk: plan.risk,
          summary: plan.summary,
          createsRetest: plan.createsRetest,
          retestEnv: plan.retestEnv,
          revision: issue?.revision ?? 0,
        }
      })
      return HttpResponse.json(diffs)
    }),

    /** 暂存发布批次（已发布的批次不允许再改） */
    http.post(api('/api/release-batches'), async ({ request }) => {
      const body = (await request.json()) as { id: string; baselineVersion: string; candidateVersion: string; keys: string[] }
      if (!body.id || !body.keys.length) return HttpResponse.json({ error: '批次编号与采纳项不能为空' }, { status: 400 })
      const db = readDB()
      const existing = db.batches[body.id]
      if (existing?.status === 'published') {
        return HttpResponse.json({ error: 'BATCH_ALREADY_PUBLISHED', batchId: body.id }, { status: 409 })
      }
      // staged / abandoned 同编号重新暂存：按最新修订重建采纳项（用于“返回修改”或失败恢复）
      const items: BatchItem[] = body.keys.map((key) => {
        const plan = DIFF_PLAN[key]
        const issue = db.issues.find((item) => item.key === key)
        if (!plan || !issue) throw new Error(`未知采纳项 ${key}`)
        return {
          issueKey: plan.key,
          field: plan.field,
          baseline: plan.baseline,
          candidate: plan.candidate,
          summary: plan.summary,
          risk: plan.risk,
          baseRevision: issue.revision,
          patch: plan.patch,
          status: '待重放',
        } satisfies BatchItem
      })
      const revision = `REL-${String(Date.now()).slice(-6)}`
      const batch: ReleaseBatch = existing
        ? { ...existing, status: 'staged' as const, baselineVersion: body.baselineVersion, candidateVersion: body.candidateVersion, items, publishedAt: undefined }
        : {
            id: body.id,
            revision,
            status: 'staged',
            baselineVersion: body.baselineVersion,
            candidateVersion: body.candidateVersion,
            createdAt: label(),
            items,
          }
      db.batches[batch.id] = batch
      writeDB(db)
      return HttpResponse.json(batch)
    }),

    http.get(api('/api/release-batches'), () => {
      const db = readDB()
      return HttpResponse.json(Object.values(db.batches).reverse())
    }),

    http.get(api('/api/release-batches/:id'), ({ params }) => {
      const db = readDB()
      const batch = db.batches[params.id as string]
      if (!batch) return HttpResponse.json({ error: 'BATCH_NOT_FOUND' }, { status: 404 })
      return HttpResponse.json(batch)
    }),

    /** 放弃暂存批次（已发布批次不可删改） */
    http.delete(api('/api/release-batches/:id'), ({ params }) => {
      const db = readDB()
      const batch = db.batches[params.id as string]
      if (!batch) return HttpResponse.json({ error: 'BATCH_NOT_FOUND' }, { status: 404 })
      if (batch.status === 'published') return HttpResponse.json({ error: 'BATCH_ALREADY_PUBLISHED' }, { status: 409 })
      batch.status = 'abandoned'
      writeDB(db)
      return HttpResponse.json(batch)
    }),

    /**
     * 发布批次：
     * 1. 已发布批次直接 409 并返回上次结果（重试不会重复重放/重复生成复测任务）；
     * 2. 逐项比对暂存修订 baseRevision 与问题最新修订，冲突项列出后跳过；
     * 3. 仅对无冲突项重放补丁、推进修订号，并按幂等键生成复测任务。
     */
    http.post(api('/api/release-batches/:id/publish'), ({ params }) => {
      const db = readDB()
      const batch = db.batches[params.id as string]
      if (!batch) return HttpResponse.json({ error: 'BATCH_NOT_FOUND' }, { status: 404 })
      if (batch.status === 'published') {
        return HttpResponse.json(
          { error: 'BATCH_ALREADY_PUBLISHED', result: db.publishResults[batch.id] },
          { status: 409 },
        )
      }
      if (batch.status === 'abandoned') {
        return HttpResponse.json({ error: 'BATCH_ABANDONED' }, { status: 409 })
      }

      const applied: string[] = []
      const conflicts: ConflictEntry[] = []
      const retestTaskIds: string[] = []

      for (const item of batch.items) {
        const issue = db.issues.find((entry) => entry.key === item.issueKey)
        if (!issue) {
          item.status = '冲突跳过'
          item.latestRevision = undefined
          item.conflictReason = '问题已不存在'
          conflicts.push({ issueKey: item.issueKey, field: item.field, baseRevision: item.baseRevision, latestRevision: 0, reason: '问题已不存在', latestActor: '-', latestAction: '-', at: label() })
          continue
        }

        item.latestRevision = issue.revision
        if (issue.revision !== item.baseRevision) {
          const latest = issue.history[issue.history.length - 1]
          item.status = '冲突跳过'
          item.conflictReason = `暂存基于修订 ${item.baseRevision}，问题最新修订为 ${issue.revision}`
          conflicts.push({
            issueKey: item.issueKey,
            field: item.field,
            baseRevision: item.baseRevision,
            latestRevision: issue.revision,
            reason: `暂存基于修订 ${item.baseRevision}，发布前问题已进入修订 ${issue.revision}`,
            latestActor: latest?.actor ?? '未知',
            latestAction: latest ? `${latest.action}：${latest.detail}` : '未知修改',
            at: latest?.at ?? label(),
          })
          continue
        }

        const nextRevision = issue.revision + 1
        Object.assign(issue, item.patch)
        issue.revision = nextRevision
        issue.lastBatchId = batch.id
        issue.history.push({
          at: label(),
          actor: '当前用户',
          action: `发布批次 ${batch.revision}`,
          detail: `采纳「${item.field}」变更，重放至修订 ${nextRevision}。`,
        })
        item.status = '已应用'
        item.appliedRevision = nextRevision
        applied.push(item.issueKey)

        const plan = DIFF_PLAN[item.issueKey]
        if (plan?.createsRetest) {
          const idempotencyKey = `${batch.id}:${item.issueKey}`
          let task = Object.values(db.tasks).find((entry) => entry.idempotencyKey === idempotencyKey)
          if (!task) {
            task = {
              id: `TASK-${batch.id.slice(0, 8)}-${item.issueKey.slice(5)}`,
              issueKey: item.issueKey,
              batchId: batch.id,
              issueRevision: nextRevision,
              title: `${item.field} 发布后复测`,
              retestEnv: plan.retestEnv,
              status: '待复测',
              idempotencyKey,
              createdAt: label(),
            }
            db.tasks[task.id] = task
          }
          retestTaskIds.push(task.id)
        }
      }

      batch.status = 'published'
      batch.publishedAt = label()
      const result: PublishResult = {
        batchId: batch.id,
        revision: batch.revision,
        applied,
        conflicts,
        retestTaskIds,
        publishedAt: batch.publishedAt,
      }
      db.publishResults[batch.id] = result
      writeDB(db)
      return HttpResponse.json(result)
    }),

    http.get(api('/api/retest-tasks'), ({ request }) => {
      const url = new URL(request.url)
      const status = url.searchParams.get('status') ?? ''
      const db = readDB()
      const tasks = Object.values(db.tasks)
        .map((task) => ({ ...task, issue: db.issues.find((issue) => issue.key === task.issueKey) }))
        .filter((task) => !status || task.status === status)
      return HttpResponse.json(tasks)
    }),

    /**
     * 提交复测结果：任务维度幂等。
     * 已完成任务重复提交直接返回首次结果，不会再写复测记录、不再推进问题修订。
     */
    http.post(api('/api/retest-tasks/:id/submit'), async ({ params, request }) => {
      const body = (await request.json()) as { result: Issue['status']; note: string; environment: string; expectedRevision: number }
      const db = readDB()
      const task = db.tasks[params.id as string]
      if (!task) return HttpResponse.json({ error: 'TASK_NOT_FOUND' }, { status: 404 })

      if (task.status !== '待复测') {
        const issue = db.issues.find((entry) => entry.key === task.issueKey)
        return HttpResponse.json({ task, issue, idempotent: true })
      }

      const issue = db.issues.find((entry) => entry.key === task.issueKey)
      if (!issue) return HttpResponse.json({ error: 'ISSUE_NOT_FOUND' }, { status: 404 })
      if (body.expectedRevision !== undefined && body.expectedRevision !== issue.revision) {
        return HttpResponse.json(
          { error: 'REVISION_CONFLICT', expected: issue.revision, base: body.expectedRevision },
          { status: 409 },
        )
      }

      const recordLabel = body.result === '已通过' ? '通过' : body.result === '已退回' ? '退回' : '不适用'
      const nextRevision = issue.revision + 1
      issue.status = body.result
      issue.retestEnv = body.environment
      issue.retestRecords = [...issue.retestRecords, { id: `RT-${Date.now()}`, actor: '当前用户', result: recordLabel, note: body.note, at: label() }]
      issue.history.push({ at: label(), actor: '当前用户', action: `复测${recordLabel}`, detail: body.note ? `${body.note}（修订 ${nextRevision}）` : `修订 ${nextRevision}` })
      issue.revision = nextRevision

      task.status = '已完成'
      task.completedAt = label()
      task.result = body.result
      writeDB(db)
      return HttpResponse.json({ task, issue, idempotent: false })
    }),
  ]
}
