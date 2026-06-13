import { create } from 'zustand'
import type { Category } from '../../../main/categories'

interface CategoriesState {
  categories: Category[]
  /** 当前用于"是否已添加到分类"快查的 fileId → categoryId set。延后阶段使用 */
  loaded: boolean

  load: () => Promise<void>
  create: (name: string) => Promise<number>
  rename: (id: number, newName: string) => Promise<void>
  remove: (id: number) => Promise<void>
  reorder: (orderedIds: number[]) => Promise<void>
  /** 把媒体加进分类，并刷新计数 */
  addItems: (categoryId: number, fileIds: number[]) => Promise<number>
  /** 从分类移除媒体，并刷新计数 */
  removeItem: (categoryId: number, fileId: number) => Promise<void>
}

export const useCategoriesStore = create<CategoriesState>((set, get) => ({
  categories: [],
  loaded: false,

  load: async () => {
    const list = await window.api.listCategories()
    set({ categories: list, loaded: true })
  },

  create: async (name: string) => {
    const id = await window.api.createCategory(name)
    await get().load()
    return id
  },

  rename: async (id: number, newName: string) => {
    await window.api.renameCategory(id, newName)
    await get().load()
  },

  remove: async (id: number) => {
    await window.api.deleteCategory(id)
    await get().load()
  },

  reorder: async (orderedIds: number[]) => {
    // 乐观更新本地顺序，避免重排时闪一下
    set((s) => {
      const map = new Map(s.categories.map((c) => [c.id, c]))
      const next: Category[] = []
      orderedIds.forEach((id, i) => {
        const c = map.get(id)
        if (c) next.push({ ...c, position: i + 1 })
      })
      return { categories: next }
    })
    await window.api.reorderCategories(orderedIds)
  },

  addItems: async (categoryId: number, fileIds: number[]) => {
    const added = await window.api.addItemsToCategory(categoryId, fileIds)
    if (added > 0) {
      // 局部更新 itemCount，省得整列表重拉
      set((s) => ({
        categories: s.categories.map((c) =>
          c.id === categoryId ? { ...c, itemCount: c.itemCount + added } : c
        )
      }))
    }
    return added
  },

  removeItem: async (categoryId: number, fileId: number) => {
    await window.api.removeItemFromCategory(categoryId, fileId)
    set((s) => ({
      categories: s.categories.map((c) =>
        c.id === categoryId ? { ...c, itemCount: Math.max(0, c.itemCount - 1) } : c
      )
    }))
  }
}))
