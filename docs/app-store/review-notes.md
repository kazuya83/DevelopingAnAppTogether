# 審査メモ（App Store Connect「App Review に関する情報」→ メモ に英語で貼る）

- サインインが必要：**いいえ**（一覧と詳細はログインなしで見られる。投稿・いいね・コメントには登録が要るが、審査の方がその場で作れる）
- デモアカウント：なし（パスキーは端末に結び付くため、共有のアカウントは作れない。下のとおりその場で登録できる）
- 連絡先：名前・電話・メールは App Store Connect に直接入れる

---

Thank you for reviewing "みんなでアプリ開発" (Developing an App Together).

WHAT THE APP IS
A community app where users grow this single app together. Users post feature ideas ("proposals"), other users like them, and when a proposal gets enough likes it is accepted for development. Accepted ideas are implemented by the developer with the help of AI (Claude) and then appear in the app. Each proposal page shows its progress (waiting / in development / in review / released). The app's screens are our own service, served from our server and shown in the app.

HOW TO TRY IT (no demo account needed)
1. Open the "ユーザ" (User) tab, enter any username (3-20 letters, numbers or _), and tap "パスキーを作って登録" (Create passkey and register). Face ID / Touch ID is used; no password or email is required. iCloud Keychain must be enabled on the device for passkeys.
2. Open the "議論" (Discussion) tab and tap "提案する" (Propose) to post an idea. After posting, the app asks once whether to enable notifications.
3. Like or comment on proposals from the proposal page.
4. Settings: "ユーザ" tab -> slider icon at the top right.

NATIVE FEATURES
- Push notifications (APNs): users are notified when their proposal is accepted, when development starts, when it is released, and when someone comments on it. Tapping a notification opens that proposal. Toggle: Settings -> "通知".
- Passkeys handled natively with AuthenticationServices (Associated Domains: webcredentials).
- Pull to refresh, an offline screen with retry, and external links opened in Safari View Controller.

USER-GENERATED CONTENT (Guideline 1.2)
- Users must agree to the Terms of Use when they register (link on the registration screen). The terms prohibit objectionable content and abusive users (zero tolerance).
- Report: "..." menu on any proposal, comment or user -> "通報" (Report).
- Block: "..." menu on a user's profile -> "ブロックする" (Block). Blocked users' content is hidden.
- Moderation: reports notify the administrator immediately by push notification; the administrator reviews them in Settings and removes the objectionable proposals or comments within 24 hours.
- Ideas that ask to change login or posting rules, attack the service, or delete the app are rejected automatically.

ACCOUNT DELETION (Guideline 5.1.1(v))
"ユーザ" tab -> slider icon (Settings) -> "アカウントを削除" (Delete account). This deletes the account, passkeys, likes, comments, notification tokens and proposals that have not been accepted.

DATA
- No tracking, no ads, no in-app purchases.
- Proposals and comments are public. Accepted proposals (title, body, username) are also published as public GitHub issues; this is explained in the Privacy Policy and the Terms.
- Privacy Policy: https://developing-an-app-together.minna-dev.workers.dev/legal/privacy
- Terms of Use: https://developing-an-app-together.minna-dev.workers.dev/legal/terms
- Support: https://developing-an-app-together.minna-dev.workers.dev/legal/support
