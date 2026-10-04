import SwiftUI

private let moodLabels = [1: "Low", 2: "Meh", 3: "Okay", 4: "Good", 5: "Great"]
private let drinks: [(String, Int)] = [("Coffee", 95), ("Espresso", 64), ("Cold brew", 150), ("Tea", 47), ("Energy drink", 80), ("Soda", 34)]

struct TodayView: View {
    @Environment(AppModel.self) private var model
    @State private var tapped = 0

    private func count(_ name: String) -> Int { model.today?.supplements.first { $0.name == name }?.count ?? 0 }

    var body: some View {
        ZStack(alignment: .bottom) {
            Screen(title: "Log", refresh: { await model.refresh() }) {
                ErrorBanner(text: model.message)
                summary
                moodCard
                caffeineCard
                supplementCard
                todayList
            }
            if let t = model.toast { toast(t).padding(.bottom, 96).transition(.move(edge: .bottom).combined(with: .opacity)) }
        }
        .animation(.spring(duration: 0.3), value: model.toast)
        .sensoryFeedback(.success, trigger: tapped)
        .task { await model.refresh() }
    }

    private var summary: some View {
        Card {
            HStack(alignment: .top) {
                Stat(label: "Mood", value: model.today?.mood.map { "\($0.value) \(moodLabels[$0.value] ?? "")" } ?? "None yet")
                Stat(label: "Caffeine", value: (model.today?.caffeine.count ?? 0) == 0 ? "None" : "\(Int(model.today?.caffeine.mg ?? 0)) mg")
                Stat(label: "Supplements", value: "\(model.today?.supplements.count ?? 0) taken")
            }
        }
    }

    private var moodCard: some View {
        Card(title: "Mood") {
            HStack(spacing: 8) {
                ForEach(1...5, id: \.self) { n in
                    let on = model.today?.mood?.value == n
                    Button { send(["type": "mood", "value": n], "Mood \(n) (\(moodLabels[n] ?? ""))") } label: {
                        VStack(spacing: 3) {
                            Text("\(n)").font(.system(size: 22, weight: .semibold, design: .rounded))
                            Text(moodLabels[n] ?? "").font(.caption2)
                        }
                        .frame(maxWidth: .infinity, minHeight: 62)
                        .foregroundStyle(on ? .white : .white.opacity(0.85))
                        .background(on ? AnyShapeStyle(Theme.accent) : AnyShapeStyle(Theme.raised), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .disabled(model.pending)
                }
            }
        }
    }

    private var caffeineCard: some View {
        Card(title: "Caffeine") {
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                ForEach(drinks, id: \.0) { d in
                    Button { send(["type": "caffeine", "drink": d.0], "\(d.0) (\(d.1) mg)") } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(d.0).font(.subheadline.weight(.medium))
                            Text("about \(d.1) mg").font(.caption).foregroundStyle(Theme.muted)
                        }
                        .frame(maxWidth: .infinity, minHeight: 54, alignment: .leading).padding(.horizontal, 14)
                        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .disabled(model.pending)
                }
            }
        }
    }

    private var supplementCard: some View {
        Card(title: "Supplements") {
            if model.supplements.isEmpty { Empty(text: "Add supplements on the web app and they show up here.") }
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                ForEach(model.supplements, id: \.self) { name in
                    let n = count(name)
                    Button { send(["type": "supplement", "name": name], name) } label: {
                        HStack(spacing: 8) {
                            Image(systemName: n > 0 ? "checkmark.circle.fill" : "circle").foregroundStyle(n > 0 ? Theme.good : Theme.muted)
                            Text(name).font(.subheadline.weight(.medium)).lineLimit(1).minimumScaleFactor(0.8)
                            Spacer(minLength: 0)
                            if n > 1 { Text("\(n)").font(.caption.weight(.bold)).padding(.horizontal, 7).padding(.vertical, 2).background(Theme.warm.opacity(0.25), in: Capsule()).foregroundStyle(Theme.warm) }
                        }
                        .frame(maxWidth: .infinity, minHeight: 54, alignment: .leading).padding(.horizontal, 14)
                        .background(n > 0 ? Theme.good.opacity(0.13) : Theme.raised, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .disabled(model.pending)
                }
            }
        }
    }

    // What was logged today, newest first. Swipe-free: each row has its own remove button.
    @ViewBuilder private var todayList: some View {
        let rows = model.history.filter { Format.isToday($0.at) }
        if !rows.isEmpty {
            Card(title: "Logged today", trailing: "\(rows.count)") {
                VStack(spacing: 0) {
                    ForEach(rows) { r in
                        HStack {
                            Text(r.label).font(.subheadline)
                            Spacer()
                            Text(Format.clock(r.at)).font(.caption).foregroundStyle(Theme.muted)
                            Button { Task { await model.remove(r) } } label: { Image(systemName: "trash").font(.footnote).foregroundStyle(Theme.muted).frame(width: 36, height: 36) }
                                .buttonStyle(.plain).accessibilityLabel("Remove \(r.label)")
                        }
                        .padding(.vertical, 6)
                        if r.id != rows.last?.id { Divider().overlay(Theme.line) }
                    }
                }
            }
        }
    }

    private func toast(_ t: Logged) -> some View {
        HStack(spacing: 14) {
            Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.good)
            Text("Logged \(t.label)").font(.subheadline.weight(.medium)).lineLimit(1)
            Spacer(minLength: 8)
            Button("Undo") { Task { await model.undo(t) } }.font(.subheadline.weight(.semibold)).foregroundStyle(Theme.sky)
        }
        .padding(.horizontal, 18).frame(height: 54).frame(maxWidth: .infinity)
        .background(.ultraThickMaterial, in: Capsule()).overlay(Capsule().stroke(Theme.line))
        .padding(.horizontal, 20)
    }

    private func send(_ event: [String: Any], _ label: String) {
        Task { if await model.log(event, label: label) { tapped += 1 } }
    }
}
