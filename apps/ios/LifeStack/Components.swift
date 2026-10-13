import SwiftUI

// A title row pinned to the very top of a screen, with an optional button on the right. It replaces the large
// navigation title, which left a tall empty band above the heading whenever a toolbar button was present.
// Set by the More menu on the screens it opens, so their header shows a back button.
private struct ScreenBackKey: EnvironmentKey { static let defaultValue: (() -> Void)? = nil }
extension EnvironmentValues {
    var screenBack: (() -> Void)? {
        get { self[ScreenBackKey.self] }
        set { self[ScreenBackKey.self] = newValue }
    }
}

private struct ScreenHeader<T: View>: ViewModifier {
    let title: String
    @ViewBuilder var trailing: T
    @Environment(\.screenBack) private var back

    func body(content: Content) -> some View {
        VStack(spacing: 0) {
            HStack(alignment: .center, spacing: 8) {
                if let back {
                    Button(action: back) { Image(systemName: "chevron.left").font(.title3.weight(.semibold)).foregroundStyle(Theme.sky).frame(width: 32, height: 36) }
                        .accessibilityLabel("Back").accessibilityIdentifier("back-button")
                }
                Text(title).font(.system(size: 30, weight: .bold)).lineLimit(1).minimumScaleFactor(0.7)
                Spacer()
                trailing
            }
            .padding(.horizontal, 18).padding(.top, 2).padding(.bottom, 0)
            content
        }
        .toolbar(.hidden, for: .navigationBar)
    }
}

extension View {
    func screenHeader<T: View>(_ title: String, @ViewBuilder trailing: () -> T = { EmptyView() }) -> some View {
        modifier(ScreenHeader(title: title, trailing: trailing))
    }
}
