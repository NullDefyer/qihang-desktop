import test from "node:test";
import assert from "node:assert/strict";
import { transformText, dateDifference, convertUnit } from "../src/tools.js";

test("text and development tools handle Unicode and invalid data", () => {
  assert.equal(transformText("你好\n你好\nworld", "dedupe"), "你好\nworld");
  assert.equal(transformText(transformText("中文 😀", "base64"), "unbase64"), "中文 😀");
  assert.equal(transformText('{"a":1}', "json"), '{\n  "a": 1\n}');
  assert.throws(() => transformText("not-json", "json"));
  assert.throws(() => transformText("%XX", "decode"));
});

test("date and unit calculations use explicit units and calendar dates", () => {
  assert.equal(dateDifference("2024-02-28", "2024-03-01"), 2);
  assert.equal(dateDifference("2026-10-31", "2026-10-30"), -1);
  assert.throws(() => dateDifference("2026-02-31", "2026-03-01"), /日期/);
  assert.equal(convertUnit("1024", "storage", "MiB", "GiB"), 1);
  assert.equal(convertUnit("2", "length", "km", "m"), 2000);
  assert.throws(() => convertUnit("", "weight", "kg", "g"));
});
