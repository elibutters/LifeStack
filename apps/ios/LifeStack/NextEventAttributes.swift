import ActivityKit
import Foundation

// Shared by the app and the widget extension. The title and times are fixed for one event.
// The countdown window is the part that changes, and it stays small enough for ActivityKit.
struct NextEventAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable, Sendable {
        enum Phase: String, Codable, Hashable, Sendable { case upcoming, now, allDay }
        var phase: Phase
        var rangeStart: Date
        var rangeEnd: Date
        var countdown: ClosedRange<Date>? { rangeStart < rangeEnd ? rangeStart...rangeEnd : nil }
    }

    var id: Int
    var title: String
    var start: Date
    var end: Date
    var allDay: Bool
    var place: String?
}
