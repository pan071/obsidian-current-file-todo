/**
 * 当前文件 TODO 侧边栏视图：渲染列表/分组两种展示模式，并支持点击跳转到对应行
 *
 * @author 启年
 * @createTime 2026-10-10 09:23
 */
import { ItemView, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type CurrentFileTodoPlugin from "./main";
import { DisplayMode, GroupStyle, TodoItem, TodoKind, VIEW_TYPE_TODO } from "./types";

/** 无标题分组的显示名称 */
const NO_HEADING = "（文档开头）";

/**
 * TODO 分组
 */
interface TodoGroup {
	/** 分组键：标题路径拼接 */
	key: string;
	/** 标题路径 */
	path: string[];
	/** 分组内 TODO */
	items: TodoItem[];
}

/**
 * 嵌套分组的标题节点
 */
interface HeadingNode {
	/** 节点键：从顶级标题到本标题的路径拼接 */
	key: string;
	/** 本级标题文本 */
	title: string;
	/** 直接位于本标题下（不含子标题）的 TODO */
	items: TodoItem[];
	/** 子标题节点，保持首次出现顺序 */
	children: Map<string, HeadingNode>;
	/** 本标题及所有子标题下的 TODO 总数 */
	total: number;
}

/**
 * 当前文件 TODO 侧边栏视图，图标显示在右侧边栏顶部标签栏中，与大纲、标签等视图并列
 *
 * @author 启年
 * @createTime 2026-10-10 09:23
 */
export class TodoView extends ItemView {
	/** 插件实例，用于读取配置与当前文件 */
	private readonly plugin: CurrentFileTodoPlugin;
	/** 已折叠的分组键 */
	private readonly collapsedGroups = new Set<string>();
	/** 已展开长文本的行号 */
	private readonly expandedLines = new Set<number>();
	/** 上次渲染的文件路径，切换文件时清空展开/折叠状态 */
	private lastPath: string | null = null;
	/** 展示模式切换按钮 */
	private modeAction: HTMLElement | null = null;
	/** 已完成任务显示切换按钮 */
	private completedAction: HTMLElement | null = null;

	/**
	 * 创建视图
	 *
	 * @param leaf 视图所在叶子
	 * @param plugin 插件实例
	 */
	constructor(leaf: WorkspaceLeaf, plugin: CurrentFileTodoPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	/**
	 * 视图类型标识
	 *
	 * @return 视图类型
	 */
	getViewType(): string {
		return VIEW_TYPE_TODO;
	}

	/**
	 * 视图标题（显示在标签页悬停提示中）
	 *
	 * @return 标题
	 */
	getDisplayText(): string {
		return "当前文件 TODO";
	}

	/**
	 * 视图图标（显示在侧边栏顶部标签栏）
	 *
	 * @return Lucide 图标名
	 */
	getIcon(): string {
		return "list-todo";
	}

	/**
	 * 视图打开时创建顶部操作按钮并首次渲染
	 */
	async onOpen(): Promise<void> {
		// 刷新按钮
		this.addAction("refresh-cw", "刷新", () => this.plugin.refreshViews());
		// 已完成任务显示开关
		this.completedAction = this.addAction("check-square", "", async () => {
			this.plugin.settings.showCompleted = !this.plugin.settings.showCompleted;
			await this.plugin.saveSettings();
		});
		// 列表/分组切换
		this.modeAction = this.addAction("list", "", async () => {
			const settings = this.plugin.settings;
			settings.displayMode = settings.displayMode === DisplayMode.List ? DisplayMode.Group : DisplayMode.List;
			await this.plugin.saveSettings();
		});
		this.contentEl.addClass("ctv-container");
		await this.refresh();
	}

	/**
	 * 视图关闭时清理内容
	 */
	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	/**
	 * 根据当前文件与配置重新渲染
	 */
	async refresh(): Promise<void> {
		this.updateActions();
		const file = this.plugin.currentFile;
		// 切换文件时重置展开/折叠状态
		const path = file ? file.path : null;
		if (path !== this.lastPath) {
			this.collapsedGroups.clear();
			this.expandedLines.clear();
			this.lastPath = path;
		}
		if (!file) {
			this.renderEmpty("当前没有打开的文件");
			return;
		}
		if (file.extension !== "md") {
			this.renderEmpty("当前文件不是 Markdown");
			return;
		}
		const items = await this.plugin.collectTodos(file);
		// 异步读取期间文件可能已切换，以最新文件为准
		if (this.plugin.currentFile !== file) {
			return;
		}
		this.render(file, items);
	}

	/**
	 * 同步顶部按钮的图标与提示文字
	 */
	private updateActions(): void {
		const settings = this.plugin.settings;
		if (this.modeAction) {
			// 图标表示点击后将切换到的模式
			const toGroup = settings.displayMode === DisplayMode.List;
			setIcon(this.modeAction, toGroup ? "list-tree" : "list");
			this.modeAction.setAttr("aria-label", toGroup ? "切换为按标题分组" : "切换为平铺列表");
		}
		if (this.completedAction) {
			setIcon(this.completedAction, settings.showCompleted ? "check-square" : "square");
			this.completedAction.setAttr("aria-label", settings.showCompleted ? "隐藏已完成任务" : "显示已完成任务");
			this.completedAction.toggleClass("is-active", settings.showCompleted);
		}
	}

	/**
	 * 渲染空状态
	 *
	 * @param message 提示文字
	 */
	private renderEmpty(message: string): void {
		this.contentEl.empty();
		this.contentEl.createDiv({ cls: "ctv-empty", text: message });
	}

	/**
	 * 渲染 TODO 列表
	 *
	 * @param file 当前文件
	 * @param items TODO 列表
	 */
	private render(file: TFile, items: TodoItem[]): void {
		const settings = this.plugin.settings;
		const el = this.contentEl;
		el.empty();
		// 通过 CSS 变量控制长文本折叠行数
		el.style.setProperty("--ctv-max-lines", String(Math.max(1, settings.maxLines)));

		// 顶部摘要：文件名与数量
		const header = el.createDiv({ cls: "ctv-header" });
		header.createSpan({ cls: "ctv-file", text: file.basename });
		header.createSpan({ cls: "ctv-count", text: `共 ${items.length} 条` });

		if (items.length === 0) {
			el.createDiv({ cls: "ctv-empty", text: "当前文件没有 TODO" });
			return;
		}

		const listEl = el.createDiv({ cls: "ctv-list" });
		if (settings.displayMode === DisplayMode.Group) {
			this.renderGroups(listEl, file, items);
		} else {
			items.forEach((item) => this.renderItem(listEl, file, item, true));
		}
		// 布局完成后再判断哪些文本被截断，决定是否显示“展开”按钮
		window.requestAnimationFrame(() => this.markOverflow(listEl));
	}

	/**
	 * 按标题分组渲染，根据配置选择单层路径或嵌套标题树
	 *
	 * @param parent 父容器
	 * @param file 当前文件
	 * @param items TODO 列表
	 */
	private renderGroups(parent: HTMLElement, file: TFile, items: TodoItem[]): void {
		if (this.plugin.settings.groupStyle === GroupStyle.Nested) {
			this.renderNestedGroups(parent, file, items);
		} else {
			this.renderFlatGroups(parent, file, items);
		}
	}

	/**
	 * 单层分组：每个完整标题路径一组
	 *
	 * @param parent 父容器
	 * @param file 当前文件
	 * @param items TODO 列表
	 */
	private renderFlatGroups(parent: HTMLElement, file: TFile, items: TodoItem[]): void {
		// 按标题路径聚合，保持首次出现顺序
		const groups = new Map<string, TodoGroup>();
		for (const item of items) {
			const key = item.headingPath.join(" > ");
			let group = groups.get(key);
			if (!group) {
				group = { key, path: item.headingPath, items: [] };
				groups.set(key, group);
			}
			group.items.push(item);
		}

		for (const group of groups.values()) {
			const bodyEl = this.renderGroupShell(parent, group.key, group.items.length, (nameEl) => {
				if (group.path.length === 0) {
					nameEl.setText(NO_HEADING);
					return;
				}
				// 上级标题以浅色显示，突出最近一级标题
				if (group.path.length > 1) {
					nameEl.createSpan({ cls: "ctv-group-parent", text: `${group.path.slice(0, -1).join(" > ")} > ` });
				}
				nameEl.createSpan({ text: group.path[group.path.length - 1] });
			});
			group.items.forEach((item) => this.renderItem(bodyEl, file, item, false));
		}
	}

	/**
	 * 嵌套分组：按标题层级构建树，逐级渲染
	 *
	 * @param parent 父容器
	 * @param file 当前文件
	 * @param items TODO 列表
	 */
	private renderNestedGroups(parent: HTMLElement, file: TFile, items: TodoItem[]): void {
		const root: HeadingNode = { key: "", title: "", items: [], children: new Map(), total: 0 };
		// 沿标题路径逐级挂载，同时累计每个节点下的 TODO 总数
		for (const item of items) {
			let node = root;
			node.total++;
			item.headingPath.forEach((title, index) => {
				const key = item.headingPath.slice(0, index + 1).join(" > ");
				let child = node.children.get(key);
				if (!child) {
					child = { key, title, items: [], children: new Map(), total: 0 };
					node.children.set(key, child);
				}
				child.total++;
				node = child;
			});
			node.items.push(item);
		}

		// 第一个标题之前的 TODO 单独成组
		if (root.items.length > 0) {
			const bodyEl = this.renderGroupShell(parent, "", root.items.length, (nameEl) => nameEl.setText(NO_HEADING));
			root.items.forEach((item) => this.renderItem(bodyEl, file, item, false));
		}
		root.children.forEach((child) => this.renderHeadingNode(parent, file, child));
	}

	/**
	 * 递归渲染标题树节点：先渲染本标题下的 TODO，再渲染子标题
	 *
	 * @param parent 父容器
	 * @param file 当前文件
	 * @param node 标题节点
	 */
	private renderHeadingNode(parent: HTMLElement, file: TFile, node: HeadingNode): void {
		const bodyEl = this.renderGroupShell(parent, node.key, node.total, (nameEl) => nameEl.setText(node.title));
		node.items.forEach((item) => this.renderItem(bodyEl, file, item, false));
		node.children.forEach((child) => this.renderHeadingNode(bodyEl, file, child));
	}

	/**
	 * 渲染可折叠的分组外壳（标题行 + 内容区）
	 *
	 * @param parent 父容器
	 * @param key 分组键，用于记录折叠状态
	 * @param count 标题行显示的数量
	 * @param renderName 渲染分组名称
	 * @return 分组内容区容器
	 */
	private renderGroupShell(parent: HTMLElement, key: string, count: number, renderName: (nameEl: HTMLElement) => void): HTMLElement {
		const groupEl = parent.createDiv({ cls: "ctv-group" });
		groupEl.toggleClass("is-collapsed", this.collapsedGroups.has(key));

		// 标题行：折叠箭头 + 名称 + 数量
		const titleEl = groupEl.createDiv({ cls: "ctv-group-title" });
		titleEl.setAttr("title", key || NO_HEADING);
		const arrow = titleEl.createSpan({ cls: "ctv-group-arrow" });
		setIcon(arrow, "chevron-down");
		renderName(titleEl.createSpan({ cls: "ctv-group-name" }));
		titleEl.createSpan({ cls: "ctv-group-count", text: String(count) });

		// 点击标题切换折叠
		titleEl.addEventListener("click", (evt) => {
			// 阻止冒泡，避免嵌套时同时折叠上级分组
			evt.stopPropagation();
			if (this.collapsedGroups.has(key)) {
				this.collapsedGroups.delete(key);
			} else {
				this.collapsedGroups.add(key);
			}
			groupEl.toggleClass("is-collapsed", this.collapsedGroups.has(key));
		});

		return groupEl.createDiv({ cls: "ctv-group-body" });
	}

	/**
	 * 渲染单条 TODO 卡片
	 *
	 * @param parent 父容器
	 * @param file 当前文件
	 * @param item TODO
	 * @param showPath 是否在卡片中展示所属标题（列表模式下展示）
	 */
	private renderItem(parent: HTMLElement, file: TFile, item: TodoItem, showPath: boolean): void {
		const itemEl = parent.createDiv({ cls: "ctv-item" });
		itemEl.toggleClass("is-completed", item.completed);
		itemEl.toggleClass("is-expanded", this.expandedLines.has(item.line));

		// 主行：类型图标 + 关键字：正文 + 行号（可配置）
		const mainEl = itemEl.createDiv({ cls: "ctv-item-main" });
		const iconEl = mainEl.createSpan({ cls: "ctv-item-icon" });
		setIcon(iconEl, this.iconOf(item));
		const label = item.kind === TodoKind.Task ? "任务" : item.keyword.toUpperCase();
		const text = item.text.length > 0 ? item.text : "（无内容）";
		const textEl = mainEl.createDiv({ cls: "ctv-item-text" });
		textEl.setText(`${label}：${text}`);
		textEl.setAttr("title", item.text);
		if (this.plugin.settings.showLineNumber) {
			mainEl.createSpan({ cls: "ctv-item-line", text: `L${item.line + 1}` });
		}

		// 下一行上下文
		if (item.nextLine) {
			const nextEl = itemEl.createDiv({ cls: "ctv-item-next" });
			nextEl.setText(`↳ ${item.nextLine}`);
			nextEl.setAttr("title", item.nextLine);
		}

		// 列表模式下展示所属标题，便于定位
		if (showPath && this.plugin.settings.showHeadingPath && item.headingPath.length > 0) {
			itemEl.createDiv({ cls: "ctv-item-path", text: item.headingPath.join(" > ") });
		}

		// 展开/收起按钮，仅文本被截断时显示（见 markOverflow）
		const toggleEl = itemEl.createDiv({ cls: "ctv-item-toggle" });
		toggleEl.setText(this.expandedLines.has(item.line) ? "收起" : "展开");
		toggleEl.addEventListener("click", (evt) => {
			// 阻止冒泡，避免触发跳转
			evt.stopPropagation();
			const expanded = !this.expandedLines.has(item.line);
			if (expanded) {
				this.expandedLines.add(item.line);
			} else {
				this.expandedLines.delete(item.line);
			}
			itemEl.toggleClass("is-expanded", expanded);
			toggleEl.setText(expanded ? "收起" : "展开");
		});

		// 点击卡片跳转到对应行
		itemEl.addEventListener("click", () => {
			void this.plugin.jumpTo(file, item.line);
		});
	}

	/**
	 * 标记文本被截断的卡片，以显示“展开”按钮
	 *
	 * @param listEl 列表容器
	 */
	private markOverflow(listEl: HTMLElement): void {
		listEl.querySelectorAll<HTMLElement>(".ctv-item").forEach((itemEl) => {
			// 已展开的卡片保留按钮，方便收起
			if (itemEl.hasClass("is-expanded")) {
				itemEl.addClass("has-overflow");
				return;
			}
			const clamped = Array.from(itemEl.querySelectorAll<HTMLElement>(".ctv-item-text, .ctv-item-next"));
			// 内容高度超过可见高度即视为被截断
			const overflow = clamped.some((el) => el.scrollHeight > el.clientHeight + 1);
			itemEl.toggleClass("has-overflow", overflow);
		});
	}

	/**
	 * 获取 TODO 类型对应的图标
	 *
	 * @param item TODO
	 * @return Lucide 图标名
	 */
	private iconOf(item: TodoItem): string {
		if (item.kind === TodoKind.Task) {
			return item.completed ? "check-square" : "square";
		}
		if (item.kind === TodoKind.Tag) {
			return "tag";
		}
		// 代码块内的 TODO 用代码图标区分
		return item.inCodeBlock ? "code" : "circle-dot";
	}
}
