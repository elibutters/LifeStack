import ActivityKit
import Foundation

// The lock-screen card for whatever is on the calendar now: an event underway, the next one
// starting within eight hours (as long as a Live Activity is allowed to stay up), or today's
// all-day event. Opening the app starts and ends it. ActivityKit's synchronous calls have to
// run on the main thread outside a Swift task; from an async task they log unsafeForcedSync
// and the card never appears.
@MainActor
enum NextEventActivity {
    private static let lead: TimeInterval = 8 * 60 * 60
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
    private static func mutate(_ chosen: NextEventAttributes?) -> (() async -> Void)? {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return nil }
        let existing = Activity<NextEventAttributes>.activities
        guard let chosen else {
            return { for activity in existing { await activity.end(nil, dismissalPolicy: .immediate) } }
        }
        let state = content(chosen, now: Date())
        let content = ActivityContent(state: state, staleDate: state.phase == .allDay ? nil : state.rangeEnd)
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

    // An event already underway wins, then the soonest one inside the lead window, then an all-day event today.
    private static func pick(_ items: [CalendarItem], now: Date) -> NextEventAttributes? {
        let timed: [(CalendarItem, Date, Date)] = items.compactMap { item in
            // A goal session already logged as done or skipped is over, whatever the clock says.
            if let status = item.session?.status, status == "done" || status == "skipped" { return nil }
            guard !item.allDay, let start = Format.date(item.start) else { return nil }
            let end = Format.date(item.end).flatMap { $0 > start ? $0 : nil } ?? start.addingTimeInterval(60 * 60)
            guard end > now else { return nil }
            return (item, start, end)
        }
        let underway = timed.filter { $0.1 <= now }.max { $0.1 < $1.1 }
        let upcoming = timed.filter { $0.1 > now && $0.1 <= now.addingTimeInterval(lead) }.min { $0.1 < $1.1 }
        if let chosen = underway ?? upcoming { return attributes(chosen) }
        let cal = Calendar.current
        guard let allDay = items.first(where: { item in
            // Holidays are not something to attend, so they never get a card.
            guard item.allDay, item.kind != "holiday", let day = Format.dayDate(String(item.start.prefix(10))) else { return false }
            return cal.isDate(day, inSameDayAs: now)
        }) else { return nil }
        let day = Format.dayDate(String(allDay.start.prefix(10))) ?? now
        let end = cal.date(byAdding: .day, value: 1, to: cal.startOfDay(for: day)) ?? day
        return NextEventAttributes(id: allDay.id, title: allDay.title, start: day, end: end, allDay: true, place: place(allDay.location))
    }

    private static func attributes(_ chosen: (CalendarItem, Date, Date)) -> NextEventAttributes {
        NextEventAttributes(id: chosen.0.id, title: chosen.0.title, start: chosen.1, end: chosen.2, allDay: false, place: place(chosen.0.location))
    }

    private static func place(_ raw: String?) -> String? { raw.flatMap { $0.isEmpty ? nil : $0 } }

    private static func content(_ event: NextEventAttributes, now: Date) -> NextEventAttributes.ContentState {
        if event.allDay { return .init(phase: .allDay, rangeStart: event.start, rangeEnd: event.start) }
        if now >= event.start { return .init(phase: .now, rangeStart: now, rangeEnd: event.end) }
        return .init(phase: .upcoming, rangeStart: now, rangeEnd: event.start)
    }

    #if DEBUG
    static func showSample(_ mode: String) {
        let now = Date()
        let allDay = mode == "allday"
        let start = mode == "next" ? now.addingTimeInterval(25 * 60) : now.addingTimeInterval(-20 * 60)
        let end = start.addingTimeInterval(60 * 60)
        let attrs = NextEventAttributes(id: 9_999, title: allDay ? "Team offsite" : "Design review", start: allDay ? Calendar.current.startOfDay(for: now) : start, end: end, allDay: allDay, place: "Room 4")
        let state = content(attrs, now: now)
        // Same rule as the real path: ActivityKit's synchronous calls run on the main queue, outside a Swift task.
        DispatchQueue.main.async {
            for a in Activity<NextEventAttributes>.activities { Task { await a.end(nil, dismissalPolicy: .immediate) } }
            do { _ = try Activity.request(attributes: attrs, content: ActivityContent(state: state, staleDate: nil)) }
            catch { print("sample activity failed:", error) }
        }
    }
    #endif
}
