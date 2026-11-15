import ActivityKit
import Foundation

// Shared by the app and the widget extension. The title, times and style stay fixed for one event.
// The countdown or the running timer is the part that changes, and it stays small enough for ActivityKit.
struct NextEventAttributes: ActivityAttributes {
    // A run and a lift get their own timer. Anything else on the calendar uses the plain timer.
    enum Style: String, Codable, Hashable, Sendable {
        case run, lift, event

        var label: String {
            switch self {
            case .run: "Run"
            case .lift: "Lift"
            case .event: "Timer"
            }
        }

        var symbol: String {
            switch self {
            case .run: "figure.run"
            case .lift: "dumbbell.fill"
            case .event: "timer"
            }
        }

        // Word boundaries, so "press" matches a lift and not a longer unrelated word. A workout with no sport in the
        // title is treated as a lift. A ride, swim, walk or similar stays the plain timer.
        static func choose(title: String, kind: String) -> Style {
            let options: String.CompareOptions = [.regularExpression, .caseInsensitive]
            if title.range(of: #"\b(runs?|running|jog|strides?|tempo|intervals?|fartlek|parkrun|race|5k|10k)\b"#, options: options) != nil { return .run }
            if title.range(of: #"\b(lifts?|lifting|strength|weights?|gym|squats?|deadlifts?|bench|press|legs|upper|lower)\b"#, options: options) != nil { return .lift }
            if title.range(of: #"\b(rides?|riding|bike|cycl\w*|spin|swims?|swimming|walks?|walking|hikes?|hiking|yoga|rows?|rowing)\b"#, options: options) != nil { return .event }
            if kind == "workout" { return .lift }
            return .event
        }
    }

    struct ContentState: Codable, Hashable, Sendable {
        enum Phase: String, Codable, Hashable, Sendable { case upcoming, now, allDay, timing }
        var phase: Phase
        var rangeStart: Date
        var rangeEnd: Date
        var startedAt: Date?

        var countdown: ClosedRange<Date>? { rangeStart < rangeEnd ? rangeStart...rangeEnd : nil }

        init(phase: Phase, rangeStart: Date, rangeEnd: Date, startedAt: Date? = nil) {
            self.phase = phase
            self.rangeStart = rangeStart
            self.rangeEnd = rangeEnd
            self.startedAt = startedAt
        }

        private enum CodingKeys: String, CodingKey { case phase, rangeStart, rangeEnd, startedAt }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            phase = try c.decode(Phase.self, forKey: .phase)
            rangeStart = try c.decode(Date.self, forKey: .rangeStart)
            rangeEnd = try c.decode(Date.self, forKey: .rangeEnd)
            startedAt = try c.decodeIfPresent(Date.self, forKey: .startedAt)
        }

        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(phase, forKey: .phase)
            try c.encode(rangeStart, forKey: .rangeStart)
            try c.encode(rangeEnd, forKey: .rangeEnd)
            try c.encodeIfPresent(startedAt, forKey: .startedAt)
        }
    }

    var id: Int
    var title: String
    var start: Date
    var end: Date
    var allDay: Bool
    var place: String?
    var style: Style
    // The session's plan, a few short lines: a heading ends in a colon, anything else is a step or a movement.
    var plan: [String]
    // Names the calendar item the same way on every device, so the server timer can say which one is running.
    var itemKey: String

    // ActivityKit keeps attributes small, so a plan is cut to a few short lines.
    static func planLines(_ blocks: [(kind: String, text: String)]) -> [String] {
        var out: [String] = []
        var used = 0
        for b in blocks {
            var t = b.text.trimmingCharacters(in: .whitespacesAndNewlines)
            if t.isEmpty { continue }
            if b.kind == "heading" { t = t.hasSuffix(":") ? t : t + ":" }
            if t.count > 64 { t = String(t.prefix(61)) + "..." }
            if out.count >= 10 || used + t.count > 640 { break }
            out.append(t); used += t.count
        }
        return out
    }

    init(id: Int, title: String, start: Date, end: Date, allDay: Bool, place: String?, style: Style = .event, plan: [String] = [], itemKey: String? = nil) {
        self.id = id
        self.title = title
        self.start = start
        self.end = end
        self.allDay = allDay
        self.place = place
        self.style = style
        self.plan = plan
        self.itemKey = itemKey ?? "ev:\(id)"
    }

    private enum CodingKeys: String, CodingKey { case id, title, start, end, allDay, place, style, plan, itemKey }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        title = try c.decode(String.self, forKey: .title)
        start = try c.decode(Date.self, forKey: .start)
        end = try c.decode(Date.self, forKey: .end)
        allDay = try c.decode(Bool.self, forKey: .allDay)
        place = try c.decodeIfPresent(String.self, forKey: .place)
        style = try c.decodeIfPresent(Style.self, forKey: .style) ?? .event
        plan = try c.decodeIfPresent([String].self, forKey: .plan) ?? []
        itemKey = try c.decodeIfPresent(String.self, forKey: .itemKey) ?? "ev:\(id)"
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(title, forKey: .title)
        try c.encode(start, forKey: .start)
        try c.encode(end, forKey: .end)
        try c.encode(allDay, forKey: .allDay)
        try c.encodeIfPresent(place, forKey: .place)
        try c.encode(style, forKey: .style)
        try c.encode(plan, forKey: .plan)
        try c.encode(itemKey, forKey: .itemKey)
    }
}
