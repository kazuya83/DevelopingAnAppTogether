import SwiftUI

@main
struct DevelopingAnAppTogetherApp: App {
    var body: some Scene {
        WindowGroup {
            WebContainer()
                .ignoresSafeArea() // 余白は Web 側（env(safe-area-inset-*)）で取る
        }
    }
}

/// 画面はすべて Web（Cloudflare Workers から配信）で作る。アプリはそれを表示するだけ。
struct WebContainer: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> WebViewController {
        WebViewController(startURL: AppConfig.webAppURL)
    }

    func updateUIViewController(_ uiViewController: WebViewController, context: Context) {}
}

enum AppConfig {
    /// Info.plist の WebAppURL（project.yml の WEB_APP_DOMAIN から作られる）
    static var webAppURL: URL {
        guard let value = Bundle.main.object(forInfoDictionaryKey: "WebAppURL") as? String,
              let url = URL(string: value) else {
            fatalError("Info.plist の WebAppURL が正しくありません")
        }
        return url
    }
}
