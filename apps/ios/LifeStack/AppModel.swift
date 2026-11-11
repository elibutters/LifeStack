import Foundation
import Observation
import UIKit
import WidgetKit

@MainActor
@Observable
final class AppModel {
    private static let addressKey = "server-address"

    var address: String = AppModel.bundledAddress ?? UserDefaults.standard.string(forKey: "server-address") ?? ""
    var signedIn: Bool
    // The day shown on the Log screen; nil means today, so it follows the calendar past midnight.
    var pickedDay: Date?
    // The shown day's summary and entries (named for when it was always today).
    var today: TodaySummary?
    // True once we know yesterday has no mood, caffeine or supplements, so the log can ask for it.
    var yesterdayMissed = false
    var pending = false
    var options: LogOptions?
    // Supplement taps paint at once and save behind that. These keep a newer tap from being wiped by a refresh
    // that started earlier, and keep two taps on the same supplement in order.
    private struct HeldSupplement { let supplement: LogOptions.Supplement; let on: Bool; let epoch: Int; let day: Date? }
    private var held: [String: HeldSupplement] = [:]
    private var chains: [String: Task<Int?, Never>] = [:]
    private var supplementInflight = 0
    // Caffeine taps change the count at once. These keep a refresh from wiping a tap the server has not confirmed,
    // and keep a remove of a just-added drink from leaving that drink behind.
    private struct PendingDrink {
        let localId: Int
        let drink: String
        let mg: Double
        let label: String
        let at: String
        let day: Date?
        var serverId: Int?
        var cancelled: Bool
    }
    private var pendingDrinks: [Int: PendingDrink] = [:]
    private var deletingDrinks: Set<Int> = []
    private var caffeineInflight = 0
    private var nextLocalDrinkId = -1_000_000
    var message: String?
    var busy = false

    // The deployment address baked in at build time (Local.xcconfig), so people never have to type one.
    static var bundledAddress: String? {
        let raw = (Bundle.main.object(forInfoDictionaryKey: "LSBaseURL") as? String)?.trimmingCharacters(in: .whitespaces) ?? ""
        return raw.isEmpty || raw.contains("$(") ? nil : raw
    }

    init() {
        signedIn = Keychain.read() != nil && !(Self.bundledAddress ?? UserDefaults.standard.string(forKey: Self.addressKey) ?? "").isEmpty
        // Debug builds only: UI tests open the tabs with no key, so navigation can be checked. No data loads.
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("UITEST_SIGNED_IN") { signedIn = true }
        #endif
    }

    var client: APIClient? {
        guard let url = APIClient.parse(address: address), let key = Keychain.read() else { return nil }
        return APIClient(base: url, key: key)
    }

    // The email and password are sent once, to trade for this device's own key; only the key is kept (in the Keychain).
    func signIn(address: String, email: String, password: String) async {
        message = nil
        guard let url = APIClient.parse(address: Self.bundledAddress ?? address) else { message = APIError.badAddress.localizedDescription; return }
        busy = true; defer { busy = false }
        do {
            let key = try await APIClient.login(base: url, email: email, password: password, device: UIDevice.current.name)
            guard Keychain.save(key) else { message = "Could not store the key on this device."; return }
            self.address = url.absoluteString
            UserDefaults.standard.set(self.address, forKey: Self.addressKey)
            signedIn = true
            await refresh()
        } catch { message = error.localizedDescription }
    }

    func signOut() {
        LocationTracker.shared.enabled = false
        LocationTracker.shared.clearQueue()
        Keychain.delete()
        today = nil; options = nil; pickedDay = nil; yesterdayMissed = false; message = nil; signedIn = false
    }

    var isToday: Bool { pickedDay.map { Calendar.current.isDateInToday($0) } ?? true }
    var shownDay: Date { isToday ? Calendar.current.startOfDay(for: .now) : pickedDay! }

    private static let ymd: DateFormatter = {
        let f = DateFormatter(); f.calendar = Calendar(identifier: .gregorian); f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current; f.dateFormat = "yyyy-MM-dd"; return f
    }()

    // Shows another day. Future days are clamped to today; picking today goes back to following the calendar.
    func showDay(_ d: Date) async {
        let day = Calendar.current.startOfDay(for: min(d, .now))
        let next: Date? = Calendar.current.isDateInToday(day) ? nil : day
        if next == pickedDay && today != nil { return }
        pickedDay = next
        today = nil
        await refresh()
    }

    func shiftDay(_ by: Int) async {
        if let d = Calendar.current.date(byAdding: .day, value: by, to: shownDay) { await showDay(d) }
    }

    // A day counts as missed only when nothing was logged: no mood, no caffeine and no supplements.
    private static func isBlank(_ day: TodaySummary) -> Bool {
        let caffeine = day.caffeine.count > 0 || (day.entries ?? []).contains { $0.key == "caffeine" }
        let supplements = day.supplements.contains { $0.count > 0 } || (day.entries ?? []).contains { $0.key == "supplement.taken" }
        return day.mood == nil && !caffeine && !supplements
    }

    func refresh() async {
        guard let client else { return }
        if pickedDay != nil && isToday { pickedDay = nil }
        let asked = pickedDay
        let yesterdayKey: String? = asked == nil ? Calendar.current.date(byAdding: .day, value: -1, to: .now).map { Self.ymd.string(from: $0) } : nil
        // The supplement list is a nicety: if it cannot load, the rest of the screen still works.
        async let opts = try? client.options()
        async let prior: TodaySummary? = yesterdayKey == nil ? nil : try? client.day(yesterdayKey!)
        do {
            let summary = try await client.day(asked.map { Self.ymd.string(from: $0) })
            // A slow answer for a day the person has already left is dropped.
            if asked == pickedDay {
                // A caffeine tap already changed the count. Applying this answer now would flash the old number back.
                if caffeineInflight == 0 {
                    today = summary
                    reapplyCaffeine()
                    if let asked, Calendar.current.isDateInYesterday(asked), let shown = today {
                        yesterdayMissed = Self.isBlank(shown)
                    }
                }
                if supplementInflight == 0 { held.removeAll() }
                else { for item in held.values where item.day == pickedDay { paintSupplement(item.supplement, on: item.on) } }
            }
            message = nil
        } catch { handle(error) }
        if let prior = await prior { yesterdayMissed = Self.isBlank(prior) }
        if let opts = await opts { options = opts }
        WidgetCenter.shared.reloadAllTimelines() // widgets show what the app just learned, including changes made on the web
    }

    // A log for a past day is placed on that day at the current clock time, so entries keep their order.
    private func shownInstant() -> Date {
        guard !isToday else { return .now }
        let cal = Calendar.current
        let t = cal.dateComponents([.hour, .minute, .second], from: .now)
        return cal.date(bySettingHour: t.hour ?? 12, minute: t.minute ?? 0, second: t.second ?? 0, of: shownDay) ?? shownDay
    }

    private func stamped(_ event: [String: Any]) -> [String: Any] {
        guard !isToday else { return event }
        var e = event
        e["at"] = ISO8601DateFormatter().string(from: shownInstant())
        return e
    }

    // Plus logs one of this drink. The count changes immediately; the save happens behind that, so the screen never dims.
    func addDrink(_ drink: LogOptions.Drink) -> Bool {
        guard client != nil else { return false }
        let localId = nextLocalDrinkId
        nextLocalDrinkId -= 1
        let amount = drink.mg == drink.mg.rounded() ? String(Int(drink.mg)) : String(drink.mg)
        let item = PendingDrink(localId: localId, drink: drink.drink, mg: drink.mg, label: "\(drink.drink) (\(amount) mg)", at: ISO8601DateFormatter().string(from: shownInstant()), day: pickedDay, serverId: nil, cancelled: false)
        pendingDrinks[localId] = item
        showDrink(item)
        let body = stamped(["type": "caffeine", "drink": drink.drink])
        caffeineInflight += 1
        Task { @MainActor in
            defer { self.finishCaffeine() }
            do {
                guard let client = self.client else { return }
                let id = try await client.log(body)
                guard var current = self.pendingDrinks[localId] else { return }
                if current.cancelled {
                    self.pendingDrinks.removeValue(forKey: localId)
                    try await client.deleteEntry(id)
                } else {
                    current.serverId = id
                    self.pendingDrinks[localId] = current
                    self.adoptDrinkId(localId: localId, serverId: id)
                }
            } catch {
                if self.pendingDrinks[localId]?.cancelled != true { self.hideDrink(id: localId) }
                self.pendingDrinks.removeValue(forKey: localId)
                self.handle(error)
            }
        }
        return true
    }

    // Minus drops the newest one of this drink at once, including one whose save has not finished.
    func removeDrink(_ entry: HistoryEntry) -> Bool {
        guard client != nil, entry.key == "caffeine" else { return false }
        hideDrink(id: entry.id)
        if entry.id < 0 {
            if var item = pendingDrinks[entry.id] {
                item.cancelled = true
                pendingDrinks[entry.id] = item
                if let serverId = item.serverId {
                    pendingDrinks.removeValue(forKey: entry.id)
                    deleteSavedDrink(serverId)
                }
            }
            return true
        }
        deleteSavedDrink(entry.id)
        return true
    }

    private func deleteSavedDrink(_ id: Int) {
        guard client != nil else { return }
        deletingDrinks.insert(id)
        caffeineInflight += 1
        Task { @MainActor in
            defer { self.finishCaffeine() }
            do {
                guard let client = self.client else { return }
                try await client.deleteEntry(id)
                self.deletingDrinks.remove(id)
            } catch {
                self.deletingDrinks.remove(id)
                self.handle(error)
            }
        }
    }

    private func finishCaffeine() {
        caffeineInflight -= 1
        if caffeineInflight == 0 { Task { await refresh() } }
    }

    private func showDrink(_ item: PendingDrink) {
        guard var day = today else { return }
        var entries = day.entries ?? []
        let id = item.serverId ?? item.localId
        if entries.contains(where: { $0.id == id || $0.id == item.localId }) { return }
        entries.append(HistoryEntry(id: id, at: item.at, key: "caffeine", label: item.label, source: "app", name: item.drink, dose: item.mg, unit: "mg"))
        day.entries = entries
        day.caffeine = .init(count: day.caffeine.count + 1, mg: day.caffeine.mg + item.mg)
        today = day
    }

    private func hideDrink(id: Int) {
        guard var day = today, var entries = day.entries, let idx = entries.firstIndex(where: { $0.id == id }) else { return }
        let removed = entries.remove(at: idx)
        day.entries = entries
        let drop = removed.dose ?? options?.caffeine.first { $0.drink.caseInsensitiveCompare(removed.drinkName) == .orderedSame }?.mg ?? 0
        day.caffeine = .init(count: max(0, day.caffeine.count - 1), mg: max(0, day.caffeine.mg - drop))
        today = day
    }

    private func adoptDrinkId(localId: Int, serverId: Int) {
        guard var day = today, var entries = day.entries, let idx = entries.firstIndex(where: { $0.id == localId }) else { return }
        let old = entries[idx]
        entries[idx] = HistoryEntry(id: serverId, at: old.at, key: old.key, label: old.label, source: old.source, name: old.name, dose: old.dose, unit: old.unit)
        day.entries = entries
        today = day
    }

    // Puts taps the server snapshot does not have yet back onto the day, and drops drinks a minus already removed.
    private func reapplyCaffeine() {
        guard var day = today else { return }
        var entries = day.entries ?? []
        var count = day.caffeine.count
        var mg = day.caffeine.mg
        entries.removeAll { e in
            guard deletingDrinks.contains(e.id) else { return false }
            count = max(0, count - 1)
            let drop = e.dose ?? options?.caffeine.first { $0.drink.caseInsensitiveCompare(e.drinkName) == .orderedSame }?.mg ?? 0
            mg = max(0, mg - drop)
            return true
        }
        for item in pendingDrinks.values where !item.cancelled && item.day == pickedDay {
            let id = item.serverId ?? item.localId
            if entries.contains(where: { $0.id == id || $0.id == item.localId }) { continue }
            entries.append(HistoryEntry(id: id, at: item.at, key: "caffeine", label: item.label, source: "app", name: item.drink, dose: item.mg, unit: "mg"))
            count += 1
            mg += item.mg
        }
        for key in Array(pendingDrinks.keys) {
            guard let serverId = pendingDrinks[key]?.serverId, entries.contains(where: { $0.id == serverId }) else { continue }
            pendingDrinks.removeValue(forKey: key)
        }
        day.entries = entries
        day.caffeine = .init(count: count, mg: mg)
        today = day
    }

    // One tap logs. More taps are ignored while a request is in flight, so a double tap cannot log twice.
    func log(_ event: [String: Any], label: String) async -> Bool {
        guard let client, !pending else { return false }
        pending = true; defer { pending = false }
        do {
            _ = try await client.log(stamped(event))
            await refresh()
            return true
        } catch { handle(error); return false }
    }

    // The shown day's entry for a supplement, if it was taken: a supplement is taken or not, never counted.
    func taken(_ name: String) -> HistoryEntry? {
        (today?.entries ?? []).first { $0.key == "supplement.taken" && ($0.name ?? "").caseInsensitiveCompare(name) == .orderedSame }
    }

    // Tap to take, tap again to un-take. The check changes immediately; the request follows without dimming the screen.
    func toggleSupplement(_ s: LogOptions.Supplement) -> Bool {
        guard client != nil else { return false }
        startSupplement(s, on: taken(s.name) == nil)
        return true
    }

    // Marks every supplement that is not already taken on the shown day.
    func takeAllSupplements() {
        let missing = (options?.supplements ?? []).filter { taken($0.name) == nil }
        for s in missing { startSupplement(s, on: true) }
    }

    // Clears every supplement taken on the shown day. The checks drop at once.
    func removeAllSupplements() {
        let takenOnes = (options?.supplements ?? []).filter { taken($0.name) != nil }
        for s in takenOnes { startSupplement(s, on: false) }
    }

    private func startSupplement(_ s: LogOptions.Supplement, on: Bool) {
        guard client != nil else { return }
        let key = s.name.lowercased()
        let epoch = (held[key]?.epoch ?? 0) + 1
        let knownId = taken(s.name)?.id
        let day = pickedDay
        var event: [String: Any] = ["type": "supplement", "name": s.name]
        if let d = s.dose { event["dose"] = d }; if let u = s.unit { event["unit"] = u }
        let body = stamped(event)
        held[key] = HeldSupplement(supplement: s, on: on, epoch: epoch, day: day)
        paintSupplement(s, on: on)
        let previous = chains[key]
        supplementInflight += 1
        let job = Task { @MainActor () -> Int? in
            let prior = await previous?.value
            defer {
                self.supplementInflight -= 1
                if self.supplementInflight == 0 { Task { await self.refresh() } }
            }
            do {
                guard let client = self.client else { return nil }
                if on { return try await client.log(body) }
                let stored: Int? = if let knownId, knownId > 0 { knownId } else { nil }
                if let savedId = prior ?? stored { try await client.deleteEntry(savedId) }
                return nil
            } catch {
                if self.held[key]?.epoch == epoch, self.pickedDay == day {
                    self.held.removeValue(forKey: key)
                    self.paintSupplement(s, on: !on)
                    self.handle(error)
                }
                return nil
            }
        }
        chains[key] = job
    }

    // Shows a supplement as taken or not before the server answers. A negative id marks a row the server has not confirmed.
    private func paintSupplement(_ s: LogOptions.Supplement, on: Bool) {
        guard var day = today else { return }
        var entries = day.entries ?? []
        entries.removeAll { $0.key == "supplement.taken" && ($0.name ?? "").caseInsensitiveCompare(s.name) == .orderedSame }
        if on {
            let label: String
            if let dose = s.dose, let unit = s.unit {
                let amount = dose == dose.rounded() ? String(Int(dose)) : String(dose)
                label = "\(s.name) (\(amount) \(unit))"
            } else { label = s.name }
            entries.append(HistoryEntry(id: -s.id, at: ISO8601DateFormatter().string(from: shownInstant()), key: "supplement.taken", label: label, source: "app", name: s.name, dose: s.dose, unit: s.unit))
        }
        day.entries = entries
        today = day
    }

    func setDose(_ s: LogOptions.Supplement, dose: Double?, unit: String) async {
        guard let client else { return }
        do { try await client.setDose(id: s.id, dose: dose, unit: unit) } catch { handle(error) }
    }

    func remove(_ entry: HistoryEntry) async {
        if entry.id < 0 {
            if entry.key == "supplement.taken", let name = entry.name,
               let s = options?.supplements.first(where: { $0.name.caseInsensitiveCompare(name) == .orderedSame }) {
                startSupplement(s, on: false)
            }
            return
        }
        guard let client else { return }
        do { try await client.deleteEntry(entry.id); await refresh() } catch { handle(error) }
    }

    // A rejected key means this device was revoked or the password changed: go back to sign in.
    func handle(_ error: Error) {
        if error is CancellationError { return } // a replaced or abandoned request is not an error to show
        if case APIError.unauthorized = error { signOut(); message = error.localizedDescription } else { message = error.localizedDescription }
    }
}

// Loads one screen's data and keeps the last good copy if a refresh fails.
@MainActor
@Observable
final class Loader<T> {
    var value: T?
    var error: String?
    var loading = false

    func load(_ model: AppModel, _ fetch: @escaping (APIClient) async throws -> T) async {
        guard let client = model.client else { return }
        loading = true; defer { loading = false }
        do { value = try await fetch(client); error = nil }
        catch is CancellationError { return }
        catch { self.error = error.localizedDescription; model.handle(error) }
    }
}
