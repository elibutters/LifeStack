import SwiftUI

@main
struct LifeStackMacApp: App {
    @State private var model = MacModel()

    var body: some Scene {
        MenuBarExtra {
            PanelView().environment(model)
        } label: {
            Label(model.barTitle, systemImage: "square.stack.3d.up")
        }
        .menuBarExtraStyle(.window)
    }
}
