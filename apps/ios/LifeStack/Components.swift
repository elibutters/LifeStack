import SwiftUI

// A title row pinned to the very top of a screen, with an optional button on the right. It replaces the large
// navigation title, which left a tall empty band above the heading whenever a toolbar button was present.
extension View {
    func screenHeader<T: View>(_ title: String, @ViewBuilder trailing: () -> T = { EmptyView() }) -> some View {
        VStack(spacing: 0) {
            HStack(alignment: .center) {
                Text(title).font(.system(size: 30, weight: .bold)).lineLimit(1).minimumScaleFactor(0.7)
                Spacer()
                trailing()
            }
            .padding(.horizontal, 18).padding(.top, 2).padding(.bottom, 0)
            self
        }
        .toolbar(.hidden, for: .navigationBar)
    }
}
