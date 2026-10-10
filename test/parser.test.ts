/**
 * TODO 解析器测试用例
 *
 * @author 启年
 * @createTime 2026-10-10 09:23
 */
import assert from "node:assert/strict";
import { parseTodos } from "../src/parser";
import { DEFAULT_SETTINGS, TodoKind, TodoSettings } from "../src/types";

/**
 * 使用默认配置并覆盖部分字段
 *
 * @param patch 需要覆盖的配置
 * @return 完整配置
 */
function settingsOf(patch: Partial<TodoSettings> = {}): TodoSettings {
	return { ...DEFAULT_SETTINGS, ...patch };
}

// 测试用 Markdown，覆盖各种写法与边界
const doc = [
	"---",
	"tags: TODO",
	"---",
	"# 提成设置",
	"TODO: 补充提成计算流程",
	"这是下面一行的说明",
	"",
	"TODO：中文冒号写法",
	"",
	"",
	"空行之后的上下文",
	"## 复活",
	"- [ ] 写复活规则",
	"- [x] 已完成的任务",
	"* [ ] TODO: 任务里再写 TODO 前缀",
	"> - [ ] 引用中的任务",
	"补充例句 TODO",
	"【TODO】括号写法",
	"[TODO] 方括号写法",
	"<!-- TODO 注释写法 -->",
	"#todo 标签写法",
	"## 私教",
	"todolist 不应识别，TODOS 也不应识别，mytodo 也不应识别",
	"lowercase todo 默认不识别",
	"```java",
	"// TODO 代码块里的待办",
	"# TODO python 风格注释",
	"- [ ] 代码块里的任务不算",
	"```",
	"TODO - " + "很长的文本".repeat(10),
	"## 下一节",
].join("\n");

// region 默认配置
const items = parseTodos(doc, settingsOf());
const texts = items.map((i) => i.text);
console.table(items.map((i) => ({ line: i.line + 1, kind: i.kind, text: i.text.slice(0, 20), next: i.nextLine, path: i.headingPath.join(">") })));

// frontmatter 中的 TODO 不识别
assert.ok(!items.some((i) => i.line === 1), "frontmatter 不应识别");
// 冒号写法与下一行上下文
assert.equal(items[0].text, "补充提成计算流程");
assert.equal(items[0].nextLine, "这是下面一行的说明");
assert.deepEqual(items[0].headingPath, ["提成设置"]);
// 中文冒号，跳过空行取上下文
assert.equal(items[1].text, "中文冒号写法");
assert.equal(items[1].nextLine, "空行之后的上下文");
// 任务
assert.ok(texts.includes("写复活规则"));
assert.ok(!texts.includes("已完成的任务"), "默认不显示已完成任务");
assert.ok(texts.includes("任务里再写 TODO 前缀"));
assert.ok(texts.includes("引用中的任务"));
assert.deepEqual(items.find((i) => i.text === "写复活规则")?.headingPath, ["提成设置", "复活"]);
// 关键字在末尾时取前面的文本
assert.ok(texts.includes("补充例句"));
// 括号、注释、标签写法
assert.ok(texts.includes("括号写法"));
assert.ok(texts.includes("方括号写法"));
assert.ok(texts.includes("注释写法"));
assert.equal(items.find((i) => i.text === "标签写法")?.kind, TodoKind.Tag);
// 整词匹配与大小写
assert.ok(!items.some((i) => i.text.includes("todolist")));
assert.ok(!items.some((i) => i.text === "默认不识别"));
// 代码块
const code = items.filter((i) => i.inCodeBlock);
assert.deepEqual(code.map((i) => i.text), ["代码块里的待办", "python 风格注释"]);
// 围栏后的长文本，且代码块内的 `#` 不被当作标题
const long = items[items.length - 1];
assert.ok(long.text.startsWith("很长的文本"));
assert.deepEqual(long.headingPath, ["提成设置", "私教"]);
// endregion

// region 配置项
// 不区分大小写时识别 lowercase todo，但 todolist 仍不识别
const insensitive = parseTodos(doc, settingsOf({ caseSensitive: false }));
assert.ok(insensitive.some((i) => i.text === "默认不识别"));
assert.ok(!insensitive.some((i) => i.text.includes("todolist")));
// 不扫描代码块
assert.ok(!parseTodos(doc, settingsOf({ scanCodeBlocks: false })).some((i) => i.inCodeBlock));
// 显示已完成任务
assert.ok(parseTodos(doc, settingsOf({ showCompleted: true })).some((i) => i.completed));
// 关闭任务识别
assert.ok(!parseTodos(doc, settingsOf({ includeTasks: false })).some((i) => i.kind === TodoKind.Task));
// 自定义关键字
assert.equal(parseTodos("FIXME: 修复\nTODO: 待办", settingsOf({ keywords: ["FIXME"] })).length, 1);
// 关闭下一行
assert.equal(parseTodos(doc, settingsOf({ showNextLine: false }))[0].nextLine, null);
// endregion

console.log(`解析器测试通过，共识别 ${items.length} 条 TODO`);
