/**
 * TODO 解析器：逐行扫描 Markdown 文本，识别任务、关键字与标签形式的 TODO
 *
 * @author 启年
 * @createTime 2026-10-10 09:23
 */
import { TodoItem, TodoKind, TodoSettings } from "./types";

/** 单条文本的最大保留长度，防止超长行拖慢渲染 */
const MAX_TEXT_LENGTH = 2000;

/** Markdown 任务：`- [ ] xxx`、`* [x] xxx`、`1. [ ] xxx`，允许位于引用块中 */
const TASK_REGEX = /^\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[(.)\]\s?(.*)$/;

/** Markdown 标题：`## xxx`，去掉结尾可选的 `#` */
const HEADING_REGEX = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;

/** 代码块围栏：``` 或 ~~~ */
const FENCE_REGEX = /^\s*(`{3,}|~{3,})/;

/** 关键字之后的分隔符：右括号、冒号、破折号等 */
const AFTER_KEYWORD_REGEX = /^\s*[\]】)）]?\s*[:：\-—]*\s*/;

/** 行尾的注释结束符：HTML 注释结尾与块注释结尾 */
const TRAILING_COMMENT_REGEX = /\s*(?:-->|\*\/)\s*$/;

/** 关键字之前的修饰符：注释符、列表符、引用符、左括号等 */
const BEFORE_KEYWORD_REGEX = /^\s*(?:<!--|\/\/|\/\*|\*|#+|>|[-+]|\d+[.)])?\s*/;

/** 结尾残留的左括号与分隔符 */
const BEFORE_TRAILING_REGEX = /\s*[\[【(（:：\-—]*\s*$/;

/**
 * 关键字匹配结果
 */
interface KeywordMatch {
	/** 来源类型 */
	kind: TodoKind;
	/** 命中的关键字原文 */
	keyword: string;
	/** 关键字（含 `#`）在行内的起始位置 */
	start: number;
	/** 关键字在行内的结束位置 */
	end: number;
}

/**
 * 转义正则特殊字符
 *
 * @param value 原始字符串
 * @return 可安全放入正则的字符串
 */
function escapeRegex(value: string): string {
	// 对正则元字符逐个加反斜杠
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 根据配置构建关键字正则与标签正则
 *
 * @param settings 插件配置
 * @return 关键字正则与标签正则；关键字为空时均为 null
 */
export function buildMatchers(settings: TodoSettings): { keyword: RegExp | null; tag: RegExp | null } {
	// 过滤空白关键字
	const keywords = settings.keywords.map((k) => k.trim()).filter((k) => k.length > 0);
	if (keywords.length === 0) {
		return { keyword: null, tag: null };
	}
	// 长关键字优先，避免短关键字截断长关键字
	const alternation = keywords.sort((a, b) => b.length - a.length).map(escapeRegex).join("|");
	// 前后均不能紧挨字母数字下划线，保证整词匹配（不使用后行断言以兼容旧版移动端）
	const keyword = new RegExp(`(^|[^A-Za-z0-9_])(${alternation})(?![A-Za-z0-9_])`, settings.caseSensitive ? "" : "i");
	// 标签形式始终不区分大小写，与 Obsidian 标签规则一致；`#todo/xxx` 这类嵌套标签同样识别
	const tag = settings.matchTags ? new RegExp(`(^|\\s)#(${alternation})(?![A-Za-z0-9_\\-])`, "i") : null;
	return { keyword, tag };
}

/**
 * 在一行中查找关键字或标签
 *
 * @param line 行文本
 * @param matchers 关键字正则与标签正则
 * @return 匹配结果；未命中时为 null
 */
function findKeyword(line: string, matchers: { keyword: RegExp | null; tag: RegExp | null }): KeywordMatch | null {
	// 优先匹配标签，标签不受大小写开关影响
	if (matchers.tag) {
		const m = matchers.tag.exec(line);
		if (m) {
			const start = m.index + m[1].length;
			return { kind: TodoKind.Tag, keyword: m[2], start, end: start + 1 + m[2].length };
		}
	}
	// 再匹配普通关键字
	if (matchers.keyword) {
		const m = matchers.keyword.exec(line);
		if (m) {
			const start = m.index + m[1].length;
			return { kind: TodoKind.Keyword, keyword: m[2], start, end: start + m[2].length };
		}
	}
	return null;
}

/**
 * 截断超长文本
 *
 * @param text 原始文本
 * @return 不超过最大长度的文本
 */
function clip(text: string): string {
	// 超长时截断并补省略号
	return text.length > MAX_TEXT_LENGTH ? `${text.slice(0, MAX_TEXT_LENGTH)}…` : text;
}

/**
 * 从关键字所在行提取 TODO 正文
 *
 * @param line 行文本
 * @param match 关键字匹配结果
 * @return 关键字之后的文本；为空时退回关键字之前的文本
 */
function extractText(line: string, match: KeywordMatch): string {
	// 关键字之后：去掉分隔符与行尾注释结束符
	const after = line.slice(match.end).replace(AFTER_KEYWORD_REGEX, "").replace(TRAILING_COMMENT_REGEX, "").trim();
	if (after.length > 0) {
		return after;
	}
	// 关键字之后为空，如 `补充例句 TODO`：取关键字之前的文本
	return line.slice(0, match.start).replace(BEFORE_KEYWORD_REGEX, "").replace(BEFORE_TRAILING_REGEX, "").trim();
}

/**
 * 查找下一个可作为上下文的非空行
 *
 * @param lines 全部行
 * @param from 当前 TODO 所在行号
 * @param matchers 关键字正则与标签正则
 * @return 下一个非空行文本；遇到标题、代码块围栏或另一条 TODO 时返回 null
 */
function findNextLine(lines: string[], from: number, matchers: { keyword: RegExp | null; tag: RegExp | null }): string | null {
	for (let i = from + 1; i < lines.length; i++) {
		const text = lines[i].trim();
		// 跳过空行
		if (text.length === 0) {
			continue;
		}
		// 标题、围栏或另一条 TODO 不作为上下文，它们各自独立展示
		if (HEADING_REGEX.test(text) || FENCE_REGEX.test(text) || TASK_REGEX.test(lines[i]) || findKeyword(lines[i], matchers)) {
			return null;
		}
		return clip(text);
	}
	return null;
}

/**
 * 解析整篇 Markdown 文本中的 TODO
 *
 * @param content 文件全文
 * @param settings 插件配置
 * @return 按行号排序的 TODO 列表
 */
export function parseTodos(content: string, settings: TodoSettings): TodoItem[] {
	const lines = content.split(/\r?\n/);
	const matchers = buildMatchers(settings);
	const result: TodoItem[] = [];
	// 标题栈：记录当前所处的各级标题
	const headingStack: { level: number; text: string }[] = [];
	// 首行为 `---` 时进入 frontmatter
	let inFrontmatter = lines.length > 0 && lines[0].trim() === "---";
	// 当前打开的代码块围栏，如 "```"；不在代码块中时为 null
	let fence: string | null = null;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// region frontmatter：整段跳过
		if (inFrontmatter) {
			if (i > 0 && /^(---|\.\.\.)\s*$/.test(line)) {
				inFrontmatter = false;
			}
			continue;
		}
		// endregion

		// region 代码块：维护围栏状态，围栏行本身不参与识别
		const fenceMatch = FENCE_REGEX.exec(line);
		if (fenceMatch) {
			const marker = fenceMatch[1];
			if (fence === null) {
				// 打开代码块
				fence = marker;
				continue;
			}
			// 只有同类型且长度不小于开启围栏、后面无其他内容的行才能关闭代码块
			if (marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) {
				fence = null;
				continue;
			}
		}
		const inCodeBlock = fence !== null;
		if (inCodeBlock && !settings.scanCodeBlocks) {
			continue;
		}
		// endregion

		// region 标题：更新标题栈（代码块内的 `#` 是注释而非标题）
		if (!inCodeBlock) {
			const heading = HEADING_REGEX.exec(line);
			if (heading) {
				const level = heading[1].length;
				// 弹出同级及更低级的标题
				while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
					headingStack.pop();
				}
				headingStack.push({ level, text: heading[2].trim() });
			}
		}
		const headingPath = headingStack.map((h) => h.text);
		const headingLevels = headingStack.map((h) => h.level);
		// endregion

		// region Markdown 任务
		const task = inCodeBlock ? null : TASK_REGEX.exec(line);
		if (task) {
			const status = task[1];
			const completed = status === "x" || status === "X";
			// 只认未完成 `[ ]` 与已完成 `[x]`，其他自定义状态忽略
			if (status !== " " && !completed) {
				continue;
			}
			if (!settings.includeTasks || (completed && !settings.showCompleted)) {
				continue;
			}
			// 任务正文中如果再写了 TODO 前缀，一并去掉
			let text = task[2].trim();
			const inner = findKeyword(text, matchers);
			if (inner && inner.start === 0) {
				text = extractText(text, inner);
			}
			result.push({
				line: i,
				kind: TodoKind.Task,
				keyword: "",
				text: clip(text),
				nextLine: settings.showNextLine ? findNextLine(lines, i, matchers) : null,
				completed,
				headingPath,
				headingLevels,
				inCodeBlock,
			});
			continue;
		}
		// endregion

		// region 关键字与标签
		const match = findKeyword(line, matchers);
		if (match) {
			result.push({
				line: i,
				kind: match.kind,
				keyword: match.keyword,
				text: clip(extractText(line, match)),
				nextLine: settings.showNextLine ? findNextLine(lines, i, matchers) : null,
				completed: false,
				headingPath,
				headingLevels,
				inCodeBlock,
			});
		}
		// endregion
	}
	return result;
}
