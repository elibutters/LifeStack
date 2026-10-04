import SwiftUI

private let moodLabels = [1: "Low", 2: "Meh", 3: "Okay", 4: "Good", 5: "Great"]
private let drinks = ["Coffee", "Espresso", "Cold brew", "Tea", "Energy drink", "Soda"]

struct TodayView: View {
    @Environment(AppModel.self) private var model
    @State private var tapped = 0

    var body: some View {
        NavigationStack {
            List {
                if let message = model.message {
                    Section { Text(message).foregroundStyle(.red) }
                }
                summary
                moodSection
                caffeineSection
                supplementSection
            }
            .screenHeader("Log") {
                Menu {
                    Button("Sign out", role: .destructive) { model.signOut() }
                } label: { Image(systemName: "person.crop.circle").font(.title2) }
            }
            .refreshable { await model.refresh() }
            .sensoryFeedback(.success, trigger: tapped)
            .task { await model.refresh() }
        }
    }

    @ViewBuilder private var summary: some View {
        if let t = model.today {
            Section(t.date) {
                LabeledContent("Mood", value: t.mood.map { "\($0.value) \(moodLabels[$0.value] ?? "")" } ?? "Not logged")
                LabeledContent("Caffeine", value: t.caffeine.count == 0 ? "None" : "\(t.caffeine.count) drink\(t.caffeine.count == 1 ? "" : "s"), \(Int(t.caffeine.mg)) mg")
                LabeledContent("Supplements", value: t.supplements.isEmpty ? "None" : t.supplements.map { $0.count > 1 ? "\($0.name) x\($0.count)" : $0.name }.joined(separator: ", "))
            }
        } else {
            Section { ProgressView() }
        }
    }

    private var moodSection: some View {
        Section("Mood") {
            HStack(spacing: 8) {
                ForEach(1...5, id: \.self) { n in
                    Button { send(["type": "mood", "value": n]) } label: {
                        VStack(spacing: 2) { Text("\(n)").font(.title3.bold()); Text(moodLabels[n] ?? "").font(.caption2) }
                            .frame(maxWidth: .infinity, minHeight: 48)
                    }
                    .buttonStyle(.bordered)
                }
            }
            .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
        }
    }

    private var caffeineSection: some View {
        Section("Caffeine") {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 100), spacing: 8)], spacing: 8) {
                ForEach(drinks, id: \.self) { d in
                    Button { send(["type": "caffeine", "drink": d]) } label: { Text(d).frame(maxWidth: .infinity, minHeight: 36) }
                        .buttonStyle(.bordered)
                }
            }
            .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
        }
    }

    @ViewBuilder private var supplementSection: some View {
        if !model.supplements.isEmpty {
            Section("Supplements") {
                ForEach(model.supplements, id: \.self) { name in
                    Button { send(["type": "supplement", "name": name]) } label: {
                        HStack { Text(name); Spacer(); Image(systemName: "plus.circle") }
                    }
                }
            }
        }
    }

    private func send(_ event: [String: Any]) {
        Task { if await model.log(event) { tapped += 1 } }
    }
}
