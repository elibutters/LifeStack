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
        let previous = pending
        let task = Task { @MainActor in
            await previous?.value
            await run(model)
        }
        pending = task
        await task.value
    }

    private static func run(_ model: AppModel) async {
        guard let client = model.client, let overview = try? await client.overview() else { return }
        let chosen = pick(overview, now: Date())
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
    private static func pick(_ overview: Overview, now: Date) -> NextEventAttributes? {
        let items = (overview.calendar?.today ?? []) + (overview.calendar?.soon ?? [])
        let timed: [(CalendarItem, Date, Date)] = items.compactMap { item in
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
            guard item.allDay, let day = Format.dayDate(String(item.start.prefix(10))) else { return false }
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
}
