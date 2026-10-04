import { Button, Progress, Space, Tag, Typography } from 'antd'
import { ArrowRightOutlined, CheckCircleOutlined, ClockCircleOutlined, ExclamationCircleOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useIssues } from '../api/useIssues'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

export default function DashboardPage() {
  useIssues()
  const issues = useWorkspaceStore((state) => state.issues)
  const navigate = useNavigate()
  const open = issues.filter((item) => !['已通过', '不适用'].includes(item.status))
  const passed = issues.filter((item) => item.status === '已通过').length
  const critical = issues.filter((item) => item.impact === '致命' || item.impact === '严重').length
  const coverage = Math.round((passed / issues.length) * 100)
  const bySite = Array.from(new Set(issues.map((item) => item.site))).map((site) => {
    const items = issues.filter((issue) => issue.site === site)
    return { site, total: items.length, passed: items.filter((item) => item.status === '已通过').length }
  })

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">ACCESSIBILITY PROGRAM / 无障碍治理</p>
          <h1>多站点整改总览</h1>
          <p className="muted">按风险、版本和团队持续跟踪 WCAG 问题，避免重复问题分散处理。</p>
        </div>
        <Space>
          <Button onClick={() => navigate('/versions')}>查看版本差异</Button>
          <Button type="primary" onClick={() => navigate('/issues')}>进入问题台账 <ArrowRightOutlined /></Button>
        </Space>
      </div>

      <div className="metric-grid">
        <div className="metric-card"><span>开放问题</span><strong>{open.length}</strong><small>{issues.length} 条总记录</small></div>
        <div className="metric-card"><span>严重 / 致命</span><strong style={{ color: '#b84f32' }}>{critical}</strong><small>需优先排期</small></div>
        <div className="metric-card"><span>复测通过率</span><strong>{coverage}%</strong><small>当前版本口径</small></div>
        <div className="metric-card"><span>覆盖站点</span><strong>{bySite.length}</strong><small>统一 WCAG 2.2 AA</small></div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.2fr) minmax(300px,.8fr)', gap: 14 }}>
        <div className="panel">
          <div className="panel-head"><h3>站点整改进度</h3><Tag color="blue">版本 v4.18 / v3.9</Tag></div>
          <div style={{ padding: 18 }}>
            {bySite.map((item) => (
              <div key={item.site} style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}>
                  <Typography.Text strong>{item.site}</Typography.Text>
                  <Typography.Text type="secondary">{item.passed}/{item.total} 已通过</Typography.Text>
                </div>
                <Progress percent={Math.round((item.passed / item.total) * 100)} showInfo={false} strokeColor="#257c80" />
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head"><h3>处理关注</h3><span className="muted">智能排序</span></div>
          <div style={{ padding: 12 }}>
            {[
              { icon: <ExclamationCircleOutlined />, tone: '#ba4d31', title: 'P0 键盘陷阱', detail: 'A11Y-1048 已修复但尚未提交复测', action: '前往复测' },
              { icon: <ClockCircleOutlined />, tone: '#ba8529', title: '2 项临近截止', detail: '未来 3 天内到期，涉及基础组件组', action: '查看排期' },
              { icon: <CheckCircleOutlined />, tone: '#367d61', title: '重复问题合并节省 6 次处理', detail: '根因“Drawer focus trap”关联 3 项问题', action: '查看合并关系' },
            ].map((item) => (
              <div key={item.title} style={{ display: 'flex', gap: 10, padding: 12, borderBottom: '1px solid #edf1f2' }}>
                <span style={{ color: item.tone, fontSize: 20 }}>{item.icon}</span>
                <div style={{ flex: 1 }}><Typography.Text strong>{item.title}</Typography.Text><Typography.Paragraph type="secondary" style={{ margin: '5px 0 0', fontSize: 12 }}>{item.detail}</Typography.Paragraph></div>
                <Button size="small" type="link" onClick={() => navigate('/retest')}>{item.action}</Button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
