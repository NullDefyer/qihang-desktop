import assert from "node:assert/strict";
import test from "node:test";
import { normalizeState } from "../src/model.js";
import { completeTodo, mergeReminderEvent, reopenTodo } from "../src/todos.js";

test("legacy completion/reminder history migrates once without fabricated timestamps or resurrection", () => {
  const state = normalizeState({ todos: [{ id: "old", text: "keep", completed: true, remindedAt: "2026-11-01T01:00:00Z" }] });
  assert.equal(state.todoHistory.length, 2);
  assert.ok(state.todoHistory.every(item => item.occurredAt === null));
  assert.equal(state.todos[0].text, "keep");
  assert.deepEqual(normalizeState(state).todoHistory, state.todoHistory);
  assert.deepEqual(normalizeState({ ...state, todoHistory: [] }).todoHistory, []);
});

test("completion snapshots survive edits/deletion and reopening preserves history without overdue re-notification", () => {
  const now = Date.parse("2026-11-03T03:00:00Z");
  let state = normalizeState({ todos: [{ id: "one", text: "archive", dueAt: "2026-11-02T03:00:00Z", repeat: "daily" }] });
  state = { ...state, ...completeTodo(state, "one", now) };
  assert.equal(state.todoHistory[0].occurredAt, new Date(now).toISOString());
  assert.equal(state.todos[0].completed, true);
  assert.deepEqual(completeTodo(state, "one", now), {});
  const record = structuredClone(state.todoHistory[0]);
  state = { ...state, ...reopenTodo(state, record, now) };
  assert.equal(state.todos[0].completed, false);
  assert.equal(state.todos[0].dueAt, null);
  assert.equal(state.todoHistory.length, 1);
  state.todos[0].text = "edited";
  assert.deepEqual(reopenTodo(state, record, now), {});
  assert.equal(state.todos[0].text, "edited");
  const restored = reopenTodo({ ...state, todos: [] }, record, now).todos[0];
  assert.equal(restored.id, "one", "Reopening preserves the reference so old history cannot create duplicate tasks");
  assert.equal(restored.text, "archive");
  assert.equal(state.todoHistory[0].text, "archive");
  assert.deepEqual(normalizeState(JSON.parse(JSON.stringify(state))).todoHistory, state.todoHistory);
});

test("late reminder events cannot overwrite edited/deleted/completed tasks; history merges by id", () => {
  const state = normalizeState({ todos: [{ id: "edited", text: "new", dueAt: "2030-01-01" }, { id: "done", text: "done", completed: true, dueAt: "old" }], todoHistory: [] });
  const event = { todos: [{ id: "edited", previousDueAt: "old", dueAt: "next" }, { id: "gone", previousDueAt: "old", dueAt: "next" }, { id: "done", previousDueAt: "old", dueAt: "next" }], todoHistory: [{ id: "event", type: "reminded", todoId: "edited", text: "old", occurredAt: "2026-11-01" }] };
  const patch = mergeReminderEvent(state, event);
  assert.deepEqual(patch.todos, state.todos);
  assert.equal(patch.todoHistory.length, 1);
  assert.equal(mergeReminderEvent({ ...state, ...patch }, event).todoHistory.length, 1);
  const match = mergeReminderEvent(normalizeState({ todos: [{ id: "edited", text: "same", dueAt: "old" }] }), event);
  assert.equal(match.todos[0].dueAt, "next");
});
