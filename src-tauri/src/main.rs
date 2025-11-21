#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "windows")]
    {
        setup_portable_webview2();
    }
    
    fuck_ace_lib::run()
}

#[cfg(target_os = "windows")]
fn setup_portable_webview2() {
    use std::env;
    use std::path::PathBuf;
    let exe_path = env::current_exe().unwrap_or_else(|_| PathBuf::from("."));
    let default_path = PathBuf::from(".");
    let exe_dir = exe_path.parent().unwrap_or(&default_path);
    let webview2_dir = exe_dir.join("webview2");
    if webview2_dir.exists() && webview2_dir.is_dir() {
        env::set_var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", webview2_dir.to_str().unwrap_or(""));
    
        let user_data_dir = exe_dir.join(".webview2-data");
        env::set_var("WEBVIEW2_USER_DATA_FOLDER", user_data_dir.to_str().unwrap_or(""));
    
        env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "--no-sandbox");
        
        println!("Using portable WebView2 from: {:?}", webview2_dir);
    }
}
