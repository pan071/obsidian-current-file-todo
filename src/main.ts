/**
 * 插件入口：注册侧边栏视图、功能区图标、命令与事件监听
 *
 * @author 启年
 * @createTime 2026-10-10 09:23
 */
import { MarkdownView, Plugin, TAbstractFile, TFile, WorkspaceLeaf, debounce } from "obsidian";
import { parseTodos } from "./parser";
import { TodoSettingTab } from "./settings";
import { DEFAULT_SETTINGS, TodoItem, TodoSettings, VIEW_TYPE_TODO } from "./types";
import { TodoView } from "./view";

/**
 * 当前文件 TODO 插件，跟踪最近激活的文件并在侧边栏展示其 TODO
 *
 * @author 启年
 * @createTime 2026-10-10 09:23
 */
export default class CurrentFileTodoPlugin extends Plugin {
	/** 插件配置 */
	settings: TodoSettings = { ...DEFAULT_SETTINGS };
	/** 当前跟踪的文件（侧边栏获得焦点时仍保留上一个文件） */
	currentFile: TFile | null = null;

	/** 编辑过程中的防抖刷新，避免每输入一个字符就重新解析 */
	private readonly debouncedRefresh = debounce(() => this.refreshViews(), 300, true);

	/**
	 * 插件加载
	 */
	async onload(): Promise<void> {
		await this.loadSettings();

		// region 视图、图标、命令、设置页
		this.registerView(VIEW_TYPE_TODO, (leaf) => new TodoView(leaf, this));
		this.addRibbonIcon("list-todo", "查看当前文件 TODO", () => void this.activateView());
		this.addCommand({
			id: "open-current-file-todo",
			name: "显示当前文件 TODO",
			callback: () => void this.activateView(),
		});
		this.addSettingTab(new TodoSettingTab(this.app, this));
		// endregion

		// region 事件监听
		// 切换标签页：只跟踪文件视图，侧边栏视图获得焦点时不改变当前文件
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				if (leaf && leaf.view instanceof MarkdownView && leaf.view.file) {
					this.setCurrentFile(leaf.view.file);
				}
			}),
		);
		// 打开文件（包括同一标签页内切换文件）
		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				if (file) {
					this.setCurrentFile(file);
				}
			}),
		);
		// 编辑当前文件时防抖刷新
		this.registerEvent(
			this.app.workspace.on("editor-change", (_editor, info) => {
				if (info.file && info.file === this.currentFile) {
					this.debouncedRefresh();
				}
			}),
		);
		// 文件在外部被修改（如同步）时刷新
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (file === this.currentFile) {
					this.debouncedRefresh();
				}
			}),
		);
		// 重命名后刷新标题中的文件名
		this.registerEvent(
			this.app.vault.on("rename", (file) => {
				if (file === this.currentFile) {
					this.refreshViews();
				}
			}),
		);
		// 当前文件被删除时清空
		this.registerEvent(
			this.app.vault.on("delete", (file: TAbstractFile) => {
				if (file === this.currentFile) {
					this.setCurrentFile(null);
				}
			}),
		);
		// endregion

		this.app.workspace.onLayoutReady(() => {
			// 初始化当前文件
			this.currentFile = this.app.workspace.getActiveFile();
			// 首次安装时把视图放进右侧边栏，使图标出现在顶部标签栏中；之后由 Obsidian 布局自动保存
			if (!this.settings.viewInitialized) {
				void this.initRightSidebarView();
			}
			this.refreshViews();
		});
	}

	/**
	 * 插件卸载
	 */
	onunload(): void {
		// 视图由 Obsidian 自动卸载，这里无需处理
	}

	/**
	 * 加载配置，缺失字段使用默认值
	 */
	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	/**
	 * 保存配置并刷新视图
	 */
	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.refreshViews();
	}

	/**
	 * 切换当前跟踪的文件
	 *
	 * @param file 新文件；为 null 时清空
	 */
	private setCurrentFile(file: TFile | null): void {
		// 同一文件不重复刷新
		if (file === this.currentFile) {
			return;
		}
		this.currentFile = file;
		this.refreshViews();
	}

	/**
	 * 刷新所有已打开的 TODO 视图
	 */
	refreshViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TODO)) {
			if (leaf.view instanceof TodoView) {
				void leaf.view.refresh();
			}
		}
	}

	/**
	 * 解析文件中的 TODO，优先读取编辑器中尚未保存的内容
	 *
	 * @param file 目标文件
	 * @return TODO 列表
	 */
	async collectTodos(file: TFile): Promise<TodoItem[]> {
		const view = this.findMarkdownLeaf(file)?.view;
		// 文件已在编辑器中打开时取编辑器内容，保证与正在输入的内容一致
		const content = view instanceof MarkdownView ? view.getViewData() : await this.app.vault.cachedRead(file);
		return parseTodos(content, this.settings);
	}

	/**
	 * 打开或聚焦侧边栏 TODO 视图
	 */
	async activateView(): Promise<void> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_TODO)[0] ?? null;
		if (!leaf) {
			// 视图不存在时在右侧边栏新建
			leaf = workspace.getRightLeaf(false);
			if (!leaf) {
				return;
			}
			await leaf.setViewState({ type: VIEW_TYPE_TODO, active: true });
		}
		await workspace.revealLeaf(leaf);
	}

	/**
	 * 首次安装时在右侧边栏创建视图（不抢占焦点）
	 */
	private async initRightSidebarView(): Promise<void> {
		if (this.app.workspace.getLeavesOfType(VIEW_TYPE_TODO).length === 0) {
			const leaf = this.app.workspace.getRightLeaf(false);
			if (leaf) {
				await leaf.setViewState({ type: VIEW_TYPE_TODO, active: false });
			}
		}
		// 记录已初始化，用户之后关闭视图不再自动添加
		this.settings.viewInitialized = true;
		await this.saveData(this.settings);
	}

	/**
	 * 跳转到文件的指定行
	 *
	 * @param file 目标文件
	 * @param line 行号（从 0 开始）
	 */
	async jumpTo(file: TFile, line: number): Promise<void> {
		const { workspace } = this.app;
		let leaf = this.findMarkdownLeaf(file);
		if (!leaf) {
			// 文件未打开时在主区域打开
			leaf = workspace.getLeaf(false);
			await leaf.openFile(file);
		}
		workspace.setActiveLeaf(leaf, { focus: true });
		const view = leaf.view;
		if (view instanceof MarkdownView && view.getMode() === "source") {
			// 编辑模式：定位光标并滚动到可视区域中间
			const pos = { line, ch: 0 };
			view.editor.setCursor(pos);
			view.editor.scrollIntoView({ from: pos, to: pos }, true);
			view.editor.focus();
		} else {
			// 阅读模式：通过临时状态滚动到对应行
			leaf.setEphemeralState({ line });
		}
	}

	/**
	 * 查找已打开指定文件的 Markdown 标签页
	 *
	 * @param file 目标文件
	 * @return 标签页；未打开时为 null
	 */
	private findMarkdownLeaf(file: TFile): WorkspaceLeaf | null {
		// 优先使用最近激活的 Markdown 视图
		const active = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (active && active.file === file) {
			return active.leaf;
		}
		const leaves = this.app.workspace.getLeavesOfType("markdown");
		return leaves.find((l) => l.view instanceof MarkdownView && l.view.file === file) ?? null;
	}
}
