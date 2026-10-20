/**
 * 目录选择弹窗：以树形结构展示库中的目录，选中后汇总该目录的 TODO
 *
 * @author 启年
 * @createTime 2026-10-20 13:41
 */
import { App, Modal, SearchComponent, TFolder, setIcon } from "obsidian";

/**
 * 树形目录选择弹窗，默认选中传入的目录并展开其所有上级目录，支持搜索过滤与键盘操作
 *
 * @author 启年
 * @createTime 2026-10-20 13:41
 */
export class FolderTreeModal extends Modal {
	/** 选中目录后的回调 */
	private readonly onChoose: (folder: TFolder) => void;
	/** 已展开的目录路径 */
	private readonly expanded = new Set<string>();
	/** 当前选中的目录 */
	private selected: TFolder;
	/** 搜索词（小写），为空时展示完整目录树 */
	private query = "";
	/** 目录树容器 */
	private treeEl: HTMLElement | null = null;
	/** 本次渲染出的可见目录及其行元素，按展示顺序排列，用于键盘上下移动 */
	private rows: { folder: TFolder; rowEl: HTMLElement }[] = [];

	/**
	 * 创建目录选择弹窗
	 *
	 * @param app Obsidian 应用实例
	 * @param initial 默认选中的目录；为 null 时选中根目录
	 * @param onChoose 选中目录后的回调
	 */
	constructor(app: App, initial: TFolder | null, onChoose: (folder: TFolder) => void) {
		super(app);
		this.onChoose = onChoose;
		this.selected = initial ?? app.vault.getRoot();
		// 展开默认目录的所有上级目录，使其在树中可见
		let parent = this.selected.parent;
		while (parent) {
			this.expanded.add(parent.path);
			parent = parent.parent;
		}
		// 根目录始终展开
		this.expanded.add(app.vault.getRoot().path);
	}

	/**
	 * 弹窗打开时创建搜索框、目录树并注册键盘操作
	 */
	onOpen(): void {
		this.modalEl.addClass("ctv-folder-modal");
		this.titleEl.setText("选择要汇总 TODO 的目录");

		// 搜索框：按路径过滤目录，命中目录的上级目录自动展开
		const search = new SearchComponent(this.contentEl)
			.setPlaceholder("搜索目录，空格分隔多个词")
			.onChange((value) => {
				this.query = value.trim().toLowerCase();
				this.renderTree();
			});
		search.inputEl.addClass("ctv-folder-search");
		this.treeEl = this.contentEl.createDiv({ cls: "ctv-folder-tree" });

		// region 键盘操作：上下移动、左右折叠展开、回车确认
		this.scope.register([], "ArrowDown", () => this.moveSelection(1));
		this.scope.register([], "ArrowUp", () => this.moveSelection(-1));
		this.scope.register([], "ArrowRight", (evt) => this.expandSelected(evt, true));
		this.scope.register([], "ArrowLeft", (evt) => this.expandSelected(evt, false));
		this.scope.register([], "Enter", () => {
			this.choose(this.selected);
			return false;
		});
		// endregion

		this.renderTree();
		// 默认选中的目录滚动到可视区域中间
		this.scrollToSelected("center");
		search.inputEl.focus();
	}

	/**
	 * 弹窗关闭时清理内容
	 */
	onClose(): void {
		this.contentEl.empty();
		this.treeEl = null;
		this.rows = [];
	}

	/**
	 * 重新渲染目录树
	 */
	private renderTree(): void {
		const treeEl = this.treeEl;
		if (!treeEl) {
			return;
		}
		treeEl.empty();
		this.rows = [];
		const root = this.app.vault.getRoot();
		const terms = this.query.split(/\s+/).filter((t) => t.length > 0);
		// 有搜索词时只展示命中目录及其上级目录
		const visible = terms.length > 0 ? this.collectMatches(root, terms) : null;
		this.renderNode(treeEl, root, 0, visible);
		if (this.rows.length === 0) {
			treeEl.createDiv({ cls: "ctv-folder-empty", text: "没有匹配的目录" });
			return;
		}
		// 选中目录被过滤掉时，改为选中第一个可见目录
		if (!this.rows.some((row) => row.folder === this.selected)) {
			this.select(this.rows[0].folder);
		}
	}

	/**
	 * 递归渲染目录节点
	 *
	 * @param parent 父容器
	 * @param folder 目录
	 * @param depth 层级深度，根目录为 0
	 * @param visible 搜索时需要展示的目录路径；为 null 时不过滤
	 */
	private renderNode(parent: HTMLElement, folder: TFolder, depth: number, visible: Set<string> | null): void {
		// 搜索时跳过不需要展示的目录
		if (visible && !visible.has(folder.path)) {
			return;
		}
		const subfolders = sortedSubfolders(folder);
		// 搜索时自动展开所有可见目录，否则按展开状态
		const isExpanded = visible !== null || this.expanded.has(folder.path);

		// 行：折叠箭头 + 目录图标 + 名称
		const rowEl = parent.createDiv({ cls: "ctv-folder-row" });
		rowEl.style.paddingLeft = `${depth * 16 + 4}px`;
		rowEl.toggleClass("is-selected", folder === this.selected);
		rowEl.setAttr("title", folder.isRoot() ? "/" : folder.path);
		const arrowEl = rowEl.createSpan({ cls: "ctv-folder-arrow" });
		if (subfolders.length > 0) {
			setIcon(arrowEl, "chevron-right");
			arrowEl.toggleClass("is-expanded", isExpanded);
			// 点击箭头只展开/折叠，不选择目录
			arrowEl.addEventListener("click", (evt) => {
				evt.stopPropagation();
				this.toggleExpanded(folder);
			});
		}
		const iconEl = rowEl.createSpan({ cls: "ctv-folder-icon" });
		setIcon(iconEl, isExpanded && subfolders.length > 0 ? "folder-open" : "folder");
		rowEl.createSpan({ cls: "ctv-folder-name", text: folder.isRoot() ? this.app.vault.getName() : folder.name });
		// 点击行直接选择该目录
		rowEl.addEventListener("click", () => this.choose(folder));
		this.rows.push({ folder, rowEl });

		if (isExpanded) {
			subfolders.forEach((child) => this.renderNode(parent, child, depth + 1, visible));
		}
	}

	/**
	 * 收集搜索时需要展示的目录：路径命中全部搜索词的目录及其所有上级目录
	 *
	 * @param root 根目录
	 * @param terms 小写搜索词
	 * @return 需要展示的目录路径集合
	 */
	private collectMatches(root: TFolder, terms: string[]): Set<string> {
		const visible = new Set<string>();
		const walk = (folder: TFolder): boolean => {
			// 先递归子目录，任一子目录可见则本目录也需要展示
			let hasVisibleChild = false;
			for (const child of sortedSubfolders(folder)) {
				if (walk(child)) {
					hasVisibleChild = true;
				}
			}
			const path = folder.path.toLowerCase();
			const matched = !folder.isRoot() && terms.every((term) => path.includes(term));
			if (matched || hasVisibleChild) {
				visible.add(folder.path);
				return true;
			}
			return false;
		};
		walk(root);
		return visible;
	}

	/**
	 * 展开或折叠目录并重新渲染
	 *
	 * @param folder 目录
	 */
	private toggleExpanded(folder: TFolder): void {
		if (this.expanded.has(folder.path)) {
			this.expanded.delete(folder.path);
		} else {
			this.expanded.add(folder.path);
		}
		this.renderTree();
	}

	/**
	 * 选中目录并高亮对应行
	 *
	 * @param folder 目录
	 */
	private select(folder: TFolder): void {
		this.selected = folder;
		// 只切换高亮，不重新渲染
		this.rows.forEach((row) => row.rowEl.toggleClass("is-selected", row.folder === folder));
	}

	/**
	 * 键盘上下移动选中项
	 *
	 * @param step 移动步长，1 为向下，-1 为向上
	 * @return false，阻止默认行为
	 */
	private moveSelection(step: number): false {
		const index = this.rows.findIndex((row) => row.folder === this.selected);
		const next = this.rows[Math.min(this.rows.length - 1, Math.max(0, index + step))];
		if (next) {
			this.select(next.folder);
			this.scrollToSelected("nearest");
		}
		return false;
	}

	/**
	 * 键盘左右展开或折叠选中目录；搜索框有内容时保留光标移动
	 *
	 * @param evt 键盘事件
	 * @param expand true 为展开，false 为折叠
	 * @return 处理时返回 false 阻止默认行为，否则返回 true
	 */
	private expandSelected(evt: KeyboardEvent, expand: boolean): boolean {
		// 搜索框有内容时左右键用于移动光标
		if (this.query.length > 0) {
			return true;
		}
		const folder = this.selected;
		if (expand) {
			// 未展开时展开，已展开时不处理
			if (!this.expanded.has(folder.path) && sortedSubfolders(folder).length > 0) {
				this.toggleExpanded(folder);
			}
		} else if (this.expanded.has(folder.path) && !folder.isRoot()) {
			// 已展开时折叠
			this.toggleExpanded(folder);
		} else if (folder.parent) {
			// 已折叠时跳到上级目录
			this.select(folder.parent);
			this.scrollToSelected("nearest");
		}
		evt.preventDefault();
		return false;
	}

	/**
	 * 把选中目录滚动到可视区域
	 *
	 * @param block 滚动对齐方式
	 */
	private scrollToSelected(block: ScrollLogicalPosition): void {
		const row = this.rows.find((r) => r.folder === this.selected);
		row?.rowEl.scrollIntoView({ block });
	}

	/**
	 * 确认选择目录并关闭弹窗
	 *
	 * @param folder 选中的目录
	 */
	private choose(folder: TFolder): void {
		this.close();
		this.onChoose(folder);
	}
}

/**
 * 获取目录下的直接子目录，按名称自然排序
 *
 * @param folder 目录
 * @return 子目录列表
 */
function sortedSubfolders(folder: TFolder): TFolder[] {
	// 只保留目录，按名称自然排序，使「2、xxx」排在「10、xxx」之前
	return folder.children
		.filter((child): child is TFolder => child instanceof TFolder)
		.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
}
