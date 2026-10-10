/**
 * 插件打包脚本：将 src/main.ts 打包为 Obsidian 可加载的 main.js
 *
 * @author 启年
 * @createTime 2026-10-10 09:23
 */
import esbuild from "esbuild";
import process from "node:process";
import { builtinModules } from "node:module";

// 是否为生产构建（生产构建一次性输出且不带 sourcemap）
const prod = process.argv[2] === "production";

const context = await esbuild.context({
	entryPoints: ["src/main.ts"],
	bundle: true,
	// Obsidian 运行时自带的模块不打包
	external: [
		"obsidian",
		"electron",
		"@codemirror/autocomplete",
		"@codemirror/collab",
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
		...builtinModules,
	],
	format: "cjs",
	target: "es2018",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	outfile: "main.js",
	minify: prod,
});

if (prod) {
	// 生产构建：构建一次后退出
	await context.rebuild();
	process.exit(0);
} else {
	// 开发模式：监听文件变化持续构建
	await context.watch();
}
