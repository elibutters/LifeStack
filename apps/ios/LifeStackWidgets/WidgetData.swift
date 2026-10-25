import Foundation
import SwiftUI
import WidgetKit

// Widgets fetch their own data (the key comes from the shared Keychain) and keep the last good answer to show when offline.
enum WidgetData {
    static var client: APIClient? {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "LSBaseURL") as? String, !raw.contains("$("),
              let url = APIClient.parse(address: raw), let key = Keychain.read() else { return nil }
        return APIClient(base: url, key: key)
    }

    private static let defaults = UserDefaults.standard
    private static func key(_ path: String) -> String { "cache:" + path }
    private static func stamp(_ path: String) -> String { "cacheAt:" + path }
    private static let dirtyKey = "optimisticUntil"

    // The answer for a path. `cacheOnly` skips the network (used right after a tap, when the cache already holds the new state);
    // `maxAge` reuses a cached answer that is recent enough, so slow-changing data is not fetched on every redraw. Otherwise it is the
    // fresh answer, or the last one kept when offline, or nil.
    static func load<T: Decodable>(_ type: T.Type, path: String, query: [URLQueryItem] = [], maxAge: TimeInterval = 0, cacheOnly: Bool = false) async -> (value: T?, signedIn: Bool) {
        guard let client else { return (nil, false) }
        let cached = defaults.data(forKey: key(path)).flatMap { try? JSONDecoder().decode(T.self, from: $0) }
        if cacheOnly, let cached { return (cached, true) }
        let at = defaults.double(forKey: stamp(path))
        if maxAge > 0, let cached, Date().timeIntervalSince1970 - at < maxAge { return (cached, true) }
        if let data = try? await client.rawGet(path, query), let v = try? JSONDecoder().decode(T.self, from: data) {
            defaults.set(data, forKey: key(path))
            defaults.set(Date().timeIntervalSince1970, forKey: stamp(path))
            return (v, true)
        }
        return (cached, true)
    }

    // ---- instant feedback for the tap-to-log buttons
    // A tap writes its result into the cached overview first and redraws from that, so the widget changes at once; the real request
    // finishes behind it. While the change is fresh, redraws read the cache instead of the network.
    enum Change {
        case mood(Int)
        case coffee(mg: Double)
        case supplements(names: [String], taken: Bool)
    }

    static func endOptimistic() { defaults.removeObject(forKey: dirtyKey) }

    static func applyLocal(_ change: Change) {
        let path = key("api/v1/overview")
        guard let data = defaults.data(forKey: path), var root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return }
        var log = root["log"] as? [String: Any] ?? [:]
        switch change {
        case .mood(let v):
            let old = (log["mood"] as? [String: Any])?["count"] as? Int ?? 0
            log["mood"] = ["value": v, "count": old + 1]
        case .coffee(let mg):
            var c = log["caffeine"] as? [String: Any] ?? ["count": 0, "mg": 0.0]
            c["count"] = (c["count"] as? Int ?? 0) + 1
            c["mg"] = (c["mg"] as? Double ?? 0) + mg
            log["caffeine"] = c
        case .supplements(let names, let taken):
            var list = (log["supplements"] as? [[String: Any]]) ?? []
            if taken {
                let have = Set(list.compactMap { ($0["name"] as? String)?.lowercased() })
                for n in names where !have.contains(n.lowercased()) { list.append(["name": n, "count": 1]) }
                list = list.map { var e = $0; if (e["count"] as? Int ?? 0) == 0 { e["count"] = 1 }; return e }
            } else {
                list = []
            }
            log["supplements"] = list
        }
        root["log"] = log
        guard log["date"] != nil || (root["log"] as? [String: Any]) != nil, let out = try? JSONSerialization.data(withJSONObject: root) else { return }
        defaults.set(out, forKey: path)
        defaults.set(Date().timeIntervalSince1970 + 30, forKey: dirtyKey)
    }

    // ---- the dropdown-style pickers: a widget cannot show a real menu, so a tap on a picker stores which one is open and the widget
    // redraws expanded. It closes itself after 20 seconds, when something is chosen, or when tapped again.
    private static let menuKey = "widgetMenu"
    static var openMenu: String? {
        guard let d = defaults.dictionary(forKey: menuKey), let until = d["until"] as? Double, until > Date().timeIntervalSince1970 else { return nil }
        return d["name"] as? String
    }
    static func setMenu(_ name: String?) {
        if let name { defaults.set(["name": name, "until": Date().timeIntervalSince1970 + 20], forKey: menuKey) } else { defaults.removeObject(forKey: menuKey) }
    }
    static var showingOptimistic: Bool { defaults.double(forKey: dirtyKey) > Date().timeIntervalSince1970 || openMenu != nil }

    static func cachedOverview() -> Overview? { defaults.data(forKey: key("api/v1/overview")).flatMap { try? JSONDecoder().decode(Overview.self, from: $0) } }
    static func cachedOptions() -> LogOptions? { defaults.data(forKey: key("api/v1/log/options")).flatMap { try? JSONDecoder().decode(LogOptions.self, from: $0) } }

    static let refresh: TimeInterval = 30 * 60
}

enum WColor {
    static let bg = Color(red: 0.039, green: 0.039, blue: 0.043)
    static let muted = Color.white.opacity(0.55)
    static let blue = Color(red: 0.30, green: 0.44, blue: 1.0)
    static let violet = Color(red: 0.56, green: 0.48, blue: 0.94)
    static let sky = Color(red: 0.66, green: 0.76, blue: 1.0)
    static let good = Color(red: 0.20, green: 0.83, blue: 0.60)
    static let gradient = LinearGradient(colors: [blue, violet], startPoint: .topLeading, endPoint: .bottomTrailing)
}

struct Ring: View {
    let fraction: Double
    var width: CGFloat = 8
    var body: some View {
        ZStack {
            Circle().stroke(Color.white.opacity(0.12), lineWidth: width)
            Circle().trim(from: 0, to: max(0.02, min(1, fraction))).stroke(WColor.gradient, style: StrokeStyle(lineWidth: width, lineCap: .round)).rotationEffect(.degrees(-90))
        }
    }
}

struct SignedOut: View {
    var body: some View {
        VStack(spacing: 4) {
            Image(systemName: "lock").font(.title3)
            Text("Open Life Stack to sign in").font(.caption2).multilineTextAlignment(.center)
        }.foregroundStyle(WColor.muted)
    }
}
