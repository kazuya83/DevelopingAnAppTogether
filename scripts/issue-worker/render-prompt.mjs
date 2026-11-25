// プロンプトのひな形の {{NUMBER}} {{TITLE}} {{BODY}} {{DIFF}} を置き換えて出力する。
//   node render-prompt.mjs <ひな形> <issue.json> <番号> [差分のファイル]
// Issue の本文や差分はユーザ由来の文章なので、区切りの文字列を含んでいたら崩して、区切りの外に出られないようにする。
import { readFileSync } from "node:fs";

const [templatePath, issuePath, number, diffPath] = process.argv.slice(2);
const issue = JSON.parse(readFileSync(issuePath, "utf8"));
const neutralize = (s) => String(s ?? "").replace(/(ISSUE|DIFF)_(START|END)/g, "$1_$2_");
const values = {
  NUMBER: number,
  TITLE: neutralize(issue.title),
  BODY: neutralize(issue.body),
  DIFF: diffPath ? neutralize(readFileSync(diffPath, "utf8")) : "",
};
// 置き換えは 1 回だけ（本文に {{…}} が含まれていても再び置き換えない）
const out = readFileSync(templatePath, "utf8").replace(/\{\{(NUMBER|TITLE|BODY|DIFF)\}\}/g, (_, k) => values[k]);
process.stdout.write(out);
