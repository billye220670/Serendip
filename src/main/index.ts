import { app, shell, BrowserWindow, protocol } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerIpcHandlers } from './ipc/handlers'
import { getDatabase, closeDatabase } from './db'
import { registerThumbProtocol } from './thumbnailer/protocol'
import { scanRoot } from './scanner'
import { startWatcher, stopWatcher } from './watcher'

// 必须在 app.whenReady 之前注册协议特权
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'serendip',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true
    }
  }
])

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0c0a09',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.serendip')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const db = getDatabase()
  registerThumbProtocol()
  registerIpcHandlers()

  // 启动时增量同步：静默扫描（不推送进度），完成后启动监听器
  const rootRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('rootPath') as
    | { value: string }
    | undefined

  if (rootRow?.value) {
    console.log('[Startup] Auto-syncing root:', rootRow.value)
    try {
      await scanRoot(rootRow.value)
      console.log('[Startup] Sync complete, starting file watcher')
      startWatcher(rootRow.value)
    } catch (err) {
      console.error('[Startup] Sync failed:', err)
    }
  }

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopWatcher()
  closeDatabase()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
