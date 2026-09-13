import type { Edit } from "../types";
export interface History {
  past: Edit[][];
  present: Edit[];
  future: Edit[][];
}
export const emptyHistory: History = { past: [], present: [], future: [] };
export type HistoryAction =
  | { type: "commit"; edits: Edit[] }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset" };
export function historyReducer(state: History, action: HistoryAction): History {
  if (action.type === "reset") return emptyHistory;
  if (action.type === "commit")
    return {
      past: [...state.past, state.present].slice(-100),
      present: action.edits,
      future: [],
    };
  if (action.type === "undo" && state.past.length)
    return {
      past: state.past.slice(0, -1),
      present: state.past.at(-1)!,
      future: [state.present, ...state.future],
    };
  if (action.type === "redo" && state.future.length)
    return {
      past: [...state.past, state.present].slice(-100),
      present: state.future[0],
      future: state.future.slice(1),
    };
  return state;
}
