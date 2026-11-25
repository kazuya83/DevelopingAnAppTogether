// prompt.md の {{NUMBER}} {{TITLE}} {{BODY}} を Issue の中身で置き換えて出力する。
// Issue の本文はユーザが書いた文章なので、区切りの文字列を含んでいたら崩して、区切りの外に出られないようにする。
import { readFileSync } from "node:fs";

const [templatePath, issuePath, number] = process.argv.slice(2);
const issue = JSON.parse(readFileSync(issuePath, "utf8"));
const neutralize = (s) => String(s ?? "").replace(/ISSUE_(START|END)/g, "ISSUE_$1_");
const values = { NUMBER: number, TITLE: neutralize(issue.title), BODY: neutralize(issue.body) };
// 置き換えは 1 回だけ（本文に {{…}} が含まれていても再び置き換えない）
const out = readFileSync(templatePath, "utf8").replace(/\{\{(NUMBER|TITLE|BODY)\}\}/g, (_, k) => values[k]);
process.stdout.write(out);
