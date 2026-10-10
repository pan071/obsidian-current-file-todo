/**
 * 安装脚本：把构建产物复制到指定 Obsidian 仓库的插件目录
 *
 * @author 启年
 * @createTime 2026-10-10 09:23
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

// 目标仓库路径，可通过环境变量 OBSIDIAN_VAULT 覆盖
const vault = process.env.OBSIDIAN_VAULT || "/path/to/vault";
// 插件 ID 取自 manifest.json，保证目录名与 ID 一致
const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const target = path.join(vault, ".obsidian", "plugins", manifest.id);

// 确保插件目录存在
fs.mkdirSync(target, { recursive: true });
// 逐个复制 Obsidian 加载插件所需的文件
for (const file of ["main.js", "manifest.json", "styles.css"]) {
	fs.copyFileSync(file, path.join(target, file));
	console.log(`已复制 ${file} -> ${target}`);
}
