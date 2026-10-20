/**
 * 插件入口：注册侧边栏视图、功能区图标、命令与事件监听
 *
 * @author 启年
 * @createTime 2026-10-10 09:23
 */
import { MarkdownView, Plugin, TAbstractFile, TFile, TFolder, Vault, WorkspaceLeaf, debounce } from "obsidian";
import { parseTodos } from "./parser";
import { TodoSettingTab } from "./settings";
import { DEFAULT_SETTINGS, FileTodos, FolderTodos, ScopeMode, TodoItem, TodoSettings, VIEW_TYPE_TODO } from "./types";
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

	/** 解析缓存：文件路径 → 解析时的修改时间与结果，目录汇总时只重新解析有变化的文件 */
	private readonly todoCache = new Map<string, { mtime: number; items: TodoItem[] }>();
	/** 缓存对应的解析配置签名，解析相关配置变化时整体失效 */
	private cacheSignature = "";
	/** 编辑中尚未落盘的内容：文件路径 → 编辑事件触发时的编辑器全文；只在编辑事件中写入，保证内容与文件一一对应 */
	private readonly liveContent = new Map<string, string>();

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
		this.addCommand({
			id: "open-current-folder-todo",
			name: "显示当前目录 TODO",
			callback: () => void this.showFolderTodos(null),
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
		// 编辑文件：记录编辑器内容，范围内的文件防抖刷新
		this.registerEvent(
			this.app.workspace.on("editor-change", (editor, info) => {
				if (!info.file) {
					return;
				}
				// 编辑事件中的编辑器与文件一定对应，切换笔记的中间状态不会混入其他文件的内容
				this.liveContent.set(info.file.path, editor.getValue());
				if (this.isInScope(info.file.path)) {
					this.debouncedRefresh();
				}
			}),
		);
		// 文件落盘或在外部被修改（如同步）时，丢弃编辑内容与缓存，改为读取磁盘内容并刷新
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				this.liveContent.delete(file.path);
				this.todoCache.delete(file.path);
				if (this.isInScope(file.path)) {
					this.debouncedRefresh();
				}
			}),
		);
		// 重命名：同步锁定目录路径，刷新标题中的文件名与目录内容
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				this.dropCache(file, oldPath);
				this.getTodoViews().forEach((view) => view.handleRename(file, oldPath));
				if (file instanceof TFolder || file === this.currentFile || this.isInScope(file.path) || this.isInScope(oldPath)) {
					this.refreshViews();
				}
			}),
		);
		// 删除：当前文件被删除时清空，范围内的文件被删除时刷新
		this.registerEvent(
			this.app.vault.on("delete", (file: TAbstractFile) => {
				this.dropCache(file, file.path);
				if (file === this.currentFile) {
					this.setCurrentFile(null);
				}
				// 锁定目录的视图不依赖当前文件，需要单独判断是否刷新
				if (file instanceof TFolder || this.isInScope(file.path)) {
					this.refreshViews();
				}
			}),
		);
		// 右键菜单：目录查看并锁定该目录的 TODO，笔记查看并锁定其所在目录的 TODO
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (file instanceof TFolder) {
					menu.addItem((item) =>
						item
							.setTitle("查看该目录 TODO")
							.setIcon("list-todo")
							.onClick(() => void this.showFolderTodos(file)),
					);
					return;
				}
				// 只为 Markdown 笔记添加，附件等文件不处理
				const folder = file instanceof TFile && file.extension === "md" ? file.parent : null;
				if (folder) {
					menu.addItem((item) =>
						item
							.setTitle("查看所在目录 TODO")
							.setIcon("list-todo")
							.onClick(() => void this.showFolderTodos(folder)),
					);
				}
			}),
		);
		// endregion

		this.app.workspace.onLayoutReady(() => {
			// 初始化当前文件
			this.currentFile = this.app.workspace.getActiveFile();
			// 新建文件：放在布局就绪后注册，避免启动时为库中每个已有文件触发一次
			this.registerEvent(
				this.app.vault.on("create", (file) => {
					if (file instanceof TFile && this.isInScope(file.path)) {
						this.debouncedRefresh();
					}
				}),
			);
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
		// 只刷新依赖当前文件的视图，锁定目录的视图内容不受影响，避免跳转时闪烁
		this.getTodoViews()
			.filter((view) => view.dependsOnCurrentFile())
			.forEach((view) => void view.refresh());
	}

	/**
	 * 获取所有已加载的 TODO 视图（尚未加载的延迟视图不包含在内）
	 *
	 * @return TODO 视图列表
	 */
	private getTodoViews(): TodoView[] {
		// 只保留真正实例化的视图
		return this.app.workspace
			.getLeavesOfType(VIEW_TYPE_TODO)
			.map((leaf) => leaf.view)
			.filter((view): view is TodoView => view instanceof TodoView);
	}

	/**
	 * 刷新所有已打开的 TODO 视图
	 */
	refreshViews(): void {
		this.getTodoViews().forEach((view) => void view.refresh());
	}

	/**
	 * 判断文件是否落在任一 TODO 视图的展示范围内，用于决定文件变化时是否需要刷新
	 *
	 * @param path 文件路径
	 * @return 在任一视图范围内时为 true
	 */
	private isInScope(path: string): boolean {
		// 任一视图覆盖该路径即需要刷新
		return this.getTodoViews().some((view) => view.coversPath(path));
	}

	/**
	 * 丢弃文件或目录对应的解析缓存
	 *
	 * @param file 被重命名或删除的文件/目录
	 * @param path 缓存使用的路径（重命名时为旧路径）
	 */
	private dropCache(file: TAbstractFile, path: string): void {
		// 目录变化会影响其下所有文件的路径，直接清空
		if (file instanceof TFolder) {
			this.todoCache.clear();
			this.liveContent.clear();
			return;
		}
		this.todoCache.delete(path);
		this.liveContent.delete(path);
	}

	/**
	 * 解析相关配置变化时清空缓存，展示类配置变化不影响缓存
	 */
	private ensureCacheSignature(): void {
		const s = this.settings;
		// 只把影响解析结果的配置纳入签名
		const signature = JSON.stringify([s.keywords, s.caseSensitive, s.matchTags, s.includeTasks, s.showCompleted, s.scanCodeBlocks, s.showNextLine]);
		if (signature !== this.cacheSignature) {
			this.todoCache.clear();
			this.cacheSignature = signature;
		}
	}

	/**
	 * 解析单个文件：有尚未落盘的编辑内容时解析编辑内容，否则优先使用缓存
	 *
	 * @param file 目标文件
	 * @return TODO 列表
	 */
	private async parseFile(file: TFile): Promise<TodoItem[]> {
		// 编辑内容尚未保存，每次都重新解析，保证与正在输入的内容一致
		const live = this.liveContent.get(file.path);
		if (live !== undefined) {
			return parseTodos(live, this.settings);
		}
		// 修改时间未变时直接复用缓存
		const cached = this.todoCache.get(file.path);
		if (cached && cached.mtime === file.stat.mtime) {
			return cached.items;
		}
		const items = parseTodos(await this.app.vault.cachedRead(file), this.settings);
		this.todoCache.set(file.path, { mtime: file.stat.mtime, items });
		return items;
	}

	/**
	 * 解析文件中的 TODO，优先使用编辑中尚未保存的内容
	 *
	 * @param file 目标文件
	 * @return TODO 列表
	 */
	async collectTodos(file: TFile): Promise<TodoItem[]> {
		this.ensureCacheSignature();
		return this.parseFile(file);
	}

	/**
	 * 汇总目录下所有 Markdown 文件的 TODO
	 *
	 * @param folder 目标目录
	 * @return 含 TODO 的文件列表（按路径自然排序）、文件总数与是否超过扫描上限
	 */
	async collectFolderTodos(folder: TFolder): Promise<FolderTodos> {
		const files = this.listMarkdownFiles(folder, this.settings.includeSubfolders);
		// 文件数超过上限时不扫描，避免误选整个库导致卡顿
		if (files.length > this.settings.maxFolderFiles) {
			return { files: [], fileCount: files.length, overLimit: true };
		}
		this.ensureCacheSignature();
		const results: FileTodos[] = await Promise.all(files.map(async (file) => ({ file, items: await this.parseFile(file) })));
		// 只保留有 TODO 的文件，并按路径自然排序，使「2、xxx」排在「10、xxx」之前
		const withTodos = results
			.filter((result) => result.items.length > 0)
			.sort((a, b) => a.file.path.localeCompare(b.file.path, undefined, { numeric: true, sensitivity: "base" }));
		return { files: withTodos, fileCount: files.length, overLimit: false };
	}

	/**
	 * 列出目录下的 Markdown 文件
	 *
	 * @param folder 目标目录
	 * @param recursive 是否包含子目录
	 * @return Markdown 文件列表
	 */
	private listMarkdownFiles(folder: TFolder, recursive: boolean): TFile[] {
		const files: TFile[] = [];
		const collect = (file: TAbstractFile) => {
			// 只收集 Markdown 文件
			if (file instanceof TFile && file.extension === "md") {
				files.push(file);
			}
		};
		if (recursive) {
			Vault.recurseChildren(folder, collect);
		} else {
			folder.children.forEach(collect);
		}
		return files;
	}

	/**
	 * 打开或聚焦侧边栏 TODO 视图
	 *
	 * @return 视图实例；无法创建时为 null
	 */
	async activateView(): Promise<TodoView | null> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_TODO)[0] ?? null;
		if (!leaf) {
			// 视图不存在时在右侧边栏新建
			leaf = workspace.getRightLeaf(false);
			if (!leaf) {
				return null;
			}
			await leaf.setViewState({ type: VIEW_TYPE_TODO, active: true });
		}
		// 展示视图，延迟加载的视图会在此时实例化
		await workspace.revealLeaf(leaf);
		return leaf.view instanceof TodoView ? leaf.view : null;
	}

	/**
	 * 切换为目录范围并展示视图
	 *
	 * @param folder 要锁定的目录；为 null 时解除锁定，跟随当前文件所在目录
	 */
	async showFolderTodos(folder: TFolder | null): Promise<void> {
		// 切换为目录范围并持久化
		this.settings.scopeMode = ScopeMode.Folder;
		await this.saveData(this.settings);
		const view = await this.activateView();
		view?.setPinnedFolder(folder ? folder.path : null);
		this.refreshViews();
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
