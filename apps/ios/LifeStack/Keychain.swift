import Foundation
import Security

// The API key lives in the Keychain, never in UserDefaults or on disk in plain text.
enum Keychain {
    private static let service = "app.lifestack.key"
    private static let account = "api-key"

    // The group the app and its widgets share (set from the build, so no team id lives in the source).
    private static var group: String? {
        let g = Bundle.main.object(forInfoDictionaryKey: "LSKeychainGroup") as? String
        return g?.contains("$(") == false ? g : nil
    }

    private static var base: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    static func read() -> String? {
        var query = base
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    @discardableResult
    static func save(_ value: String) -> Bool {
        delete()
        var query = base
        if let group { query[kSecAttrAccessGroup as String] = group }
        query[kSecValueData as String] = Data(value.utf8)
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(query as CFDictionary, nil) == errSecSuccess
    }

    // A key saved before widgets existed sits in the app's own group; move it where the widgets can read it.
    static func shareWithWidgets() {
        if let key = read() { save(key) }
    }

    static func delete() {
        SecItemDelete(base as CFDictionary)
    }
}
