// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Disable browser extensions in WebView2 BEFORE it initializes
    // This blocks IDM and other BHOs from injecting into the app
    #[cfg(target_os = "windows")]
    std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "--disable-extensions --disable-component-extensions-with-background-pages");

    delulu_lib::run()
}
