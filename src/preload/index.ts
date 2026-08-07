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
  type GePrice,
  type PaneShortcut,
  type AccountMode,
  type GeItem,
  type Hiscores,
  type GeItemDetail,
  type MotionEvent,
  type MotionMode,
  type GeTimestep,
  type PaneBounds,
  type ProfileSummary,
  type RunePanelApi,
  type SearchResult,
  type Settings,
  type SetupProgress,
  type SyncProgress,
  type UpdateStatus,
  type TitleIndexState,
  type ToolId,
} from '../shared/ipc'

/**
 * How main will animate the window, passed down as a launch argument by
 * `window.ts` because the renderer needs the answer before its first paint.
 *
 * Only the value at launch. Later changes ride along on each motion event,
 * which is the authoritative one — this exists solely so the very first frame
 * knows whether to hold itself collapsed.
 */
const motionMode: MotionMode =
  (process.argv
    .find((a) => a.startsWith('--rp-motion='))
    ?.slice('--rp-motion='.length) as MotionMode | undefined) ?? 'scale'

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
  motionMode,
  reportReduceMotion: (reduce: boolean) => ipcRenderer.send(Send.ReduceMotion, reduce),

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
  capturePane: () => ipcRenderer.invoke(Invoke.CapturePane),
  setPaneBounds: (bounds: PaneBounds) => ipcRenderer.send(Send.SetPaneBounds, bounds),
  lookupProfile: (username: string): Promise<ProfileSummary> =>
    ipcRenderer.invoke(Invoke.LookupProfile, username),

  geDetail: (itemId: number, timestep?: GeTimestep): Promise<GeItemDetail | null> =>
    ipcRenderer.invoke(Invoke.GeDetail, itemId, timestep),
  gePrices: (ids: number[]): Promise<Array<{ id: number; price: GePrice | null }>> =>
    ipcRenderer.invoke(Invoke.GePrices, ids),
  geSearch: (query: string): Promise<SearchResult[]> =>
    ipcRenderer.invoke(Invoke.GeSearch, query),
  geFindByName: (name: string): Promise<GeItem | null> =>
    ipcRenderer.invoke(Invoke.GeFindByName, name),

  hiscores: (name: string, mode?: AccountMode): Promise<Hiscores> =>
    ipcRenderer.invoke(Invoke.Hiscores, name, mode),

  getSetup: (): Promise<SetupProgress> => ipcRenderer.invoke(Invoke.GetSetup),
  runSetup: (options: { prices: boolean }) =>
    ipcRenderer.send(Send.RunSetup, options),
  onSetupProgress: (cb) => subscribeWith<SetupProgress>(On.SetupProgress, cb),

  getUpdate: (): Promise<UpdateStatus> => ipcRenderer.invoke(Invoke.GetUpdate),
  checkUpdate: () => ipcRenderer.send(Send.UpdateCheck),
  downloadUpdate: () => ipcRenderer.send(Send.UpdateDownload),
  installUpdate: () => ipcRenderer.send(Send.UpdateInstall),
  onUpdateStatus: (cb) => subscribeWith<UpdateStatus>(On.UpdateStatus, cb),

  onShown: (cb) => subscribe(On.Shown, cb),
  onMotion: (cb) => subscribeWith<MotionEvent>(On.Motion, cb),
  onSettings: (cb) => subscribeWith<Settings>(On.Settings, cb),
  onSyncProgress: (cb) => subscribeWith<SyncProgress>(On.SyncProgress, cb),
  onCrawlProgress: (cb) => subscribeWith<CrawlState>(On.CrawlProgress, cb),
  onPaneLoading: (cb) => subscribeWith<boolean>(On.PaneLoading, cb),
  onPaneShortcut: (cb) => subscribeWith<PaneShortcut>(On.PaneShortcut, cb),
}

contextBridge.exposeInMainWorld('rp', api)
