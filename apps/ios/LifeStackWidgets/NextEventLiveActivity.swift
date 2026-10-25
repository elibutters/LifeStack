import ActivityKit
import SwiftUI
import WidgetKit

struct NextEventLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: NextEventAttributes.self) { context in
            LockCard(context: context)
                .activityBackgroundTint(WColor.bg)
                .activitySystemActionForegroundColor(WColor.sky)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text(context.attributes.title).font(.headline).lineLimit(1)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Countdown(context: context).font(.headline.monospacedDigit())
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text(detail(context)).font(.caption).foregroundStyle(WColor.muted).lineLimit(1)
                }
            } compactLeading: {
                Image(systemName: "calendar").foregroundStyle(WColor.sky)
            } compactTrailing: {
                Countdown(context: context).font(.caption.monospacedDigit()).frame(maxWidth: 64)
            } minimal: {
                Image(systemName: "calendar").foregroundStyle(WColor.sky)
            }
        }
    }
}

private struct LockCard: View {
    let context: ActivityViewContext<NextEventAttributes>

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: "calendar").font(.title2).foregroundStyle(WColor.sky).frame(width: 36)
            VStack(alignment: .leading, spacing: 2) {
                Text(context.attributes.title).font(.headline).lineLimit(1)
                Text(detail(context)).font(.caption).foregroundStyle(WColor.muted).lineLimit(1)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 0) {
                Countdown(context: context).font(.system(.title3).weight(.semibold))
                if context.state.phase != .allDay && !context.isStale {
                    Text(context.state.phase == .now ? "left" : "until").font(.caption2).foregroundStyle(WColor.muted)
                }
            }
        }
        .padding(.horizontal, 2)
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
            Text(timerInterval: range, countsDown: true).monospacedDigit()
        } else {
            Text("Now")
        }
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
