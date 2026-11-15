import SwiftUI
import UserNotifications

// What the daily agent wrote for the owner: a headline, a few short sections and one question. It sits at the top of Overview.
struct Brief: Decodable, Equatable, Identifiable {
    struct Section: Decodable, Equatable { let title: String; let items: [String] }
    let id: String
    let kind: String
    let day: String
    let headline: String
    let sections: [Section]
    let question: String?
    let createdAt: String
    var readAt: String?
}

extension APIClient {
    func brief() async throws -> Brief? {
        struct R: Decodable { let brief: Brief? }
        return (try await get("api/v1/brief") as R).brief
    }

    // Reading is kept on the server, so every device agrees on what has been read.
    func markBriefRead(_ id: String) async throws {
        _ = try await request("api/v1/brief", method: "POST", body: try JSONSerialization.data(withJSONObject: ["id": id]))
    }
}

// A notification-style row at the top of Overview. Unread, it is lit and asks to be opened; once read it stays as a quiet row, so the brief
// is always one tap away without shouting.
struct BriefBanner: View {
    let brief: Brief
    let open: () -> Void

    private var unread: Bool { brief.readAt == nil }
    private var title: String { brief.kind == "evening" ? "Evening brief" : "Morning brief" }

    var body: some View {
        Button(action: open) {
            HStack(alignment: .center, spacing: 12) {
                Image(systemName: unread ? "bell.badge.fill" : "text.bubble").font(.title3).foregroundStyle(unread ? Theme.accent : Theme.muted)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(title.uppercased()).font(.caption2.weight(.semibold)).tracking(0.6).foregroundStyle(unread ? Theme.accent : Theme.muted)
                        if unread { Text("NEW").font(.caption2.weight(.bold)).padding(.horizontal, 5).padding(.vertical, 1).background(Theme.accent, in: Capsule()).foregroundStyle(.black) }
                    }
                    Text(brief.headline).font(unread ? .subheadline.weight(.semibold) : .footnote).foregroundStyle(unread ? .white : Theme.muted).lineLimit(unread ? 2 : 1).multilineTextAlignment(.leading)
                    if unread { Text("Tap to read").font(.caption).foregroundStyle(Theme.accent) }
                }
                Spacer(minLength: 4)
                Image(systemName: "chevron.right").font(.footnote).foregroundStyle(Theme.muted)
            }
            .padding(unread ? 14 : 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(unread ? Theme.accent.opacity(0.12) : Theme.card, in: RoundedRectangle(cornerRadius: Theme.r))
            .overlay(RoundedRectangle(cornerRadius: Theme.r).stroke(unread ? Theme.accent.opacity(0.7) : Theme.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("brief-banner")
        .accessibilityHint("Opens the brief")
    }
}

// The whole brief, opened from the banner.
struct BriefSheet: View {
    let brief: Brief
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView { BriefCard(brief: brief).padding(16) }
                .background(Theme.bg)
                .navigationTitle(brief.kind == "evening" ? "Evening brief" : "Morning brief")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .preferredColorScheme(.dark)
    }
}

struct BriefCard: View {
    let brief: Brief

    private var title: String { brief.kind == "evening" ? "Evening brief" : "Morning brief" }
    private var stamp: String { Format.date(brief.createdAt)?.formatted(date: .omitted, time: .shortened) ?? "" }

    var body: some View {
        Card(title: title, trailing: stamp) {
            Text(brief.headline).font(.title3.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
            ForEach(brief.sections, id: \.title) { s in
                VStack(alignment: .leading, spacing: 4) {
                    Text(s.title.uppercased()).font(.caption2.weight(.semibold)).tracking(0.6).foregroundStyle(Theme.accent)
                    ForEach(Array(s.items.enumerated()), id: \.offset) { _, item in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text("\u{2022}").foregroundStyle(Theme.muted)
                            Text(item).font(.subheadline).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
            if let q = brief.question, !q.isEmpty { Text(q).font(.subheadline.weight(.medium)).foregroundStyle(Theme.good).padding(.top, 2) }
        }
        .accessibilityIdentifier("brief-card")
    }
}

// A gentle nudge at the times the briefs are written. It cannot carry the brief itself (that needs a push, which a free developer account
// cannot send), so it says to open the app.
enum BriefReminders {
    private static let slots: [(id: String, hour: Int, minute: Int, title: String)] = [("brief.morning", 6, 15, "Morning brief"), ("brief.evening", 20, 45, "Evening brief")]

    static func schedule() async {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        if settings.authorizationStatus == .notDetermined {
            guard (try? await center.requestAuthorization(options: [.alert, .sound])) == true else { return }
        } else if settings.authorizationStatus != .authorized && settings.authorizationStatus != .provisional {
            return
        }
        center.removePendingNotificationRequests(withIdentifiers: slots.map(\.id))
        for slot in slots {
            let content = UNMutableNotificationContent()
            content.title = slot.title
            content.body = "Open Life Stack to see what matters."
            var when = DateComponents(); when.hour = slot.hour; when.minute = slot.minute
            try? await center.add(UNNotificationRequest(identifier: slot.id, content: content, trigger: UNCalendarNotificationTrigger(dateMatching: when, repeats: true)))
        }
    }
}
