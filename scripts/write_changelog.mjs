// js/version.js の更新ログから CHANGELOG.md を作る。実行：npm run changelog
import { writeFileSync } from "node:fs";
import { changelogMarkdown, VERSION_LABEL } from "../js/version.js";

const path = new URL("../CHANGELOG.md", import.meta.url);
writeFileSync(path, changelogMarkdown());
console.log(`CHANGELOG.md を書き出しました（現在のバージョン：${VERSION_LABEL}）`);
