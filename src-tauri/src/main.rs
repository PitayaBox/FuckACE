// src-tauri/src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::env;
use std::mem;
use std::ffi::c_void;
use std::process::Command;
use std::os::windows::process::CommandExt;
use sysinfo::System; 
use winreg::enums::*;
use winreg::RegKey;

// 引入 windows crate 的模块
use windows::Win32::Foundation::HANDLE; 
use windows::Win32::System::Threading::{
    OpenProcess, SetPriorityClass, SetProcessAffinityMask, SetProcessInformation,
    PROCESS_ALL_ACCESS, IDLE_PRIORITY_CLASS, PROCESS_POWER_THROTTLING_STATE,
    PROCESS_POWER_THROTTLING_CURRENT_VERSION, PROCESS_POWER_THROTTLING_EXECUTION_SPEED,
    ProcessPowerThrottling,
};
use windows::Win32::System::ProcessStatus::EmptyWorkingSet;

// --- 结构体定义 ---
#[derive(serde::Serialize)]
struct ProcessStatus {
    target_core: usize,
    sguard64_found: bool,
    sguard64_restricted: bool,
    sguardsvc64_found: bool,
    sguardsvc64_restricted: bool,
    message: String,
}

#[derive(serde::Serialize)]
struct SystemInfo {
    cpu_model: String,
    cpu_cores: usize,
    cpu_logical_cores: usize,
    os_name: String,
    os_version: String,
    is_admin: bool,
    total_memory_gb: f64,
    webview2_env: String,
}

#[derive(serde::Serialize)]
struct ProcessPerformance {
    pid: u32,
    name: String,
    cpu_usage: f32,
    memory_mb: f64,
}

// --- 辅助函数 ---

// 开启效率模式 (EcoQoS - Win11)
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

// 修改注册表 IFEO
fn set_registry_priority(exe_name: &str, priority: u32) -> Result<String, String> {
    let hk_lm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let path = format!("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\{}\\PerfOptions", exe_name);
    
    let (key, _) = hk_lm.create_subkey(&path).map_err(|e| format!("无法访问注册表: {}", e))?;
    key.set_value("CpuPriorityClass", &priority).map_err(|e| format!("写入失败: {}", e))?;
    
    Ok(format!("{} 注册表优化成功 (优先级: {})", exe_name, priority))
}

// --- 核心功能命令 ---

#[tauri::command]
fn restrict_processes(
    enable_cpu_affinity: bool,
    enable_process_priority: bool,
    enable_efficiency_mode: bool,
    enable_io_priority: bool,
    enable_memory_priority: bool,
) -> ProcessStatus {
    let mut sys = System::new_all();
    sys.refresh_all();
    let target_process_names = ["SGuard64.exe", "SGuardSvc64.exe"];
    let mut log_messages = Vec::new();
    let cpu_count = sys.cpus().len();
    let last_core_mask: usize = 1 << (cpu_count - 1); 

    let mut found_sguard = false;
    let mut found_svc = false;

    for process_name in target_process_names.iter() {
        for (pid, process) in sys.processes() {
            if process.name() == *process_name {
                if process_name.contains("Svc") { found_svc = true; } else { found_sguard = true; }
                
                unsafe {
                    if let Ok(handle) = OpenProcess(PROCESS_ALL_ACCESS, false, pid.as_u32()) {
                        if enable_cpu_affinity {
                            if SetProcessAffinityMask(handle, last_core_mask).is_ok() {
                                log_messages.push(format!("{} 绑定至核心 {}", process_name, cpu_count - 1));
                            }
                        }
                        if enable_process_priority {
                            if SetPriorityClass(handle, IDLE_PRIORITY_CLASS).is_ok() {
                                log_messages.push(format!("{} 优先级降至最低", process_name));
                            }
                        }
                        if enable_efficiency_mode {
                            if set_efficiency_mode(handle) {
                                log_messages.push(format!("{} 已开启效率模式", process_name));
                            }
                        }
                        if enable_memory_priority {
                            if EmptyWorkingSet(handle).is_ok() {
                                log_messages.push(format!("{} 内存已释放", process_name));
                            }
                        }
                    }
                }
            }
        }
    }

    ProcessStatus {
        target_core: cpu_count - 1,
        sguard64_found: found_sguard,
        sguard64_restricted: true,
        sguardsvc64_found: found_svc,
        sguardsvc64_restricted: true,
        message: if log_messages.is_empty() { "未发现活跃 ACE 进程".to_string() } else { log_messages.join("\n") },
    }
}

#[tauri::command]
fn get_system_info() -> SystemInfo {
    let mut sys = System::new_all();
    sys.refresh_cpu();
    sys.refresh_memory();
    
    let cpu_model = if !sys.cpus().is_empty() {
        sys.cpus()[0].brand().to_string()
    } else {
        "Unknown CPU".to_string()
    };

    let os_name = System::name().unwrap_or("Windows".to_string());
    let os_version = System::os_version().unwrap_or("?".to_string());

    SystemInfo {
        cpu_model,
        cpu_cores: sys.physical_core_count().unwrap_or(0),
        cpu_logical_cores: sys.cpus().len(),
        os_name,
        os_version,
        is_admin: true,
        total_memory_gb: sys.total_memory() as f64 / 1024.0 / 1024.0 / 1024.0,
        webview2_env: "Local".to_string(),
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
            list.push(ProcessPerformance {
                pid: pid.as_u32(),
                name: name.to_string(),
                cpu_usage: process.cpu_usage(),
                memory_mb: process.memory() as f64 / 1024.0 / 1024.0,
            });
        }
    }
    list
}

#[tauri::command]
fn lower_ace_priority() -> String {
    let r1 = set_registry_priority("SGuard64.exe", 1);
    let r2 = set_registry_priority("SGuardSvc64.exe", 1);
    
    match (r1, r2) {
        (Ok(_), Ok(_)) => "ACE 注册表降权成功！重启电脑后生效".to_string(),
        (Err(e), _) => format!("操作失败 (SGuard64): {}", e),
        (_, Err(e)) => format!("操作失败 (SGuardSvc64): {}", e),
    }
}

#[tauri::command]
fn raise_delta_priority() -> String {
    match set_registry_priority("DeltaForceClient.exe", 3) {
        Ok(_) => "三角洲优化成功！(High Priority)".to_string(),
        Err(e) => format!("优化失败: {}", e),
    }
}

#[tauri::command]
fn modify_valorant_registry_priority() -> String {
    match set_registry_priority("VALORANT-Win64-Shipping.exe", 3) {
        Ok(_) => "瓦罗兰特优化成功！(High Priority)".to_string(),
        Err(e) => format!("优化失败: {}", e),
    }
}

#[tauri::command]
fn check_registry_priority() -> String {
    let hk_lm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let path = "SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\SGuard64.exe\\PerfOptions";
    
    if let Ok(key) = hk_lm.open_subkey(path) {
        let val: Result<u32, _> = key.get_value("CpuPriorityClass");
        if let Ok(v) = val {
            if v == 1 { return "当前状态: ACE 已被限制 (Idle)".to_string(); }
        }
    }
    "当前状态: ACE 未受限制 (默认)".to_string()
}

// --- 升级后的自启动方案：使用任务计划程序绕过 UAC ---

#[tauri::command]
fn enable_autostart() -> Result<String, String> {
    let exe_path = env::current_exe().map_err(|e| e.to_string())?;
    let path_str = exe_path.to_str().unwrap();

    // 1. 先尝试删除可能存在的旧任务
    let _ = Command::new("schtasks")
        .args(&["/delete", "/tn", "PitayaBoxAutoStart", "/f"])
        .creation_flags(0x08000000) // CREATE_NO_WINDOW: 不弹出黑色命令行窗口
        .status();

    // 2. 创建新任务：登录时以最高权限 (highest) 运行
    let status = Command::new("schtasks")
        .args(&[
            "/create",
            "/tn", "PitayaBoxAutoStart",
            "/tr", path_str,
            "/sc", "onlogon",
            "/rl", "highest",
            "/f"
        ])
        .creation_flags(0x08000000)
        .status()
        .map_err(|e| e.to_string())?;

    if status.success() {
        // 清理旧的、无效的注册表启动项
        let hk_cu = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok(key) = hk_cu.open_subkey_with_flags("Software\\Microsoft\\Windows\\CurrentVersion\\Run", KEY_WRITE) {
            let _ = key.delete_value("PitayaBox");
        }
        Ok("已创建高级自启动任务 (绕过UAC权限拦截)".to_string())
    } else {
        Err("创建任务计划失败，请确认是否拥有管理员权限".to_string())
    }
}

#[tauri::command]
fn disable_autostart() -> Result<String, String> {
    // 删除计划任务
    let status = Command::new("schtasks")
        .args(&["/delete", "/tn", "PitayaBoxAutoStart", "/f"])
        .creation_flags(0x08000000)
        .status()
        .map_err(|e| e.to_string())?;

    if status.success() {
        Ok("已成功取消开机自启动任务".to_string())
    } else {
        Err("取消任务失败，可能任务原本就不存在".to_string())
    }
}

#[tauri::command]
fn check_autostart() -> bool {
    // 检查任务是否存在
    let output = Command::new("schtasks")
        .args(&["/query", "/tn", "PitayaBoxAutoStart"])
        .creation_flags(0x08000000)
        .output();

    if let Ok(out) = output {
        return out.status.success();
    }
    false
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            restrict_processes,
            get_system_info,
            get_process_performance,
            disable_autostart,
            enable_autostart,
            check_autostart,
            lower_ace_priority,
            raise_delta_priority,
            modify_valorant_registry_priority,
            check_registry_priority
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}