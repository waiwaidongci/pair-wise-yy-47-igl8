import { useMemo, useState } from 'react'
import { Alert, Button, Checkbox, Space, Switch, Table, Tag, Typography, message } from 'antd'
import {
  CheckCircleOutlined,
  CloudUploadOutlined,
  ReloadOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { useIssues } from '../api/useIssues'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import type { BatchItem, Issue, IssueStatus } from '../api/types'

const statusColor: Record<string, string> = { 待分配: 'default', 修复中: 'processing', 待复测: 'orange', 已通过: 'success', 已退回: 'error', 不适用: 'default' }

type DiffRow = {
  key: string
  field: string
  baseline: string
  candidate: string
  risk: string
  change: { status?: IssueStatus; fixNote?: string; retestEnv?: string }
}

const diffs: DiffRow[] = [
  {
    key: 'A11Y-1048',
    field: '修复状态',
    baseline: '修复中',
    candidate: '已提交复测材料',
    risk: '低',
    change: { status: '待复测' },
  },
  {
    key: 'A11Y-1074',
    field: '图表色板',
    baseline: '#98B7AF / 对比度 2.6:1',
    candidate: '#1D6570 / 对比度 5.1:1 + 纹理',
    risk: '低',
    change: { fixNote: '更换色板 #1D6570（对比度 5.1:1），增加虚线纹理与可切换数据表' },
  },
  {
    key: 'A11Y-1083',
    field: '错误提示实现',
    baseline: '视觉错误颜色',
    candidate: 'aria-live + aria-describedby',
    risk: '中',
    change: { fixNote: '表单错误组件接入 aria-live 与字段 aria-describedby' },
  },
]

export default function VersionsPage() {
  useIssues()
  const issues = useWorkspaceStore((state) => state.issues)
  const batches = useWorkspaceStore((state) => state.batches)
  const stageBatch = useWorkspaceStore((state) => state.stageBatch)
  const releaseBatch = useWorkspaceStore((state) => state.releaseBatch)
  const [accepted, setAccepted] = useState<string[]>(['A11Y-1074'])
  const [simulateFailure, setSimulateFailure] = useState(false)
  const [releasingId, setReleasingId] = useState<string | null>(null)

  const issueMap = useMemo(() => new Map(issues.map((issue) => [issue.key, issue])), [issues])

  const toggle = (key: string, checked: boolean) => {
    setAccepted((current) => (checked ? [...new Set([...current, key])] : current.filter((item) => item !== key)))
  }

  const handleStage = () => {
    const items = diffs.filter((diff) => accepted.includes(diff.key))
    if (!items.length) return
    const id = stageBatch(items)
    message.success(`已暂存 ${items.length} 项变更为发布批次 ${id}`)
    setAccepted([])
  }

  const handleRelease = async (batchId: string) => {
    setReleasingId(batchId)
    try {
      const result = await releaseBatch(batchId, simulateFailure)
      if (simulateFailure) setSimulateFailure(false)
      message.success(`发布完成：已重放 ${result.replayed} 项，跳过冲突 ${result.conflicts} 项`)
    } catch {
      message.error('发布失败：批次与选择已保留，可重试（已重放项不会重复生成复测任务）')
    } finally {
      setReleasingId(null)
    }
  }

  const itemStatusTag = (item: BatchItem) => {
    if (item.status === 'replayed') return <Tag color="success" icon={<CheckCircleOutlined />}>已重放</Tag>
    if (item.status === 'conflict') return <Tag color="error" icon={<WarningOutlined />}>冲突已跳过</Tag>
    const issue = issueMap.get(item.key)
    const willConflict = issue && issue.rev !== item.baseRev
    return willConflict ? <Tag color="warning" icon={<WarningOutlined />}>将冲突</Tag> : <Tag>待发布</Tag>
  }

  const columns: ColumnsType<DiffRow> = [
    { title: '采纳', width: 70, render: (_, record) => <Checkbox checked={accepted.includes(record.key)} onChange={(event) => toggle(record.key, event.target.checked)} /> },
    { title: '问题', dataIndex: 'key', width: 110, render: (value) => <Typography.Text strong>{value}</Typography.Text> },
    { title: '变更项', dataIndex: 'field', width: 130 },
    { title: '当前基线', dataIndex: 'baseline', width: 260, render: (value) => <span style={{ color: '#9a4d35' }}>{value}</span> },
    { title: '候选版本', dataIndex: 'candidate', width: 320, render: (value) => <span style={{ color: '#26705a' }}>{value}</span> },
    { title: '风险', dataIndex: 'risk', width: 70, render: (value) => <Tag color={value === '中' ? 'gold' : 'green'}>{value}</Tag> },
  ]

  const batchColumns: ColumnsType<BatchItem> = [
    { title: '问题', dataIndex: 'key', width: 110, render: (value) => <Typography.Text strong>{value}</Typography.Text> },
    { title: '变更项', dataIndex: 'field', width: 130 },
    { title: '基线', dataIndex: 'baseline', width: 240, render: (value) => <span style={{ color: '#9a4d35' }}>{value}</span> },
    { title: '候选', dataIndex: 'candidate', width: 300, render: (value) => <span style={{ color: '#26705a' }}>{value}</span> },
    { title: '基础修订', dataIndex: 'baseRev', width: 90, render: (value) => <Tag>r{value}</Tag> },
    {
      title: '状态',
      dataIndex: 'status',
      width: 120,
      render: (_, record) => itemStatusTag(record),
    },
  ]

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">VERSION DIFF / 版本差异</p>
          <h1>比较整改版本并按修订发布</h1>
          <p className="muted">先暂存所选变更为发布批次，发布前按问题最新修订检测冲突，只重放无冲突项。</p>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => message.info('已刷新为最新修订')}>刷新修订</Button>
          <Button type="primary" icon={<CloudUploadOutlined />} disabled={!accepted.length} onClick={handleStage}>
            暂存所选变更
          </Button>
        </Space>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 14 }}
        message="发布批次机制"
        description="暂存变更时记录各项的基础修订号（rN）。若另一标签页在此期间提交复测或修改问题，发布时该问题修订号已变化 → 判定冲突并跳过，仅重放无冲突项。批次发布后问题台账、复测队列与报告读取同一修订结果；旧批次不能再次发布。"
      />

      <div className="panel">
        <div className="panel-head">
          <h3>变更清单</h3>
          <Tag color="blue">基线 v4.18</Tag>
        </div>
        <Table rowKey="key" dataSource={diffs} pagination={false} scroll={{ x: 900 }} columns={columns} />
      </div>

      <div className="panel" style={{ marginTop: 14 }}>
        <div className="panel-head">
          <h3>发布批次</h3>
          <Space>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>模拟接口失败</Typography.Text>
            <Switch checked={simulateFailure} onChange={setSimulateFailure} />
          </Space>
        </div>
        {batches.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center' }}>
            <Typography.Text type="secondary">暂无发布批次。请在上方勾选变更并暂存。</Typography.Text>
          </div>
        )}
        {batches.map((batch) => {
          const replayedCount = batch.items.filter((item) => item.status === 'replayed').length
          const conflictCount = batch.items.filter((item) => item.status === 'conflict').length
          const pendingCount = batch.items.filter((item) => item.status === 'pending').length
          return (
            <div key={batch.id} style={{ padding: '14px 16px', borderBottom: '1px solid #eef2f3' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <Space>
                  <Typography.Text strong>{batch.name}</Typography.Text>
                  <Tag color={batch.status === 'released' ? 'success' : 'processing'}>
                    {batch.status === 'released' ? '已发布' : '待发布'}
                  </Tag>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>{batch.id}</Typography.Text>
                </Space>
                <Space>
                  {batch.status === 'released' ? (
                    <Tag color="success">已重放 {replayedCount} · 冲突 {conflictCount}</Tag>
                  ) : (
                    <>
                      {batch.lastError && <Tag color="error">{batch.lastError}</Tag>}
                      <Button
                        type="primary"
                        size="small"
                        icon={<CloudUploadOutlined />}
                        loading={releasingId === batch.id}
                        onClick={() => handleRelease(batch.id)}
                      >
                        {batch.lastError ? '重试发布' : '发布批次'}
                      </Button>
                    </>
                  )}
                </Space>
              </div>
              {batch.status === 'released' && (
                <Alert
                  type={conflictCount > 0 ? 'warning' : 'success'}
                  showIcon
                  style={{ marginBottom: 10 }}
                  message={conflictCount > 0 ? `已重放 ${replayedCount} 项，跳过冲突 ${conflictCount} 项` : `已重放全部 ${replayedCount} 项变更`}
                  description={
                    conflictCount > 0
                      ? '以下问题在暂存后被其他标签页修改，已按最新修订列出冲突并跳过，未覆盖其状态。'
                      : '批次已发布，问题台账、复测队列与报告读取同一修订结果。'
                  }
                />
              )}
              {batch.status === 'staged' && pendingCount > 0 && (
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 10 }}
                  message={`待重放 ${pendingCount} 项`}
                  description="发布时将逐项比对基础修订号与问题最新修订号。若问题已被其他标签页修改则标记冲突并跳过，仅重放无冲突项。"
                />
              )}
              <Table
                rowKey="key"
                dataSource={batch.items}
                pagination={false}
                size="small"
                scroll={{ x: 900 }}
                columns={batchColumns}
              />
            </div>
          )
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
        <div className="panel">
          <div className="panel-head"><h3>被接受变更的影响</h3></div>
          <div style={{ padding: 16 }}>
            <Typography.Paragraph>预计关闭 2 个开放问题，新增 1 次复测任务。基础组件组无需额外排期。</Typography.Paragraph>
            <Space><Tag color="green">减少 5 次键盘操作</Tag><Tag color="blue">覆盖 3 个页面</Tag></Space>
          </div>
        </div>
        <div className="panel">
          <div className="panel-head"><h3>版本操作历史</h3></div>
          <div style={{ padding: 16 }}>
            <div className="timeline-item"><strong>v4.18-rc2 创建</strong><div>仅包含无障碍修复，不影响业务功能。</div><span className="muted">何沐 · 09-28 16:20</span></div>
            {batches.filter((b) => b.status === 'released').map((b) => (
              <div className="timeline-item" key={b.id}><strong>{b.name} 已发布</strong><div>重放 {b.items.filter((i) => i.status === 'replayed').length} 项，冲突跳过 {b.items.filter((i) => i.status === 'conflict').length} 项。</div><span className="muted">{b.id}</span></div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
