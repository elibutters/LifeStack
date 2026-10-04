import SwiftUI

struct ErrorRow: View {
    let text: String?
    var body: some View { if let text { Section { Text(text).foregroundStyle(.red) } } }
}

struct EventRow: View {
    let item: CalendarItem
    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(Format.time(item)).font(.subheadline).foregroundStyle(item.kind == "holiday" ? .orange : .blue).frame(width: 72, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title)
                if let place = item.location, !place.isEmpty { Text(place).font(.caption).foregroundStyle(.secondary) }
            }
        }
    }
}

struct Stat: View {
    let label: String
    let value: String
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.title3.weight(.semibold))
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct InsightRow: View {
    let insight: Insight
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(insight.title).font(.subheadline.weight(.medium))
            Text(insight.detail).font(.caption).foregroundStyle(.secondary)
        }
    }
}

// A title row pinned to the very top of a screen, with an optional button on the right. It replaces the large
// navigation title, which left a tall empty band above the heading whenever a toolbar button was present.
extension View {
    func screenHeader<T: View>(_ title: String, @ViewBuilder trailing: () -> T = { EmptyView() }) -> some View {
        VStack(spacing: 0) {
            HStack(alignment: .center) {
                Text(title).font(.largeTitle.weight(.bold)).lineLimit(1).minimumScaleFactor(0.7)
                Spacer()
                trailing()
            }
            .padding(.horizontal, 20).padding(.top, 6).padding(.bottom, 2)
            self
        }
        .toolbar(.hidden, for: .navigationBar)
    }
}
