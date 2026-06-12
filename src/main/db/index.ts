import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'

let db: Database.Database | null = null

export function getDatabase(): Database.Database {
  if (db) return db

  const userDataPath = app.getPath('userData')
  if (!existsSync(userDataPath)) {
    mkdirSync(userDataPath, { recursive: true })
  }

  const dbPath = join(userDataPath, 'serendip.db')
  db = new Database(dbPath)

  // 启用 WAL 模式提升并发性能
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')

  // 执行迁移
  runMigrations(db)

  return db
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}

function runMigrations(db: Database.Database): void {
  // 获取当前版本
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `)

  const currentVersion = db.prepare('SELECT MAX(version) as v FROM _migrations').get() as { v: number | null }
  const version = currentVersion.v ?? 0

  const migrations = [
    // 迁移 1: 初始 schema
    {
      version: 1,
      up: `
        -- 媒体文件表
        CREATE TABLE media_files (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          path TEXT UNIQUE NOT NULL,
          folder_path TEXT NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('image', 'video')),
          mtime INTEGER NOT NULL,
          size INTEGER NOT NULL,
          width INTEGER,
          height INTEGER,
          duration_ms INTEGER,
          thumb_path TEXT,
          liked INTEGER NOT NULL DEFAULT 0,
          disliked INTEGER NOT NULL DEFAULT 0,
          shown_count INTEGER NOT NULL DEFAULT 0,
          last_shown_at INTEGER,
          created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE INDEX idx_files_folder ON media_files(folder_path);
        CREATE INDEX idx_files_type ON media_files(type);
        CREATE INDEX idx_files_liked ON media_files(liked) WHERE liked = 1;
        CREATE INDEX idx_files_disliked ON media_files(disliked) WHERE disliked = 1;
        CREATE INDEX idx_files_shown ON media_files(last_shown_at);

        -- 文件夹表（用于智能随机算法的文件夹级权重）
        CREATE TABLE folders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          path TEXT UNIQUE NOT NULL,
          parent_path TEXT,
          depth INTEGER NOT NULL,
          file_count INTEGER NOT NULL DEFAULT 0,
          recursive_count INTEGER NOT NULL DEFAULT 0,
          mtime INTEGER NOT NULL,
          created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE INDEX idx_folders_parent ON folders(parent_path);
        CREATE INDEX idx_folders_depth ON folders(depth);

        -- 收藏分类表
        CREATE TABLE categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE NOT NULL,
          created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );

        -- 分类内容关联表
        CREATE TABLE category_items (
          category_id INTEGER NOT NULL,
          file_id INTEGER NOT NULL,
          added_at INTEGER NOT NULL DEFAULT (unixepoch()),
          PRIMARY KEY (category_id, file_id),
          FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
          FOREIGN KEY (file_id) REFERENCES media_files(id) ON DELETE CASCADE
        );

        CREATE INDEX idx_category_items_file ON category_items(file_id);

        -- 设置表
        CREATE TABLE settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `
    },
    // 迁移 2: 文件失效标记（已删除 / 缩略图生成失败 / 文件损坏）
    {
      version: 2,
      up: `
        ALTER TABLE media_files ADD COLUMN unavailable INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE media_files ADD COLUMN unavailable_reason TEXT;
        CREATE INDEX idx_files_unavailable ON media_files(unavailable) WHERE unavailable = 1;
      `
    }
  ]

  for (const migration of migrations) {
    if (migration.version > version) {
      console.log(`Applying migration ${migration.version}...`)
      db.exec(migration.up)
      db.prepare('INSERT INTO _migrations (version, applied_at) VALUES (?, ?)').run(
        migration.version,
        Date.now()
      )
    }
  }
}
