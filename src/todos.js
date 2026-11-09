import { createId } from "./ids.js";

// Missing legacy timestamps stay null; reopening must never invent a completion
// time or immediately re-notify an already expired one-off reminder.
export function normalizeTodoHistory(value, todos) {
  if (Array.isArray(value)) return value.filter((item) => item?.id && typeof item.text === "string" && ["completed", "reminded"].includes(item.type));
  return todos.flatMap((todo) => [
    ...(todo.completed ? [{ id: `legacy-completed-${todo.id}`, type: "completed", todoId: todo.id, text: todo.text, occurredAt: todo.completedAt || null, todo: { ...todo } }] : []),
    ...(todo.remindedAt ? [{ id: `legacy-reminded-${todo.id}-${todo.remindedAt}`, type: "reminded", todoId: todo.id, text: todo.text, occurredAt: null, scheduledAt: todo.remindedAt, todo: { ...todo } }] : []),
  ]);
}

export function completeTodo(state, id, now = Date.now()) {
  const todo = state.todos.find((item) => item.id === id && !item.completed);
  if (!todo) return {};
  const completed = { ...todo, completed: true, completedAt: new Date(now).toISOString() };
  return { todos: state.todos.map((item) => item.id === id ? completed : item), todoHistory: [{ id: createId("completed"), todoId: id, type: "completed", text: todo.text, occurredAt: completed.completedAt, todo: completed }, ...state.todoHistory] };
}

export function reopenTodo(state, record, now = Date.now()) {
  const existing = state.todos.find((item) => item.id === record.todoId);
  if (existing && !existing.completed) return {};
  const original = existing || record.todo || { text: record.text, dueAt: null, repeat: "none" };
  const expired = original.dueAt && new Date(original.dueAt).getTime() <= now;
  const todo = { ...original, id: existing?.id || record.todoId || original.id || createId("todo"), completed: false, completedAt: null, dueAt: expired ? null : original.dueAt, remindedAt: expired ? null : original.remindedAt };
  return { todos: existing ? state.todos.map((item) => item.id === todo.id ? todo : item) : [...state.todos, todo] };
}

export function mergeReminderEvent(state, event) {
  const history = new Map(state.todoHistory.map((item) => [item.id, item]));
  for (const record of event.todoHistory || []) history.set(record.id, record);
  return {
    todos: state.todos.map((todo) => {
      const patch = event.todos?.find((item) => item.id === todo.id && item.previousDueAt === todo.dueAt && !todo.completed);
      return patch ? { ...todo, dueAt: patch.dueAt, remindedAt: patch.remindedAt } : todo;
    }),
    todoHistory: [...history.values()],
  };
}
