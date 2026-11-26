import UIKit
import UserNotifications
import WebKit

/// 通知（APNs）の許可・登録と、通知を押したときの画面の移動をまとめる。
final class PushManager: NSObject, UNUserNotificationCenterDelegate {
    static let shared = PushManager()
    /// 通知を押したときに開く画面（Web の #/... ）。WebViewController が受け取る
    static let openPathNotification = Notification.Name("PushOpenPath")

    /// 開発用ビルドは APNs の sandbox、App Store・TestFlight は production に届く
    #if DEBUG
    static let environment = "sandbox"
    #else
    static let environment = "production"
    #endif

    private(set) var token: String?
    private var waiters: [(String?) -> Void] = []
    /// アプリが閉じている状態で通知を押して起動したとき、画面ができるまで待っておく
    var pendingPath: String?

    func start() {
        UNUserNotificationCenter.current().delegate = self
        // すでに許可されていれば、起動のたびに登録し直してトークンを新しくする
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            if settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional {
                DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
            }
        }
    }

    func status(_ done: @escaping ([String: Any]) -> Void) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            let value: String
            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral: value = "authorized"
            case .denied: value = "denied"
            default: value = "notDetermined"
            }
            DispatchQueue.main.async {
                done(["authorization": value, "token": self.token ?? NSNull(), "env": Self.environment])
            }
        }
    }

    /// 許可を求めて登録し、トークンを返す。断られたら nil
    func enable(_ done: @escaping (String?) -> Void) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            DispatchQueue.main.async {
                guard granted else { return done(nil) }
                if let token = self.token { return done(token) }
                self.waiters.append(done)
                UIApplication.shared.registerForRemoteNotifications()
                // 登録の返事が来ないときに待ち続けない
                DispatchQueue.main.asyncAfter(deadline: .now() + 15) { self.finish(nil) }
            }
        }
    }

    func didRegister(_ deviceToken: Data) {
        token = deviceToken.map { String(format: "%02x", $0) }.joined()
        finish(token)
    }

    func didFail(_ error: Error) {
        finish(nil)
    }

    private func finish(_ token: String?) {
        let list = waiters
        waiters.removeAll()
        list.forEach { $0(token) }
    }

    // アプリを開いているときも通知をバナーで出す
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound, .list])
    }

    // 通知を押したら、その画面を開く
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        if let path = response.notification.request.content.userInfo["path"] as? String, path.hasPrefix("#/") {
            pendingPath = path
            NotificationCenter.default.post(name: Self.openPathNotification, object: path)
        }
        completionHandler()
    }
}

/// Web の `window.webkit.messageHandlers.push.postMessage({ action })` から呼ばれる。
///   action: "status" → { authorization: "authorized" | "denied" | "notDetermined", token, env }
///   action: "enable" → { token, env }（断られたら reject）
///   action: "openSettings" → iPhone の「設定」のこのアプリのページを開く
final class PushBridge: NSObject, WKScriptMessageHandlerWithReply {
    private let allowedHost: String

    init(allowedHost: String) {
        self.allowedHost = allowedHost
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.host == allowedHost else {
            return replyHandler(nil, "このページからは通知の設定ができません")
        }
        let action = (message.body as? [String: Any])?["action"] as? String
        switch action {
        case "status":
            PushManager.shared.status { replyHandler($0, nil) }
        case "enable":
            PushManager.shared.enable { token in
                if let token {
                    replyHandler(["token": token, "env": PushManager.environment], nil)
                } else {
                    replyHandler(nil, "denied")
                }
            }
        case "openSettings":
            if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
            replyHandler(true, nil)
        default:
            replyHandler(nil, "不明な操作です")
        }
    }
}
