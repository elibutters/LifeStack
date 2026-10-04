import Charts
import SwiftUI

struct SleepView: View {
    @Environment(AppModel.self) private var model
    @State private var loader = Loader<[Night]>()

    var body: some View {
        Screen(title: "Sleep", refresh: { await load() }) {
            ErrorBanner(text: loader.error)
            if let nights = loader.value {
                if let n = nights.first {
                    Card(title: "Last night", trailing: Format.shortDay(n.day)) {
                        HStack(spacing: 22) {
                            ScoreRing(score: n.score, size: 128)
                            VStack(alignment: .leading, spacing: 14) {
                                Stat(label: "Time asleep", value: Format.minutes(n.sleepMin))
                                HStack { Stat(label: "HRV", value: n.hrv.map { String(Int($0.rounded())) } ?? "-"); Stat(label: "Resp", value: n.respiratoryAvg.map { String(format: "%.1f", $0) } ?? "-") }
                            }
                        }
                        StageBar(night: n)
                    }
                    Card(title: "Score, last \(nights.count) nights") {
                        Chart(nights.reversed()) { x in
                            BarMark(x: .value("Night", x.day), y: .value("Score", x.score ?? 0), width: .fixed(14))
                                .foregroundStyle(Theme.accent).cornerRadius(5)
                        }
                        .chartXAxis(.hidden)
                        .chartYScale(domain: 0...100)
                        .chartYAxis { AxisMarks(values: [0, 50, 100]) { _ in AxisGridLine().foregroundStyle(Theme.line); AxisValueLabel().foregroundStyle(Theme.muted) } }
                        .frame(height: 150)
                    }
                    Card(title: "Nights") {
                        VStack(spacing: 0) {
                            ForEach(nights) { x in
                                HStack {
                                    Text(Format.shortDay(x.day)).font(.subheadline)
                                    Spacer()
                                    Text(Format.minutes(x.sleepMin)).font(.subheadline).foregroundStyle(Theme.muted)
                                    Text(x.score.map { String(Int($0.rounded())) } ?? "-").font(.subheadline.weight(.semibold)).monospacedDigit().frame(width: 38, alignment: .trailing)
                                }
                                .padding(.vertical, 9)
                                if x.id != nights.last?.id { Divider().overlay(Theme.line) }
                            }
                        }
                    }
                } else { Card { Empty(text: "No nights imported yet.") } }
            } else if loader.loading { ProgressView().padding(.top, 60) }
        }
        .task { await load() }
    }

    private func load() async { await loader.load(model) { try await $0.sleep() } }
}
