import AuthenticationServices
import UIKit
import WebKit

/// Web 側の `window.webkit.messageHandlers.passkey.postMessage(...)` から呼ばれ、
/// iOS のパスキー機能（AuthenticationServices）でパスキーを作る・使う。
/// WKWebView の WebAuthn は条件がそろわないと理由なしに断るので、アプリ側で直接扱う。
///
/// 受け取るもの: `{ type: "create" | "get", options: <サーバーが返した WebAuthn のオプション（JSON）> }`
/// 返すもの: サーバーにそのまま送れる WebAuthn の応答（JSON）。失敗したら理由の文字列で reject する。
final class PasskeyBridge: NSObject, WKScriptMessageHandlerWithReply {
    private let allowedHost: String
    private weak var anchorView: UIView?
    private var controller: ASAuthorizationController?
    private var reply: ((Any?, String?) -> Void)?

    init(allowedHost: String, anchorView: UIView) {
        self.allowedHost = allowedHost
        self.anchorView = anchorView
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        // 自分の Web のページからだけ受け付ける
        guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.host == allowedHost else {
            return replyHandler(nil, "このページからはパスキーを使えません")
        }
        guard reply == nil else { return replyHandler(nil, "パスキーの処理中です") }
        guard let body = message.body as? [String: Any],
              let type = body["type"] as? String,
              let options = body["options"] as? [String: Any],
              let challenge = (options["challenge"] as? String).flatMap(Data.init(base64URL:)) else {
            return replyHandler(nil, "パスキーのオプションが正しくありません")
        }
        let rpID = (options["rpId"] as? String) ?? ((options["rp"] as? [String: Any])?["id"] as? String) ?? allowedHost
        guard rpID == allowedHost else { return replyHandler(nil, "RP ID がドメインと一致しません: \(rpID)") }

        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rpID)
        let request: ASAuthorizationRequest
        switch type {
        case "create":
            guard let user = options["user"] as? [String: Any],
                  let name = user["name"] as? String,
                  let userID = (user["id"] as? String).flatMap(Data.init(base64URL:)) else {
                return replyHandler(nil, "ユーザ情報が正しくありません")
            }
            let r = provider.createCredentialRegistrationRequest(challenge: challenge, name: name, userID: userID)
            r.userVerificationPreference = .preferred
            if #available(iOS 17.4, *), let exclude = options["excludeCredentials"] as? [[String: Any]] {
                r.excludedCredentials = exclude.compactMap { ($0["id"] as? String).flatMap(Data.init(base64URL:)) }
                    .map { ASAuthorizationPlatformPublicKeyCredentialDescriptor(credentialID: $0) }
            }
            request = r
        case "get":
            let r = provider.createCredentialAssertionRequest(challenge: challenge)
            r.userVerificationPreference = .preferred
            if let allow = options["allowCredentials"] as? [[String: Any]], !allow.isEmpty {
                r.allowedCredentials = allow.compactMap { ($0["id"] as? String).flatMap(Data.init(base64URL:)) }
                    .map { ASAuthorizationPlatformPublicKeyCredentialDescriptor(credentialID: $0) }
            }
            request = r
        default:
            return replyHandler(nil, "不明な操作です: \(type)")
        }

        reply = replyHandler
        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        self.controller = controller
        controller.performRequests()
    }

    private func finish(_ value: Any?, _ error: String?) {
        reply?(value, error)
        reply = nil
        controller = nil
    }
}

extension PasskeyBridge: ASAuthorizationControllerDelegate {
    func authorizationController(controller: ASAuthorizationController,
                                 didCompleteWithAuthorization authorization: ASAuthorization) {
        if let c = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialRegistration {
            guard let attestation = c.rawAttestationObject else { return finish(nil, "パスキーの作成結果を読めませんでした") }
            let id = c.credentialID.base64URL
            finish([
                "id": id, "rawId": id, "type": "public-key", "authenticatorAttachment": "platform",
                "clientExtensionResults": [String: Any](),
                "response": [
                    "clientDataJSON": c.rawClientDataJSON.base64URL,
                    "attestationObject": attestation.base64URL,
                    "transports": ["internal", "hybrid"],
                ],
            ], nil)
        } else if let c = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion {
            let id = c.credentialID.base64URL
            finish([
                "id": id, "rawId": id, "type": "public-key", "authenticatorAttachment": "platform",
                "clientExtensionResults": [String: Any](),
                "response": [
                    "clientDataJSON": c.rawClientDataJSON.base64URL,
                    "authenticatorData": c.rawAuthenticatorData.base64URL,
                    "signature": c.signature.base64URL,
                    "userHandle": c.userID.base64URL,
                ],
            ], nil)
        } else {
            finish(nil, "対応していないパスキーの種類です")
        }
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        let e = error as NSError
        // Web 側はこの番号でキャンセルかどうかを見分ける
        finish(nil, "ASAuthorizationError \(e.code): \(e.localizedDescription)")
    }
}

extension PasskeyBridge: ASAuthorizationControllerPresentationContextProviding {
    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        anchorView?.window ?? ASPresentationAnchor()
    }
}

extension Data {
    init?(base64URL s: String) {
        var b64 = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        b64 += String(repeating: "=", count: (4 - b64.count % 4) % 4)
        self.init(base64Encoded: b64)
    }

    var base64URL: String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
