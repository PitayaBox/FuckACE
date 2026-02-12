// src-tauri/src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::Command;
use std::os::windows::process::CommandExt;
use sysinfo::System; 
use winreg::enums::*;
use winreg::RegKey;
use tauri::WindowEvent; // 移除了未使用的 Emitter

use std::mem;
use std::ffi::c_void;
use windows::Win32::Foundation::HANDLE; 
use windows::Win32::System::Threading::{
    OpenProcess, SetPriorityClass, SetProcessAffinityMask, SetProcessInformation,
    PROCESS_ALL_ACCESS, IDLE_PRIORITY_CLASS, PROCESS_POWER_THROTTLING_STATE,
    PROCESS_POWER_THROTTLING_CURRENT_VERSION, PROCESS_POWER_THROTTLING_EXECUTION_SPEED,
    ProcessPowerThrottling,
};
use windows::Win32::System::ProcessStatus::EmptyWorkingSet;

#[derive(serde::Serialize)]
struct ProcessStatus {
    target_core: usize,
    sguard64_restricted: bool,
    message: String,
}

#[derive(serde::Serialize)]
struct SystemInfo {
    cpu_model: String,
    os_name: String,
    os_version: String,
    cpu_logical_cores: usize,
}

#[derive(serde::Serialize)]
struct ProcessPerformance {
    pid: u32,
    name: String,
    cpu_usage: f32,
    memory_mb: f64,
}

unsafe fn set_efficiency_mode(handle: HANDLE) -> bool {
    let mut throttling_state = PROCESS_POWER_THROTTLING_STATE {
        Version: PROCESS_POWER_THROTTLING_CURRENT_VERSION,
        ControlMask: PROCESS_POWER_THROTTLING_EXECUTION_SPEED,
        StateMask: PROCESS_POWER_THROTTLING_EXECUTION_SPEED,
    };
    let result = SetProcessInformation(
        handle,
        ProcessPowerThrottling,
        &mut throttling_state as *mut _ as *mut c_void,
        mem::size_of::<PROCESS_POWER_THROTTLING_STATE>() as u32,
    );
    result.is_ok()
}

fn set_registry_priority(exe_name: &str, priority: u32) -> Result<String, String> {
    let hk_lm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let path = format!("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\{}\\PerfOptions", exe_name);
    let (key, _) = hk_lm.create_subkey(&path).map_err(|e| format!("权限不足: {}", e))?;
    key.set_value("CpuPriorityClass", &priority).map_err(|e| format!("写入失败: {}", e))?;
    Ok(format!("{} 优化已应用", exe_name))
}

fn reset_registry_priority(exe_name: &str) -> Result<String, String> {
    let hk_lm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let parent_path = format!("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\{}", exe_name);
    if let Ok(key) = hk_lm.open_subkey_with_flags(&parent_path, KEY_ALL_ACCESS) {
        match key.delete_subkey("PerfOptions") {
            Ok(_) => Ok(format!("{} 已恢复默认", exe_name)),
            Err(e) => Err(format!("恢复失败: {}", e)),
        }
    } else {
        Ok("无需恢复".to_string())
    }
}

#[tauri::command]
fn restrict_processes(enable_cpu_affinity: bool, enable_process_priority: bool, enable_efficiency_mode: bool, enable_io_priority: bool, enable_memory_priority: bool) -> ProcessStatus {
    let mut sys = System::new_all();
    sys.refresh_all();
    let target_process_names = ["SGuard64.exe", "SGuardSvc64.exe"];
    // ❌ 已删除导致报错的 log_messages 变量
    let cpu_count = sys.cpus().len();
    let last_core_mask: usize = 1 << (cpu_count - 1); 
    let mut found = false;

    for process_name in target_process_names.iter() {
        for (pid, process) in sys.processes() {
            if process.name() == *process_name {
                found = true;
                unsafe {
                    if let Ok(handle) = OpenProcess(PROCESS_ALL_ACCESS, false, pid.as_u32()) {
                        if enable_cpu_affinity { let _ = SetProcessAffinityMask(handle, last_core_mask); }
                        if enable_process_priority { let _ = SetPriorityClass(handle, IDLE_PRIORITY_CLASS); }
                        if enable_efficiency_mode { let _ = set_efficiency_mode(handle); }
                        if enable_memory_priority { let _ = EmptyWorkingSet(handle); }
                        if enable_io_priority { } 
                    }
                }
            }
        }
    }
    ProcessStatus {
        target_core: cpu_count - 1, sguard64_restricted: found,
        message: if found { "ACE 限制已生效".to_string() } else { "未发现 ACE 进程".to_string() },
    }
}

#[tauri::command]
fn get_system_info() -> SystemInfo {
    let mut sys = System::new_all();
    sys.refresh_cpu();
    let cpu_model = if !sys.cpus().is_empty() { sys.cpus()[0].brand().to_string() } else { "Unknown CPU".to_string() };
    SystemInfo {
        cpu_model, os_name: System::name().unwrap_or("Windows".to_string()), os_version: System::os_version().unwrap_or("11".to_string()),
        cpu_logical_cores: sys.cpus().len(),
    }
}

#[tauri::command]
fn get_process_performance() -> Vec<ProcessPerformance> {
    let mut sys = System::new_all();
    sys.refresh_processes();
    let mut list = Vec::new();
    for (pid, process) in sys.processes() {
        let name = process.name();
        if name.contains("SGuard") || name.contains("Delta") || name.contains("VALORANT") {
            list.push(ProcessPerformance { pid: pid.as_u32(), name: name.to_string(), cpu_usage: process.cpu_usage(), memory_mb: process.memory() as f64 / 1024.0 / 1024.0 });
        }
    }
    list
}

#[tauri::command]
fn lower_ace_priority() -> String {
    let _ = set_registry_priority("SGuard64.exe", 1);
    let _ = set_registry_priority("SGuardSvc64.exe", 1);
    "ACE 已降权".to_string()
}
#[tauri::command]
fn reset_ace_priority() -> String {
    let _ = reset_registry_priority("SGuard64.exe");
    let _ = reset_registry_priority("SGuardSvc64.exe");
    "ACE 已恢复".to_string()
}
#[tauri::command]
fn raise_delta_priority() -> String { let _ = set_registry_priority("DeltaForceClient.exe", 3); "优化已应用".to_string() }
#[tauri::command]
fn reset_delta_priority() -> String { let _ = reset_registry_priority("DeltaForceClient.exe"); "已恢复".to_string() }
#[tauri::command]
fn modify_valorant_registry_priority() -> String { let _ = set_registry_priority("VALORANT-Win64-Shipping.exe", 3); "优化已应用".to_string() }
#[tauri::command]
fn reset_valorant_priority() -> String { let _ = reset_registry_priority("VALORANT-Win64-Shipping.exe"); "已恢复".to_string() }

#[tauri::command]
fn check_registry_priority() -> String {
    let hk_lm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let path = "SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\SGuard64.exe\\PerfOptions";
    if let Ok(key) = hk_lm.open_subkey(path) {
        if let Ok(v) = key.get_value::<u32, _>("CpuPriorityClass") {
            if v == 1 { return "⚠️ 已降权".to_string(); }
        }
    }
    "✅ 默认".to_string()
}

#[tauri::command]
fn exit_app() { std::process::exit(0); }

#[tauri::command]
fn enable_autostart() -> Result<String, String> {
    let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
    let path_str = exe_path.to_str().unwrap();
    let _ = Command::new("schtasks").args(&["/create", "/tn", "PitayaBoxAutoStart", "/tr", path_str, "/sc", "onlogon", "/rl", "highest", "/f"]).creation_flags(0x08000000).status();
    Ok("自启已开启".to_string())
}
#[tauri::command]
fn disable_autostart() -> Result<String, String> {
    let _ = Command::new("schtasks").args(&["/delete", "/tn", "PitayaBoxAutoStart", "/f"]).creation_flags(0x08000000).status();
    Ok("自启已关闭".to_string())
}
#[tauri::command]
fn check_autostart() -> bool {
    if let Ok(out) = Command::new("schtasks").args(&["/query", "/tn", "PitayaBoxAutoStart"]).creation_flags(0x08000000).output() { return out.status.success(); }
    false
}

#[tauri::command]
fn open_github() {
    let _ = Command::new("cmd").args(&["/C", "start", "https://github.com/PitayaBox/FuckACE"]).creation_flags(0x08000000).spawn();
}

// 移除了所有 lib.rs 相关的宏引用，直接在这里定义 main
fn main() {
    tauri::Builder::default()
        // 只保留 shell 插件，用于打开 GitHub 链接
        .plugin(tauri_plugin_shell::init())
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                window.close().unwrap();
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            restrict_processes, get_system_info, get_process_performance,
            disable_autostart, enable_autostart, check_autostart,
            lower_ace_priority, reset_ace_priority,
            raise_delta_priority, reset_delta_priority,
            modify_valorant_registry_priority, reset_valorant_priority,
            check_registry_priority, exit_app, open_github
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}