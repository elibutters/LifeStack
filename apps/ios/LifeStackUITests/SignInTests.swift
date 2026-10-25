import XCTest

// Signs in against a development server and checks that the Today screen loads. Needs a throwaway key:
//   TEST_RUNNER_LS_EMAIL=... TEST_RUNNER_LS_PASSWORD=... xcodebuild test ... API_BASE_URL=http:/\$()/localhost:3000
// The development database needs a supplement named Alpha (any dose) and three others, so "1 of 4" holds.
// Skipped when the variables are not set. The credentials are the development server's. Run it on a
// simulator whose Keychain is reset (`xcrun simctl keychain <device> reset`) so the app starts signed out.
final class SignInTests: XCTestCase {
    func testSignInShowsToday() throws {
        let env = ProcessInfo.processInfo.environment
        guard let email = env["LS_EMAIL"], let password = env["LS_PASSWORD"] else { throw XCTSkip("LS_EMAIL and LS_PASSWORD not set") }

        let app = XCUIApplication()
        app.launch()

        // The server address is baked into the build (API_BASE_URL), so only email and password are asked for.
        let emailField = app.textFields["Email"]
        XCTAssertTrue(emailField.waitForExistence(timeout: 10))
        XCTAssertFalse(app.textFields["Address"].exists, "the app should not ask for an address")
        emailField.tap(); emailField.typeText(email)
        let keyField = app.secureTextFields.firstMatch
        keyField.tap(); keyField.typeText(password)
        app.buttons["Sign in"].tap()

        XCTAssertTrue(app.tabBars.buttons["Overview"].waitForExistence(timeout: 20), "should reach the home screen")
        shot("overview", env)
        // Every tab loads its screen from the server.
        for tab in ["Sleep", "Fitness", "Finance", "More"] {
            let button = app.tabBars.buttons[tab]
            XCTAssertTrue(button.exists, "\(tab) tab")
            button.tap()
            if tab != "More" { shot(tab.lowercased(), env) }
        }
        app.tabBars.buttons["Fitness"].tap()
        XCTAssertTrue(app.staticTexts["MILES PER WEEK"].waitForExistence(timeout: 20), "workouts overview loads")
        shot("workouts", env)
        app.tabBars.buttons["Finance"].tap()
        XCTAssertTrue(app.staticTexts["NET WORTH"].waitForExistence(timeout: 20), "finance summary loads")
        app.tabBars.buttons["Sleep"].tap()
        XCTAssertTrue(app.staticTexts["LAST NIGHT"].waitForExistence(timeout: 20), "sleep nights load")
        app.tabBars.buttons["More"].tap()
        app.buttons["more-wants"].tap()
        XCTAssertTrue(app.buttons["add-want"].waitForExistence(timeout: 20), "wants screen loads")
        shot("wants", env)
        app.buttons["back-button"].tap()
        app.buttons["more-log"].tap()
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS 'Coffee'")).firstMatch.waitForExistence(timeout: 15))
        // A supplement is taken or not: one tap takes it, the next tap un-takes it, and taking it again leaves one
        // entry. The chip and the "n of 4" count show the state; there is no banner.
        let zinc = app.buttons.matching(NSPredicate(format: "label CONTAINS 'Alpha'")).firstMatch
        XCTAssertTrue(zinc.waitForExistence(timeout: 10))
        zinc.tap()
        XCTAssertTrue(app.staticTexts["1 of 4"].waitForExistence(timeout: 10), "taking it is shown on the chip and the count")
        shot("log", env)
        XCTAssertFalse(app.buttons["Undo"].exists, "no confirmation banner")
        zinc.tap()
        XCTAssertTrue(app.staticTexts["0 of 4"].waitForExistence(timeout: 10), "tapping again un-takes it")
        zinc.tap()
        XCTAssertTrue(app.staticTexts["1 of 4"].waitForExistence(timeout: 10), "and taking it again works")

        // Doses can be changed: the new dose shows on the chip.
        app.buttons["Edit doses"].tap()
        let field = app.textFields["dose-Alpha"]
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        app.buttons["Clear Alpha dose"].tap()
        field.typeText("30")
        app.buttons["Save"].tap()
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS 'Alpha' AND label CONTAINS '30'")).firstMatch.waitForExistence(timeout: 15), "the chip shows the new dose")
    }

    // Opening a screen from More used to replace the tab's contents, which sent the tab bar back to Overview.
    func testMoreOpensWithoutLeavingTheTab() {
        let app = XCUIApplication()
        app.launchArguments = ["UITEST_SIGNED_IN"]
        app.launch()

        let more = app.tabBars.buttons["More"]
        XCTAssertTrue(more.waitForExistence(timeout: 10))
        more.tap()
        for (id, title) in [("more-calendar", "Calendar"), ("more-log", "Log"), ("more-wants", "Wants")] {
            app.buttons[id].tap()
            XCTAssertTrue(app.buttons["back-button"].waitForExistence(timeout: 5), "\(title) should open in place")
            XCTAssertTrue(app.tabBars.buttons["More"].isSelected, "\(title) should stay on the More tab")
            XCTAssertFalse(app.buttons[id].exists, "\(title) should cover the menu")
            app.buttons["back-button"].tap()
            XCTAssertTrue(app.buttons[id].waitForExistence(timeout: 5), "back should return to the menu")
        }

        // Sheets keep their own bar. Hiding the tab's navigation bar must not hide Cancel or Done.
        app.buttons["more-wants"].tap()
        app.buttons["add-want"].tap()
        XCTAssertTrue(app.buttons["Cancel"].waitForExistence(timeout: 5))
        app.buttons["Cancel"].tap()
        app.tabBars.buttons["Overview"].tap()
        app.buttons["account-button"].tap()
        XCTAssertTrue(app.buttons["Done"].waitForExistence(timeout: 5))
    }

    private func shot(_ name: String, _ env: [String: String]) {
        guard let dir = env["LS_SHOTS"] else { return }
        Thread.sleep(forTimeInterval: 3)
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "\(dir)/\(name).png"))
    }
}
