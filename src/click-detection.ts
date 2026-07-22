// Pure decision logic for the extension.js click-vs-hover gate, extracted for testability.
// VS Code fires onDidChangeTextEditorSelection BEFORE textDocument/definition on a real click;
// hover never changes selection. lastSelectionChangeMs === null means no selection change has
// been observed yet (e.g. the first definition request of a session) — treat that as a click
// rather than penalizing it against a Date.now() - 0 comparison that can never be true.
export function wasRecentClick(lastSelectionChangeMs: number | null, nowMs: number, windowMs = 300): boolean {
  return lastSelectionChangeMs === null || nowMs - lastSelectionChangeMs < windowMs
}
