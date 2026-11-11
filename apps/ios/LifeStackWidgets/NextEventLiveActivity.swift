import ActivityKit
import SwiftUI
import WidgetKit

struct NextEventLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: NextEventAttributes.self) { context in
            LockCard(context: context)
                .activityBackgroundTint(Color(white: 0.07))
                .activitySystemActionForegroundColor(WColor.blue)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading, spacing: 2) {
                        StatusLabel(context: context)
                        Text(context.attributes.title).font(.headline).lineLimit(2).minimumScaleFactor(0.85)
                    }
                    .padding(.leading, 10).padding(.top, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Countdown(context: context)
                        .font(.system(.title2, design: .rounded).weight(.semibold).monospacedDigit())
                        .foregroundStyle(phaseColor(context))
                        .multilineTextAlignment(.trailing)
                        .padding(.trailing, 10).padding(.top, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(spacing: 8) {
                        ProgressRow(context: context)
                        HStack {
                            Text(detail(context)).lineLimit(1)
                            Spacer()
                            if !context.attributes.allDay {
                                Text(context.attributes.end.formatted(date: .omitted, time: .shortened))
                            }
                        }
                        .font(.caption).foregroundStyle(WColor.muted)
                    }
                    // The island's bottom corners are deeply rounded, so the row is inset well clear of them.
                    .padding(.horizontal, 16).padding(.top, 4).padding(.bottom, 10)
                }
            } compactLeading: {
                LogoMark().frame(width: 22, height: 18)
            } compactTrailing: {
                Countdown(context: context)
                    .font(.system(.caption, design: .rounded).weight(.semibold).monospacedDigit())
                    .foregroundStyle(phaseColor(context))
                    .frame(maxWidth: 58)
            } minimal: {
                LogoMark().frame(width: 18, height: 15)
            }
            .keylineTint(phaseColor(context))
        }
    }
}

// The Life Stack mark (three stacked layers), drawn as vectors because the widget has no asset catalog.
// Points are from the 608 x 496 logo artwork, so it matches the app icon exactly.
private struct LogoMark: View {
    var body: some View {
        Canvas { ctx, size in
            let k = min(size.width / 608, size.height / 496)
            let dx = (size.width - 608 * k) / 2, dy = (size.height - 496 * k) / 2
            func fill(_ pts: [(CGFloat, CGFloat)], _ color: Color) {
                var path = Path()
                for (i, p) in pts.enumerated() {
                    let q = CGPoint(x: dx + p.0 * k, y: dy + p.1 * k)
                    if i == 0 { path.move(to: q) } else { path.addLine(to: q) }
                }
                path.closeSubpath()
                ctx.fill(path, with: .color(color))
            }
            fill([(32, 120), (304, 32), (576, 120), (304, 207)], WColor.blue)
            fill([(32, 208), (304, 296), (576, 208), (576, 264), (304, 352), (32, 264)], Color(white: 0.54))
            fill([(32, 320), (304, 408), (576, 320), (576, 376), (304, 464), (32, 376)], Color(white: 0.30))
        }
        .accessibilityHidden(true)
    }
}

private struct LockCard: View {
    let context: ActivityViewContext<NextEventAttributes>

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    StatusLabel(context: context)
                    Text(context.attributes.title)
                        .font(.title3.weight(.semibold)).lineLimit(2).minimumScaleFactor(0.85)
                    Text(detail(context)).font(.subheadline).foregroundStyle(WColor.muted).lineLimit(1)
                }
                Spacer(minLength: 8)
                Countdown(context: context)
                    .font(.system(size: 34, weight: .semibold, design: .rounded).monospacedDigit())
                    .foregroundStyle(phaseColor(context))
                    .minimumScaleFactor(0.6).lineLimit(1)
                    .multilineTextAlignment(.trailing)
                    .frame(maxWidth: 128, alignment: .trailing)
            }
            if !context.attributes.allDay { ProgressRow(context: context) }
        }
        .padding(.horizontal, 16).padding(.vertical, 14)
    }
}

// "NOW", "UP NEXT" or "TODAY", in the same quiet caps Apple's own cards use.
private struct StatusLabel: View {
    let context: ActivityViewContext<NextEventAttributes>
    var body: some View {
        Label(phaseLabel(context), systemImage: phaseIcon(context))
            .font(.caption.weight(.semibold)).textCase(.uppercase).tracking(0.6)
            .foregroundStyle(phaseColor(context)).labelStyle(.titleAndIcon)
    }
}

// Elapsed share of the event while it is underway; a faint empty track before it starts.
private struct ProgressRow: View {
    let context: ActivityViewContext<NextEventAttributes>
    var body: some View {
        if context.state.phase == .now, !context.isStale {
            ProgressView(timerInterval: context.attributes.start...context.attributes.end, countsDown: false) { EmptyView() } currentValueLabel: { EmptyView() }
                .progressViewStyle(.linear).tint(phaseColor(context))
        } else {
            Capsule().fill(Color.white.opacity(0.12)).frame(height: 4)
        }
    }
}

private struct Countdown: View {
    let context: ActivityViewContext<NextEventAttributes>

    var body: some View {
        if context.state.phase == .allDay {
            Text("All day")
        } else if context.isStale {
            Text(context.state.phase == .now ? "Ended" : "Now")
        } else if let range = context.state.countdown {
            Text(timerInterval: range, countsDown: true, showsHours: true)
        } else {
            Text("Now")
        }
    }
}

private func phaseLabel(_ context: ActivityViewContext<NextEventAttributes>) -> String {
    if context.state.phase == .allDay { return "Today" }
    if context.isStale { return context.state.phase == .now ? "Ended" : "Starting" }
    return context.state.phase == .now ? "Now" : "Up next"
}

private func phaseIcon(_ context: ActivityViewContext<NextEventAttributes>) -> String {
    switch context.state.phase {
    case .now: "clock.fill"
    case .upcoming: "calendar"
    case .allDay: "sun.max.fill"
    }
}

private func phaseColor(_ context: ActivityViewContext<NextEventAttributes>) -> Color {
    switch context.state.phase {
    case .now: WColor.good
    case .upcoming: WColor.blue
    case .allDay: Color(red: 0.902, green: 0.694, blue: 0.361)
    }
}

private func detail(_ context: ActivityViewContext<NextEventAttributes>) -> String {
    if context.attributes.allDay {
        return context.attributes.place.map { "All day · \($0)" } ?? "All day"
    }
    let time = context.attributes.start.formatted(date: .omitted, time: .shortened)
    if let place = context.attributes.place, !place.isEmpty { return "\(time) · \(place)" }
    return time
}
