import ActivityKit
import Foundation

// The lock-screen card for whatever is on the calendar and about to start. It appears during the half
// hour before the start and stays for the first half hour (or until the event ends, if that is sooner).
// Start turns that card into a run, a lift or a plain timer that counts up until Stop. Opening the app
// starts and ends the automatic card. A timer the user started is left alone. ActivityKit's synchronous
// calls have to run on the main thread outside a Swift task; from an async task they log unsafeForcedSync
// and the card never appears.
@MainActor
enum NextEventActivity {
    struct Clock: Equatable { let id: Int; let startedAt: Date }

    private static var pending: Task<Void, Never>?

    static func sync(_ model: AppModel) async {
        #if DEBUG
        if UserDefaults.standard.string(forKey: "LS_SAMPLE_ACTIVITY") != nil { return }   // keep the sample card up
        #endif
        let previous = pending
        let task = Task { @MainActor in
            await previous?.value
            await run(model)
        }
        pending = task
        await task.value
    }

    // A timed event can be started. An all-day event can too: it has no clock time, so only the button starts it.
    // A holiday is not something to attend. A session already logged as done or skipped is over.
    static func canTime(_ item: CalendarItem) -> Bool {
        guard item.kind != "holiday" else { return false }
        if let status = item.session?.status, status == "done" || status == "skipped" { return false }
        if item.allDay { return true }
        return Format.date(item.start) != nil
    }

    // The Start button in the calendar is only for today, so other days stay uncluttered. A timer already running for the item keeps its Stop.
    static func showsStart(_ item: CalendarItem) -> Bool {
        guard canTime(item) else { return false }
        if current()?.id == item.id { return true }
        let cal = Calendar.current
        if item.allDay { return Format.dayDate(String(item.start.prefix(10))).map { cal.isDateInToday($0) } ?? false }
        return Format.date(item.start).map { cal.isDateInToday($0) } ?? false
    }

    static func current() -> Clock? {
        guard let activity = Activity<NextEventAttributes>.activities.first(where: { $0.content.state.phase == .timing }),
              let started = activity.content.state.startedAt else { return nil }
        return Clock(id: activity.attributes.id, startedAt: started)
    }

    static func start(_ item: CalendarItem) {
        guard let event = event(for: item) else { return }
        SessionMemory.forget(event)
        let now = Date()
        let state = NextEventAttributes.ContentState(phase: .timing, rangeStart: now, rangeEnd: event.end, startedAt: now)
        DispatchQueue.main.async {
            SessionClock.hold(event.id)
            let existing = Activity<NextEventAttributes>.activities
            let content = ActivityContent(state: state, staleDate: nil)
            if let match = existing.first(where: { $0.attributes.id == event.id }) {
                let others = existing.filter { $0.id != match.id }
                Task { @MainActor in
                    await match.update(content)
                    for other in others {
                        if other.content.state.phase == .timing { SessionMemory.dismiss(other.attributes) }
                        await other.end(nil, dismissalPolicy: .immediate)
                    }
                    NotificationCenter.default.post(name: .sessionTimerChanged, object: nil)
                }
            } else {
                do { _ = try Activity.request(attributes: event, content: content) } catch {
                    NotificationCenter.default.post(name: .sessionTimerChanged, object: nil)
                    return
                }
                Task { @MainActor in
                    for other in existing {
                        if other.content.state.phase == .timing { SessionMemory.dismiss(other.attributes) }
                        await other.end(nil, dismissalPolicy: .immediate)
                    }
                    NotificationCenter.default.post(name: .sessionTimerChanged, object: nil)
                }
            }
        }
    }

    static func stop() {
        DispatchQueue.main.async {
            let existing = Activity<NextEventAttributes>.activities
            for activity in existing { SessionClock.hold(activity.attributes.id) }
            Task { @MainActor in
                for activity in existing {
                    SessionMemory.dismiss(activity.attributes)
                    await activity.end(nil, dismissalPolicy: .immediate)
                }
                NotificationCenter.default.post(name: .sessionTimerChanged, object: nil)
            }
        }
    }

    private static func run(_ model: AppModel) async {
        // The calendar endpoint, not the overview: only it says whether a goal session is already done or skipped.
        let start = Calendar.current.startOfDay(for: Date())
        guard let client = model.client, let items = try? await client.calendar(from: start, to: Calendar.current.date(byAdding: .day, value: 2, to: start) ?? start) else { return }
        let chosen = pick(items, now: Date())
        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            DispatchQueue.main.async {
                let followup = mutate(chosen)
                guard let followup else { cont.resume(); return }
                Task { @MainActor in
                    await followup()
                    cont.resume()
                }
            }
        }
    }

    // Main thread, not a Swift task. Returns the async end/update work, which is safe to await.
    // A timer the user started is never replaced by the automatic card.
    private static func mutate(_ chosen: NextEventAttributes?) -> (() async -> Void)? {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return nil }
        let existing = Activity<NextEventAttributes>.activities
        if existing.contains(where: { $0.content.state.phase == .timing }) {
            SessionClock.cancel()
            let prompts = existing.filter { $0.content.state.phase != .timing }
            return { for activity in prompts { await activity.end(nil, dismissalPolicy: .immediate) } }
        }
        guard let chosen, !SessionMemory.isDismissed(chosen) else {
            SessionClock.cancel()
            return { for activity in existing { await activity.end(nil, dismissalPolicy: .immediate) } }
        }
        let state = content(chosen, now: Date())
        let stale = state.phase == .allDay ? nil : (state.phase == .upcoming ? chosen.start : SessionWindow.closes(start: chosen.start, end: chosen.end))
        let content = ActivityContent(state: state, staleDate: stale)
        SessionClock.arm(chosen)
        if let match = existing.first(where: { $0.attributes.id == chosen.id }) {
            let others = existing.filter { $0.id != match.id }
            return {
                await match.update(content)
                for other in others { await other.end(nil, dismissalPolicy: .immediate) }
            }
        }
        do { _ = try Activity.request(attributes: chosen, content: content) } catch { return nil }
        return { for activity in existing { await activity.end(nil, dismissalPolicy: .immediate) } }
    }

    // An event already in its first half hour wins, otherwise the soonest one starting within the next half hour.
    private static func pick(_ items: [CalendarItem], now: Date) -> NextEventAttributes? {
        let visible: [NextEventAttributes] = items.compactMap { item in
            guard !item.allDay, let event = event(for: item) else { return nil }
            guard SessionWindow.contains(start: event.start, end: event.end, now: now) else { return nil }
            guard !SessionMemory.isDismissed(event) else { return nil }
            return event
        }
        let underway = visible.filter { $0.start <= now }.max { $0.start < $1.start }
        let upcoming = visible.filter { $0.start > now }.min { $0.start < $1.start }
        return underway ?? upcoming
    }

    private static func event(for item: CalendarItem) -> NextEventAttributes? {
        guard canTime(item) else { return nil }
        let style = NextEventAttributes.Style.choose(title: item.title, kind: item.kind)
        if item.allDay {
            let day = Format.dayDate(String(item.start.prefix(10))) ?? Date()
            return NextEventAttributes(id: item.id, title: item.title, start: day, end: day.addingTimeInterval(24 * 60 * 60), allDay: true, place: place(item.location), style: style)
        }
        guard let start = Format.date(item.start) else { return nil }
        let end = Format.date(item.end).flatMap { $0 > start ? $0 : nil } ?? start.addingTimeInterval(60 * 60)
        return NextEventAttributes(id: item.id, title: item.title, start: start, end: end, allDay: false, place: place(item.location), style: style)
    }

    private static func place(_ raw: String?) -> String? { raw.flatMap { $0.isEmpty ? nil : $0 } }

    private static func content(_ event: NextEventAttributes, now: Date) -> NextEventAttributes.ContentState {
        if event.allDay { return .init(phase: .allDay, rangeStart: event.start, rangeEnd: event.start) }
        let close = SessionWindow.closes(start: event.start, end: event.end)
        if now >= event.start { return .init(phase: .now, rangeStart: event.start, rangeEnd: close) }
        return .init(phase: .upcoming, rangeStart: now, rangeEnd: event.start)
    }

    #if DEBUG
    static func showSample(_ mode: String) {
        let now = Date()
        if mode == "run" || mode == "lift" {
            let style: NextEventAttributes.Style = mode == "run" ? .run : .lift
            let start = now.addingTimeInterval(-5 * 60)
            let attrs = NextEventAttributes(id: 9_999, title: style == .run ? "Easy run" : "Lift", start: start, end: start.addingTimeInterval(60 * 60), allDay: false, place: nil, style: style)
            let state = NextEventAttributes.ContentState(phase: .timing, rangeStart: now, rangeEnd: attrs.end, startedAt: now.addingTimeInterval(-90))
            DispatchQueue.main.async {
                for a in Activity<NextEventAttributes>.activities { Task { await a.end(nil, dismissalPolicy: .immediate) } }
                do { _ = try Activity.request(attributes: attrs, content: ActivityContent(state: state, staleDate: nil)) }
                catch { print("sample activity failed:", error) }
            }
            return
        }
        let allDay = mode == "allday"
        let start = mode == "next" ? now.addingTimeInterval(25 * 60) : now.addingTimeInterval(-20 * 60)
        let end = start.addingTimeInterval(60 * 60)
        let attrs = NextEventAttributes(id: 9_999, title: allDay ? "Team offsite" : "Design review", start: allDay ? Calendar.current.startOfDay(for: now) : start, end: end, allDay: allDay, place: "Room 4", style: .event)
        let state = content(attrs, now: now)
        // Same rule as the real path: ActivityKit's synchronous calls run on the main queue, outside a Swift task.
        DispatchQueue.main.async {
            for a in Activity<NextEventAttributes>.activities { Task { await a.end(nil, dismissalPolicy: .immediate) } }
            let stale = allDay ? nil : (state.phase == .upcoming ? attrs.start : SessionWindow.closes(start: attrs.start, end: attrs.end))
            do { _ = try Activity.request(attributes: attrs, content: ActivityContent(state: state, staleDate: stale)) }
            catch { print("sample activity failed:", error) }
        }
    }
    #endif
}
