// App Store のスクリーンショット（Dynamic Island（中）の欄：1179×2556、透明なし）を作る
//   node docs/app-store/screenshots/source/gen.mjs <playwright のあるフォルダ>
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(process.argv[2] + "/")("playwright");
const SHOTS = [
  ["01", "main", 'この1つのアプリを、<br><span class="grad">みんなで育てる。</span>', "中身はまだ「hope」だけ。<br>ここから先は、あなたの提案で。"],
  ["02", "new", '「あったらいいな」を<br><span class="grad">書くだけ。</span>', "むずかしい知識はいりません。<br>ひとことでも OK。"],
  ["03", "list", 'いいねで、<br><span class="grad">作るものが決まる。</span>', "いいなと思った提案を、押して応援。"],
  ["04", "developing", '裏で AI が、<br><span class="grad">開発スタート。</span>', "進み具合はアプリで見られて、<br>通知でも知らせます。"],
  ["05", "released", 'このアプリが、<br><span class="grad">少しずつ育つ。</span>', "できあがったら、そのまま反映。<br>開くたびに、ちょっと変わります。"],
];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1179, height: 2556 }, deviceScaleFactor: 1 });
for (const [n, img, h, sub] of SHOTS) {
  const url = "file://" + join(here, "frame.html") + "?" + new URLSearchParams({ img, h, p: sub });
  await p.goto(url);
  await p.waitForTimeout(400);
  const tmp = join(here, `../${n}.tmp.png`), out = join(here, `../${n}-${img}.png`);
  await p.screenshot({ path: tmp });
  // 透明（アルファ）なしの RGB にする
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", tmp, "-vf", "format=rgb24", out]);
  execFileSync("rm", [tmp]);
}
await b.close();
