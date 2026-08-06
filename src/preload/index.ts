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
  type RuneBuddyApi,
  type Settings,
  type SyncProgress,
  type TitleIndexState,
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

const api: RuneBuddyApi = {
  hide: () => ipcRenderer.send(Send.Hide),
  log: (message: string) => ipcRenderer.send(Send.Log, message),
  quit: () => ipcRenderer.send(Send.Quit),

  getSettings: (): Promise<Settings> => ipcRenderer.invoke(Invoke.GetSettings),
  setSettings: (patch: Partial<Settings>) => ipcRenderer.send(Send.SetSettings, patch),

  getTitleIndex: (): Promise<TitleIndexState> => ipcRenderer.invoke(Invoke.GetTitleIndex),
  syncTitles: () => ipcRenderer.send(Send.SyncTitles),

  onShown: (cb) => subscribe(On.Shown, cb),
  onSettings: (cb) => subscribeWith<Settings>(On.Settings, cb),
  onSyncProgress: (cb) => subscribeWith<SyncProgress>(On.SyncProgress, cb),
}

contextBridge.exposeInMainWorld('rb', api)
