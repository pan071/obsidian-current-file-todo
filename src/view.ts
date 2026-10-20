/**
 * 当前文件 TODO 侧边栏视图：渲染列表/分组两种展示模式，并支持点击跳转到对应行
 *
 * @author 启年
 * @createTime 2026-10-10 09:23
 */
import { ItemView, SearchComponent, TAbstractFile, TFile, TFolder, ViewStateResult, WorkspaceLeaf, setIcon } from "obsidian";
import { FolderTreeModal } from "./folder-modal";
import type CurrentFileTodoPlugin from "./main";
import { DisplayMode, FileTodos, GroupStyle, ScopeMode, TodoItem, TodoKind, VIEW_TYPE_TODO } from "./types";

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
	/** 最后一级标题的层级（1～6）；无标题时为 0 */
	level: number;
	/** 分组内 TODO */
	items: TodoItem[];
}

/**
 * 分组类型图标（Lucide 图标名），用于区分文件分组与标题分组
 */
enum GroupIcon {
	/** 子目录分组（目录范围下包含子目录时） */
	Folder = "folder",
	/** 文件分组（目录范围下） */
	File = "file-text",
	/** 标题分组 */
	Heading = "hash",
	/** 第一个标题之前的内容 */
	DocumentStart = "align-left",
}

/**
 * 目录树分组的目录节点
 */
interface FolderNode {
	/** 相对范围目录的路径，如「需求文档/01、公共口径」；范围目录本身为空字符串 */
	path: string;
	/** 本级目录名 */
	name: string;
	/** 直接位于本目录下的文件 */
	files: FileTodos[];
	/** 子目录节点，键为目录名 */
	children: Map<string, FolderNode>;
	/** 本目录及所有子目录下的 TODO 总数 */
	total: number;
}

/**
 * 嵌套分组的标题节点
 */
interface HeadingNode {
	/** 节点键：从顶级标题到本标题的路径拼接 */
	key: string;
	/** 本级标题文本 */
	title: string;
	/** 本级标题的层级（1～6），对应 `#` 的数量 */
	level: number;
	/** 直接位于本标题下（不含子标题）的 TODO */
	items: TodoItem[];
	/** 子标题节点，保持首次出现顺序 */
	children: Map<string, HeadingNode>;
	/** 本标题及所有子标题下的 TODO 总数 */
	total: number;
}

/**
 * 视图当前的汇总范围
 */
interface ResolvedScope {
	/** 范围类型 */
	mode: ScopeMode;
	/** 当前文件（仅文件范围） */
	file: TFile | null;
	/** 目标目录（仅目录范围）；锁定的目录已不存在或没有当前文件时为 null */
	folder: TFolder | null;
	/** 目录是否为锁定状态（仅目录范围） */
	pinned: boolean;
}

/**
 * 最近一次刷新得到的渲染数据，输入过滤词时直接复用，无需重新解析
 */
interface ScopeData {
	/** 范围类型 */
	mode: ScopeMode;
	/** 顶部显示的名称：文件名或目录名 */
	title: string;
	/** 目录路径（仅目录范围），用于锁定与计算子目录相对路径 */
	folderPath: string;
	/** 目录是否已锁定（仅目录范围） */
	pinned: boolean;
	/** 文件及其 TODO；文件范围下只有当前文件一项，目录范围下只包含有 TODO 的文件 */
	files: FileTodos[];
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
	/** 已展开长文本的 TODO，键为「文件路径:行号」 */
	private readonly expandedItems = new Set<string>();
	/** 上次渲染的范围键，范围变化时清空展开/折叠状态 */
	private lastScopeKey: string | null = null;
	/** 锁定的目录路径；为 null 时目录范围跟随当前文件所在目录 */
	private pinnedFolder: string | null = null;
	/** 过滤词（小写），为空时不过滤 */
	private filterQuery = "";
	/** 刷新序号，异步解析期间又发起新刷新时丢弃旧结果 */
	private refreshSeq = 0;
	/** 最近一次刷新得到的渲染数据；展示空状态时为 null */
	private data: ScopeData | null = null;
	/** 顶部摘要区（固定在列表上方，不随列表滚动），每次渲染时清空重建 */
	private headerEl: HTMLElement | null = null;
	/** 列表内容区（独立滚动），每次渲染时清空重建 */
	private bodyEl: HTMLElement | null = null;
	/** 本次渲染出的全部分组键，用于全部展开/折叠 */
	private renderedGroupKeys: string[] = [];
	/** 展示模式切换按钮 */
	private modeAction: HTMLElement | null = null;
	/** 已完成任务显示切换按钮 */
	private completedAction: HTMLElement | null = null;
	/** 汇总范围切换按钮 */
	private scopeAction: HTMLElement | null = null;
	/** 全部展开/折叠按钮 */
	private foldAction: HTMLElement | null = null;

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
		return "TODO 汇总";
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
	 * 保存视图状态：锁定的目录随布局持久化，重启后仍然生效
	 *
	 * @return 视图状态
	 */
	getState(): Record<string, unknown> {
		return { ...super.getState(), pinnedFolder: this.pinnedFolder };
	}

	/**
	 * 恢复视图状态
	 *
	 * @param state 视图状态
	 * @param result 状态变更结果
	 */
	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		// 只接受字符串形式的锁定目录
		const pinned = (state as { pinnedFolder?: unknown } | null)?.pinnedFolder;
		this.pinnedFolder = typeof pinned === "string" ? pinned : null;
		await super.setState(state, result);
		await this.refresh();
	}

	/**
	 * 视图打开时创建过滤输入框与操作按钮并首次渲染
	 */
	async onOpen(): Promise<void> {
		const el = this.contentEl;
		el.empty();
		el.addClass("ctv-container");
		// 过滤输入框与操作按钮放在同一行并常驻顶部：列表重新渲染时不丢失输入焦点，侧边栏隐藏标题栏时按钮也可见
		const toolbarEl = el.createDiv({ cls: "ctv-toolbar" });
		new SearchComponent(toolbarEl)
			.setPlaceholder("过滤 TODO，空格分隔多个词")
			.setValue(this.filterQuery)
			.onChange((value) => {
				this.filterQuery = value.trim().toLowerCase();
				this.renderData();
			});
		// 当前文件/当前目录切换
		this.scopeAction = this.createToolbarButton(toolbarEl, async () => {
			const settings = this.plugin.settings;
			settings.scopeMode = settings.scopeMode === ScopeMode.File ? ScopeMode.Folder : ScopeMode.File;
			await this.plugin.saveSettings();
		});
		// 列表/分组切换
		this.modeAction = this.createToolbarButton(toolbarEl, async () => {
			const settings = this.plugin.settings;
			settings.displayMode = settings.displayMode === DisplayMode.List ? DisplayMode.Group : DisplayMode.List;
			await this.plugin.saveSettings();
		});
		// 全部展开/折叠，仅分组模式下可用
		this.foldAction = this.createToolbarButton(toolbarEl, () => this.toggleFoldAll());
		// 已完成任务显示开关
		this.completedAction = this.createToolbarButton(toolbarEl, async () => {
			this.plugin.settings.showCompleted = !this.plugin.settings.showCompleted;
			await this.plugin.saveSettings();
		});
		// 刷新按钮，图标与提示固定不变
		const refreshEl = this.createToolbarButton(toolbarEl, () => this.plugin.refreshViews());
		setIcon(refreshEl, "refresh-cw");
		refreshEl.setAttr("aria-label", "刷新");

		this.headerEl = el.createDiv({ cls: "ctv-header-slot" });
		this.bodyEl = el.createDiv({ cls: "ctv-body" });
		await this.refresh();
	}

	/**
	 * 在工具栏中创建图标按钮，图标与提示文字由 updateActions 统一设置
	 *
	 * @param parent 工具栏容器
	 * @param onClick 点击回调
	 * @return 按钮元素
	 */
	private createToolbarButton(parent: HTMLElement, onClick: () => unknown): HTMLElement {
		const buttonEl = parent.createDiv({ cls: "ctv-toolbar-button clickable-icon" });
		// 点击时执行回调，异步回调的结果无需等待
		buttonEl.addEventListener("click", () => void onClick());
		return buttonEl;
	}

	/**
	 * 视图关闭时清理内容
	 */
	async onClose(): Promise<void> {
		this.contentEl.empty();
		this.headerEl = null;
		this.bodyEl = null;
	}

	/**
	 * 设置锁定的目录，并随布局保存
	 *
	 * @param path 目录路径；为 null 时解除锁定
	 */
	setPinnedFolder(path: string | null): void {
		this.pinnedFolder = path;
		// 视图状态变化后请求保存布局，使锁定目录在重启后仍然生效
		this.app.workspace.requestSaveLayout();
	}

	/**
	 * 目录被重命名或移动时同步锁定目录的路径
	 *
	 * @param file 被重命名的文件或目录
	 * @param oldPath 旧路径
	 */
	handleRename(file: TAbstractFile, oldPath: string): void {
		const pinned = this.pinnedFolder;
		if (pinned === null || !(file instanceof TFolder)) {
			return;
		}
		// 锁定目录自身或其上级目录被重命名时，替换路径前缀
		if (pinned === oldPath) {
			this.setPinnedFolder(file.path);
		} else if (pinned.startsWith(`${oldPath}/`)) {
			this.setPinnedFolder(file.path + pinned.slice(oldPath.length));
		}
	}

	/**
	 * 判断文件是否在本视图的展示范围内
	 *
	 * @param path 文件路径
	 * @return 在范围内时为 true
	 */
	coversPath(path: string): boolean {
		const scope = this.resolveScope();
		// 文件范围：只看当前文件
		if (scope.mode === ScopeMode.File) {
			return scope.file !== null && scope.file.path === path;
		}
		// 目录范围：只关心 Markdown 文件
		if (!scope.folder || !path.endsWith(".md")) {
			return false;
		}
		return isPathInFolder(path, scope.folder.path, this.plugin.settings.includeSubfolders);
	}

	/**
	 * 根据配置、锁定目录与当前文件计算展示范围
	 *
	 * @return 展示范围
	 */
	private resolveScope(): ResolvedScope {
		const currentFile = this.plugin.currentFile;
		// 文件范围
		if (this.plugin.settings.scopeMode === ScopeMode.File) {
			return { mode: ScopeMode.File, file: currentFile, folder: null, pinned: false };
		}
		// 目录范围：已锁定时使用锁定目录
		if (this.pinnedFolder !== null) {
			const folder = this.app.vault.getAbstractFileByPath(this.pinnedFolder);
			return { mode: ScopeMode.Folder, file: null, folder: folder instanceof TFolder ? folder : null, pinned: true };
		}
		// 目录范围：未锁定时跟随当前文件所在目录
		return { mode: ScopeMode.Folder, file: null, folder: currentFile ? currentFile.parent : null, pinned: false };
	}

	/**
	 * 根据当前范围与配置重新解析并渲染
	 */
	async refresh(): Promise<void> {
		// 视图尚未打开时不渲染
		if (!this.bodyEl) {
			return;
		}
		this.updateActions();
		const seq = ++this.refreshSeq;
		const scope = this.resolveScope();

		// 范围变化时重置展开/折叠状态
		const scopeKey = scope.mode === ScopeMode.File ? `file:${scope.file?.path ?? ""}` : `folder:${scope.folder?.path ?? ""}`;
		if (scopeKey !== this.lastScopeKey) {
			this.collapsedGroups.clear();
			this.expandedItems.clear();
			this.lastScopeKey = scopeKey;
		}

		// region 文件范围
		if (scope.mode === ScopeMode.File) {
			const file = scope.file;
			if (!file) {
				this.renderEmpty("当前没有打开的文件");
				return;
			}
			if (file.extension !== "md") {
				this.renderEmpty("当前文件不是 Markdown");
				return;
			}
			const items = await this.plugin.collectTodos(file);
			// 异步读取期间又发起了新的刷新，以最新一次为准
			if (seq !== this.refreshSeq) {
				return;
			}
			this.data = { mode: ScopeMode.File, title: file.basename, folderPath: "", pinned: false, files: [{ file, items }] };
			this.renderData();
			return;
		}
		// endregion

		// region 目录范围
		const folder = scope.folder;
		if (!folder) {
			this.renderEmpty(scope.pinned ? "锁定的目录已不存在" : "当前没有打开的文件", scope.pinned);
			return;
		}
		const result = await this.plugin.collectFolderTodos(folder);
		// 异步读取期间又发起了新的刷新，以最新一次为准
		if (seq !== this.refreshSeq) {
			return;
		}
		if (result.overLimit) {
			const limit = this.plugin.settings.maxFolderFiles;
			const emptyEl = this.renderEmpty(`目录下有 ${result.fileCount} 个 Markdown 文件，超过扫描上限 ${limit}。请缩小范围、关闭「包含子目录」或在设置中调高上限。`, scope.pinned);
			// 包含子目录导致超限时，提供一键关闭入口
			if (emptyEl && this.plugin.settings.includeSubfolders) {
				const offEl = emptyEl.createDiv({ cls: "ctv-empty-action", text: "关闭包含子目录" });
				offEl.addEventListener("click", () => void this.toggleSubfolders());
			}
			return;
		}
		const title = folder.isRoot() ? this.app.vault.getName() : folder.name;
		this.data = { mode: ScopeMode.Folder, title, folderPath: folder.path, pinned: scope.pinned, files: result.files };
		this.renderData();
		// endregion
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
		if (this.scopeAction) {
			// 图标表示点击后将切换到的范围
			const toFolder = settings.scopeMode === ScopeMode.File;
			setIcon(this.scopeAction, toFolder ? "folder" : "file-text");
			this.scopeAction.setAttr("aria-label", toFolder ? "切换为当前目录 TODO" : "切换为当前文件 TODO");
		}
	}

	/**
	 * 渲染空状态
	 *
	 * @param message 提示文字
	 * @param showUnpin 是否附带「解除锁定」入口（锁定目录不可用时）
	 * @return 空状态容器，用于追加其他操作入口；视图未打开时为 null
	 */
	private renderEmpty(message: string, showUnpin = false): HTMLElement | null {
		this.data = null;
		this.renderedGroupKeys = [];
		this.updateFoldAction();
		if (!this.bodyEl) {
			return null;
		}
		this.headerEl?.empty();
		this.bodyEl.empty();
		const emptyEl = this.bodyEl.createDiv({ cls: "ctv-empty", text: message });
		if (showUnpin) {
			// 解除锁定后回到跟随当前文件所在目录
			const unpinEl = emptyEl.createDiv({ cls: "ctv-empty-action", text: "解除锁定" });
			unpinEl.addEventListener("click", () => {
				this.setPinnedFolder(null);
				void this.refresh();
			});
		}
		return emptyEl;
	}

	/**
	 * 按过滤词渲染最近一次刷新得到的数据
	 */
	private renderData(): void {
		const data = this.data;
		const el = this.bodyEl;
		if (!data || !el) {
			return;
		}
		const settings = this.plugin.settings;
		const isFolder = data.mode === ScopeMode.Folder;
		el.empty();
		this.renderedGroupKeys = [];
		// 通过 CSS 变量控制长文本折叠行数
		el.style.setProperty("--ctv-max-lines", String(Math.max(1, settings.maxLines)));
		// 不自动换行时单行展示，整个列表横向滚动
		el.toggleClass("ctv-nowrap", !settings.wrapText);

		// region 过滤
		const terms = this.filterQuery.split(/\s+/).filter((t) => t.length > 0);
		const filtered: FileTodos[] = data.files
			.map((ft) => ({ file: ft.file, items: terms.length > 0 ? ft.items.filter((item) => this.matches(item, ft.file, terms, isFolder)) : ft.items }))
			// 目录范围下隐藏没有命中的文件
			.filter((ft) => !isFolder || ft.items.length > 0);
		const total = data.files.reduce((sum, ft) => sum + ft.items.length, 0);
		const matched = filtered.reduce((sum, ft) => sum + ft.items.length, 0);
		// endregion

		this.renderHeader(data, terms.length > 0 ? `${matched} / ${total} 条` : `共 ${total} 条`, isFolder ? filtered.length : 0);

		// region 空状态
		if (total === 0 || matched === 0) {
			el.createDiv({ cls: "ctv-empty", text: total === 0 ? (isFolder ? "目录下没有 TODO" : "当前文件没有 TODO") : "没有匹配的 TODO" });
			this.updateFoldAction();
			return;
		}
		// endregion

		const listEl = el.createDiv({ cls: "ctv-list" });
		if (!isFolder) {
			// 文件范围：保持原有展示方式
			const { file, items } = filtered[0];
			if (settings.displayMode === DisplayMode.Group) {
				this.renderGroups(listEl, file, items, "");
			} else {
				items.forEach((item) => this.renderItem(listEl, file, item, true, false));
			}
		} else if (settings.displayMode === DisplayMode.Group) {
			// 目录范围 + 分组：按目录树逐级分组，文件内再按标题分组
			this.renderFolderTree(listEl, filtered, data.folderPath);
		} else {
			// 目录范围 + 平铺：按文件顺序、文件内按行号顺序平铺，每条附带文件名
			filtered.forEach((ft) => ft.items.forEach((item) => this.renderItem(listEl, ft.file, item, true, true)));
		}
		this.updateFoldAction();
		// 自动换行时，布局完成后再判断哪些文本被截断，决定是否显示“展开”按钮
		if (settings.wrapText) {
			window.requestAnimationFrame(() => this.markOverflow(listEl));
		}
	}

	/**
	 * 渲染顶部摘要：范围名称（点击选择目录）、数量、上一级与目录锁定按钮
	 *
	 * @param data 渲染数据
	 * @param countText 数量文字
	 * @param fileCount 有 TODO 的文件数（目录范围下展示）
	 */
	private renderHeader(data: ScopeData, countText: string, fileCount: number): void {
		if (!this.headerEl) {
			return;
		}
		const isFolder = data.mode === ScopeMode.Folder;
		this.headerEl.empty();
		const header = this.headerEl.createDiv({ cls: "ctv-header" });
		// 范围图标 + 名称，点击弹出目录选择框
		const iconEl = header.createSpan({ cls: "ctv-header-icon" });
		setIcon(iconEl, isFolder ? "folder" : "file-text");
		const nameEl = header.createSpan({ cls: "ctv-file is-clickable", text: data.title });
		nameEl.setAttr("title", `${isFolder ? data.folderPath : data.files[0].file.path}\n点击选择其他目录`);
		nameEl.addEventListener("click", () => this.chooseFolder());
		header.createSpan({ cls: "ctv-count", text: isFolder ? `${countText} · ${fileCount} 个文件` : countText });

		if (!isFolder) {
			return;
		}
		// 包含子目录开关：开启时高亮，切换后立即重新汇总
		const subfoldersOn = this.plugin.settings.includeSubfolders;
		const subEl = header.createSpan({ cls: "ctv-header-button ctv-header-toggle clickable-icon" });
		setIcon(subEl, "folder-tree");
		subEl.toggleClass("is-active", subfoldersOn);
		subEl.setAttr("aria-label", subfoldersOn ? "已包含子目录，点击只看当前目录" : "点击包含子目录");
		subEl.addEventListener("click", () => void this.toggleSubfolders());
		// 上一级按钮：根目录没有上一级时不展示
		const parentFolder = this.app.vault.getAbstractFileByPath(data.folderPath)?.parent ?? null;
		if (parentFolder) {
			const upEl = header.createSpan({ cls: "ctv-header-button clickable-icon" });
			setIcon(upEl, "arrow-up");
			upEl.setAttr("aria-label", `切换到上一级目录：${parentFolder.isRoot() ? this.app.vault.getName() : parentFolder.name}`);
			upEl.addEventListener("click", () => void this.showFolder(parentFolder));
		}
		// 锁定按钮：锁定后不再跟随当前文件所在目录变化
		const pinEl = header.createSpan({ cls: "ctv-header-button ctv-header-pin clickable-icon" });
		setIcon(pinEl, "pin");
		pinEl.toggleClass("is-active", data.pinned);
		pinEl.setAttr("aria-label", data.pinned ? "解除锁定，跟随当前文件所在目录" : "锁定此目录");
		pinEl.addEventListener("click", () => {
			this.setPinnedFolder(data.pinned ? null : data.folderPath);
			void this.refresh();
		});
	}

	/**
	 * 弹出树形目录选择框，默认选中当前展示的目录（文件范围下为当前文件所在目录），选中后切换为目录范围并锁定该目录
	 */
	private chooseFolder(): void {
		const scope = this.resolveScope();
		// 目录范围取当前展示的目录，文件范围取当前文件所在目录
		const initial = scope.mode === ScopeMode.Folder ? scope.folder : scope.file?.parent ?? null;
		new FolderTreeModal(this.app, initial, (folder) => void this.showFolder(folder)).open();
	}

	/**
	 * 切换为目录范围并锁定指定目录
	 *
	 * @param folder 目标目录
	 */
	private async showFolder(folder: TFolder): Promise<void> {
		this.setPinnedFolder(folder.path);
		const settings = this.plugin.settings;
		// 当前为文件范围时先切换为目录范围，保存配置时会刷新所有视图
		if (settings.scopeMode !== ScopeMode.Folder) {
			settings.scopeMode = ScopeMode.Folder;
			await this.plugin.saveSettings();
			return;
		}
		await this.refresh();
	}

	/**
	 * 切换目录范围是否包含子目录，保存配置时会刷新所有视图
	 */
	private async toggleSubfolders(): Promise<void> {
		const settings = this.plugin.settings;
		settings.includeSubfolders = !settings.includeSubfolders;
		await this.plugin.saveSettings();
	}

	/**
	 * 全部展开或全部折叠：有任一分组展开时全部折叠，否则全部展开
	 */
	private toggleFoldAll(): void {
		const keys = this.renderedGroupKeys;
		if (keys.length === 0) {
			return;
		}
		// 判断当前是否已全部折叠
		const allCollapsed = keys.every((key) => this.collapsedGroups.has(key));
		if (allCollapsed) {
			this.collapsedGroups.clear();
		} else {
			keys.forEach((key) => this.collapsedGroups.add(key));
		}
		this.renderData();
	}

	/**
	 * 同步全部展开/折叠按钮的图标、提示与可用状态
	 */
	private updateFoldAction(): void {
		const action = this.foldAction;
		if (!action) {
			return;
		}
		const keys = this.renderedGroupKeys;
		// 平铺列表或没有分组时按钮不可用
		const disabled = keys.length === 0;
		const allCollapsed = !disabled && keys.every((key) => this.collapsedGroups.has(key));
		setIcon(action, allCollapsed ? "chevrons-up-down" : "chevrons-down-up");
		action.toggleClass("is-disabled", disabled);
		action.setAttr("aria-label", disabled ? "按标题分组时可全部展开/折叠" : allCollapsed ? "全部展开" : "全部折叠");
	}

	/**
	 * 判断 TODO 是否命中所有过滤词
	 *
	 * @param item TODO
	 * @param file 所属文件
	 * @param terms 小写过滤词
	 * @param withFileName 是否把文件名纳入匹配（目录范围下）
	 * @return 全部命中时为 true
	 */
	private matches(item: TodoItem, file: TFile, terms: string[], withFileName: boolean): boolean {
		// 拼接关键字、正文、下一行、标题路径与文件名后统一匹配
		const label = item.kind === TodoKind.Task ? "任务" : item.keyword;
		const parts = [label, item.text, item.nextLine ?? "", item.headingPath.join(" ")];
		if (withFileName) {
			parts.push(file.basename);
		}
		const haystack = parts.join("\n").toLowerCase();
		return terms.every((term) => haystack.includes(term));
	}

	/**
	 * 按目录树渲染：子目录逐级成组（每级单独一行），同一层先列子目录再列文件
	 *
	 * @param parent 父容器
	 * @param files 含 TODO 的文件，按路径自然排序
	 * @param folderPath 范围目录路径，文件按相对该目录的路径挂到树上
	 */
	private renderFolderTree(parent: HTMLElement, files: FileTodos[], folderPath: string): void {
		const root: FolderNode = { path: "", name: "", files: [], children: new Map(), total: 0 };
		// 沿相对目录逐级挂载文件，同时累计每级目录下的 TODO 总数
		for (const ft of files) {
			let node = root;
			const dir = relativeDir(ft.file, folderPath);
			const segments = dir.length > 0 ? dir.split("/") : [];
			segments.forEach((name, index) => {
				const path = segments.slice(0, index + 1).join("/");
				let child = node.children.get(name);
				if (!child) {
					child = { path, name, files: [], children: new Map(), total: 0 };
					node.children.set(name, child);
				}
				child.total += ft.items.length;
				node = child;
			});
			node.files.push(ft);
		}
		this.renderFolderNode(parent, root, folderPath);
	}

	/**
	 * 递归渲染目录树节点的内容：先渲染子目录分组，再渲染本目录下的文件分组
	 *
	 * @param parent 父容器
	 * @param node 目录节点
	 * @param folderPath 范围目录路径，用于拼接悬停提示中的完整路径
	 */
	private renderFolderNode(parent: HTMLElement, node: FolderNode, folderPath: string): void {
		const root = normalizeFolderPath(folderPath);
		// 子目录按名称自然排序，与 Obsidian 文件列表一致
		const children = Array.from(node.children.values()).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
		for (const child of children) {
			const fullPath = root.length > 0 ? `${root}/${child.path}` : child.path;
			const bodyEl = this.renderGroupShell(parent, `dir:${child.path}`, fullPath, child.total, GroupIcon.Folder, 0, (nameEl) => nameEl.setText(child.name));
			this.renderFolderNode(bodyEl, child, folderPath);
		}
		// 本目录下的文件已按路径排序，直接按顺序渲染
		node.files.forEach((ft) => this.renderFileGroup(parent, ft));
	}

	/**
	 * 渲染目录范围下的单个文件分组，文件内再按标题分组
	 *
	 * @param parent 父容器
	 * @param fileTodos 文件及其 TODO
	 */
	private renderFileGroup(parent: HTMLElement, fileTodos: FileTodos): void {
		const { file, items } = fileTodos;
		const bodyEl = this.renderGroupShell(parent, `file:${file.path}`, file.path, items.length, GroupIcon.File, 0, (nameEl) => {
			nameEl.addClass("ctv-group-file");
			nameEl.createSpan({ text: file.basename });
			// 附带文件后缀，与标题分组明显区分
			nameEl.createSpan({ cls: "ctv-group-ext", text: `.${file.extension}` });
		});
		this.renderGroups(bodyEl, file, items, `${file.path}|`);
	}

	/**
	 * 按标题分组渲染，根据配置选择单层路径或嵌套标题树
	 *
	 * @param parent 父容器
	 * @param file 当前文件
	 * @param items TODO 列表
	 * @param keyPrefix 分组键前缀，目录范围下用文件路径区分不同文件的同名标题
	 */
	private renderGroups(parent: HTMLElement, file: TFile, items: TodoItem[], keyPrefix: string): void {
		if (this.plugin.settings.groupStyle === GroupStyle.Nested) {
			this.renderNestedGroups(parent, file, items, keyPrefix);
		} else {
			this.renderFlatGroups(parent, file, items, keyPrefix);
		}
	}

	/**
	 * 单层分组：每个完整标题路径一组
	 *
	 * @param parent 父容器
	 * @param file 当前文件
	 * @param items TODO 列表
	 * @param keyPrefix 分组键前缀
	 */
	private renderFlatGroups(parent: HTMLElement, file: TFile, items: TodoItem[], keyPrefix: string): void {
		// 按标题路径聚合，保持首次出现顺序
		const groups = new Map<string, TodoGroup>();
		for (const item of items) {
			const key = item.headingPath.join(" > ");
			let group = groups.get(key);
			if (!group) {
				// 取最后一级标题的层级，用于展示对应数量的 `#`
				const level = item.headingLevels[item.headingLevels.length - 1] ?? 0;
				group = { key, path: item.headingPath, level, items: [] };
				groups.set(key, group);
			}
			group.items.push(item);
		}

		for (const group of groups.values()) {
			const icon = group.path.length === 0 ? GroupIcon.DocumentStart : GroupIcon.Heading;
			const bodyEl = this.renderGroupShell(parent, keyPrefix + group.key, group.key || NO_HEADING, group.items.length, icon, group.level, (nameEl) => {
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
			group.items.forEach((item) => this.renderItem(bodyEl, file, item, false, false));
		}
	}

	/**
	 * 嵌套分组：按标题层级构建树，逐级渲染
	 *
	 * @param parent 父容器
	 * @param file 当前文件
	 * @param items TODO 列表
	 * @param keyPrefix 分组键前缀
	 */
	private renderNestedGroups(parent: HTMLElement, file: TFile, items: TodoItem[], keyPrefix: string): void {
		const root: HeadingNode = { key: "", title: "", level: 0, items: [], children: new Map(), total: 0 };
		// 沿标题路径逐级挂载，同时累计每个节点下的 TODO 总数
		for (const item of items) {
			let node = root;
			node.total++;
			item.headingPath.forEach((title, index) => {
				const key = item.headingPath.slice(0, index + 1).join(" > ");
				let child = node.children.get(key);
				if (!child) {
					child = { key, title, level: item.headingLevels[index] ?? 0, items: [], children: new Map(), total: 0 };
					node.children.set(key, child);
				}
				child.total++;
				node = child;
			});
			node.items.push(item);
		}

		// 第一个标题之前的 TODO 单独成组
		if (root.items.length > 0) {
			const bodyEl = this.renderGroupShell(parent, keyPrefix, NO_HEADING, root.items.length, GroupIcon.DocumentStart, 0, (nameEl) => nameEl.setText(NO_HEADING));
			root.items.forEach((item) => this.renderItem(bodyEl, file, item, false, false));
		}
		root.children.forEach((child) => this.renderHeadingNode(parent, file, child, keyPrefix));
	}

	/**
	 * 递归渲染标题树节点：先渲染本标题下的 TODO，再渲染子标题
	 *
	 * @param parent 父容器
	 * @param file 当前文件
	 * @param node 标题节点
	 * @param keyPrefix 分组键前缀
	 */
	private renderHeadingNode(parent: HTMLElement, file: TFile, node: HeadingNode, keyPrefix: string): void {
		const bodyEl = this.renderGroupShell(parent, keyPrefix + node.key, node.key, node.total, GroupIcon.Heading, node.level, (nameEl) => nameEl.setText(node.title));
		node.items.forEach((item) => this.renderItem(bodyEl, file, item, false, false));
		node.children.forEach((child) => this.renderHeadingNode(bodyEl, file, child, keyPrefix));
	}

	/**
	 * 渲染可折叠的分组外壳（标题行 + 内容区）
	 *
	 * @param parent 父容器
	 * @param key 分组键，用于记录折叠状态
	 * @param tooltip 标题行悬停提示
	 * @param count 标题行显示的数量
	 * @param icon 分组类型图标，用于区分文件分组与标题分组
	 * @param headingLevel 标题层级（1～6），标题分组按层级展示对应数量的 `#`；非标题分组为 0
	 * @param renderName 渲染分组名称
	 * @return 分组内容区容器
	 */
	private renderGroupShell(parent: HTMLElement, key: string, tooltip: string, count: number, icon: GroupIcon, headingLevel: number, renderName: (nameEl: HTMLElement) => void): HTMLElement {
		const groupEl = parent.createDiv({ cls: "ctv-group" });
		groupEl.toggleClass("is-file-group", icon === GroupIcon.File);
		groupEl.toggleClass("is-folder-group", icon === GroupIcon.Folder);
		groupEl.toggleClass("is-collapsed", this.collapsedGroups.has(key));
		// 记录分组键，供全部展开/折叠使用
		this.renderedGroupKeys.push(key);

		// 标题行：折叠箭头 + 类型图标 + 名称 + 数量
		const titleEl = groupEl.createDiv({ cls: "ctv-group-title" });
		titleEl.setAttr("title", tooltip);
		const arrow = titleEl.createSpan({ cls: "ctv-group-arrow" });
		setIcon(arrow, "chevron-down");
		const iconEl = titleEl.createSpan({ cls: "ctv-group-icon" });
		if (icon === GroupIcon.Heading && headingLevel > 0) {
			// 标题分组按实际层级展示 `#`、`##`，与 Markdown 写法一致，避免与文件名混淆
			iconEl.addClass("ctv-group-level");
			iconEl.setText("#".repeat(headingLevel));
		} else {
			setIcon(iconEl, icon);
		}
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
			this.updateFoldAction();
		});

		return groupEl.createDiv({ cls: "ctv-group-body" });
	}

	/**
	 * 渲染单条 TODO 卡片
	 *
	 * @param parent 父容器
	 * @param file 所属文件
	 * @param item TODO
	 * @param showPath 是否在卡片中展示所属位置（平铺列表模式下展示）
	 * @param showFile 所属位置中是否包含文件名（目录范围的平铺列表下展示）
	 */
	private renderItem(parent: HTMLElement, file: TFile, item: TodoItem, showPath: boolean, showFile: boolean): void {
		const itemKey = `${file.path}:${item.line}`;
		const itemEl = parent.createDiv({ cls: "ctv-item" });
		itemEl.toggleClass("is-completed", item.completed);
		itemEl.toggleClass("is-expanded", this.expandedItems.has(itemKey));

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

		// 平铺列表模式下展示所属位置（文件名 > 标题路径），便于定位
		const headings = this.plugin.settings.showHeadingPath ? item.headingPath : [];
		if (showPath && (showFile || headings.length > 0)) {
			const pathEl = itemEl.createDiv({ cls: "ctv-item-path" });
			if (showFile) {
				pathEl.createSpan({ cls: "ctv-item-file", text: file.basename });
			}
			if (headings.length > 0) {
				pathEl.appendText(`${showFile ? " > " : ""}${headings.join(" > ")}`);
			}
		}

		// 展开/收起按钮，仅文本被截断时显示（见 markOverflow）
		const toggleEl = itemEl.createDiv({ cls: "ctv-item-toggle" });
		toggleEl.setText(this.expandedItems.has(itemKey) ? "收起" : "展开");
		toggleEl.addEventListener("click", (evt) => {
			// 阻止冒泡，避免触发跳转
			evt.stopPropagation();
			const expanded = !this.expandedItems.has(itemKey);
			if (expanded) {
				this.expandedItems.add(itemKey);
			} else {
				this.expandedItems.delete(itemKey);
			}
			itemEl.toggleClass("is-expanded", expanded);
			toggleEl.setText(expanded ? "收起" : "展开");
		});

		// 点击卡片跳转到对应文件的对应行
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

/**
 * 统一目录路径：Obsidian 根目录的路径为 `/`，转换为空字符串便于拼接比较
 *
 * @param folderPath 目录路径
 * @return 规范化后的目录路径
 */
function normalizeFolderPath(folderPath: string): string {
	// 根目录统一为空字符串
	return folderPath === "/" ? "" : folderPath;
}

/**
 * 获取文件路径所在的目录路径
 *
 * @param path 文件路径
 * @return 目录路径，位于根目录时为空字符串
 */
function parentPathOf(path: string): string {
	// 取最后一个 `/` 之前的部分
	const index = path.lastIndexOf("/");
	return index < 0 ? "" : path.slice(0, index);
}

/**
 * 判断文件路径是否位于目录下
 *
 * @param path 文件路径
 * @param folderPath 目录路径
 * @param recursive 是否包含子目录
 * @return 位于目录下时为 true
 */
function isPathInFolder(path: string, folderPath: string, recursive: boolean): boolean {
	const root = normalizeFolderPath(folderPath);
	const parent = parentPathOf(path);
	// 直接位于目录下
	if (parent === root) {
		return true;
	}
	// 包含子目录时，根目录覆盖全部文件，其他目录按路径前缀判断
	return recursive && (root === "" || parent.startsWith(`${root}/`));
}

/**
 * 计算文件所在目录相对范围目录的路径
 *
 * @param file 文件
 * @param folderPath 范围目录路径
 * @return 相对目录路径；文件直接位于范围目录下时为空字符串
 */
function relativeDir(file: TFile, folderPath: string): string {
	const root = normalizeFolderPath(folderPath);
	const parent = parentPathOf(file.path);
	// 直接位于范围目录下
	if (parent === root) {
		return "";
	}
	// 根目录范围下直接返回完整目录路径，其他目录去掉范围目录前缀
	return root === "" ? parent : parent.slice(root.length + 1);
}
