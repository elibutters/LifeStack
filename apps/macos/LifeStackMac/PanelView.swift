import AppKit
import SwiftUI

struct PanelView: View {
    @Environment(MacModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if model.signedIn { content } else { SignInView() }
            Divider()
            HStack {
                if model.signedIn { Button("Sign out") { model.signOut() } }
                Spacer()
                Button("Quit") { NSApplication.shared.terminate(nil) }.keyboardShortcut("q")
            }
            .buttonStyle(.plain).font(.caption).foregroundStyle(.secondary)
        }
        .padding(14)
        .frame(width: 340)
        .task { if model.signedIn { await model.refresh() } }
    }

    @ViewBuilder private var content: some View {
        if let m = model.message { Text(m).font(.caption).foregroundStyle(.orange) }
        section("Today", model.today, empty: "Nothing else today.")
        if !model.soon.isEmpty { section("Coming up", Array(model.soon.prefix(4)), empty: "") }
        Divider()
        QuickLog()
    }

    private func section(_ title: String, _ items: [CalendarItem], empty: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title.uppercased()).font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
            if items.isEmpty { Text(empty).font(.callout).foregroundStyle(.secondary) }
            ForEach(items) { item in
                HStack(alignment: .firstTextBaseline) {
                    Text(title == "Today" ? Format.time(item) : Format.upcoming(item))
                        .font(.callout.monospacedDigit()).foregroundStyle(.secondary).frame(width: 78, alignment: .leading)
                    Text(item.title).font(.callout).lineLimit(1)
                    Spacer(minLength: 0)
                }
            }
        }
    }
}

struct QuickLog: View {
    @Environment(MacModel.self) private var model
    private let moods = [1, 2, 3, 4, 5]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("QUICK LOG").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
            HStack {
                Text("Mood").font(.callout)
                Spacer()
                ForEach(moods, id: \.self) { n in
                    Button("\(n)") { Task { await model.send(["type": "mood", "value": n]) } }
                        .buttonStyle(.bordered).tint(model.log?.mood?.value == n ? .accentColor : nil)
                }
            }
            if let drinks = model.options?.caffeine, !drinks.isEmpty {
                HStack {
                    Text("Caffeine").font(.callout)
                    Spacer()
                    if let c = model.log?.caffeine, c.count > 0 { Text("\(Int(c.mg)) mg").font(.caption).foregroundStyle(.secondary) }
                    ForEach(drinks, id: \.self) { d in
                        Button(d.drink) { Task { await model.send(["type": "caffeine", "drink": d.drink]) } }.buttonStyle(.bordered)
                    }
                }
            }
            if let sups = model.options?.supplements, !sups.isEmpty {
                let taken = Set((model.log?.supplements ?? []).map { $0.name.lowercased() })
                FlowRow(items: sups.map(\.name)) { name in
                    let on = taken.contains(name.lowercased())
                    Button(name) {
                        guard let s = sups.first(where: { $0.name == name }) else { return }
                        var e: [String: Any] = ["type": "supplement", "name": s.name]
                        if let d = s.dose { e["dose"] = d }; if let u = s.unit { e["unit"] = u }
                        Task { await model.send(e) }
                    }
                    .buttonStyle(.bordered).tint(on ? .green : nil).disabled(on)
                }
            }
        }
    }
}

// Wraps buttons onto as many lines as needed.
struct FlowRow<Content: View>: View {
    let items: [String]
    @ViewBuilder let content: (String) -> Content
    var body: some View {
        FlowLayout(spacing: 6) { ForEach(items, id: \.self) { content($0) } }
    }
}

struct FlowLayout: Layout {
    var spacing: CGFloat = 6
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        arrange(proposal.width ?? 300, subviews).size
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for (i, p) in arrange(bounds.width, subviews).points.enumerated() {
            subviews[i].place(at: CGPoint(x: bounds.minX + p.x, y: bounds.minY + p.y), proposal: .unspecified)
        }
    }
    private func arrange(_ width: CGFloat, _ subviews: Subviews) -> (points: [CGPoint], size: CGSize) {
        var x: CGFloat = 0, y: CGFloat = 0, row: CGFloat = 0, maxX: CGFloat = 0
        var points: [CGPoint] = []
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width { x = 0; y += row + spacing; row = 0 }
            points.append(CGPoint(x: x, y: y))
            x += size.width + spacing; row = max(row, size.height); maxX = max(maxX, x - spacing)
        }
        return (points, CGSize(width: maxX, height: y + row))
    }
}

struct SignInView: View {
    @Environment(MacModel.self) private var model
    @State private var address = ""
    @State private var email = ""
    @State private var password = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Sign in to Life Stack").font(.headline)
            if MacModel.bundledAddress == nil { TextField("Address (https://...)", text: $address) }
            TextField("Email", text: $email)
            SecureField("Password", text: $password).onSubmit(go)
            if let m = model.message { Text(m).font(.caption).foregroundStyle(.orange) }
            Button(model.busy ? "Signing in..." : "Sign in", action: go).disabled(model.busy || email.isEmpty || password.isEmpty)
        }
        .textFieldStyle(.roundedBorder)
    }

    private func go() { Task { await model.signIn(address: address, email: email, password: password) } }
}
