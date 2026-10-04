import { setupWorker } from 'msw/browser'
import { buildHandlers, DB_KEY, SYNC_CHANNEL } from './handlers'

/**
 * 标签页级共享存储：写入 localStorage 后通过 BroadcastChannel 通知其它标签页，
 * 使各自独立的 MSW 实例对同一份权威修订数据并发读写。
 */
const channel = new BroadcastChannel(SYNC_CHANNEL)
const sharedStorage = {
  getItem: (key: string) => localStorage.getItem(key),
  setItem: (key: string, value: string) => {
    localStorage.setItem(key, value)
    if (key === DB_KEY) channel.postMessage({ type: 'commit', at: Date.now() })
  },
}

export const worker = setupWorker(...buildHandlers(sharedStorage))

export { channel }
