import { useState } from 'react'
import { Button, Checkbox, Select, Space, Table, Tag, Typography, message } from 'antd'
import { useIssues } from '../api/useIssues'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

export default function VersionsPage() {
  useIssues()
  const issues = useWorkspaceStore((state) => state.issues)
  const [accepted, setAccepted] = useState<string[]>(['A11Y-1074'])
  const diffs = issues
    .filter((item) => ['A11Y-1048', 'A11Y-1074', 'A11Y-1083'].includes(item.key))
    .map((issue, index) => ({
      key: issue.key,
      field: index === 0 ? '修复状态' : index === 1 ? '图表色板' : '错误提示实现',
      baseline: index === 0 ? '待复测' : index === 1 ? '#98B7AF / 对比度 2.6:1' : '视觉错误颜色',
      candidate: index === 0 ? '已提交复测材料' : index === 1 ? '#1D6570 / 对比度 5.1:1 + 纹理' : 'aria-live + aria-describedby',
      risk: index === 2 ? '中' : '低',
    }))

  const toggle = (key: string, checked: boolean) => {
    setAccepted((current) => checked ? [...new Set([...current, key])] : current.filter((item) => item !== key))
  }

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">VERSION DIFF / 版本差异</p>
          <h1>比较整改版本并部分采纳</h1>
          <p className="muted">可选择接受单一变更，生成新的整改版本而不覆盖基线。</p>
        </div>
        <Space>
          <Select defaultValue="v4.18" options={[{ value: 'v4.18' }, { value: 'v4.17' }]} style={{ width: 110 }} />
          <span>对比</span>
          <Select defaultValue="v4.18-rc2" options={[{ value: 'v4.18-rc2' }, { value: 'v4.19-dev' }]} style={{ width: 130 }} />
          <Button type="primary" disabled={!accepted.length} onClick={() => message.success(`已接受 ${accepted.length} 项变更并生成新修订`)}>接受所选变更</Button>
        </Space>
      </div>

      <div className="panel">
        <div className="panel-head"><h3>变更清单</h3><Tag color="blue">基线 v4.18</Tag></div>
        <Table
          rowKey="key"
          dataSource={diffs}
          pagination={false}
          scroll={{ x: 850 }}
          columns={[
            { title: '采纳', width: 70, render: (_, record) => <Checkbox checked={accepted.includes(record.key)} onChange={(event) => toggle(record.key, event.target.checked)} /> },
            { title: '问题', dataIndex: 'key', width: 110, render: (value) => <Typography.Text strong>{value}</Typography.Text> },
            { title: '变更项', dataIndex: 'field', width: 130 },
            { title: '当前基线', dataIndex: 'baseline', width: 280, render: (value) => <span style={{ color: '#9a4d35' }}>{value}</span> },
            { title: '候选版本', dataIndex: 'candidate', width: 330, render: (value) => <span style={{ color: '#26705a' }}>{value}</span> },
            { title: '风险', dataIndex: 'risk', width: 80, render: (value) => <Tag color={value === '中' ? 'gold' : 'green'}>{value}</Tag> },
          ]}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
        <div className="panel"><div className="panel-head"><h3>被接受变更的影响</h3></div><div style={{ padding: 16 }}><Typography.Paragraph>预计关闭 2 个开放问题，新增 1 次复测任务。基础组件组无需额外排期。</Typography.Paragraph><Space><Tag color="green">减少 5 次键盘操作</Tag><Tag color="blue">覆盖 3 个页面</Tag></Space></div></div>
        <div className="panel"><div className="panel-head"><h3>版本操作历史</h3></div><div style={{ padding: 16 }}><div className="timeline-item"><strong>v4.18-rc2 创建</strong><div>仅包含无障碍修复，不影响业务功能。</div><span className="muted">何沐 · 09-28 16:20</span></div></div></div>
      </div>
    </section>
  )
}
