import { create } from 'zustand'

export interface UndoCommand {
  apply: () => void | Promise<void>
  revert: () => void | Promise<void>
}

const MAX_UNDO = 50

interface CanvasUndoState {
  past: UndoCommand[]
  future: UndoCommand[]
  push: (cmd: UndoCommand) => void
  undo: () => Promise<void>
  redo: () => Promise<void>
  clear: () => void
}

export const useCanvasUndoStore = create<CanvasUndoState>((set, get) => ({
  past: [],
  future: [],

  push: (cmd) => {
    set((s) => {
      const next = [...s.past, cmd]
      if (next.length > MAX_UNDO) next.shift()
      return { past: next, future: [] }
    })
  },

  undo: async () => {
    const { past } = get()
    if (past.length === 0) return
    const cmd = past[past.length - 1]
    set((s) => ({ past: s.past.slice(0, -1), future: [cmd, ...s.future] }))
    await cmd.revert()
  },

  redo: async () => {
    const { future } = get()
    if (future.length === 0) return
    const cmd = future[0]
    set((s) => ({ future: s.future.slice(1), past: [...s.past, cmd] }))
    await cmd.apply()
  },

  clear: () => set({ past: [], future: [] }),
}))
