import SwiftUI

// One look for the whole app: black canvas, hairline cards, tight corners, greyscale.
// The old colour names stay so charts still separate series by lightness.
enum Theme {
    static let r: CGFloat = 4    // cards
    static let rs: CGFloat = 2   // buttons and chips
    static let bg = Color.black
    static let card = Color(white: 0.06)
    static let raised = Color(white: 0.11)
    static let line = Color.white.opacity(0.14)
    static let muted = Color.white.opacity(0.55)
    static let accent = Color(red: 0.431, green: 0.659, blue: 1)       // focus
    static let blue = accent
    static let violet = Color(red: 0.941, green: 0.443, blue: 0.471)   // money out
    static let sky = Color(white: 0.78)                                 // chrome icons
    static let good = Color(red: 0.243, green: 0.812, blue: 0.557)
    static let bad = Color(red: 0.941, green: 0.443, blue: 0.471)
    static let warm = Color(red: 0.902, green: 0.694, blue: 0.361)
    static func mood(_ value: Int) -> Color {
        switch min(max(value, 1), 5) {
        case 1: Color(red: 0.941, green: 0.443, blue: 0.471)
        case 2: Color(red: 0.769, green: 0.518, blue: 0.416)
        case 3: Color(white: 0.541)
        case 4: Color(red: 0.490, green: 0.729, blue: 0.604)
        default: Color(red: 0.243, green: 0.812, blue: 0.557)
        }
    }
}

struct Card<Content: View>: View {
    var title: String? = nil
    var trailing: String? = nil
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if title != nil || trailing != nil {
                HStack {
                    if let title { Text(title.uppercased()).font(.caption.weight(.semibold)).tracking(0.8).foregroundStyle(Theme.muted) }
                    Spacer()
                    if let trailing { Text(trailing).font(.caption).foregroundStyle(Theme.muted) }
                }
            }
            content
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .panel()
    }
}

// A screen: scrolling stack of cards on the canvas, pull to refresh.
struct Screen<Content: View, Trailing: View>: View {
    let title: String
    var refresh: (() async -> Void)? = nil
    @ViewBuilder var trailing: Trailing
    @ViewBuilder var content: Content

    init(title: String, refresh: (() async -> Void)? = nil, @ViewBuilder trailing: () -> Trailing, @ViewBuilder content: () -> Content) {
        self.title = title; self.refresh = refresh; self.trailing = trailing(); self.content = content()
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 10) { content }
                .padding(.horizontal, 14).padding(.top, 6).padding(.bottom, 110)
        }
        .scrollIndicators(.hidden)
        .refreshable { await refresh?() }
        .screenHeader(title) { trailing }
        .background(Ambient())
    }
}

extension Screen where Trailing == EmptyView {
    init(title: String, refresh: (() async -> Void)? = nil, @ViewBuilder content: () -> Content) {
        self.init(title: title, refresh: refresh, trailing: { EmptyView() }, content: content)
    }
}

// Flat black behind every screen.
struct Ambient: View {
    var body: some View { Theme.bg.ignoresSafeArea() }
}

extension View {
    // A flat fill with a hairline, the surface used for cards and chips.
    func panel(_ radius: CGFloat = Theme.r, fill: Color = Theme.card) -> some View {
        background(fill, in: RoundedRectangle(cornerRadius: radius))
            .overlay { RoundedRectangle(cornerRadius: radius).strokeBorder(Theme.line, lineWidth: 1) }
    }

    // A compact button surface; `tint` marks a selected or taken state.
    func chip(_ tint: Color? = nil) -> some View {
        panel(Theme.rs, fill: tint ?? Theme.raised)
    }
}

struct Big: View {
    let text: String
    var size: CGFloat = 44
    var body: some View { Text(text).font(.system(size: size, weight: .semibold)).monospacedDigit().minimumScaleFactor(0.6).lineLimit(1) }
}

struct Stat: View {
    let label: String
    let value: String
    var tint: Color = .white
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(value).font(.system(size: 22, weight: .semibold)).monospacedDigit().foregroundStyle(tint).minimumScaleFactor(0.7).lineLimit(1)
            Text(label).font(.caption).foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct ErrorBanner: View {
    let text: String?
    var body: some View {
        if let text {
            Text(text).font(.subheadline).foregroundStyle(Theme.bad).frame(maxWidth: .infinity, alignment: .leading)
                .padding(14).background(Theme.bad.opacity(0.12), in: RoundedRectangle(cornerRadius: Theme.rs))
        }
    }
}

struct Empty: View {
    let text: String
    var body: some View { Text(text).font(.subheadline).foregroundStyle(Theme.muted) }
}

struct ScoreRing: View {
    let score: Double?
    var size: CGFloat = 132
    private var fraction: Double { min(max((score ?? 0) / 100, 0), 1) }
    var body: some View {
        ZStack {
            Circle().stroke(Theme.raised, lineWidth: 12)
            Circle().trim(from: 0, to: fraction).stroke(Theme.accent, style: StrokeStyle(lineWidth: 12, lineCap: .butt)).rotationEffect(.degrees(-90))
            VStack(spacing: 0) {
                Text(score.map { String(Int($0.rounded())) } ?? "-").font(.system(size: size * 0.32, weight: .semibold)).monospacedDigit()
                Text("score").font(.caption2).foregroundStyle(Theme.muted)
            }
        }
        .frame(width: size, height: size)
    }
}

// Deep / REM / light / awake as one proportional bar with a legend.
struct StageBar: View {
    let night: Night
    private var parts: [(String, Double, Color)] {
        [("Deep", night.deepMin ?? 0, Theme.accent), ("REM", night.remMin ?? 0, Color(red: 0.541, green: 0.643, blue: 0.800)), ("Light", night.lightMin ?? 0, Color(red: 0.290, green: 0.333, blue: 0.408)), ("Awake", night.awakeMin ?? 0, Theme.warm)]
    }
    var body: some View {
        let total = max(parts.reduce(0) { $0 + $1.1 }, 1)
        VStack(alignment: .leading, spacing: 10) {
            GeometryReader { g in
                HStack(spacing: 2) {
                    ForEach(parts, id: \.0) { p in
                        Rectangle().fill(p.2).frame(width: max(2, (g.size.width - 6) * p.1 / total))
                    }
                }
            }
            .frame(height: 8)
            HStack {
                ForEach(parts, id: \.0) { p in
                    HStack(spacing: 5) { Circle().fill(p.2).frame(width: 7, height: 7); Text("\(p.0) \(Format.minutes(p.1))").font(.caption2).foregroundStyle(Theme.muted) }
                    if p.0 != "Awake" { Spacer(minLength: 0) }
                }
            }
        }
    }
}

struct EventRow: View {
    let item: CalendarItem
    // Ordinary events stay quiet. Colour marks a holiday, a workout, or a prep day.
    private var mark: Color {
        switch item.kind {
        case "holiday", "prep": Theme.warm
        case "workout": Theme.good
        default: Color.white.opacity(0.28)
        }
    }
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Rectangle().fill(mark).frame(width: 2)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title).font(.body.weight(.medium))
                HStack(spacing: 6) {
                    Text(Format.time(item)).font(.caption).foregroundStyle(Theme.muted)
                    if let place = item.location, !place.isEmpty { Text("· \(place)").font(.caption).foregroundStyle(Theme.muted).lineLimit(1) }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 2)
    }
}

struct InsightRow: View {
    let insight: Insight
    private var tint: Color { insight.tone == "good" ? Theme.good : insight.tone == "warn" ? Theme.warm : Theme.blue }
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Circle().fill(tint).frame(width: 8, height: 8).padding(.top, 6)
            VStack(alignment: .leading, spacing: 2) {
                Text(insight.title).font(.subheadline.weight(.semibold))
                Text(insight.detail).font(.caption).foregroundStyle(Theme.muted)
            }
        }
    }
}

// Horizontal proportional bars, the way a budgeting app shows where money went.
struct BarList: View {
    let rows: [(label: String, value: Double)]
    var body: some View {
        let top = max(rows.map(\.value).max() ?? 1, 1)
        VStack(spacing: 12) {
            ForEach(rows, id: \.label) { r in
                VStack(alignment: .leading, spacing: 5) {
                    HStack { Text(r.label).font(.subheadline); Spacer(); Text(Format.money(r.value)).font(.subheadline.weight(.medium)).monospacedDigit() }
                    GeometryReader { g in Rectangle().fill(Theme.accent).frame(width: max(2, g.size.width * r.value / top)) }.frame(height: 4)
                }
            }
        }
    }
}
