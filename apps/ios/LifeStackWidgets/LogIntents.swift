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

// One button for the whole stack. If everything on the list is already taken today it undoes today's supplements; otherwise it takes
// whatever is missing. Anything more particular (one supplement, an odd mix) is done in the app.
struct ToggleSupplementsIntent: AppIntent {
    static var title: LocalizedStringResource = "Take or undo all supplements"

    func perform() async throws -> some IntentResult {
        guard let client = WidgetData.client else { return .result() }
        let all = try await client.options().supplements.map(\.name)
        let taken = Set(try await client.today().supplements.filter { $0.count > 0 }.map { $0.name.lowercased() })
        let missing = all.filter { !taken.contains($0.lowercased()) }
        if missing.isEmpty && !all.isEmpty {
            for entry in try await client.history(limit: 100) where entry.key == "supplement.taken" && Format.isToday(entry.at) { try await client.deleteEntry(entry.id) }
        } else {
            for name in missing { _ = try await client.log(["type": "supplement", "name": name]) }
        }
        WidgetCenter.shared.reloadAllTimelines()
        return .result()
    }
}
