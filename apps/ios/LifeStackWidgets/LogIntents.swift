import AppIntents
import WidgetKit

// The buttons on the large widget. Each tap changes the widget at once (the new state is written to the cache and the widgets are
// redrawn from it), then sends the same event the app does with the key from the shared Keychain. These run in the widget extension,
// so nothing opens. If the request fails the widgets redraw from the server and the change disappears.
private func run(_ change: WidgetData.Change, _ send: () async throws -> Void) async throws {
    WidgetData.setMenu(nil) // choosing something closes the open picker
    WidgetData.applyLocal(change)
    WidgetCenter.shared.reloadAllTimelines()
    defer { WidgetData.endOptimistic(); WidgetCenter.shared.reloadAllTimelines() }
    try await send()
}

struct LogCaffeineIntent: AppIntent {
    static var title: LocalizedStringResource = "Log a coffee"
    static var description = IntentDescription("Logs a coffee in Life Stack.")

    func perform() async throws -> some IntentResult {
        guard let client = WidgetData.client else { return .result() }
        try await run(.coffee(mg: 95)) { _ = try await client.log(["type": "caffeine", "drink": "Coffee"]) }
        return .result()
    }
}

// Opens or closes one of the dropdown-style pickers on the widget. It only changes what the widget shows.
struct TogglePickerIntent: AppIntent {
    static var title: LocalizedStringResource = "Open or close a picker"
    @Parameter(title: "Picker") var name: String

    init() {}
    init(name: String) { self.name = name }

    func perform() async throws -> some IntentResult {
        WidgetData.setMenu(WidgetData.openMenu == name ? nil : name)
        WidgetCenter.shared.reloadAllTimelines()
        return .result()
    }
}

struct LogDrinkIntent: AppIntent {
    static var title: LocalizedStringResource = "Log a drink"
    @Parameter(title: "Drink") var drink: String
    @Parameter(title: "Caffeine in mg") var mg: Double

    init() {}
    init(drink: String, mg: Double) { self.drink = drink; self.mg = mg }

    func perform() async throws -> some IntentResult {
        guard let client = WidgetData.client else { return .result() }
        let (d, amount) = (drink, mg)
        try await run(.coffee(mg: amount)) { _ = try await client.log(["type": "caffeine", "drink": d]) }
        return .result()
    }
}

struct LogMoodIntent: AppIntent {
    static var title: LocalizedStringResource = "Log mood"
    @Parameter(title: "Mood, 1 to 5") var value: Int

    init() {}
    init(value: Int) { self.value = value }

    func perform() async throws -> some IntentResult {
        guard (1 ... 5).contains(value), let client = WidgetData.client else { return .result() }
        let v = value
        try await run(.mood(v)) { _ = try await client.log(["type": "mood", "value": v]) }
        return .result()
    }
}

// One button for the whole stack. If everything on the list is already taken today it undoes today's supplements; otherwise it takes
// whatever is missing. The decision uses what the widget already shows, so there is no wait before it redraws. Anything more
// particular (one supplement, an odd mix) is done in the app.
struct ToggleSupplementsIntent: AppIntent {
    static var title: LocalizedStringResource = "Take or undo all supplements"

    func perform() async throws -> some IntentResult {
        guard let client = WidgetData.client else { return .result() }
        var all = WidgetData.cachedOptions()?.supplements.map(\.name) ?? []
        if all.isEmpty { all = try await client.options().supplements.map(\.name) }
        let taken = Set((WidgetData.cachedOverview()?.log?.supplements ?? []).filter { $0.count > 0 }.map { $0.name.lowercased() })
        let missing = all.filter { !taken.contains($0.lowercased()) }
        if missing.isEmpty && !all.isEmpty {
            try await run(.supplements(names: all, taken: false)) {
                let entries = try await client.history(limit: 100).filter { $0.key == "supplement.taken" && Format.isToday($0.at) }
                try await withThrowingTaskGroup(of: Void.self) { group in
                    for e in entries { group.addTask { try await client.deleteEntry(e.id) } }
                    try await group.waitForAll()
                }
            }
        } else {
            try await run(.supplements(names: all, taken: true)) {
                try await withThrowingTaskGroup(of: Void.self) { group in
                    for name in missing { group.addTask { _ = try await client.log(["type": "supplement", "name": name]) } }
                    try await group.waitForAll()
                }
            }
        }
        return .result()
    }
}
