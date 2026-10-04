import SwiftUI

struct SleepView: View {
    @Environment(AppModel.self) private var model
    @State private var loader = Loader<[Night]>()

    var body: some View {
        NavigationStack {
            List {
                ErrorRow(text: loader.error)
                if let nights = loader.value {
                    if let n = nights.first {
                        Section("Last night") {
                            HStack { Stat(label: "Score", value: n.score.map { String(Int($0.rounded())) } ?? "-"); Stat(label: "Asleep", value: Format.minutes(n.sleepMin)); Stat(label: "HRV", value: n.hrv.map { String(Int($0.rounded())) } ?? "-") }
                            HStack { Stat(label: "Deep", value: Format.minutes(n.deepMin)); Stat(label: "REM", value: Format.minutes(n.remMin)); Stat(label: "Light", value: Format.minutes(n.lightMin)) }
                        }
                    }
                    Section("Recent nights") {
                        ForEach(nights) { n in
                            HStack {
                                Text(Format.shortDay(n.day))
                                Spacer()
                                Text(Format.minutes(n.sleepMin)).foregroundStyle(.secondary)
                                Text(n.score.map { String(Int($0.rounded())) } ?? "-").bold().frame(width: 36, alignment: .trailing)
                            }
                        }
                        if nights.isEmpty { Text("No nights imported yet.").foregroundStyle(.secondary) }
                    }
                } else if loader.loading { Section { ProgressView() } }
            }
            .navigationTitle("Sleep")
            .refreshable { await load() }
            .task { await load() }
        }
    }

    private func load() async { await loader.load(model) { try await $0.sleep() } }
}
