import { useEffect, useState } from 'react'
import { Alert, Button, Descriptions, Form, Input, Radio, Space, Table, Tag, Typography, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import axios from 'axios'
import { useQueryClient } from '@tanstack/react-query'
import { useIssues } from '../api/useIssues'
import { submitRetest, useRetestTasks, type RetestTaskRow } from '../api/release'
import type { Issue } from '../api/types'

type FormValues = { result: '已通过' | '已退回' | '不适用'; note: string; environment: string }

export default function RetestPage() {
  useIssues()
  const queryClient = useQueryClient()
  const tasksQuery = useRetestTasks('待复测')
  const tasks = tasksQuery.data ?? []
  const [activeId, setActiveId] = useState<string | null>(tasks[0]?.id ?? null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [form] = Form.useForm<FormValues>()

  useEffect(() => {
    if (!activeId && tasks.length) setActiveId(tasks[0].id)
    if (activeId && !tasks.some((task) => task.id === activeId)) setActiveId(tasks[0]?.id ?? null)
  }, [tasks, activeId])

  const active: RetestTaskRow | undefined = tasks.find((task) => task.id === activeId)
  const activeIssue = active?.issue as Issue | undefined

  const submit = async (values: FormValues) => {
    if (!active || !activeIssue) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const data = await submitRetest(active.id, {
        result: values.result,
        note: values.note,
        environment: values.environment,
        expectedRevision: activeIssue.revision,
      })
      if (data.idempotent) {
        message.warning('该复测任务已提交过，未重复写入复测记录')
      } else {
        message.success(`复测结果已记录：${values.result}，问题修订推进至 r${data.issue?.revision}`)
      }
      form.resetFields()
      queryClient.invalidateQueries({ queryKey: ['issues'] })
      queryClient.invalidateQueries({ queryKey: ['retest-tasks'] })
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 409 && err.response.data?.error === 'REVISION_CONFLICT') {
        setSubmitError(`问题已被其它标签页更新（当前最新 r${err.response.data.expected}），页面已刷新到最新修订，请核对后重新提交。`)
      } else {
        // 接口失败：任务、表单与选择全部保留，重试不会生成重复复测任务（任务维度幂等）
        setSubmitError('提交失败，已填写内容与当前任务已保留，请直接重试。')
      }
      queryClient.invalidateQueries({ queryKey: ['issues'] })
      queryClient.invalidateQueries({ queryKey: ['retest-tasks'] })
    } finally {
      setSubmitting(false)
    }
  }

  const columns: ColumnsType<RetestTaskRow> = [
    {
      title: '复测任务 / 问题',
      render: (_, record) => (
        <div>
          <Typography.Text strong>{record.issueKey}</Typography.Text>
          <div>{record.title}</div>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>{record.issue?.title}</Typography.Text>
        </div>
      ),
    },
    { title: '来源批次', dataIndex: 'batchId', width: 150, render: (value) => <Tag color={value === 'seed' ? 'default' : 'blue'}>{value === 'seed' ? '既有任务' : value}</Tag> },
    { title: '基于修订', dataIndex: 'issueRevision', width: 90, render: (value) => <Tag>r{value}</Tag> },
    {
      title: '问题最新修订',
      width: 110,
      render: (_, record) => {
        const drifted = record.issue && record.issue.revision !== record.issueRevision
        return <Tag color={drifted ? 'warning' : 'green'}>r{record.issue?.revision ?? '-'}</Tag>
      },
    },
    { title: '环境', dataIndex: 'retestEnv', width: 220, render: (value) => value ?? '待开发提交' },
  ]

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">RETEST / 复测工作台</p>
          <h1>按发布批次复测任务逐项验证</h1>
          <p className="muted">复测任务由发布批次生成并与修订号绑定；同一任务重复提交只生效一次，不会重复建单。</p>
        </div>
        <Tag color="orange">{tasks.length} 项待复测</Tag>
      </div>

      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="复测规则" description="键盘问题必须覆盖 Tab、Shift+Tab、Esc 和焦点返回；屏幕阅读器问题需保留截图或播报日志。在另一个标签页提交复测或修改问题后，本页队列与修订号会自动刷新。" />

      {submitError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message="复测提交未完成"
          description={submitError}
          action={<Button size="small" type="primary" onClick={() => form.submit()} loading={submitting}>重试提交</Button>}
        />
      )}

      <div className="review-grid">
        <div className="panel">
          <div className="panel-head"><h3>复测队列</h3><span className="muted">点击选择任务</span></div>
          <Table
            rowKey="id"
            columns={columns}
            dataSource={tasks}
            loading={tasksQuery.isLoading}
            pagination={false}
            rowClassName={(record) => (record.id === activeId ? 'ant-table-row-selected' : '')}
            onRow={(record) => ({ onClick: () => { setActiveId(record.id); setSubmitError(null); form.resetFields() } })}
            scroll={{ x: 760 }}
          />
        </div>

        <div className="panel review-box">
          <Typography.Title level={4}>{active ? active.issueKey : '暂无可复测任务'}</Typography.Title>
          {active && activeIssue && (
            <>
              <Descriptions size="small" column={1} bordered>
                <Descriptions.Item label="任务">{active.title}</Descriptions.Item>
                <Descriptions.Item label="来源批次">{active.batchId}</Descriptions.Item>
                <Descriptions.Item label="问题">{activeIssue.title}</Descriptions.Item>
                <Descriptions.Item label="根因">{activeIssue.rootCause}</Descriptions.Item>
                <Descriptions.Item label="修复说明">{activeIssue.fixNote ?? '未提交'}</Descriptions.Item>
                <Descriptions.Item label="复测环境">{active.retestEnv ?? activeIssue.retestEnv ?? '待开发提交'}</Descriptions.Item>
                <Descriptions.Item label="修订号">
                  任务基于 r{active.issueRevision}
                  {activeIssue.revision === active.issueRevision
                    ? '，与问题最新修订一致'
                    : `，问题已更新到 r${activeIssue.revision}，提交前请先核对差异`}
                </Descriptions.Item>
              </Descriptions>
              <Form form={form} layout="vertical" style={{ marginTop: 18 }} onFinish={submit} initialValues={{ result: '已通过', environment: active.retestEnv ?? activeIssue.retestEnv ?? '' }}>
                <Form.Item name="result" label="复测结论" rules={[{ required: true }]}>
                  <Radio.Group><Radio.Button value="已通过">通过</Radio.Button><Radio.Button value="已退回">退回</Radio.Button><Radio.Button value="不适用">不适用</Radio.Button></Radio.Group>
                </Form.Item>
                <Form.Item name="environment" label="本次复测环境" rules={[{ required: true }]}><Input placeholder="浏览器 / 辅助技术 / 版本号" /></Form.Item>
                <Form.Item name="note" label="复测记录" rules={[{ required: true, message: '请填写可验证的复测记录' }]}><Input.TextArea rows={5} placeholder="记录实际操作、结果与证据位置" /></Form.Item>
                <Button type="primary" htmlType="submit" block loading={submitting}>提交复测记录</Button>
              </Form>
              <Typography.Title level={5} style={{ marginTop: 20 }}>历史复测</Typography.Title>
              {activeIssue.retestRecords.length === 0 && <Typography.Text type="secondary">暂无历史记录</Typography.Text>}
              {activeIssue.retestRecords.map((record) => (
                <div className="timeline-item" key={record.id}>
                  <Tag color={record.result === '通过' ? 'success' : record.result === '退回' ? 'error' : 'default'}>{record.result}</Tag>
                  <Typography.Text strong>{record.actor}</Typography.Text>
                  <div>{record.note}</div>
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>{record.at}</Typography.Text>
                </div>
              ))}
            </>
          )}
          {!active && (
            <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
              所有批次复测任务均已处理。在“版本差异”页发布批次后，无冲突采纳项会生成新的复测任务。
            </Typography.Paragraph>
          )}
        </div>
      </div>
    </section>
  )
}
