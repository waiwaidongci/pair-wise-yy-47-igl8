import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type SavedFilter = { id: string; name: string; query: string; site: string; status: string; priority: string }

export type BatchDraft = {
  /** 与服务端发布批次一致的编号；重试/刷新后仍指向同一暂存批次 */
  id: string
  baselineVersion: string
  candidateVersion: string
  keys: string[]
}

type WorkspaceState = {
  selectedKeys: string[]
  savedFilters: SavedFilter[]
  draft: string
  /** 未发布的发布批次草稿，接口失败或刷新后据此恢复批次与勾选 */
  batchDraft: BatchDraft | null
  setSelectedKeys: (keys: string[]) => void
  saveFilter: (filter: Omit<SavedFilter, 'id'>) => void
  removeFilter: (id: string) => void
  setDraft: (draft: string) => void
  setBatchDraft: (draft: BatchDraft | null) => void
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      selectedKeys: [],
      savedFilters: [
        { id: 'f1', name: 'P0/P1 未关闭', query: '', site: '', status: '', priority: 'P0' },
        { id: 'f2', name: '基础组件组待复测', query: '基础组件', site: '', status: '待复测', priority: '' },
      ],
      draft: 'A11Y-1048：需同时验证 Esc 关闭与 Tab/Shift+Tab、Esc 和焦点返回；移动端抽屉也需复测。',
      batchDraft: null,
      setSelectedKeys: (selectedKeys) => set({ selectedKeys }),
      saveFilter: (filter) => set((state) => ({ savedFilters: [...state.savedFilters, { ...filter, id: crypto.randomUUID() }] })),
      removeFilter: (id) => set((state) => ({ savedFilters: state.savedFilters.filter((item) => item.id !== id) })),
      setDraft: (draft) => set({ draft }),
      setBatchDraft: (batchDraft) => set({ batchDraft }),
    }),
    {
      name: 'accessibility-remediation-v1',
      version: 2,
      partialize: (state) => ({
        selectedKeys: state.selectedKeys,
        savedFilters: state.savedFilters,
        draft: state.draft,
        batchDraft: state.batchDraft,
      }),
    },
  ),
)
