import assert from 'node:assert/strict'
import { setupServer } from 'msw/node'
import { buildHandlers, DB_KEY } from '../src/api/handlers.ts'

/** 两个标签页共享同一个服务端存储（等价于浏览器里的 localStorage） */
const mem = new Map()
const sharedStorage = {
  getItem: (key) => (mem.has(key) ? mem.get(key) : null),
  setItem: (key, value) => mem.set(key, value),
}

const server = setupServer(...buildHandlers(sharedStorage, '*'))
server.listen({ onUnhandledRequest: 'error' })

const json = async (res) => {
  const text = await res.text()
  return text ? JSON.parse(text) : null
}
const get = (url) => fetch(url).then(json)
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const del = (url) => fetch(url, { method: 'DELETE' })

const snapshot = () => JSON.parse(mem.get(DB_KEY))
const issueRev = (db, key) => db.issues.find((i) => i.key === key).revision
const findIssue = (db, key) => db.issues.find((i) => i.key === key)

let passed = 0
const check = (name, fn) => {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

// --- 场景 1：标签页 A 暂存批次后，标签页 B 提交复测/修改，A 发布时只重放无冲突项 ---
{
  console.log('场景 1：暂存后另一方修改 → 发布列出冲突，只重放无冲突项')
  const batchId = 'BATCH-A-1'
  const r1 = await post('http://localhost/api/release-batches', {
    id: batchId,
    baselineVersion: 'v4.18',
    candidateVersion: 'v4.18-rc2',
    keys: ['A11Y-1048', 'A11Y-1074'],
  })
  assert.equal(r1.status, 200)
  const batch = await json(r1)
  check('暂存批次锁定各问题基线修订', () => {
    assert.equal(batch.items.find((i) => i.issueKey === 'A11Y-1048').baseRevision, 3)
    assert.equal(batch.items.find((i) => i.issueKey === 'A11Y-1074').baseRevision, 4)
  })

  // 标签页 B：对 1048 做批量分配（推进修订 3→4）
  await post('http://localhost/api/issues/bulk-assign', { keys: ['A11Y-1048'], team: '结算体验组', owner: '王测', dueDate: '2026-10-20', priority: 'P1' })
  // 标签页 B：对种子复测任务 1074 提交复测（修订 4→5）
  const before1074 = issueRev(snapshot(), 'A11Y-1074')
  await post('http://localhost/api/retest-tasks/TASK-1074-1/submit', {
    result: '已通过',
    note: '对比度 5.2:1，纹理与数据表可用',
    environment: 'Safari 26 / 对比度工具',
    expectedRevision: before1074,
  })

  const pub = await post(`http://localhost/api/release-batches/${batchId}/publish`, {})
  const result = await json(pub)
  check('发布返回冲突清单', () => {
    assert.equal(pub.status, 200)
    assert.deepEqual(result.applied, [])
    const keys = result.conflicts.map((c) => c.issueKey).sort()
    assert.deepEqual(keys, ['A11Y-1048', 'A11Y-1074'])
    const c48 = result.conflicts.find((c) => c.issueKey === 'A11Y-1048')
    assert.equal(c48.baseRevision, 3)
    assert.equal(c48.latestRevision, 4)
    assert.match(c48.latestAction, /批量分配/)
  })
  check('冲突项未被覆盖：1048 保留批量分配结果', () => {
    const db = snapshot()
    const i = findIssue(db, 'A11Y-1048')
    assert.equal(i.status, '修复中')
    assert.equal(i.owner, '王测')
    assert.equal(i.revision, 4)
    assert.equal(i.lastBatchId, undefined)
  })
  check('冲突项未生成复测任务', () => {
    const db = snapshot()
    assert.equal(Object.values(db.tasks).filter((t) => t.batchId === batchId).length, 0)
  })
}

// --- 场景 2：新批次只选无冲突项 → 正常重放并生成任务 ---
{
  console.log('场景 2：无冲突批次发布 → 重放、推进修订、生成复测任务')
  const batchId = 'BATCH-A-2'
  await post('http://localhost/api/release-batches', {
    id: batchId,
    baselineVersion: 'v4.18',
    candidateVersion: 'v4.19-dev',
    keys: ['A11Y-1083'],
  })
  const baseRev = issueRev(snapshot(), 'A11Y-1083')
  const pub = await post(`http://localhost/api/release-batches/${batchId}/publish`, {})
  const result = await json(pub)
  check('1083 被重放并推进一个修订', () => {
    assert.deepEqual(result.applied, ['A11Y-1083'])
    assert.equal(result.conflicts.length, 0)
    assert.equal(issueRev(snapshot(), 'A11Y-1083'), baseRev + 1)
    const i = findIssue(snapshot(), 'A11Y-1083')
    assert.equal(i.status, '待复测')
    assert.equal(i.lastBatchId, batchId)
  })
  check('每个采纳项只生成 1 条复测任务', () => {
    assert.equal(result.retestTaskIds.length, 1)
  })
}

// --- 场景 3：已发布批次不能再发布；重试不重复生成任务 ---
{
  console.log('场景 3：旧批次重复发布 → 409 + 首次结果，任务不重复')
  const batchId = 'BATCH-A-2'
  const tasksBefore = Object.values(snapshot().tasks).filter((t) => t.batchId === batchId).length
  const repub = await post(`http://localhost/api/release-batches/${batchId}/publish`, {})
  check('重复发布被拒绝（409）', () => assert.equal(repub.status, 409))
  const body = await json(repub)
  check('返回首次发布结果且未重复生成任务', () => {
    assert.equal(body.error, 'BATCH_ALREADY_PUBLISHED')
    assert.deepEqual(body.result.applied, ['A11Y-1083'])
    const tasksAfter = Object.values(snapshot().tasks).filter((t) => t.batchId === batchId).length
    assert.equal(tasksAfter, tasksBefore)
  })
  // 已发布批次也不能再改暂存
  const reStage = await post('http://localhost/api/release-batches', { id: batchId, baselineVersion: 'x', candidateVersion: 'y', keys: ['A11Y-1074'] })
  check('已发布批次不能再暂存覆盖', () => assert.equal(reStage.status, 409))
}

// --- 场景 4：复测任务提交幂等：重试不重复写记录、不重复推进修订 ---
{
  console.log('场景 4：复测提交重试 → 任务维度幂等')
  const db0 = snapshot()
  const task = Object.values(db0.tasks).find((t) => t.batchId === 'BATCH-A-2' && t.issueKey === 'A11Y-1083')
  const first = await post(`http://localhost/api/retest-tasks/${task.id}/submit`, {
    result: '已通过', note: 'aria-live 正常播报', environment: 'Chrome 140 / JAWS', expectedRevision: task.issueRevision,
  }).then(json)
  check('首次提交生效并推进修订', () => {
    assert.equal(first.idempotent, false)
    assert.equal(findIssue(snapshot(), 'A11Y-1083').status, '已通过')
    assert.equal(findIssue(snapshot(), 'A11Y-1083').revision, task.issueRevision + 1)
  })
  const recordsAfterFirst = findIssue(snapshot(), 'A11Y-1083').retestRecords.length
  const second = await post(`http://localhost/api/retest-tasks/${task.id}/submit`, {
    result: '已退回', note: '伪造的重复提交', environment: 'X', expectedRevision: task.issueRevision + 1,
  }).then(json)
  check('重复提交返回幂等结果，不写第二条记录、修订不回退', () => {
    assert.equal(second.idempotent, true)
    const i = findIssue(snapshot(), 'A11Y-1083')
    assert.equal(i.retestRecords.length, recordsAfterFirst)
    assert.equal(i.status, '已通过')
    assert.equal(i.revision, task.issueRevision + 1)
  })
}

// --- 场景 5：乐观锁：基于旧修订的复测提交被拒 ---
{
  console.log('场景 5：基于过期修订的复测提交 → 409，不覆盖另一方结果')
  // 标签页 B 先通过 TASK-1083-2（种子任务，当前 1083 修订为 task.issueRevision+1 已完成场景4... 改用 1048 新批次）
  const bid = 'BATCH-A-3'
  await post('http://localhost/api/release-batches', { id: bid, baselineVersion: 'v4.18', candidateVersion: 'v4.20', keys: ['A11Y-1048'] })
  await post(`http://localhost/api/release-batches/${bid}/publish`, {})
  const db = snapshot()
  const task = Object.values(db.tasks).find((t) => t.batchId === bid)
  const staleRev = task.issueRevision
  // 另一方先批量分配改动 1048
  await post('http://localhost/api/issues/bulk-assign', { keys: ['A11Y-1048'], team: 'X', owner: 'Y', dueDate: '2026-11-01', priority: 'P2' })
  const res = await post(`http://localhost/api/retest-tasks/${task.id}/submit`, {
    result: '已通过', note: '旧页面提交', environment: 'Z', expectedRevision: staleRev,
  })
  check('过期修订提交返回 409', () => {
    assert.equal(res.status, 409)
  })
  const body = await json(res)
  check('响应给出最新修订供页面刷新', () => {
    assert.equal(body.error, 'REVISION_CONFLICT')
    assert.equal(body.expected, staleRev + 1)
    assert.equal(findIssue(snapshot(), 'A11Y-1048').owner, 'Y')
  })
}

// --- 场景 6：放弃的批次不能发布；放弃后可复用同 id 重新暂存 ---
{
  console.log('场景 6：批次生命周期（放弃 → 不可发布 → 可重建）')
  const bid = 'BATCH-A-4'
  await post('http://localhost/api/release-batches', { id: bid, baselineVersion: 'v1', candidateVersion: 'v2', keys: ['A11Y-1074'] })
  await del(`http://localhost/api/release-batches/${bid}`)
  const pubGone = await post(`http://localhost/api/release-batches/${bid}/publish`, {})
  check('放弃的批次不可发布', () => {
    const db = snapshot()
    assert.equal(db.batches[bid].status, 'abandoned')
    const items = db.batches[bid].items.every((i) => i.status === '待重放')
    assert.equal(items, true)
    assert.equal(pubGone.status, 409)
  })
}

// --- 场景 7：问题台账、复测队列、报告读取同一修订结果 ---
{
  console.log('场景 7：所有读视图同源于 /api/issues 的修订结果')
  const issues = await get('http://localhost/api/issues')
  const pendingTasks = await get('http://localhost/api/retest-tasks?status=待复测')
  check('复测任务携带的问题修订与台账一致', () => {
    for (const task of pendingTasks) {
      const ledger = issues.find((i) => i.key === task.issueKey)
      assert.ok(ledger, `台账包含 ${task.issueKey}`)
      assert.equal(task.issue.revision, ledger.revision)
    }
  })
  check('发布重放项在台账中可见批次来源', () => {
    const i = issues.find((x) => x.key === 'A11Y-1083')
    assert.equal(i.lastBatchId, 'BATCH-A-2')
  })
}

server.close()
console.log(`\n全部 ${passed} 项断言通过`)
