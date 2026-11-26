// 画面で使うアイコン（線の SVG）。絵文字や記号の文字は端末ごとに見た目が変わるので使わない。
// タブバーのアイコンと同じく、24×24・線の太さ 2・角は丸。

const PATHS = {
  back: '<path d="m15 18-6-6 6-6"/>',
  more: '<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  heart:
    '<path class="fillable" d="M12 20.5s-7.5-4.6-9.3-9.4C1.4 7.6 3.6 4 7.2 4c2 0 3.5 1.1 4.8 2.8C13.3 5.1 14.8 4 16.8 4c3.6 0 5.8 3.6 4.5 7.1-1.8 4.8-9.3 9.4-9.3 9.4z"/>',
  comment: '<path d="M20 15.5a2 2 0 0 1-2 2H8.5L4 21V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z"/>',
  trophy:
    '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 6h2.5a.5.5 0 0 1 .5.5V7a4 4 0 0 1-3.2 3.9M7 6H4.5a.5.5 0 0 0-.5.5V7a4 4 0 0 0 3.2 3.9"/>',
  settings:
    '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.2 2.4 2.4 4.6-5"/>',
  issue: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
};

/** アイコンの SVG。filled: true で中を塗る（いいね済みのハートなど） */
export function icon(name, { size = 18, filled = false, cls = "" } = {}) {
  return `<svg class="icon${filled ? " filled" : ""}${cls ? ` ${cls}` : ""}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
}
