import ActivityKit
import SwiftUI

// The lock-screen card, mirrored at the top of Overview while it is up: the same plan, the same clock, and the same Start and Stop.
struct LiveCard: View {
    @State private var tick = 0

    private var activity: Activity<NextEventAttributes>? {
        let all = Activity<NextEventAttributes>.activities.filter { $0.activityState == .active }
        return all.first { $0.content.state.phase == .timing } ?? all.first
    }

    var body: some View {
        TimelineView(.periodic(from: .now, by: 5)) { _ in
            if let a = activity, a.content.state.phase != .allDay { card(a) }
        }
        .id(tick)
        .onReceive(NotificationCenter.default.publisher(for: .sessionTimerChanged)) { _ in tick += 1 }
    }

    private func tint(_ a: Activity<NextEventAttributes>) -> Color {
        switch a.attributes.style {
        case .run: Theme.good
        case .lift: Theme.warm
        case .event: Theme.accent
        }
    }

    @ViewBuilder private func card(_ a: Activity<NextEventAttributes>) -> some View {
        let state = a.content.state
        let attrs = a.attributes
        let started = Date() >= attrs.start
        let timing = state.phase == .timing
        let color = timing || started ? tint(a) : Theme.accent
        let label = timing ? attrs.style.label : (started ? "Now" : "Up next")
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Label(label, systemImage: timing ? attrs.style.symbol : (started ? "clock.fill" : "calendar"))
                        .font(.caption.weight(.semibold)).textCase(.uppercase).tracking(0.6).foregroundStyle(color)
                    Text(attrs.title).font(.title3.weight(.semibold)).lineLimit(2)
                    Text(attrs.start.formatted(date: .omitted, time: .shortened)).font(.subheadline).foregroundStyle(Theme.muted)
                }
                Spacer(minLength: 8)
                clock(state, attrs, started: started).font(.system(size: 30, weight: .semibold, design: .rounded).monospacedDigit()).foregroundStyle(color)
            }
            if (timing || started), !attrs.plan.isEmpty { plan(attrs.plan, color) }
            Button {
                Task { if timing { _ = try? await StopSessionIntent().perform() } else { _ = try? await StartSessionIntent().perform() } }
            } label: {
                Image(systemName: timing ? "stop.fill" : "play.fill").font(.title3).accessibilityLabel(timing ? "Stop" : "Play").frame(maxWidth: .infinity).padding(.vertical, 10)
                    .background(timing ? Theme.bad : color, in: RoundedRectangle(cornerRadius: Theme.r))
                    .foregroundStyle(timing ? Color.white : Color.black)
            }
            .buttonStyle(.plain)
        }
        .padding(16)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.r))
        .overlay(RoundedRectangle(cornerRadius: Theme.r).stroke(color.opacity(0.6), lineWidth: 1))
        .accessibilityIdentifier("live-card")
    }

    @ViewBuilder private func clock(_ state: NextEventAttributes.ContentState, _ attrs: NextEventAttributes, started: Bool) -> some View {
        if state.phase == .timing, let s = state.startedAt {
            Text(s, style: .timer)
        } else if started {
            Text(attrs.start, style: .timer)
        } else {
            Text(attrs.start, style: .timer)
        }
    }

    private func plan(_ lines: [String], _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                if line.hasSuffix(":") {
                    Text(String(line.dropLast())).font(.caption2.weight(.semibold)).textCase(.uppercase).tracking(0.5).foregroundStyle(color).padding(.top, 3)
                } else {
                    Text(line).font(.footnote).foregroundStyle(.white.opacity(0.88))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
