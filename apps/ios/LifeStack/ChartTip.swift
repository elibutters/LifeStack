import Charts
import SwiftUI

// The bubble shown above a chart while a bar or point is selected (press or drag on the chart).
struct TipBubble: View {
    let lines: [String]
    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            ForEach(Array(lines.enumerated()), id: \.offset) { i, l in
                Text(l).font(i == 0 ? .caption.weight(.semibold) : .caption).foregroundStyle(i == 0 ? Color.white : Theme.muted)
            }
        }
        .padding(.horizontal, 9).padding(.vertical, 6)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(Theme.line))
    }
}

// Drop inside a Chart: shows the guide line and tooltip for the selected category, if any.
struct SelectionMark: ChartContent {
    let x: String?
    let lines: [String]
    var body: some ChartContent {
        if let x {
            RuleMark(x: .value("Selected", x))
                .foregroundStyle(Theme.muted.opacity(0.5))
                .lineStyle(StrokeStyle(lineWidth: 1))
                .annotation(position: .top, spacing: 2, overflowResolution: .init(x: .fit(to: .chart), y: .disabled)) { TipBubble(lines: lines) }
        }
    }
}
