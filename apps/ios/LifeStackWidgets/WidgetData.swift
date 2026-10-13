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

    // The fresh answer, or the last one kept, or nil if neither exists.
    static func load<T: Decodable>(_ type: T.Type, path: String, query: [URLQueryItem] = []) async -> (value: T?, signedIn: Bool) {
        let cacheKey = "cache:" + path
        guard let client else { return (nil, false) }
        if let data = try? await client.rawGet(path, query), let v = try? JSONDecoder().decode(T.self, from: data) {
            UserDefaults.standard.set(data, forKey: cacheKey)
            return (v, true)
        }
        if let data = UserDefaults.standard.data(forKey: cacheKey), let v = try? JSONDecoder().decode(T.self, from: data) { return (v, true) }
        return (nil, true)
    }

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
