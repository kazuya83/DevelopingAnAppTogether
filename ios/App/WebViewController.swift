import SafariServices
import UIKit
import WebKit

final class WebViewController: UIViewController {
    private let startURL: URL
    private var webView: WKWebView!
    private let errorView = ErrorView()
    private var hasLoadedOnce = false

    init(startURL: URL) {
        self.startURL = startURL
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor { $0.userInterfaceStyle == .dark
            ? UIColor(red: 0x10 / 255, green: 0x10 / 255, blue: 0x14 / 255, alpha: 1)
            : UIColor(red: 0xF6 / 255, green: 0xF6 / 255, blue: 0xF8 / 255, alpha: 1) }

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default() // ログインの Cookie をアプリを閉じても残す
        config.allowsInlineMediaPlayback = true
        config.applicationNameForUserAgent = "DevelopingAnAppTogether-iOS"
        // パスキーはアプリ側（AuthenticationServices）で扱う。Web からは window.webkit.messageHandlers.passkey で呼ぶ
        let passkey = PasskeyBridge(allowedHost: startURL.host ?? "", anchorView: view)
        config.userContentController.addScriptMessageHandler(passkey, contentWorld: .page, name: "passkey")
        // 通知の許可と登録。Web からは window.webkit.messageHandlers.push で呼ぶ
        let push = PushBridge(allowedHost: startURL.host ?? "")
        config.userContentController.addScriptMessageHandler(push, contentWorld: .page, name: "push")

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isOpaque = false // 読み込み前に白く光らないようにする
        webView.backgroundColor = .clear
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        // 画面の移動はアプリの「戻る」ボタンで行う。左右のスワイプで履歴を戻る・進むのはやめる
        webView.allowsBackForwardNavigationGestures = false
        // リンクやアイコンを長押ししたときに、リンク先のプレビューやメニューを出さない
        webView.allowsLinkPreview = false
        #if DEBUG
        if #available(iOS 16.4, *) { webView.isInspectable = true } // Mac の Safari から調べられるようにする
        #endif

        let refresh = UIRefreshControl()
        refresh.addTarget(self, action: #selector(pullToRefresh(_:)), for: .valueChanged)
        webView.scrollView.refreshControl = refresh

        webView.translatesAutoresizingMaskIntoConstraints = false
        errorView.translatesAutoresizingMaskIntoConstraints = false
        errorView.isHidden = true
        errorView.onRetry = { [weak self] in self?.retry() }
        view.addSubview(webView)
        view.addSubview(errorView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            errorView.topAnchor.constraint(equalTo: view.topAnchor),
            errorView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            errorView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            errorView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])

        // 通知を押して起動したときは、その画面から開く
        var first = startURL
        if let path = PushManager.shared.pendingPath, let url = appURL(path) {
            first = url
            PushManager.shared.pendingPath = nil
        }
        webView.load(URLRequest(url: first, cachePolicy: .reloadRevalidatingCacheData))

        NotificationCenter.default.addObserver(forName: PushManager.openPathNotification, object: nil, queue: .main) { [weak self] note in
            guard let self, let path = note.object as? String, let url = self.appURL(path) else { return }
            PushManager.shared.pendingPath = nil
            self.webView.load(URLRequest(url: url))
        }
    }

    /// 通知に入っている #/... を、Web の URL にする
    private func appURL(_ path: String) -> URL? {
        guard path.hasPrefix("#/") else { return nil }
        return URL(string: startURL.absoluteString + path)
    }

    @objc private func pullToRefresh(_ sender: UIRefreshControl) {
        webView.reload()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { sender.endRefreshing() }
    }

    private func retry() {
        errorView.isHidden = true
        if hasLoadedOnce, webView.url != nil {
            webView.reload()
        } else {
            webView.load(URLRequest(url: startURL, cachePolicy: .reloadRevalidatingCacheData))
        }
    }

    /// 自分の Web 以外の URL は Safari で開く
    private func isAppURL(_ url: URL) -> Bool {
        if url.scheme == "about" || url.scheme == "blob" || url.scheme == "data" { return true }
        return url.host == startURL.host && url.scheme == startURL.scheme
    }

    private func openExternally(_ url: URL) {
        if url.scheme == "http" || url.scheme == "https" {
            present(SFSafariViewController(url: url), animated: true)
        } else {
            UIApplication.shared.open(url)
        }
    }
}

extension WebViewController: WKNavigationDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { return decisionHandler(.cancel) }
        if isAppURL(url) || navigationAction.targetFrame?.isMainFrame == false {
            decisionHandler(.allow)
        } else {
            openExternally(url)
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        hasLoadedOnce = true
        errorView.isHidden = true
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showError(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showError(error)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    private func showError(_ error: Error) {
        if (error as NSError).code == NSURLErrorCancelled { return }
        errorView.isHidden = false
    }
}

extension WebViewController: WKUIDelegate {
    /// target="_blank" のリンクは Safari で開く
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            if isAppURL(url) { webView.load(navigationAction.request) } else { openExternally(url) }
        }
        return nil
    }

    // WKWebView は alert / confirm / prompt を自分で出す必要がある
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        presentAlert(alert, orElse: completionHandler)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "キャンセル", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        presentAlert(alert) { completionHandler(false) }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        alert.addTextField { $0.text = defaultText }
        alert.addAction(UIAlertAction(title: "キャンセル", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in
            completionHandler(alert.textFields?.first?.text ?? "")
        })
        presentAlert(alert) { completionHandler(nil) }
    }

    private func presentAlert(_ alert: UIAlertController, orElse fallback: @escaping () -> Void) {
        guard viewIfLoaded?.window != nil, presentedViewController == nil else { return fallback() }
        present(alert, animated: true)
    }
}

/// 通信できないときの画面
private final class ErrorView: UIView {
    var onRetry: (() -> Void)?

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .systemGroupedBackground

        let icon = UIImageView(image: UIImage(systemName: "wifi.exclamationmark"))
        icon.tintColor = .secondaryLabel
        icon.preferredSymbolConfiguration = .init(pointSize: 44)

        let label = UILabel()
        label.text = "読み込めませんでした\n通信できる場所でもう一度お試しください"
        label.numberOfLines = 0
        label.textAlignment = .center
        label.textColor = .secondaryLabel

        var config = UIButton.Configuration.filled()
        config.title = "再読み込み"
        config.cornerStyle = .large
        let button = UIButton(configuration: config, primaryAction: UIAction { [weak self] _ in self?.onRetry?() })

        let stack = UIStackView(arrangedSubviews: [icon, label, button])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: centerYAnchor),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: leadingAnchor, constant: 24),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }
}
