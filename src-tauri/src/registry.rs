use winreg::enums::*;
use winreg::RegKey;

const IFEO_PATH: &str = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options";

// 瀹氫箟涓€涓粨鏋勪綋鏉ラ厤缃父鎴忎紭鍖栧弬鏁?
pub struct GameConfig<'a> {
    pub exe_name: &'a str,
    pub cpu_priority: u32,
    pub io_priority: u32,
}

pub fn apply_game_optimizations(games: &[GameConfig]) -> Result<String, String> {
    // 鏉冮檺妫€鏌ュ簲璇ュ湪涓婂眰鍋氾紝鎴栬€呰繖閲岀畝鍗曠殑渚濋潬 API 澶辫触杩斿洖
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let mut results = Vec::new();

    for game in games {
        let key_path = format!(r"{}\{}\PerfOptions", IFEO_PATH, game.exe_name);
        
        match hklm.create_subkey(&key_path) {
            Ok((key, _)) => {
                let mut success = true;
                if let Err(e) = key.set_value("CpuPriorityClass", &game.cpu_priority) {
                    results.push(format!("{}: 璁剧疆 CPU 浼樺厛绾уけ璐? {}", game.exe_name, e));
                    success = false;
                }
                if let Err(e) = key.set_value("IoPriority", &game.io_priority) {
                    results.push(format!("{}: 璁剧疆 I/O 浼樺厛绾уけ璐? {}", game.exe_name, e));
                    success = false;
                }
                if success {
                    results.push(format!("{}: 浼樺寲鎴愬姛 (CPU: {}, I/O: {})", game.exe_name, game.cpu_priority, game.io_priority));
                }
            }
            Err(e) => {
                // 濡傛灉鏄€滄嫆缁濊闂€濓紝缁欎釜鏇村弸濂界殑鎻愮ず
                let err_msg = e.to_string();
                if err_msg.contains("Access is denied") {
                    results.push(format!("{}: 鏉冮檺涓嶈冻锛岃浠ョ鐞嗗憳杩愯", game.exe_name));
                } else {
                    results.push(format!("{}: 鍒涘缓娉ㄥ唽琛ㄥけ璐? {}", game.exe_name, e));
                }
            }
        }
    }
    
    Ok(results.join("\n"))
}

pub fn reset_optimizations(exe_names: &[&str]) -> Result<String, String> {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let mut results = Vec::new();

    for &exe_name in exe_names {
        let exe_key_path = format!(r"{}\{}", IFEO_PATH, exe_name);
        match hklm.open_subkey_with_flags(&exe_key_path, KEY_WRITE) {
            Ok(exe_key) => {
                match exe_key.delete_subkey("PerfOptions") {
                    Ok(_) => results.push(format!("{}: 宸叉仮澶嶉粯璁?, exe_name)),
                    Err(e) => results.push(format!("{}: 鎭㈠澶辫触: {}", exe_name, e)),
                }
            }
            Err(_) => results.push(format!("{}: 鏈壘鍒伴厤缃?, exe_name)),
        }
    }
    Ok(results.join("\n"))
}

// 杩欓噷鐨勮嚜鍚姩閫昏緫淇濇寔鍘熸牱锛屼絾涔熸惉杩囨潵
pub fn set_autostart(enable: bool) -> Result<String, String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let path = r"Software\Microsoft\Windows\CurrentVersion\Run";
    let app_name = "PitayaBox";

    if enable {
        let (key, _) = hkcu.create_subkey(path).map_err(|e| e.to_string())?;
        let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
        key.set_value(app_name, &exe_path.to_str().unwrap_or("")).map_err(|e| e.to_string())?;
        Ok("宸插惎鐢ㄥ紑鏈鸿嚜鍚?.to_string())
    } else {
        let key = hkcu.open_subkey_with_flags(path, KEY_WRITE).map_err(|e| e.to_string())?;
        match key.delete_value(app_name) {
            Ok(_) => Ok("宸茬鐢ㄥ紑鏈鸿嚜鍚?.to_string()),
            Err(_) => Ok("寮€鏈鸿嚜鍚師鏈氨鏈惎鐢?.to_string()), 
        }
    }
}
