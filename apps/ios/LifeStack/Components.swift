import SwiftUI

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
        .background(Theme.bg.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
    }
}
