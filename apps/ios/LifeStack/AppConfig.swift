import Foundation

// Preferences that can be changed from the web or by an assistant without a new app version. They are fetched when the app opens and
// kept, so the app still has the last values when offline. Only numbers are kept here; the server validates every value.
enum AppConfig {
    private static let prefix = "cfg."

    static func number(_ key: String, fallback: Double) -> Double {
        let v = UserDefaults.standard.double(forKey: prefix + key)
        return v > 0 ? v : fallback
    }

    @MainActor
    static func refresh(_ model: AppModel) async {
        guard let client = model.client, let values = try? await client.settings() else { return }
        for (key, value) in values where key.hasPrefix("location.") {
            if let n = value as? NSNumber, n.doubleValue > 0 { UserDefaults.standard.set(n.doubleValue, forKey: prefix + key) }
        }
    }
}
