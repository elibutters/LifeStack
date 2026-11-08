import Foundation
import Observation

// Everything the dropdown shows. Data is loaded when the dropdown opens and every few minutes while the Mac is awake.
@MainActor
@Observable
final class MacModel {
    static let addressKey = "address"

    var signedIn: Bool
    var today: [CalendarItem] = []
    var soon: [CalendarItem] = []
    var log: TodaySummary?
    var options: LogOptions?
    var message: String?
    var busy = false
    private var timer: Timer?

    init() {
        signedIn = Keychain.read() != nil && !Self.address.isEmpty
        if signedIn { Task { await refresh() }; startTimer() }
    }

    static var bundledAddress: String? {
        let raw = (Bundle.main.object(forInfoDictionaryKey: "LSBaseURL") as? String)?.trimmingCharacters(in: .whitespaces) ?? ""
        return raw.isEmpty || raw.contains("$(") ? nil : raw
    }
    static var address: String { bundledAddress ?? UserDefaults.standard.string(forKey: addressKey) ?? "" }

    var client: APIClient? {
        guard let url = APIClient.parse(address: Self.address), let key = Keychain.read() else { return nil }
        return APIClient(base: url, key: key)
    }

    private func startTimer() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.refresh() }
        }
    }

    func signIn(address: String, email: String, password: String) async {
        message = nil
        guard let url = APIClient.parse(address: Self.bundledAddress ?? address) else { message = APIError.badAddress.localizedDescription; return }
        busy = true; defer { busy = false }
        do {
            let device = Host.current().localizedName ?? "Mac"
            let key = try await APIClient.login(base: url, email: email, password: password, device: device)
            guard Keychain.save(key) else { message = "Could not store the key on this Mac."; return }
            UserDefaults.standard.set(url.absoluteString, forKey: Self.addressKey)
            signedIn = true
            startTimer()
            await refresh()
        } catch { message = error.localizedDescription }
    }

    func signOut() {
        Keychain.delete()
        timer?.invalidate()
        today = []; soon = []; log = nil; options = nil; message = nil; signedIn = false
    }

    func refresh() async {
        guard let client else { return }
        do {
            // The calendar request also refreshes Outlook on the server when its copy is stale.
            let start = Calendar.current.startOfDay(for: .now)
            let items = try await client.calendar(from: start, to: Calendar.current.date(byAdding: .day, value: 7, to: start) ?? start)
            let todayKey = Format.dayKey(.init(id: 0, title: "", start: ISO8601DateFormatter().string(from: .now), end: "", allDay: false, kind: "", location: nil, session: nil))
            today = items.filter { Format.dayKey($0) == todayKey }
            soon = items.filter { Format.dayKey($0) != todayKey }
            message = nil
        } catch is CancellationError {
        } catch APIError.unauthorized { signOut(); message = APIError.unauthorized.localizedDescription; return }
        catch { message = error.localizedDescription }
        if let d = try? await client.day() { log = d }
        if options == nil, let o = try? await client.options() { options = o }
    }

    // The next timed event that has not finished, shown in the menu bar.
    var next: CalendarItem? {
        let now = Date.now
        return (today + soon).first { !$0.allDay && (Format.date($0.end).map { $0 > now } ?? false) }
    }

    var barTitle: String {
        guard signedIn, let n = next, let start = Format.date(n.start) else { return "" }
        let name = n.title.count > 22 ? String(n.title.prefix(21)) + "…" : n.title
        return "\(start.formatted(date: .omitted, time: .shortened)) \(name)"
    }

    func send(_ event: [String: Any]) async {
        guard let client else { return }
        do { _ = try await client.log(event); message = nil; log = try? await client.day() }
        catch { message = error.localizedDescription }
    }
}
