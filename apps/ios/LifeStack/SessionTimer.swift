import ActivityKit
import AppIntents
import Foundation
import Security

extension Notification.Name {
    static let sessionTimerChanged = Notification.Name("lifestack.sessionTimerChanged")
}

// How long a calendar event stays on the lock screen by itself: from half an hour before it starts
// until half an hour after, and never past the time it ends.
enum SessionWindow {
    static let lead: TimeInterval = 30 * 60
    static let shown: TimeInterval = 30 * 60

    static func closes(start: Date, end: Date) -> Date {
        min(end, start.addingTimeInterval(shown))
    }

    static func contains(start: Date, end: Date, now: Date) -> Bool {
        let close = closes(start: start, end: end)
        return close > start && now >= start.addingTimeInterval(-lead) && now < close
    }
}

// What the server knows about the running timer. It is the one source of truth: every phone, the Mac and the agents read the same row.
struct ServerTimer: Decodable, Equatable {
    let itemKey: String
    let title: String
    let style: String
    let plan: [String]
    let startedAt: String
    let stoppedAt: String?
}

struct TimerSnapshot: Decodable {
    struct Stopped: Decodable { let itemKey: String; let stoppedAt: String }
    let running: ServerTimer?
    let recentlyStopped: [Stopped]
}

enum TimerServer {
    static var client: APIClient? {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "LSBaseURL") as? String, !raw.contains("$("),
              let url = APIClient.parse(address: raw), let key = Keychain.read() else { return nil }
        return APIClient(base: url, key: key)
    }

    // True while this device's own start or stop is on its way, so a sync in that moment does not undo it.
    nonisolated(unsafe) static var busy = 0

    static func snapshot() async -> TimerSnapshot? {
        guard let client else { return nil }
        return try? await client.get("api/v1/timer")
    }

    private static func send(_ body: [String: Any]) async -> TimerSnapshot? {
        guard let client, let data = try? JSONSerialization.data(withJSONObject: body),
              let out = try? await client.request("api/v1/timer", method: "POST", body: data) else { return nil }
        return try? JSONDecoder().decode(TimerSnapshot.self, from: out)
    }

    // The start time the server settled on (the first start wins if two devices tap at once), or nil when it could not be reached.
    static func start(_ e: NextEventAttributes) async -> Date? {
        busy += 1; defer { busy -= 1 }
        let snap = await send(["action": "start", "itemKey": e.itemKey, "title": e.title, "style": e.style.rawValue, "plan": e.plan])
        guard let run = snap?.running, run.itemKey == e.itemKey else { return nil }
        return Format.date(run.startedAt)
    }

    static func stop(_ itemKey: String) async {
        busy += 1; defer { busy -= 1 }
        _ = await send(["action": "stop", "itemKey": itemKey])
    }
}

// Events the user stopped, so the automatic card does not come straight back. Shared through the
// keychain because the lock-screen button and the app are not the same process.
enum SessionMemory {
    private static let service = "app.lifestack.timer"
    private static let account = "dismissed"

    static func token(_ event: NextEventAttributes) -> String {
        "\(event.id)|\(Int(event.start.timeIntervalSince1970))"
    }

    static func isDismissed(_ event: NextEventAttributes) -> Bool { load().contains(token(event)) }

    static func dismiss(_ event: NextEventAttributes) {
        var ids = load()
        ids.insert(token(event))
        save(ids)
    }

    static func forget(_ event: NextEventAttributes) {
        var ids = load()
        ids.remove(token(event))
        save(ids)
    }

    private static var group: String? {
        // The simulator build is not signed with the shared group, so using it there fails every save.
        #if targetEnvironment(simulator)
        return nil
        #else
        let g = Bundle.main.object(forInfoDictionaryKey: "LSKeychainGroup") as? String
        return g?.contains("$(") == false ? g : nil
        #endif
    }

    private static func query() -> [String: Any] {
        var q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        if let group { q[kSecAttrAccessGroup as String] = group }
        return q
    }

    private static func load() -> Set<String> {
        var q = query()
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data,
              let list = try? JSONDecoder().decode([String].self, from: data) else { return [] }
        let cutoff = Date().timeIntervalSince1970 - 36 * 60 * 60
        return Set(list.filter { item in
            guard let stamp = item.split(separator: "|").last, let t = TimeInterval(stamp) else { return false }
            return t >= cutoff
        })
    }

    private static func save(_ ids: Set<String>) {
        SecItemDelete(query() as CFDictionary)
        guard !ids.isEmpty, let data = try? JSONEncoder().encode(Array(ids)) else { return }
        var q = query()
        q[kSecValueData as String] = data
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(q as CFDictionary, nil)
    }
}

// The automatic card schedules its own end. Starting a timer cancels that, so the clock keeps
// running after the half hour until Stop.
enum SessionClock {
    nonisolated(unsafe) static var held: Set<Int> = []
    nonisolated(unsafe) private static var follow: Task<Void, Never>?

    static func hold(_ id: Int) {
        held.insert(id)
        follow?.cancel()
    }

    static func cancel() { follow?.cancel() }

    static func arm(_ event: NextEventAttributes) {
        guard !held.contains(event.id), !event.allDay else { return }
        follow?.cancel()
        let event = event
        follow = Task { @MainActor in
            if Date() < event.start {
                let wait = event.start.timeIntervalSinceNow
                if wait > 0 { try? await Task.sleep(for: .seconds(wait)) }
                guard !Task.isCancelled, !held.contains(event.id) else { return }
                await promote(event)
            }
            let close = SessionWindow.closes(start: event.start, end: event.end)
            let remain = close.timeIntervalSinceNow
            if remain > 0 { try? await Task.sleep(for: .seconds(remain)) }
            guard !Task.isCancelled, !held.contains(event.id) else { return }
            for activity in Activity<NextEventAttributes>.activities where activity.attributes.id == event.id && activity.content.state.phase != .timing {
                guard !held.contains(event.id) else { return }
                await activity.end(nil, dismissalPolicy: .immediate)
            }
        }
    }

    private static func promote(_ event: NextEventAttributes) async {
        guard !held.contains(event.id) else { return }
        let close = SessionWindow.closes(start: event.start, end: event.end)
        guard close > event.start else { return }
        let state = NextEventAttributes.ContentState(phase: .now, rangeStart: event.start, rangeEnd: close)
        for activity in Activity<NextEventAttributes>.activities {
            guard activity.attributes.id == event.id, activity.content.state.phase == .upcoming, !held.contains(event.id) else { continue }
            await activity.update(ActivityContent(state: state, staleDate: close))
        }
    }
}

// The Start button on the lock-screen card. It turns the card that is already up into a running timer.
struct StartSessionIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Play"
    static var openAppWhenRun = false

    func perform() async throws -> some IntentResult {
        let existing = await MainActor.run { Activity<NextEventAttributes>.activities.filter { $0.content.state.phase != .timing } }
        for activity in existing {
            let began = await TimerServer.start(activity.attributes) ?? Date()
            await MainActor.run {
                SessionClock.hold(activity.attributes.id)
                SessionMemory.forget(activity.attributes)
            }
            let state = NextEventAttributes.ContentState(phase: .timing, rangeStart: began, rangeEnd: activity.attributes.end, startedAt: began)
            await activity.update(ActivityContent(state: state, staleDate: nil))
        }
        await MainActor.run { NotificationCenter.default.post(name: .sessionTimerChanged, object: nil) }
        return .result()
    }
}

// The Stop button on the running timer. The same event is not put back on the lock screen automatically.
struct StopSessionIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Stop"
    static var openAppWhenRun = false

    func perform() async throws -> some IntentResult {
        let existing = await MainActor.run { Activity<NextEventAttributes>.activities.map { $0 } }
        for activity in existing {
            await MainActor.run { SessionClock.hold(activity.attributes.id) }
            await TimerServer.stop(activity.attributes.itemKey)
            await MainActor.run { SessionMemory.dismiss(activity.attributes) }
            await activity.end(nil, dismissalPolicy: .immediate)
        }
        await MainActor.run { NotificationCenter.default.post(name: .sessionTimerChanged, object: nil) }
        return .result()
    }
}
