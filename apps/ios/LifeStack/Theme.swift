import SwiftUI

// One look for the whole app: near-black canvas, soft cards, big numbers, and the blue-to-violet of the logo.
enum Theme {
    static let bg = Color(red: 0.039, green: 0.039, blue: 0.043)
    static let card = Color(red: 0.082, green: 0.082, blue: 0.094)
    static let raised = Color(red: 0.118, green: 0.118, blue: 0.133)
    static let line = Color.white.opacity(0.07)
    static let muted = Color.white.opacity(0.55)
    static let blue = Color(red: 0.30, green: 0.44, blue: 1.0)
    static let violet = Color(red: 0.56, green: 0.48, blue: 0.94)
    static let sky = Color(red: 0.66, green: 0.76, blue: 1.0)
    static let good = Color(red: 0.20, green: 0.83, blue: 0.60)
    static let bad = Color(red: 0.97, green: 0.44, blue: 0.44)
    static let warm = Color(red: 1.0, green: 0.72, blue: 0.30)
    static let accent = LinearGradient(colors: [blue, violet], startPoint: .topLeading, endPoint: .bottomTrailing)
}

struct Card<Content: View>: View {
    var title: String? = nil
    var trailing: String? = nil
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if title != nil || trailing != nil {
                HStack {
                    if let title { Text(title.uppercased()).font(.caption.weight(.semibold)).tracking(0.8).foregroundStyle(Theme.muted) }
                    Spacer()
                    if let trailing { Text(trailing).font(.caption).foregroundStyle(Theme.muted) }
                }
            }
            content
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(Theme.line, lineWidth: 1))
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
            VStack(spacing: 14) { content }
                .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 110)
        }
        .scrollIndicators(.hidden)
        .refreshable { await refresh?() }
        .background(Theme.bg.ignoresSafeArea())
        .screenHeader(title) { trailing }
    }
}

extension Screen where Trailing == EmptyView {
    init(title: String, refresh: (() async -> Void)? = nil, @ViewBuilder content: () -> Content) {
        self.init(title: title, refresh: refresh, trailing: { EmptyView() }, content: content)
    }
}

struct Big: View {
    let text: String
    var size: CGFloat = 44
    var body: some View { Text(text).font(.system(size: size, weight: .semibold, design: .rounded)).monospacedDigit().minimumScaleFactor(0.6).lineLimit(1) }
}

struct Stat: View {
    let label: String
    let value: String
    var tint: Color = .white
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(value).font(.system(size: 22, weight: .semibold, design: .rounded)).monospacedDigit().foregroundStyle(tint).minimumScaleFactor(0.7).lineLimit(1)
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
                .padding(14).background(Theme.bad.opacity(0.12), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
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
            Circle().trim(from: 0, to: fraction).stroke(Theme.accent, style: StrokeStyle(lineWidth: 12, lineCap: .round)).rotationEffect(.degrees(-90))
            VStack(spacing: 0) {
                Text(score.map { String(Int($0.rounded())) } ?? "-").font(.system(size: size * 0.32, weight: .semibold, design: .rounded)).monospacedDigit()
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
        [("Deep", night.deepMin ?? 0, Theme.blue), ("REM", night.remMin ?? 0, Theme.violet), ("Light", night.lightMin ?? 0, Theme.sky.opacity(0.55)), ("Awake", night.awakeMin ?? 0, Color.white.opacity(0.22))]
    }
    var body: some View {
        let total = max(parts.reduce(0) { $0 + $1.1 }, 1)
        VStack(alignment: .leading, spacing: 10) {
            GeometryReader { g in
                HStack(spacing: 2) {
                    ForEach(parts, id: \.0) { p in
                        RoundedRectangle(cornerRadius: 4).fill(p.2).frame(width: max(2, (g.size.width - 6) * p.1 / total))
                    }
                }
            }
            .frame(height: 14).clipShape(Capsule())
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
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Capsule().fill(item.kind == "holiday" ? Theme.warm : Theme.blue).frame(width: 4)
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
                    GeometryReader { g in Capsule().fill(Theme.accent).frame(width: max(6, g.size.width * r.value / top)) }.frame(height: 6)
                }
            }
        }
    }
}
