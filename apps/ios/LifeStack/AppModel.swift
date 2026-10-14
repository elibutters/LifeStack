import Foundation
import Observation
import UIKit

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
    var pending = false
    var options: LogOptions?
    var message: String?
    var busy = false

    // The deployment address baked in at build time (Local.xcconfig), so people never have to type one.
    static var bundledAddress: String? {
        let raw = (Bundle.main.object(forInfoDictionaryKey: "LSBaseURL") as? String)?.trimmingCharacters(in: .whitespaces) ?? ""
        return raw.isEmpty || raw.contains("$(") ? nil : raw
    }

    init() {
        signedIn = Keychain.read() != nil && !(Self.bundledAddress ?? UserDefaults.standard.string(forKey: Self.addressKey) ?? "").isEmpty
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
        today = nil; options = nil; pickedDay = nil; message = nil; signedIn = false
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

    func refresh() async {
        guard let client else { return }
        if pickedDay != nil && isToday { pickedDay = nil }
        let asked = pickedDay
        // The supplement list is a nicety: if it cannot load, the rest of the screen still works.
        async let opts = try? client.options()
        do {
            let summary = try await client.day(asked.map { Self.ymd.string(from: $0) })
            // A slow answer for a day the person has already left is dropped.
            if asked == pickedDay { today = summary }
            message = nil
        } catch { handle(error) }
        if let opts = await opts { options = opts }
    }

    // A log for a past day is placed on that day at the current clock time, so entries keep their order.
    private func stamped(_ event: [String: Any]) -> [String: Any] {
        guard !isToday else { return event }
        let cal = Calendar.current
        let t = cal.dateComponents([.hour, .minute, .second], from: .now)
        let at = cal.date(bySettingHour: t.hour ?? 12, minute: t.minute ?? 0, second: t.second ?? 0, of: shownDay) ?? shownDay
        var e = event
        e["at"] = ISO8601DateFormatter().string(from: at)
        return e
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

    // Tap to take, tap again to un-take, on whichever day is shown.
    func toggleSupplement(_ s: LogOptions.Supplement) async -> Bool {
        guard let client, !pending else { return false }
        pending = true; defer { pending = false }
        do {
            if let taken = taken(s.name) {
                try await client.deleteEntry(taken.id)
            } else {
                var event: [String: Any] = ["type": "supplement", "name": s.name]
                if let d = s.dose { event["dose"] = d }; if let u = s.unit { event["unit"] = u }
                _ = try await client.log(stamped(event))
            }
            await refresh()
            return true
        } catch { handle(error); return false }
    }

    func setDose(_ s: LogOptions.Supplement, dose: Double?, unit: String) async {
        guard let client else { return }
        do { try await client.setDose(id: s.id, dose: dose, unit: unit) } catch { handle(error) }
    }

    func remove(_ entry: HistoryEntry) async {
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
