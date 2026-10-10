/**
 * 测试脚本：用 esbuild 打包解析器测试用例后在 Node 中执行
 *
 * @author 启年
 * @createTime 2026-10-10 09:23
 */
import esbuild from "esbuild";
import { createRequire } from "node:module";

// 测试产物输出到 .cache，避免污染插件目录
const outfile = ".cache/parser.test.cjs";
await esbuild.build({
	entryPoints: ["test/parser.test.ts"],
	bundle: true,
	platform: "node",
	format: "cjs",
	outfile,
	logLevel: "warning",
});
// 执行测试文件
createRequire(import.meta.url)(`../${outfile}`);
