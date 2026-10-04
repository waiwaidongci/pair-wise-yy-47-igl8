import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Checkbox, Select, Space, Table, Tag, Typography, message } from 'antd'
import {
  CheckCircleOutlined,
  CloudServerOutlined,
  WarningOutlined,
  ReloadOutlined,
  SaveOutlined,
} from '@ant-design/icons'
import { useQueryClient } from '@tanstack/react-query'
import {
  abandonBatch,
  publishBatch,
  stageBatch,
  useReleaseBatches,
  useVersionDiffs,
  type PublishOutcome,
  type VersionDiff,
} from '../api/release'
import type { ConflictEntry, PublishResult, ReleaseBatch } from '../api/types'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

type Phase = 'editing' | 'staged'

function makeBatchId() {
  return `BATCH-${Date.now().toString(36).toUpperCase()}`
}

export default function VersionsPage() {
  const queryClient = useQueryClient()
  const diffsQuery = useVersionDiffs()
  const batchesQuery = useReleaseBatches()
  const batchDraft = useWorkspaceStore((state) => state.batchDraft)
  const setBatchDraft = useWorkspaceStore((state) => state.setBatchDraft)

  const [baselineVersion, setBaselineVersion] = useState('v4.18')
  const [candidateVersion, setCandidateVersion] = useState('v4.18-rc2')
  const [accepted, setAccepted] = useState<string[]>(['A11Y-1074'])
  const [phase, setPhase] = useState<Phase>('editing')
  const [staging, setStaging] = useState(false)
  const [stageError, setStageError] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState(false)
  const [simulateFlake, setSimulateFlake] = useState(false)
  const [outcome, setOutcome] = useState<{ result: PublishResult; alreadyPublished: boolean } | null>(null)

  const diffs = diffsQuery.data ?? []
  const batches = batchesQuery.data ?? []
  const liveBatch: ReleaseBatch | undefined = batchDraft ? batches.find((item) => item.id === batchDraft.id) : undefined

  // 刷新或接口失败后回到页面：依据持久化草稿恢复批次与已选变更
  useEffect(() => {
    if (batchDraft) {
      setPhase('staged')
      setAccepted(batchDraft.keys)
      setBaselineVersion(batchDraft.baselineVersion)
      setCandidateVersion(batchDraft.candidateVersion)
    }
  }, [batchDraft])

  const revisionByKey = useMemo(() => new Map(diffs.map((item) => [item.key, item.revision])), [diffs])

  const toggle = (key: string, checked: boolean) => {
    setAccepted((current) => (checked ? [...new Set([...current, key])] : current.filter((item) => item !== key)))
  }

  const persistStage = async (keys: string[], batchId: string) => {
    setStaging(true)
    setStageError(false)
    // 先乐观持久化草稿：即便本次请求失败后立刻刷新，批次编号与勾选仍可恢复
    setBatchDraft({ id: batchId, baselineVersion, candidateVersion, keys })
    setPhase('staged')
    try {
      await stageBatch({ id: batchId, baselineVersion, candidateVersion, keys })
      queryClient.invalidateQueries({ queryKey: ['release-batches'] })
      message.success(`已暂存发布批次 ${batchId}（${keys.length} 项采纳）`)
    } catch {
      // 失败不丢批次、不丢选择，允许用同一批次编号原样重试（不会产生重复批次）
      setStageError(true)
      message.error('暂存失败，批次与勾选已保留，可重试')
    } finally {
      setStaging(false)
    }
  }

  const onStage = () => {
    if (!accepted.length) return
    persistStage(accepted, batchDraft?.id ?? makeBatchId())
  }

  const onPublish = async () => {
    if (!batchDraft) return
    setPublishing(true)
    setPublishError(false)
    // 演示用：模拟发布请求在网络层丢失一次；重试时服务端仍保证幂等
    if (simulateFlake) {
      setSimulateFlake(false)
      await new Promise((resolve) => setTimeout(resolve, 500))
      setPublishing(false)
      setPublishError(true)
      message.error('发布请求中断（模拟），批次已保留，请重试')
      return
    }
    // 草稿可能来自“暂存失败后刷新”：若服务端尚无该批次，用同一编号补建后再发布；
    // 若批次已在其它标签页放弃，则以草稿重建一个新暂存批次
    if (!liveBatch || liveBatch.status === 'abandoned') {
      try {
        await stageBatch({
          id: batchDraft.id,
          baselineVersion: batchDraft.baselineVersion,
          candidateVersion: batchDraft.candidateVersion,
          keys: batchDraft.keys,
        })
        await queryClient.invalidateQueries({ queryKey: ['release-batches'] })
      } catch {
        setPublishing(false)
        setPublishError(true)
        message.error('恢复服务端批次失败，草稿已保留，可重试')
        return
      }
    }
    const result: PublishOutcome = await publishBatch(batchDraft.id)
    setPublishing(false)
    queryClient.invalidateQueries({ queryKey: ['issues'] })
    queryClient.invalidateQueries({ queryKey: ['retest-tasks'] })
    queryClient.invalidateQueries({ queryKey: ['release-batches'] })
    if (result.ok) {
      setOutcome({ result: result.result, alreadyPublished: false })
      setBatchDraft(null)
      setPhase('editing')
      message.success(`批次 ${result.result.revision} 已发布`)
    } else if (result.alreadyPublished) {
      setOutcome({ result: result.result, alreadyPublished: true })
      setBatchDraft(null)
      setPhase('editing')
      message.warning('该批次此前已在其它标签页发布，返回首次结果，未重复生成复测任务')
    } else if (result.abandoned) {
      setPublishError(true)
      message.warning('批次已被放弃，请重新暂存')
    } else {
      setPublishError(true)
      message.error('发布失败，批次与选择已保留，可重试')
    }
  }

  const backToEditing = () => {
    setPhase('editing')
    setOutcome(null)
  }

  const discardBatch = async () => {
    if (!batchDraft) return
    try {
      await abandonBatch(batchDraft.id)
    } catch {
      // 已发布等终态无需再删除；本地草稿仍要清掉
    }
    setBatchDraft(null)
    setPhase('editing')
    setStageError(false)
    setPublishError(false)
    setOutcome(null)
    await queryClient.invalidateQueries({ queryKey: ['release-batches'] })
    message.info('已放弃暂存批次，采纳项未生效')
  }

  // 暂存后、发布前的冲突预检：用服务端最新修订对比暂存基线修订
  const pendingConflicts = useMemo(() => {
    if (!liveBatch || liveBatch.status !== 'staged') return []
    return liveBatch.items
      .map((item) => ({ item, latest: revisionByKey.get(item.issueKey) }))
      .filter(({ item, latest }) => latest !== undefined && latest !== item.baseRevision)
  }, [liveBatch, revisionByKey])

  const columns = [
    {
      title: '采纳',
      width: 70,
      render: (_: unknown, record: VersionDiff) => (
        <Checkbox checked={accepted.includes(record.key)} disabled={phase === 'staged'} onChange={(event) => toggle(record.key, event.target.checked)} />
      ),
    },
    { title: '问题', dataIndex: 'key', width: 110, render: (value: string) => <Typography.Text strong>{value}</Typography.Text> },
    { title: '变更项', dataIndex: 'field', width: 130 },
    {
      title: '问题最新修订',
      dataIndex: 'revision',
      width: 120,
      render: (value: number, record: VersionDiff) => {
        const staged = liveBatch?.items.find((item) => item.issueKey === record.key)
        const drifted = staged && value !== staged.baseRevision
        return (
          <Space size={4}>
            <Tag color={drifted ? 'error' : 'blue'}>r{value}</Tag>
            {staged && <Tag color={drifted ? 'error' : 'default'}>暂存 r{staged.baseRevision}</Tag>}
          </Space>
        )
      },
    },
    { title: '当前基线', dataIndex: 'baseline', width: 240, render: (value: string) => <span style={{ color: '#9a4d35' }}>{value}</span> },
    { title: '候选版本', dataIndex: 'candidate', width: 290, render: (value: string) => <span style={{ color: '#26705a' }}>{value}</span> },
    { title: '风险', dataIndex: 'risk', width: 80, render: (value: string) => <Tag color={value === '中' ? 'gold' : 'green'}>{value}</Tag> },
  ]

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">VERSION DIFF / 版本发布批次</p>
          <h1>带修订号的版本采纳发布</h1>
          <p className="muted">先暂存已选变更锁定修订基线；发布时按问题最新修订列出冲突，只重放无冲突项。</p>
        </div>
        <Space>
          <Select value={baselineVersion} disabled={phase === 'staged'} onChange={setBaselineVersion} options={[{ value: 'v4.18' }, { value: 'v4.17' }]} style={{ width: 110 }} />
          <span>对比</span>
          <Select value={candidateVersion} disabled={phase === 'staged'} onChange={setCandidateVersion} options={[{ value: 'v4.18-rc2' }, { value: 'v4.19-dev' }]} style={{ width: 130 }} />
          {phase === 'editing' ? (
            <Button type="primary" icon={<SaveOutlined />} loading={staging} disabled={!accepted.length} onClick={onStage}>
              暂存已选变更{batchDraft ? '（更新批次）' : ''}
            </Button>
          ) : (
            <Space>
              <Button icon={<ReloadOutlined />} loading={publishing} type="primary" onClick={onPublish}>
                发布批次
              </Button>
              <Button onClick={backToEditing}>返回修改</Button>
            </Space>
          )}
        </Space>
      </div>

      {stageError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message="暂存请求失败"
          description="批次编号与已选变更已保留在本地并与服务端批次对应，点击“重试暂存”即可继续，不会产生重复批次。"
          action={<Button size="small" onClick={onStage} loading={staging}>重试暂存</Button>}
        />
      )}
      {publishError && batchDraft && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message="批次发布失败"
          description="发布批次与勾选均未丢失。重试仍为同一批次：服务端只在首次发布时重放变更与生成复测任务，重复请求会直接返回首次发布结果。"
          action={<Button size="small" type="primary" onClick={onPublish} loading={publishing}>重试发布</Button>}
        />
      )}
      {liveBatch?.status === 'staged' && (
        <Alert
          type={pendingConflicts.length ? 'warning' : 'info'}
          showIcon
          style={{ marginBottom: 12 }}
          icon={pendingConflicts.length ? <WarningOutlined /> : <CloudServerOutlined />}
          message={
            pendingConflicts.length
              ? `发布前预检：${pendingConflicts.length} 项在暂存后被其它标签页改过，发布时将列为冲突并跳过`
              : `发布批次 ${liveBatch.id}（修订 ${liveBatch.revision}）已暂存，采纳项仍与问题最新修订一致`
          }
          description={
            <Space direction="vertical" size={2}>
              {pendingConflicts.map(({ item, latest }) => (
                <span key={item.issueKey}>
                  <Typography.Text strong>{item.issueKey}</Typography.Text> 暂存基于 r{item.baseRevision}，最新 r{latest}
                  ，发布时仅报告冲突、不覆盖另一方的复测或修改。
                </span>
              ))}
              <Space>
                <Checkbox checked={simulateFlake} onChange={(event) => setSimulateFlake(event.target.checked)}>
                  演示：让下一次发布请求失败一次（验证批次保留与幂等重试）
                </Checkbox>
                <Button size="small" type="link" danger onClick={discardBatch}>放弃该批次</Button>
              </Space>
            </Space>
          }
        />
      )}

      {outcome && <PublishResultCard result={outcome.result} alreadyPublished={outcome.alreadyPublished} onClose={() => setOutcome(null)} />}

      <div className="panel">
        <div className="panel-head">
          <h3>变更清单</h3>
          <Space>
            <Tag color="blue">基线 {baselineVersion}</Tag>
            <Tag color="cyan">候选 {candidateVersion}</Tag>
          </Space>
        </div>
        <Table
          rowKey="key"
          dataSource={diffs}
          loading={diffsQuery.isLoading}
          pagination={false}
          scroll={{ x: 1150 }}
          columns={columns}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 14, marginTop: 14 }}>
        <div className="panel">
          <div className="panel-head"><h3>发布批次</h3><span className="muted">旧批次不可再次发布</span></div>
          <div style={{ padding: 12 }}>
            {batches.length === 0 && <Typography.Text type="secondary">暂无批次。暂存采纳项后生成带修订号的发布批次。</Typography.Text>}
            {batches.map((batch) => {
              const applied = batch.items.filter((item) => item.status === '已应用').length
              const skipped = batch.items.filter((item) => item.status === '冲突跳过').length
              return (
                <div key={batch.id} className="timeline-item">
                  <Space wrap>
                    <Typography.Text strong>{batch.revision}</Typography.Text>
                    <Tag color={batch.status === 'published' ? 'success' : batch.status === 'abandoned' ? 'default' : 'processing'}>
                      {batch.status === 'published' ? '已发布' : batch.status === 'abandoned' ? '已放弃' : '暂存中'}
                    </Tag>
                    {batch.status === 'published' && <Tag color="green">重放 {applied}</Tag>}
                    {skipped > 0 && <Tag color="error">冲突跳过 {skipped}</Tag>}
                  </Space>
                  <div>{batch.candidateVersion} ← {batch.baselineVersion} · {batch.items.length} 项采纳</div>
                  <span className="muted">{batch.id} · {batch.publishedAt ? `发布于 ${batch.publishedAt}` : `暂存于 ${batch.createdAt}`}</span>
                  {batch.status === 'published' && (
                    <div style={{ marginTop: 4 }}>
                      <Button size="small" type="link" icon={<CheckCircleOutlined />} disabled title="已发布批次不能再次发布，复测任务不会重复生成">
                        再次发布（已锁定）
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
        <div className="panel">
          <div className="panel-head"><h3>被接受变更的影响</h3></div>
          <div style={{ padding: 16 }}>
            <Typography.Paragraph>
              发布后，问题台账、复测队列与报告读取同一修订结果；每个采纳项至多生成 1 条复测任务，重试不会重复建单。
            </Typography.Paragraph>
            <Space wrap>
              <Tag color="green">无冲突项直接进入复测队列</Tag>
              <Tag color="red">冲突项保留双方状态，需人工合并后再发布</Tag>
              <Tag color="blue">所有读视图以修订号 r{Math.max(0, ...diffs.map((item) => item.revision))} 口径刷新</Tag>
            </Space>
          </div>
        </div>
      </div>
    </section>
  )
}

function PublishResultCard({ result, alreadyPublished, onClose }: { result: PublishResult; alreadyPublished: boolean; onClose: () => void }) {
  return (
    <Alert
      type={result.conflicts.length ? 'warning' : 'success'}
      showIcon
      style={{ marginBottom: 12 }}
      message={
        <Space wrap>
          <span>批次 {result.revision} 发布结果</span>
          <Tag color="green">重放 {result.applied.length} 项</Tag>
          {result.conflicts.length > 0 && <Tag color="error">冲突 {result.conflicts.length} 项</Tag>}
          <Tag color="blue">复测任务 {result.retestTaskIds.length} 条</Tag>
          {alreadyPublished && <Tag color="gold">重试返回首次结果，未重复执行</Tag>}
        </Space>
      }
      description={
        <Space direction="vertical" style={{ width: '100%' }} size={6}>
          {result.applied.length > 0 && (
            <div>
              <Typography.Text strong>已重放：</Typography.Text>
              {result.applied.map((key) => (
                <Tag key={key} color="green">{key}</Tag>
              ))}
            </div>
          )}
          {result.conflicts.length > 0 && (
            <div>
              <Typography.Text strong>冲突项（未覆盖）：</Typography.Text>
              {result.conflicts.map((conflict: ConflictEntry) => (
                <div key={conflict.issueKey} style={{ marginTop: 4 }}>
                  <Tag color="error">{conflict.issueKey}</Tag>
                  {conflict.reason}；最新变更来自 {conflict.latestActor} · {conflict.latestAction}（{conflict.at}）
                </div>
              ))}
            </div>
          )}
          <div className="muted">问题台账、复测队列、报告已按本次发布的修订结果刷新。</div>
          <Button size="small" type="link" onClick={onClose}>收起结果</Button>
        </Space>
      }
    />
  )
}
