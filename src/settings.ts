/**
 * 插件设置页：关键字、大小写、识别范围、汇总范围、展示方式等配置
 *
 * @author 启年
 * @createTime 2026-10-10 09:23
 */
import { App, PluginSettingTab, Setting } from "obsidian";
import type CurrentFileTodoPlugin from "./main";
import { DisplayMode, GroupStyle, ScopeMode } from "./types";

/**
 * 插件设置页，修改后立即保存并刷新侧边栏视图
 *
 * @author 启年
 * @createTime 2026-10-10 09:23
 */
export class TodoSettingTab extends PluginSettingTab {
	/** 插件实例 */
	private readonly plugin: CurrentFileTodoPlugin;

	/**
	 * 创建设置页
	 *
	 * @param app Obsidian 应用实例
	 * @param plugin 插件实例
	 */
	constructor(app: App, plugin: CurrentFileTodoPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/**
	 * 渲染设置项
	 */
	display(): void {
		const { containerEl } = this;
		const settings = this.plugin.settings;
		containerEl.empty();

		// region 识别规则
		new Setting(containerEl).setName("识别规则").setHeading();

		new Setting(containerEl)
			.setName("关键字")
			.setDesc("多个关键字用英文逗号分隔，如 TODO, FIXME。按整词匹配，TODOS、todolist 不会被识别。")
			.addText((text) =>
				text
					.setPlaceholder("TODO")
					.setValue(settings.keywords.join(", "))
					.onChange(async (value) => {
						// 拆分并去除空项
						settings.keywords = value.split(/[,，]/).map((k) => k.trim()).filter((k) => k.length > 0);
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("区分大小写")
			.setDesc("开启后只识别与关键字大小写完全一致的写法（如只认 TODO），可避免英文正文中的 todo 被误识别。")
			.addToggle((toggle) =>
				toggle.setValue(settings.caseSensitive).onChange(async (value) => {
					settings.caseSensitive = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("识别标签")
			.setDesc("识别 #todo、#TODO 等标签写法（与 Obsidian 标签一致，不区分大小写）。")
			.addToggle((toggle) =>
				toggle.setValue(settings.matchTags).onChange(async (value) => {
					settings.matchTags = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("识别 Markdown 任务")
			.setDesc("识别 - [ ] xxx 形式的标准任务。")
			.addToggle((toggle) =>
				toggle.setValue(settings.includeTasks).onChange(async (value) => {
					settings.includeTasks = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("显示已完成任务")
			.setDesc("显示 - [x] xxx 形式的已完成任务。")
			.addToggle((toggle) =>
				toggle.setValue(settings.showCompleted).onChange(async (value) => {
					settings.showCompleted = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("扫描代码块")
			.setDesc("识别代码块中 // TODO、# TODO 等注释形式的关键字。")
			.addToggle((toggle) =>
				toggle.setValue(settings.scanCodeBlocks).onChange(async (value) => {
					settings.scanCodeBlocks = value;
					await this.plugin.saveSettings();
				}),
			);
		// endregion

		// region 汇总范围
		new Setting(containerEl).setName("汇总范围").setHeading();

		new Setting(containerEl)
			.setName("默认范围")
			.setDesc("当前文件只展示正在查看的笔记；当前目录汇总其所在目录下所有笔记的 TODO。也可以通过侧边栏顶部按钮切换，或在文件列表中右键目录选择「查看该目录 TODO」锁定目录。")
			.addDropdown((dropdown) =>
				dropdown
					.addOption(ScopeMode.File, "当前文件")
					.addOption(ScopeMode.Folder, "当前目录")
					.setValue(settings.scopeMode)
					.onChange(async (value) => {
						settings.scopeMode = value as ScopeMode;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("包含子目录")
			.setDesc("目录范围下同时汇总所有子目录中的笔记。")
			.addToggle((toggle) =>
				toggle.setValue(settings.includeSubfolders).onChange(async (value) => {
					settings.includeSubfolders = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("目录扫描文件上限")
			.setDesc("目录范围下 Markdown 文件数超过该值时不扫描，避免误选整个库导致卡顿。")
			.addText((text) => {
				text.inputEl.type = "number";
				text.inputEl.min = "1";
				text
					.setPlaceholder("500")
					.setValue(String(settings.maxFolderFiles))
					.onChange(async (value) => {
						// 只接受正整数，非法输入时保留原值
						const limit = Number.parseInt(value, 10);
						if (!Number.isFinite(limit) || limit < 1) {
							return;
						}
						settings.maxFolderFiles = limit;
						await this.plugin.saveSettings();
					});
			});
		// endregion

		// region 展示方式
		new Setting(containerEl).setName("展示方式").setHeading();

		new Setting(containerEl)
			.setName("默认展示模式")
			.setDesc("也可以通过侧边栏顶部按钮随时切换。")
			.addDropdown((dropdown) =>
				dropdown
					.addOption(DisplayMode.List, "平铺列表")
					.addOption(DisplayMode.Group, "按标题分组")
					.setValue(settings.displayMode)
					.onChange(async (value) => {
						settings.displayMode = value as DisplayMode;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("展示行号")
			.setDesc("在每条 TODO 右侧展示所在行号，如 L128。")
			.addToggle((toggle) =>
				toggle.setValue(settings.showLineNumber).onChange(async (value) => {
					settings.showLineNumber = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("平铺列表展示所属标题")
			.setDesc("平铺列表模式下，在每条 TODO 下方展示所属标题路径，如「提成设置 > 复活」。")
			.addToggle((toggle) =>
				toggle.setValue(settings.showHeadingPath).onChange(async (value) => {
					settings.showHeadingPath = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("分组样式")
			.setDesc("按标题分组时生效。嵌套标题树按标题层级逐级折叠；标题路径则每个完整路径一组。")
			.addDropdown((dropdown) =>
				dropdown
					.addOption(GroupStyle.Nested, "嵌套标题树")
					.addOption(GroupStyle.Flat, "标题路径（单层）")
					.setValue(settings.groupStyle)
					.onChange(async (value) => {
						settings.groupStyle = value as GroupStyle;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("展示下一行")
			.setDesc("在 TODO 下方附带展示下一个非空行的内容（遇到标题或另一条 TODO 时不展示）。")
			.addToggle((toggle) =>
				toggle.setValue(settings.showNextLine).onChange(async (value) => {
					settings.showNextLine = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("TODO 文本自动换行")
			.setDesc("关闭时每条 TODO 单行展示，超出部分通过整个列表的横向滚动查看；开启时自动换行，并按下方行数折叠长文本。")
			.addToggle((toggle) =>
				toggle.setValue(settings.wrapText).onChange(async (value) => {
					settings.wrapText = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("长文本折叠行数")
			.setDesc("开启自动换行时生效，超过该行数的内容会折叠，可点击“展开”查看全文。")
			.addSlider((slider) =>
				slider
					.setLimits(1, 10, 1)
					.setValue(settings.maxLines)
					.setDynamicTooltip()
					.onChange(async (value) => {
						settings.maxLines = value;
						await this.plugin.saveSettings();
					}),
			);
		// endregion
	}
}
