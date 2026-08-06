/**
 * The only bridge between the renderer and the main process.
 *
 * Context isolation is on and node integration is off, so this file defines the
 * complete surface the UI can reach. Each subscription returns its own
 * unsubscribe function — React effects need to clean up, and without it every
 * remount would stack another listener.
 */

import { contextBridge, ipcRenderer } from 'electron'
import {
  Send,
  Invoke,
  On,
  type Article,
  type CrawlState,
  type GeItem,
  type GeItemDetail,
  type PaneBounds,
  type ProfileSummary,
  type RunePanelApi,
  type SearchResult,
  type Settings,
  type SyncProgress,
  type TitleIndexState,
  type ToolId,
} from '../shared/ipc'

function subscribe(channel: string, cb: () => void): () => void {
  const handler = (): void => cb()
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

function subscribeWith<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_e: unknown, payload: T): void => cb(payload)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

const api: RunePanelApi = {
  hide: () => ipcRenderer.send(Send.Hide),
  log: (message: string) => ipcRenderer.send(Send.Log, message),
  quit: () => ipcRenderer.send(Send.Quit),

  getSettings: (): Promise<Settings> => ipcRenderer.invoke(Invoke.GetSettings),
  setSettings: (patch: Partial<Settings>) => ipcRenderer.send(Send.SetSettings, patch),

  getTitleIndex: (): Promise<TitleIndexState> => ipcRenderer.invoke(Invoke.GetTitleIndex),
  syncTitles: () => ipcRenderer.send(Send.SyncTitles),
  search: (query: string): Promise<SearchResult[]> => ipcRenderer.invoke(Invoke.Search, query),
  getPage: (title: string, options?: { force?: boolean }): Promise<Article | null> =>
    ipcRenderer.invoke(Invoke.GetPage, title, options),
  prefetchPage: (title: string) => ipcRenderer.send(Send.PrefetchPage, title),

  getCrawlState: (): Promise<CrawlState> => ipcRenderer.invoke(Invoke.GetCrawlState),
  startCrawl: () => ipcRenderer.send(Send.StartCrawl),
  stopCrawl: () => ipcRenderer.send(Send.StopCrawl),

  showTool: (id: ToolId, arg?: string) => ipcRenderer.send(Send.ShowTool, id, arg),
  hideTool: () => ipcRenderer.send(Send.HideTool),
  setPaneBounds: (bounds: PaneBounds) => ipcRenderer.send(Send.SetPaneBounds, bounds),
  lookupProfile: (username: string): Promise<ProfileSummary> =>
    ipcRenderer.invoke(Invoke.LookupProfile, username),

  geDetail: (itemId: number): Promise<GeItemDetail | null> =>
    ipcRenderer.invoke(Invoke.GeDetail, itemId),
  geFindByName: (name: string): Promise<GeItem | null> =>
    ipcRenderer.invoke(Invoke.GeFindByName, name),

  onShown: (cb) => subscribe(On.Shown, cb),
  onSettings: (cb) => subscribeWith<Settings>(On.Settings, cb),
  onSyncProgress: (cb) => subscribeWith<SyncProgress>(On.SyncProgress, cb),
  onCrawlProgress: (cb) => subscribeWith<CrawlState>(On.CrawlProgress, cb),
}

contextBridge.exposeInMainWorld('rp', api)
