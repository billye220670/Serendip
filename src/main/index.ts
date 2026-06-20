import { app, shell, BrowserWindow, protocol } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerIpcHandlers } from './ipc/handlers'
import { IPC } from './ipc/contract'
import { getDatabase, closeDatabase } from './db'
import { registerThumbProtocol } from './thumbnailer/protocol'
import { scanRoot } from './scanner'
import { startWatcher, stopWatcher } from './watcher'

// 修复 Windows 多平面叠加（MPO）导致的全屏色彩闪烁：
// 视频 hover 播放时，Chromium 会把 <video> 提升为 DirectComposition 硬件叠加平面，
// Windows 在叠加平面出现/消失瞬间会切换整块显示器的色彩/HDR 管线，
// 表现为整个桌面（含 app 窗口外）骤然变暗+过饱和、几秒后自行恢复。
// 关闭视频叠加平面即可消除该现象，硬件解码与合成仍保留。
app.commandLine.appendSwitch(
  'disable-features',
  'DirectCompositionVideoOverlays,UseMultiPlaneOverlayForVideo'
)
// 兜底升级：若个别 GPU/驱动上述精准开关仍压不住闪烁，再放开下面这行
// （彻底关闭 DirectComposition，代价是合成性能下降、可能引入其它渲染瑕疵）。
// app.commandLine.appendSwitch('disable-direct-composition')

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
    // 自绘标题栏：Win/Linux 用 WCO（系统在右上角自绘最小化/最大化/关闭按钮，
    // 业务区接管除按钮外的整条顶栏）；macOS 走默认 hidden（信号灯保留在左上）
    titleBarStyle: 'hidden',
    ...(process.platform === 'win32' || process.platform === 'linux'
      ? {
          titleBarOverlay: {
            // 初始值走亮色主题（glass-over-background 的温暖近白），切主题时由渲染层通过 IPC 重设
            color: '#d9d6d3',
            symbolColor: '#444444',
            height: 64
          }
        }
      : {}),
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('enter-full-screen', () => {
    mainWindow.webContents.send(IPC.FULLSCREEN_CHANGE, true)
  })
  mainWindow.on('leave-full-screen', () => {
    mainWindow.webContents.send(IPC.FULLSCREEN_CHANGE, false)
  })
  mainWindow.on('move', () => {
    mainWindow.webContents.send(IPC.WINDOW_MOVE)
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
