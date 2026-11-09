import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_STATE, formatUptime, normalizeState, countdownRemaining } from "../src/model.js";
import { resolveServiceView } from "../src/service-layout.js";
import { SERVICE_TEMPLATES, canStartService, serviceFromTemplate } from "../src/service-templates.js";

test("glass preferences migrate without losing records, clamp values and round-trip", () => {
  const legacy = normalizeState({ theme: "light", notes: [{ id: "keep", title: "Keep", content: "unchanged" }] });
  assert.equal(legacy.preferences.material, "frosted");
  assert.equal(legacy.notes[0].content, "unchanged");
  for (const material of ["frosted", "liquid", "plain"]) {
    const state = normalizeState({ ...legacy, preferences: { ...legacy.preferences, material, glassOpacity: 60, glassBlur: 18, startPage: "github" } });
    assert.equal(normalizeState(JSON.parse(JSON.stringify(state))).preferences.material, material);
    assert.equal(state.preferences.startPage, "github");
    assert.equal(state.preferences.glassOpacity, 60);
    assert.equal(state.preferences.glassBlur, 18);
  }
  const invalid = normalizeState({ preferences: { material: "invalid", glassOpacity: 0, glassBlur: 500 } });
  assert.equal(invalid.preferences.material, "frosted");
  assert.equal(invalid.preferences.glassOpacity, 40);
  assert.equal(invalid.preferences.glassBlur, 40);
});

test("templates are editable Windows configurations; fresh local lists stay empty", () => {
  assert.equal(new Set(SERVICE_TEMPLATES.map((item) => item.id)).size, SERVICE_TEMPLATES.length);
  assert.equal(SERVICE_TEMPLATES.length, 9);
  assert.ok(!SERVICE_TEMPLATES.some(item => ["mysql", "postgresql", "mongodb"].includes(item.id)));
  assert.deepEqual(DEFAULT_STATE.services, []);
  assert.deepEqual(normalizeState(null).services, []);
  for (const template of SERVICE_TEMPLATES.filter((item) => item.id !== "custom")) {
    const service = serviceFromTemplate(template.id);
    assert.equal(service.folder, "");
    assert.equal(canStartService(service), false);
    assert.ok(service.startCommand);
    assert.ok(template.hint);
  }
  assert.equal(canStartService({ isExample: true, folder: "C:/fixture", startCommand: "never-run" }), false);
  const redis = serviceFromTemplate("redis");
  assert.equal(redis.port, "6379");
  assert.match(redis.startCommand, /redis-server.exe/);
  assert.equal(canStartService(redis), false);
  redis.folder = "C:/test"; redis.startCommand = "my-custom-command";
  assert.ok(canStartService(redis));
  assert.equal(normalizeState({ services: [redis] }).services[0].startCommand, "my-custom-command");
  assert.equal(normalizeState({ services: [redis] }).services[0].isExample, undefined);
  assert.equal(serviceFromTemplate("custom").startCommand, "");
});

test("service density uses the stage capacity and buffers boundary transitions", () => {
  assert.equal(resolveServiceView(1350, 380, 5), "full");
  assert.equal(resolveServiceView(1350, 245, 5, "full"), "compact");
  assert.equal(resolveServiceView(1350, 160, 5), "icons");
  assert.equal(resolveServiceView(1350, 300, 5, "full"), "full");
  assert.equal(resolveServiceView(1350, 300, 5, "compact"), "compact");
  assert.equal(resolveServiceView(1350, 185, 5, "icons"), "icons");
  assert.equal(resolveServiceView(1350, 185, 5, "compact"), "compact");
  assert.equal(resolveServiceView(790, 380, 5), "compact");
  for (const serviceViewMode of ["auto", "full", "compact", "icons"]) {
    const state = normalizeState({ ...DEFAULT_STATE, preferences: { ...DEFAULT_STATE.preferences, serviceViewMode } });
    assert.equal(normalizeState(JSON.parse(JSON.stringify(state))).preferences.serviceViewMode, serviceViewMode);
  }
  assert.equal(normalizeState({ preferences: { serviceViewMode: "invalid" } }).preferences.serviceViewMode, "auto");
});

test("normalizeState restores transient service state after relaunch", () => {
  const restored = normalizeState({
    ...DEFAULT_STATE,
    theme: "light",
    services: [{
      ...serviceFromTemplate("nacos"),
      status: "running",
      startedAt: 123,
      pid: 456,
    }],
  });

  assert.equal(restored.theme, "light");
  assert.equal(restored.services[0].status, "stopped");
  assert.equal(restored.services[0].startedAt, null);
  assert.equal(restored.services[0].pid, null);
});

test("normalizeState falls back to a supported theme and usable note", () => {
  const restored = normalizeState({ theme: "purple", services: [], notes: [] });

  assert.equal(restored.theme, "dark");
  assert.equal(restored.notes.length, 1);
  assert.equal(restored.activeNoteId, restored.notes[0].id);
});

test("formatUptime formats elapsed time as hours, minutes, and seconds", () => {
  assert.equal(formatUptime(1_000, 3_662_000), "01:01:01");
  assert.equal(formatUptime(null, 3_662_000), "-");
});

test("legacy state migrates without losing notes or services, and daily data round-trips", () => {
  const migrated = normalizeState({ services: DEFAULT_STATE.services, notes: [{ id: "old", title: "saved", content: "keep me" }], activeNoteId: "old" });
  assert.equal(migrated.schemaVersion, 4);
  assert.equal(migrated.notes[0].content, "keep me");
  assert.equal(migrated.preferences.closeBehavior, "tray");
  assert.equal(migrated.preferences.startPage, "home");
  migrated.shortcuts = [{ id: "shortcut", target: "https://example.com" }];
  migrated.todos = [{ id: "todo", text: "remember" }];
  migrated.snippets = [{ id: "snippet", content: "copy" }];
  assert.deepEqual(normalizeState(migrated).todos, migrated.todos);
  assert.deepEqual(normalizeState(migrated).shortcuts, migrated.shortcuts);
  assert.deepEqual(normalizeState(migrated).snippets, migrated.snippets);
  migrated.commands = [{ id: "cmd", name: "check", command: "Get-Date", shell: "powershell", cwd: "C:/work" }];
  assert.deepEqual(normalizeState(migrated).commands, migrated.commands);
  assert.deepEqual(normalizeState({ services: [], notes: migrated.notes }).commands, []);
});

test("countdowns preserve paused time and migrate an active legacy focus timer once", () => {
  const migrated = normalizeState({ focus: { running: true, deadline: 50000, remaining: 1500 } });
  assert.equal(migrated.countdowns.length, 1);
  assert.equal(countdownRemaining(migrated.countdowns[0], 40000), 10);
  assert.equal(countdownRemaining({ status: "paused", remaining: 99, deadline: null }, 100000), 99);
  assert.equal(normalizeState({ ...migrated, countdowns: [] }).countdowns.length, 0);
});

test("console appearance survives reload and migrates old sci-fi choices without losing records", () => {
  for (const [theme, mode, accent] of [["bridge", "dark", "cyan"], ["cyber", "dark", "blue"], ["aurora", "dark", "green"], ["mars", "dark", "amber"], ["lunar", "light", "cyan"], ["light", "light", "cyan"], ["dark", "dark", "cyan"], ["system", "system", "cyan"]]) {
    const state = normalizeState({ ...DEFAULT_STATE, theme, preferences: { backgroundIntensity: 35, motionEffects: true } });
    const reloaded = normalizeState(JSON.parse(JSON.stringify(state)));
    assert.equal(reloaded.theme, mode);
    assert.equal(reloaded.preferences.accent, accent);
    assert.equal(reloaded.preferences.backgroundIntensity, 35);
    assert.equal(reloaded.preferences.motionEffects, true);
    assert.deepEqual(reloaded.notes, state.notes);
  }
  assert.equal(normalizeState({ preferences: { backgroundIntensity: -1 } }).preferences.backgroundIntensity, 0);
  assert.equal(normalizeState({ preferences: { backgroundIntensity: 500 } }).preferences.backgroundIntensity, 100);
  const legacy = normalizeState({ theme: "dark", preferences: { backgroundIntensity: "75", motionEffects: "true" } });
  assert.equal(legacy.preferences.backgroundIntensity, 75);
  assert.equal(legacy.preferences.motionEffects, false);
});
