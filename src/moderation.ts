/**
 * 受け付けない提案を見分ける（投稿のときに使う）。
 *
 * 提案は、いいねが集まると GitHub Issue になり、Mac の Claude が自動で開発する。
 * そのため、次のような提案は入口で止める。
 *   - リポジトリや GitHub の設定・ルールファイル・自動化の仕組みを変えさせるもの
 *   - プロンプトインジェクションや攻撃（AI への指示の上書き、コマンド実行、情報の持ち出しなど）
 *   - このアプリやデータを消す・止めるもの
 *
 * ここは言葉で判定する 1 段目。言い換えたものは、Mac の仕組みが開発を始める前に Claude で判定する（2 段目）。
 */

export interface RejectReason {
  category: "repository" | "attack" | "destroy";
  message: string;
}

const MESSAGES: Record<RejectReason["category"], string> = {
  repository:
    "GitHub のリポジトリ・設定・ルールファイル・自動化の仕組みを変える提案は受け付けていません。アプリの画面や機能についての提案をお願いします。",
  attack:
    "AI への指示の上書きや、攻撃につながる内容を含む提案は受け付けていません。アプリの画面や機能についての提案をお願いします。",
  destroy: "このアプリやデータを消す・止める提案は受け付けていません。",
};

const RULES: { category: RejectReason["category"]; patterns: RegExp[] }[] = [
  {
    category: "repository",
    patterns: [
      /\.github/,
      /githubactions|ワークフロー|workflow/,
      /claude\.md|agents\.md|\.claude|cursorrules|copilot-instructions/,
      /wrangler(\.jsonc?|\.toml)|package(-lock)?\.json|\.dev\.vars|\.env\b/,
      /issue-?worker|scripts\//,
      /ブランチ保護|branchprotection|rulesets?|codeowners|dependabot/,
      /(リポジトリ|repository|repo|github)の?(設定|ルール|権限|ラベル|secret|シークレット|コラボレーター|collaborator|オーナー|owner|公開範囲|可視性)/,
      /(secret|シークレット|apiキー|apikey|トークン|token|認証情報|credential)を?(見せ|表示|出力|教え|送|書き出|変更|追加|削除|公開)/,
      /(自動|auto)マージ|automerge|レビューを?(飛ばし|省略|無効|スキップ)|ci(を|の)?(止め|無効|スキップ|外)/,
    ],
  },
  {
    category: "attack",
    patterns: [
      /(ignore|disregard|forget|override)(all|any|the)?(previous|prior|above|earlier|your|system)?(instructions?|prompts?|rules?)/,
      /(以前|前|上|これまで|最初|今まで|あなた)の?(指示|命令|ルール|プロンプト|制約|設定)を?(無視|忘れ|破棄|上書き|取り消)/,
      /(指示|命令|ルール|制約)を?(無視|忘れ)/,
      /systemprompt|システムプロンプト|jailbreak|脱獄|開発者モード|developermode/,
      /(あなた|you)は(今から|これから|もう).{0,20}(ではない|として振る舞|になりきっ|です)/,
      /rm-rf|(^|[^a-z])sudo[a-z]|chmod|curl(https?:|-)|wget|nc-e|\/bin\/(ba)?sh|powershell|base64-?d/,
      /<script|javascript:|onerror=|onload=|document\.cookie|eval\(|newfunction\(/,
      /droptable|deletefrom|truncatetable|unionselect|;--|' ?or ?'?1'?=/,
      /バックドア|backdoor|マルウェア|malware|ランサム|ransom|ウイルスを|キーロガー|keylogger|フィッシング|phishing|クリプトマイ|cryptomin|マイニングを/,
      /ddos|dos攻撃|サービス妨害|ブルートフォース|bruteforce|総当たり/,
      /(パスワード|パスキー|セッション|cookie|クッキー|個人情報|メールアドレス|ユーザ(ー)?(の)?(情報|データ))を?(盗|抜き|送信|外部に|集め|収集|流出|漏)/,
      /(外部|別|他)の?(サーバ|url|サイト)に?(送信|送る|転送)/,
      /ハッキング|ハックして|hackthe|exploit|脆弱性を(突|利用|悪用)|権限昇格|管理者権限を(付与|与え|ちょうだい)|adminに(して|する)/,
    ],
  },
  {
    category: "destroy",
    patterns: [
      /(アプリ|サービス|サイト|プロジェクト|リポジトリ|repository|repo)(自体|そのもの|全体)?を?(消し|消す|消去|削除|閉鎖|廃止|潰|破壊|無くし|なくし)/,
      /(この|本)(アプリ|サービス|サイト|プロジェクト|リポジトリ)(自体|そのもの|全体)?を(終了|停止|止め|壊)/,
      /(アプリ|サービス|サイト|プロジェクト)(自体|そのもの|全体)?を(終了|停止|止め)(させ|して|する|てほし|てくだ|ろ|よう)/,
      /(全て|すべて|全部|全)の?(データ|ユーザ(ー)?|アカウント|投稿|提案|コメント|コード|ファイル|issue)を?(消|削除|初期化|リセット|壊)/,
      /(データベース|db|d1|テーブル)を?(消|削除|空に|初期化|リセット|壊|drop)/,
      /(delete|remove|destroy|shutdown|shut ?down|wipe|erase)(the|this|all)?(app|application|service|site|project|repo|repository|database|data|users|accounts)/,
      /(コード|ソース|ファイル)を?(全部|すべて|全て)(消|削除)/,
    ],
  },
];

/** 判定しやすい形にそろえる（全角→半角、大文字→小文字、空白を除く） */
function normalize(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[\s​-‍﻿]+/g, "");
}

/** 受け付けない提案なら理由を返す。問題なければ null */
export function checkProposal(title: string, body: string): RejectReason | null {
  const text = normalize(`${title}\n${body}`);
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(text))) {
      return { category: rule.category, message: MESSAGES[rule.category] };
    }
  }
  return null;
}
