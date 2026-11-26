import SwiftUI
import UIKit

/// 通知（APNs）の登録の結果を受け取る
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        PushManager.shared.start()
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        PushManager.shared.didRegister(deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        PushManager.shared.didFail(error)
    }
}

@main
struct DevelopingAnAppTogetherApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

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
