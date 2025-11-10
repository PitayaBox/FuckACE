use serde::{Deserialize, Serialize};
use sysinfo::{System, Pid};
use std::sync::Mutex;
use tauri::{Emitter, State};

#[derive(Debug, Serialize, Deserialize)]
struct RestrictResult {
    target_core: u32,
    sguard64_found: bool,
    sguard64_restricted: bool,
    sguardsvc64_found: bool,
    sguardsvc64_restricted: bool,
    message: String,
}

struct AppState {
    system: Mutex<System>,
}

fn find_target_core() -> (u32, u64) {
    match detect_e_cores() {
        Some((target_core, core_mask)) => {
            (target_core, core_mask)
        }
        None => {
            let system = System::new_all();
            let total_cores = system.cpus().len() as u32;
            let target_core = if total_cores > 0 { total_cores - 1 } else { 0 };
            let core_mask = 1u64 << target_core;
            
            (target_core, core_mask)
        }
    }
}

fn detect_e_cores() -> Option<(u32, u64)> {
    let system = System::new_all();
    let total_cores = system.cpus().len() as u32;
    
    if total_cores > 4 {
        let target_core = total_cores - 1;
        let core_mask = 1u64 << target_core;
        return Some((target_core, core_mask));
    }
    
    None
}

fn set_process_affinity(pid: Pid, core_mask: u64) -> bool {
    unsafe {
        use winapi::um::processthreadsapi::OpenProcess;
        use winapi::um::winbase::SetProcessAffinityMask;
        use winapi::um::winnt::{PROCESS_SET_INFORMATION, PROCESS_QUERY_INFORMATION};
        use winapi::um::winnt::HANDLE;
        
        let process_handle: HANDLE = OpenProcess(
            PROCESS_SET_INFORMATION | PROCESS_QUERY_INFORMATION,
            0,
            pid.as_u32()
        );
        
        if process_handle.is_null() {
            return false;
        }
        
        let result = SetProcessAffinityMask(process_handle, core_mask as u32);
        
        winapi::um::handleapi::CloseHandle(process_handle);
        
        result != 0
    }
}

fn set_process_priority(pid: Pid) -> bool {
    unsafe {
        use winapi::um::processthreadsapi::OpenProcess;
        use winapi::um::processthreadsapi::SetPriorityClass;
        use winapi::um::winbase::IDLE_PRIORITY_CLASS;
        use winapi::um::winnt::{PROCESS_SET_INFORMATION, PROCESS_QUERY_INFORMATION};
        use winapi::um::winnt::HANDLE;
        
        let process_handle: HANDLE = OpenProcess(
            PROCESS_SET_INFORMATION | PROCESS_QUERY_INFORMATION,
            0,
            pid.as_u32()
        );
        
        if process_handle.is_null() {
            return false;
        }
        
        let result = SetPriorityClass(process_handle, IDLE_PRIORITY_CLASS);
        
        winapi::um::handleapi::CloseHandle(process_handle);
        
        result != 0
    }
}

fn restrict_target_processes() -> RestrictResult {
    let mut system = System::new_all();
    system.refresh_processes();
    
    let (target_core, core_mask) = find_target_core();
    
    let mut sguard64_found = false;
    let mut sguard64_restricted = false;
    let mut sguardsvc64_found = false;
    let mut sguardsvc64_restricted = false;
    
    let mut message = String::new();
    
    message.push_str(&format!("目标核心: {}\n", target_core));
    
    for (pid, process) in system.processes() {
        let process_name = process.name().to_lowercase();
        
        if process_name.contains("sguard64.exe") {
            sguard64_found = true;
            
            if set_process_affinity(*pid, core_mask) && set_process_priority(*pid) {
                sguard64_restricted = true;
                message.push_str(&format!("SGuard64.exe (PID: {}) 已限制到核心 {}\n", pid, target_core));
            } else {
                message.push_str(&format!("SGuard64.exe (PID: {}) 限制失败\n", pid));
            }
        }
        
        if process_name.contains("sguardsvc64.exe") {
            sguardsvc64_found = true;
            
            if set_process_affinity(*pid, core_mask) && set_process_priority(*pid) {
                sguardsvc64_restricted = true;
                message.push_str(&format!("SGuardSvc64.exe (PID: {}) 已限制到核心 {}\n", pid, target_core));
            } else {
                message.push_str(&format!("SGuardSvc64.exe (PID: {}) 限制失败\n", pid));
            }
        }
    }
    
    if !sguard64_found {
        message.push_str("未找到SGuard64.exe进程\n");
    }
    
    if !sguardsvc64_found {
        message.push_str("未找到SGuardSvc64.exe进程\n");
    }
    
    RestrictResult {
        target_core,
        sguard64_found,
        sguard64_restricted,
        sguardsvc64_found,
        sguardsvc64_restricted,
        message,
    }
}

#[tauri::command]
fn restrict_processes(_state: State<AppState>) -> RestrictResult {
    let result = restrict_target_processes();
    result
}

#[tauri::command]
fn get_system_info() -> String {
    let system = System::new_all();
    
    format!(
        "CPU核心数: {}\n物理内存: {} MB\n可用内存: {} MB",
        system.cpus().len(),
        system.total_memory() / 1024 / 1024,
        system.available_memory() / 1024 / 1024
    )
}

#[tauri::command]
async fn start_timer(app_handle: tauri::AppHandle) -> Result<String, String> {
    let app_handle_clone = app_handle.clone();
    
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
        
        loop {
            interval.tick().await;
            
            let result = restrict_target_processes();
            
            if let Err(e) = app_handle_clone.emit("timer_tick", &result) {
                eprintln!("发送定时器事件失败: {}", e);
            }
        }
    });
    
    Ok("定时器已启动，每60秒执行一次进程限制".to_string())
}

#[tauri::command]
fn stop_timer() -> String {
    "定时器已停止".to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            system: Mutex::new(System::new()),
        })
        .invoke_handler(tauri::generate_handler![restrict_processes, get_system_info, start_timer, stop_timer])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
