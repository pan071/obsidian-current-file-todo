/**
 * TODO 插件公共类型、枚举与默认配置
 *
 * @author 启年
 * @createTime 2026-10-10 09:23
 */
import type { TFile } from "obsidian";

/**
 * TODO 来源类型
 */
export enum TodoKind {
	/** Markdown 标准任务，如 `- [ ] xxx` */
	Task = "task",
	/** 关键字形式，如 `TODO: xxx`、`// TODO xxx` */
	Keyword = "keyword",
	/** 标签形式，如 `#todo xxx`（Obsidian 标签不区分大小写） */
	Tag = "tag",
}

/**
 * 视图展示模式
 */
export enum DisplayMode {
	/** 平铺列表 */
	List = "list",
	/** 按标题分组 */
	Group = "group",
}

/**
 * 分组样式（仅在按标题分组模式下生效）
 */
export enum GroupStyle {
	/** 单层：每个完整标题路径一组，如「提成设置 > 复活」 */
	Flat = "flat",
	/** 嵌套：按标题层级逐级嵌套 */
	Nested = "nested",
}

/**
 * TODO 汇总范围
 */
export enum ScopeMode {
	/** 当前文件 */
	File = "file",
	/** 当前文件所在目录（或已锁定的目录） */
	Folder = "folder",
}

/**
 * 单条 TODO 解析结果
 */
export interface TodoItem {
	/** 所在行号（从 0 开始） */
	line: number;
	/** 来源类型 */
	kind: TodoKind;
	/** 命中的关键字原文（任务类型为空字符串） */
	keyword: string;
	/** TODO 正文：关键字之后的文本；关键字后为空时取关键字之前的文本 */
	text: string;
	/** 下一个非空行的文本，作为上下文展示；没有时为 null */
	nextLine: string | null;
	/** 是否已完成（仅任务类型可能为 true） */
	completed: boolean;
	/** 所属标题路径，如 ["提成设置", "复活"] */
	headingPath: string[];
	/** 是否位于代码块内 */
	inCodeBlock: boolean;
}

/**
 * 单个文件的 TODO 解析结果（目录汇总时使用）
 */
export interface FileTodos {
	/** 所属文件 */
	file: TFile;
	/** 文件内的 TODO，按行号排序 */
	items: TodoItem[];
}

/**
 * 目录 TODO 汇总结果
 */
export interface FolderTodos {
	/** 含 TODO 的文件，按路径自然排序 */
	files: FileTodos[];
	/** 扫描范围内的 Markdown 文件数 */
	fileCount: number;
	/** 文件数是否超过扫描上限（超过时 files 为空，不做扫描） */
	overLimit: boolean;
}

/**
 * 插件配置
 */
export interface TodoSettings {
	/** 识别的关键字列表，如 ["TODO", "FIXME"] */
	keywords: string[];
	/** 关键字是否区分大小写 */
	caseSensitive: boolean;
	/** 是否识别 `#todo` 标签（不区分大小写） */
	matchTags: boolean;
	/** 是否识别 Markdown 标准任务 */
	includeTasks: boolean;
	/** 是否展示已完成任务 */
	showCompleted: boolean;
	/** 是否扫描代码块内的关键字 */
	scanCodeBlocks: boolean;
	/** 是否附带展示下一行文本 */
	showNextLine: boolean;
	/** 正文折叠前最多展示的行数 */
	maxLines: number;
	/** 展示模式 */
	displayMode: DisplayMode;
	/** 是否展示行号 */
	showLineNumber: boolean;
	/** 平铺列表模式下是否展示所属标题 */
	showHeadingPath: boolean;
	/** 分组样式 */
	groupStyle: GroupStyle;
	/** 汇总范围 */
	scopeMode: ScopeMode;
	/** 目录范围下是否包含子目录 */
	includeSubfolders: boolean;
	/** 目录范围下最多扫描的 Markdown 文件数，超过时不扫描 */
	maxFolderFiles: number;
	/** 是否已在右侧边栏初始化过视图（仅首次安装自动添加） */
	viewInitialized: boolean;
}

/** 插件默认配置 */
export const DEFAULT_SETTINGS: TodoSettings = {
	keywords: ["TODO"],
	caseSensitive: true,
	matchTags: true,
	includeTasks: true,
	showCompleted: false,
	scanCodeBlocks: true,
	showNextLine: true,
	maxLines: 2,
	displayMode: DisplayMode.List,
	groupStyle: GroupStyle.Nested,
	showLineNumber: true,
	showHeadingPath: true,
	scopeMode: ScopeMode.File,
	includeSubfolders: false,
	maxFolderFiles: 500,
	viewInitialized: false,
};

/** 侧边栏视图类型标识 */
export const VIEW_TYPE_TODO = "current-file-todo-view";
