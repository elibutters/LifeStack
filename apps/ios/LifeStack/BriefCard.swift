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
}

extension APIClient {
    func brief() async throws -> Brief? {
        struct R: Decodable { let brief: Brief? }
        return (try await get("api/v1/brief") as R).brief
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
    private static let slots: [(id: String, hour: Int, minute: Int, title: String)] = [("brief.morning", 7, 0, "Morning brief"), ("brief.evening", 20, 30, "Evening brief")]

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
