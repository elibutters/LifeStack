import AppIntents
import WidgetKit

// The buttons on the large widget. Each one sends the same event the app does, with the key from the shared Keychain, then asks
// the widgets to refresh so the new state shows. These run in the widget extension, so nothing opens.
struct LogCaffeineIntent: AppIntent {
    static var title: LocalizedStringResource = "Log a coffee"
    static var description = IntentDescription("Logs a coffee in Life Stack.")

    func perform() async throws -> some IntentResult {
        _ = try await WidgetData.client?.log(["type": "caffeine", "drink": "Coffee"])
        WidgetCenter.shared.reloadAllTimelines()
        return .result()
    }
}

struct LogMoodIntent: AppIntent {
    static var title: LocalizedStringResource = "Log mood"
    @Parameter(title: "Mood, 1 to 5") var value: Int

    init() {}
    init(value: Int) { self.value = value }

    func perform() async throws -> some IntentResult {
        guard (1 ... 5).contains(value) else { return .result() }
        _ = try await WidgetData.client?.log(["type": "mood", "value": value])
        WidgetCenter.shared.reloadAllTimelines()
        return .result()
    }
}

// A supplement is taken or not: logging one that is already taken today changes nothing, so a double tap is harmless.
struct TakeSupplementIntent: AppIntent {
    static var title: LocalizedStringResource = "Take a supplement"
    @Parameter(title: "Supplement") var name: String

    init() {}
    init(name: String) { self.name = name }

    func perform() async throws -> some IntentResult {
        _ = try await WidgetData.client?.log(["type": "supplement", "name": name])
        WidgetCenter.shared.reloadAllTimelines()
        return .result()
    }
}

struct TakeAllSupplementsIntent: AppIntent {
    static var title: LocalizedStringResource = "Take all supplements"

    func perform() async throws -> some IntentResult {
        guard let client = WidgetData.client else { return .result() }
        let all = try await client.options().supplements.map(\.name)
        let taken = Set(try await client.today().supplements.filter { $0.count > 0 }.map { $0.name.lowercased() })
        for name in all where !taken.contains(name.lowercased()) { _ = try await client.log(["type": "supplement", "name": name]) }
        WidgetCenter.shared.reloadAllTimelines()
        return .result()
    }
}
