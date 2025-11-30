use serde::{Deserialize, Serialize};
use sysinfo::{System, Pid};
use tauri::{State, Manager, AppHandle, WindowEvent, Emitter};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use winreg::enums::*;
use winreg::RegKey;

#[derive(Debug, Serialize, Deserialize)]
struct RestrictResult {
    target_core: u32,
    sguard64_found: bool,
    sguard64_restricted: bool,
    sguardsvc64_found: bool,
    sguardsvc64_restricted: bool,
    weixin_found: bool,
    weixin_restricted: bool,
    message: String,
}

#[derive(Debug, Serialize, Deserialize)]
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

#[derive(Debug, Serialize, Deserialize)]
struct ProcessPerformance {
    pid: u32,
    name: String,
    cpu_usage: f32,
    memory_mb: f64,
}

struct AppState;

fn find_target_core() -> (u32, u64, bool) {
    let system = System::new_all();
    let total_cores = system.cpus().len() as u32;
    let target_core = if total_cores > 0 { total_cores - 1 } else { 0 };
    let core_mask = 1u64 << target_core;
    
    (target_core, core_mask, false)
}

fn set_process_affinity(pid: Pid, core_mask: u64) -> (bool, Option<String>) {
    unsafe {
        use windows::Win32::System::Threading::{
            OpenProcess, SetProcessAffinityMask, PROCESS_SET_INFORMATION, PROCESS_QUERY_INFORMATION
        };
        use windows::Win32::Foundation::CloseHandle;
        
        let process_handle = OpenProcess(
            PROCESS_SET_INFORMATION | PROCESS_QUERY_INFORMATION,
            false,
            pid.as_u32()
        );
        
        let handle = match process_handle {
            Ok(h) => h,
            Err(e) => {
                eprintln!("[进程亲和性] PID {} OpenProcess失败: {:?}", pid, e);
                return (false, Some(format!("打开进程失败: {:?}", e)));
            },
        };
        
        if handle.is_invalid() {
            eprintln!("进程亲和性PID {} 进程句柄无效", pid);
            return (false, Some("进程句柄无效".to_string()));
        }
        
        let result = SetProcessAffinityMask(handle, core_mask as usize);
        
        let _ = CloseHandle(handle);
        
        if let Err(e) = &result {
            eprintln!("进程亲和性PID {} SetProcessAffinityMask失败: {:?}", pid, e);
            return (false, Some(format!("设置亲和性失败: {:?}", e)));
        }
        
        (true, None)
    }
}

fn set_process_affinity_with_fallback(pid: Pid, primary_core_mask: u64, is_e_core: bool) -> (bool, Option<String>, u32) {
    let (success, error) = set_process_affinity(pid, primary_core_mask);
    
    if success || !is_e_core {
        let core_id = primary_core_mask.trailing_zeros();
        return (success, error, core_id);
    }
    
    eprintln!("进程亲和性PID {} E-Core绑定失败，尝试备用方案", pid);
    let system = System::new_all();
    let total_cores = system.cpus().len() as u32;
    let fallback_core = if total_cores > 0 { total_cores - 1 } else { 0 };
    let fallback_mask = 1u64 << fallback_core;
    
    let (fallback_success, fallback_error) = set_process_affinity(pid, fallback_mask);
    
    if fallback_success {
        eprintln!("[进程亲和性] PID {} 备用方案成功，已绑定到核心 {}", pid, fallback_core);
        (true, None, fallback_core)
    } else {
        (false, fallback_error, fallback_core)
    }
}

fn set_process_priority(pid: Pid) -> bool {
    unsafe {
        use windows::Win32::System::Threading::{
            OpenProcess, SetPriorityClass, PROCESS_SET_INFORMATION, PROCESS_QUERY_INFORMATION, IDLE_PRIORITY_CLASS
        };
        use windows::Win32::Foundation::CloseHandle;
        
        let process_handle = match OpenProcess(
            PROCESS_SET_INFORMATION | PROCESS_QUERY_INFORMATION,
            false,
            pid.as_u32()
        ) {
            Ok(handle) => handle,
            Err(e) => {
                eprintln!("[进程优先级] PID {} OpenProcess失败: {:?}", pid, e);
                return false;
            },
        };
        
        if process_handle.is_invalid() {
            eprintln!("[进程优先级] PID {} 进程句柄无效", pid);
            return false;
        }
        
        let result = SetPriorityClass(process_handle, IDLE_PRIORITY_CLASS);
        
        let _ = CloseHandle(process_handle);
        
        if let Err(e) = &result {
            eprintln!("[进程优先级] PID {} SetPriorityClass失败: {:?}", pid, e);
        }
        
        result.is_ok()
    }
}

fn set_process_efficiency_mode(pid: Pid) -> (bool, Option<String>) {
    unsafe {
        use windows::Win32::System::Threading::{
            OpenProcess, SetProcessInformation, PROCESS_SET_INFORMATION, PROCESS_QUERY_INFORMATION,
            PROCESS_POWER_THROTTLING_STATE, ProcessPowerThrottling, PROCESS_POWER_THROTTLING_EXECUTION_SPEED,
            PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION
        };
        use windows::Win32::Foundation::CloseHandle;
        
        let process_handle = match OpenProcess(
            PROCESS_SET_INFORMATION | PROCESS_QUERY_INFORMATION,
            false,
            pid.as_u32()
        ) {
            Ok(handle) => handle,
            Err(e) => {
                eprintln!("[效率模式] PID {} OpenProcess失败: {:?}", pid, e);
                return (false, Some(format!("打开进程失败: {:?}", e)));
            },
        };
        
        if process_handle.is_invalid() {
            eprintln!("[效率模式] PID {} 进程句柄无效", pid);
            return (false, Some("进程句柄无效".to_string()));
        }
        
        let mut throttling_state = PROCESS_POWER_THROTTLING_STATE {
            Version: 1,
            ControlMask: PROCESS_POWER_THROTTLING_EXECUTION_SPEED | PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION,
            StateMask: PROCESS_POWER_THROTTLING_EXECUTION_SPEED | PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION,
        };
        
        let result = SetProcessInformation(
            process_handle,
            ProcessPowerThrottling,
            &mut throttling_state as *mut _ as *mut _,
            std::mem::size_of::<PROCESS_POWER_THROTTLING_STATE>() as u32
        );
        
        let _ = CloseHandle(process_handle);
        
        if let Err(e) = &result {
            eprintln!("[效率模式] PID {} SetProcessInformation失败: {:?}", pid, e);
            return (false, Some(format!("设置效率模式失败: {:?}", e)));
        }
        
        (true, None)
    }
}

fn set_process_io_priority(pid: Pid) -> (bool, Option<String>) {
    unsafe {
        use windows::Win32::System::Threading::{
            OpenProcess, SetProcessInformation, PROCESS_SET_INFORMATION, PROCESS_QUERY_INFORMATION, PROCESS_INFORMATION_CLASS
        };
        use windows::Win32::Foundation::CloseHandle;
        
        let process_handle = match OpenProcess(
            PROCESS_SET_INFORMATION | PROCESS_QUERY_INFORMATION,
            false,
            pid.as_u32()
        ) {
            Ok(handle) => handle,
            Err(e) => {
                eprintln!("[I/O优先级] PID {} OpenProcess失败: {:?}", pid, e);
                return (false, Some(format!("打开进程失败: {:?}", e)));
            },
        };
        
        if process_handle.is_invalid() {
            eprintln!("[I/O优先级] PID {} 进程句柄无效", pid);
            return (false, Some("进程句柄无效".to_string()));
        }
        
        let io_priority: u32 = 0;
        let result = SetProcessInformation(
            process_handle,
            PROCESS_INFORMATION_CLASS(33),
            &io_priority as *const _ as *const _,
            std::mem::size_of::<u32>() as u32
        );
        
        let _ = CloseHandle(process_handle);
        
        if let Err(e) = &result {
            eprintln!("[I/O优先级] PID {} SetProcessInformation失败: {:?}", pid, e);
            return (false, Some(format!("设置I/O优先级失败: {:?}", e)));
        }
        
        (true, None)
    }
}

fn set_process_memory_priority(pid: Pid) -> (bool, Option<String>) {
    unsafe {
        use windows::Win32::System::Threading::{
            OpenProcess, SetProcessInformation, PROCESS_SET_INFORMATION, PROCESS_QUERY_INFORMATION, PROCESS_INFORMATION_CLASS
        };
        use windows::Win32::Foundation::CloseHandle;
        
        let process_handle = match OpenProcess(
            PROCESS_SET_INFORMATION | PROCESS_QUERY_INFORMATION,
            false,
            pid.as_u32()
        ) {
            Ok(handle) => handle,
            Err(e) => {
                eprintln!("[内存优先级] PID {} OpenProcess失败: {:?}", pid, e);
                return (false, Some(format!("打开进程失败: {:?}", e)));
            },
        };
        
        if process_handle.is_invalid() {
            eprintln!("[内存优先级] PID {} 进程句柄无效", pid);
            return (false, Some("进程句柄无效".to_string()));
        }
        
        let memory_priority: u32 = 1;
        let result = SetProcessInformation(
            process_handle,
            PROCESS_INFORMATION_CLASS(39),
            &memory_priority as *const _ as *const _,
            std::mem::size_of::<u32>() as u32
        );
        
        let _ = CloseHandle(process_handle);
        
        if let Err(e) = &result {
            eprintln!("[内存优先级] PID {} SetProcessInformation失败: {:?}", pid, e);
            return (false, Some(format!("设置内存优先级失败: {:?}", e)));
        }
        
        (true, None)
    }
}

fn restrict_target_processes(enable_cpu_affinity: bool, enable_process_priority: bool, enable_efficiency_mode: bool, enable_io_priority: bool, enable_memory_priority: bool) -> RestrictResult {
    enable_debug_privilege();
    
    let mut system = System::new_all();
    system.refresh_processes();
    
    let (target_core, core_mask, is_e_core) = find_target_core();
    
    let mut sguard64_found = false;
    let mut sguard64_restricted = false;
    let mut sguardsvc64_found = false;
    let mut sguardsvc64_restricted = false;
    let mut weixin_found = false;
    let mut weixin_restricted = false;
    
    let mut message = String::new();
    
    let mode_parts: Vec<&str> = vec![
        if enable_cpu_affinity { "CPU亲和性" } else { "" },
        if enable_process_priority { "进程优先级" } else { "" },
        if enable_efficiency_mode { "效率模式" } else { "" },
        if enable_io_priority { "I/O优先级" } else { "" },
        if enable_memory_priority { "内存优先级" } else { "" },
    ].into_iter().filter(|s| !s.is_empty()).collect();
    
    let mode_str = if mode_parts.is_empty() { "标准模式".to_string() } else { mode_parts.join("+") };
    message.push_str(&format!("限制模式: {}\n", mode_str));
    
    message.push_str(&format!("绑定到最后一个逻辑核心 {}\n", target_core));
    
    for (pid, process) in system.processes() {
        let process_name = process.name().to_lowercase();
        
        if process_name.contains("sguard64.exe") {
            sguard64_found = true;
            
            let (affinity_ok, affinity_err, actual_core) = if enable_cpu_affinity {
                set_process_affinity_with_fallback(*pid, core_mask, is_e_core)
            } else {
                (false, None, 0)
            };
            let priority_ok = if enable_process_priority {
                set_process_priority(*pid)
            } else {
                false
            };
            
            let (efficiency_ok, io_priority_ok, mem_priority_ok) = {
                let (eff_ok, _) = if enable_efficiency_mode {
                    set_process_efficiency_mode(*pid)
                } else {
                    (false, None)
                };
                let (io_ok, _) = if enable_io_priority {
                    set_process_io_priority(*pid)
                } else {
                    (false, None)
                };
                let (mem_ok, _) = if enable_memory_priority {
                    set_process_memory_priority(*pid)
                } else {
                    (false, None)
                };
                (eff_ok, io_ok, mem_ok)
            };
            
            let mut details = Vec::new();
            if affinity_ok {
                details.push(format!("CPU亲和性→核心{}", actual_core));
            } else if let Some(err) = &affinity_err {
                details.push(format!("CPU亲和性✗({})", err));
            } else {
                details.push("CPU亲和性✗".to_string());
            }
            
            if priority_ok {
                details.push("优先级→最低".to_string());
            } else {
                details.push("优先级✗".to_string());
            }
            
            if efficiency_ok {
                details.push("效率模式✓".to_string());
            }
            if io_priority_ok {
                details.push("I/O优先级✓".to_string());
            }
            if mem_priority_ok {
                details.push("内存优先级✓".to_string());
            }
            
            if affinity_ok || priority_ok || efficiency_ok || io_priority_ok || mem_priority_ok {
                sguard64_restricted = true;
                message.push_str(&format!("SGuard64.exe (PID: {}) [{}]\n", pid, details.join(", ")));
            } else {
                message.push_str(&format!("SGuard64.exe (PID: {}) 所有限制均失败 [{}]\n", pid, details.join(", ")));
            }
        }
        
        if process_name.contains("sguardsvc64.exe") {
            sguardsvc64_found = true;
            
            let (affinity_ok, affinity_err, actual_core) = if enable_cpu_affinity {
                set_process_affinity_with_fallback(*pid, core_mask, is_e_core)
            } else {
                (false, None, 0)
            };
            let priority_ok = if enable_process_priority {
                set_process_priority(*pid)
            } else {
                false
            };
            
            let (efficiency_ok, io_priority_ok, mem_priority_ok) = {
                let (eff_ok, _) = if enable_efficiency_mode {
                    set_process_efficiency_mode(*pid)
                } else {
                    (false, None)
                };
                let (io_ok, _) = if enable_io_priority {
                    set_process_io_priority(*pid)
                } else {
                    (false, None)
                };
                let (mem_ok, _) = if enable_memory_priority {
                    set_process_memory_priority(*pid)
                } else {
                    (false, None)
                };
                (eff_ok, io_ok, mem_ok)
            };
            
            let mut details = Vec::new();
            if affinity_ok {
                details.push(format!("CPU亲和性→核心{}", actual_core));
            } else if let Some(err) = &affinity_err {
                details.push(format!("CPU亲和性✗({})", err));
            } else {
                details.push("CPU亲和性✗".to_string());
            }
            
            if priority_ok {
                details.push("优先级→最低".to_string());
            } else {
                details.push("优先级✗".to_string());
            }
            
            if efficiency_ok {
                details.push("效率模式✓".to_string());
            }
            if io_priority_ok {
                details.push("I/O优先级✓".to_string());
            }
            if mem_priority_ok {
                details.push("内存优先级✓".to_string());
            }
            
            if affinity_ok || priority_ok || efficiency_ok || io_priority_ok || mem_priority_ok {
                sguardsvc64_restricted = true;
                message.push_str(&format!("SGuardSvc64.exe (PID: {}) [{}]\n", pid, details.join(", ")));
            } else {
                message.push_str(&format!("SGuardSvc64.exe (PID: {}) 所有限制均失败 [{}]\n", pid, details.join(", ")));
            }
        }
        
        if process_name.contains("weixin.exe") {
            weixin_found = true;
            
            let (affinity_ok, affinity_err, actual_core) = if enable_cpu_affinity {
                set_process_affinity_with_fallback(*pid, core_mask, is_e_core)
            } else {
                (false, None, 0)
            };
            let priority_ok = if enable_process_priority {
                set_process_priority(*pid)
            } else {
                false
            };
            
            let (efficiency_ok, io_priority_ok, mem_priority_ok) = {
                let (eff_ok, _) = if enable_efficiency_mode {
                    set_process_efficiency_mode(*pid)
                } else {
                    (false, None)
                };
                let (io_ok, _) = if enable_io_priority {
                    set_process_io_priority(*pid)
                } else {
                    (false, None)
                };
                let (mem_ok, _) = if enable_memory_priority {
                    set_process_memory_priority(*pid)
                } else {
                    (false, None)
                };
                (eff_ok, io_ok, mem_ok)
            };
            
            let mut details = Vec::new();
            if affinity_ok {
                details.push(format!("CPU亲和性→核心{}", actual_core));
            } else if let Some(err) = &affinity_err {
                details.push(format!("CPU亲和性✗({})", err));
            } else {
                details.push("CPU亲和性✗".to_string());
            }
            
            if priority_ok {
                details.push("优先级→最低".to_string());
            } else {
                details.push("优先级✗".to_string());
            }
            
            if efficiency_ok {
                details.push("效率模式✓".to_string());
            }
            if io_priority_ok {
                details.push("I/O优先级✓".to_string());
            }
            if mem_priority_ok {
                details.push("内存优先级✓".to_string());
            }
            
            if affinity_ok || priority_ok || efficiency_ok || io_priority_ok || mem_priority_ok {
                weixin_restricted = true;
                message.push_str(&format!("Weixin.exe (PID: {}) [{}]\n", pid, details.join(", ")));
            } else {
                message.push_str(&format!("Weixin.exe (PID: {}) 所有限制均失败 [{}]\n", pid, details.join(", ")));
            }
        }
        
    }
    
    if !sguard64_found {
        message.push_str("未找到SGuard64.exe进程\n");
    }
    
    if !sguardsvc64_found {
        message.push_str("未找到SGuardSvc64.exe进程\n");
    }
    
    if !weixin_found {
        message.push_str("未找到Weixin.exe进程\n");
    }
    
    
    RestrictResult {
        target_core,
        sguard64_found,
        sguard64_restricted,
        sguardsvc64_found,
        sguardsvc64_restricted,
        weixin_found,
        weixin_restricted,
        message,
    }
}

#[tauri::command]
fn restrict_processes(
    _state: State<AppState>,
    enable_cpu_affinity: bool,
    enable_process_priority: bool,
    enable_efficiency_mode: bool,
    enable_io_priority: bool,
    enable_memory_priority: bool,
) -> RestrictResult {
    let result = restrict_target_processes(enable_cpu_affinity, enable_process_priority, enable_efficiency_mode, enable_io_priority, enable_memory_priority);
    result
}


fn enable_debug_privilege() -> bool {
    unsafe {
        use windows::Win32::Foundation::{CloseHandle, LUID};
        use windows::Win32::Security::{
            AdjustTokenPrivileges, LookupPrivilegeValueW, 
            SE_PRIVILEGE_ENABLED, TOKEN_ADJUST_PRIVILEGES, TOKEN_PRIVILEGES, LUID_AND_ATTRIBUTES
        };
        use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
        use windows::core::PCWSTR;
        
        let mut token_handle = windows::Win32::Foundation::HANDLE::default();
        
        if OpenProcessToken(
            GetCurrentProcess(),
            TOKEN_ADJUST_PRIVILEGES,
            &mut token_handle
        ).is_err() {
            eprintln!("[权限提升] OpenProcessToken失败");
            return false;
        }
        
        let mut luid = LUID::default();
        let privilege_name: Vec<u16> = "SeDebugPrivilege\0".encode_utf16().collect();
        
        if LookupPrivilegeValueW(
            PCWSTR::null(),
            PCWSTR(privilege_name.as_ptr()),
            &mut luid
        ).is_err() {
            eprintln!("[权限提升] LookupPrivilegeValueW失败");
            let _ = CloseHandle(token_handle);
            return false;
        }
        
        let mut tp = TOKEN_PRIVILEGES {
            PrivilegeCount: 1,
            Privileges: [LUID_AND_ATTRIBUTES {
                Luid: luid,
                Attributes: SE_PRIVILEGE_ENABLED,
            }],
        };
        
        let result = AdjustTokenPrivileges(
            token_handle,
            false,
            Some(&mut tp),
            0,
            None,
            None
        );
        
        let _ = CloseHandle(token_handle);
        
        if result.is_ok() {
            eprintln!("[权限提升] SeDebugPrivilege已启用");
            true
        } else {
            eprintln!("[权限提升] AdjustTokenPrivileges失败");
            false
        }
    }
}

fn is_elevated() -> bool {
    unsafe {
        use windows::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
        use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
        use windows::Win32::Foundation::CloseHandle;
        
        let mut token_handle = windows::Win32::Foundation::HANDLE::default();
        
        
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token_handle).is_err() {
            return false;
        }
        
        let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
        let mut return_length: u32 = 0;
        
        
        let result = GetTokenInformation(
            token_handle,
            TokenElevation,
            Some(&mut elevation as *mut _ as *mut _),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut return_length,
        );
        
        let _ = CloseHandle(token_handle);
        
        result.is_ok() && elevation.TokenIsElevated != 0
    }
}

#[tauri::command]
fn get_webview2_environment() -> String {
    #[cfg(target_os = "windows")]
    {
        use std::env;
        if let Ok(webview_path) = env::var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER") {
            if !webview_path.is_empty() {
                return "便携环境".to_string();
            }
        }
        if let Ok(exe_path) = env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                if exe_dir.join("webview2").exists() {
                    return "便携环境".to_string();
                }
            }
        }
        "本地环境".to_string()
    }
    
    #[cfg(not(target_os = "windows"))]
    {
        "非Windows平台".to_string()
    }
}

#[tauri::command]
fn get_system_info() -> SystemInfo {
    let mut system = System::new_all();
    system.refresh_all();
    
    let cpu_model = if let Some(cpu) = system.cpus().first() {
        cpu.brand().to_string()
    } else {
        "Unknown".to_string()
    };
    
    let cpu_cores = system.physical_core_count().unwrap_or(0);
    let cpu_logical_cores = system.cpus().len();
    
    let os_name = System::name().unwrap_or_else(|| "Unknown".to_string());
    let os_version = System::os_version().unwrap_or_else(|| "Unknown".to_string());
    
    let is_admin = is_elevated();
    
    let total_memory_gb = system.total_memory() as f64 / 1024.0 / 1024.0 / 1024.0;
    
    SystemInfo {
        cpu_model,
        cpu_cores,
        cpu_logical_cores,
        os_name,
        os_version,
        is_admin,
        total_memory_gb,
        webview2_env: get_webview2_environment(),
    }
}


#[tauri::command]
fn get_process_performance() -> Vec<ProcessPerformance> {
    let mut system = System::new_all();
    system.refresh_all();
    
    
    std::thread::sleep(std::time::Duration::from_millis(200));
    system.refresh_processes();
    
    let target_names = vec!["sguard64.exe", "sguardsvc64.exe", "weixin.exe"];
    let mut performances = Vec::new();
    
    for (pid, process) in system.processes() {
        let process_name = process.name().to_lowercase();
        
        for target in &target_names {
            if process_name.contains(target) {
                performances.push(ProcessPerformance {
                    pid: pid.as_u32(),
                    name: process.name().to_string(),
                    cpu_usage: process.cpu_usage(),
                    memory_mb: process.memory() as f64 / 1024.0 / 1024.0,
                });
                break;
            }
        }
    }
    
    performances
}

#[tauri::command]
fn check_game_processes() -> Vec<String> {
    Vec::new()
}

#[tauri::command]
fn set_game_process_priority() -> Result<String, String> {
    Ok("游戏进程优先级设置功能已改为手动执行模式。请通过前端界面手动选择要设置的进程。".to_string())
}

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "隐藏到托盘", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    
    let menu = Menu::with_items(app, &[
        &show,
        &PredefinedMenuItem::separator(app)?,
        &hide,
        &PredefinedMenuItem::separator(app)?,
        &quit,
    ])?;
    
    let _tray = TrayIconBuilder::with_id("main-tray")
        .tooltip("FuckACE")
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            match event {
                TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, .. } => {
                    let app = tray.app_handle();
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                TrayIconEvent::DoubleClick { button: tauri::tray::MouseButton::Left, .. } => {
                    let app = tray.app_handle();
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                _ => {}
            }
        })
        .on_menu_event(|app, event| {
            match event.id().as_ref() {
                "quit" => {
                    std::process::exit(0);
                }
                "show" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                "hide" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.hide();
                    }
                }
                _ => {}
            }
        })
        .build(app)?;
    
    Ok(())
}

#[tauri::command]
async fn show_close_dialog(app_handle: AppHandle) -> Result<String, String> {
    //最小化到托盘＞﹏＜
    if let Some(window) = app_handle.get_webview_window("main") {
        window.hide().unwrap();
    }
    Ok("已最小化到托盘".to_string())
}

#[tauri::command]
fn close_application(_app_handle: AppHandle) -> Result<String, String> {
    //退出FuckACE/(ㄒoㄒ)/~~
    std::process::exit(0);
}

fn get_exe_path() -> Result<String, String> {
    std::env::current_exe()
        .map_err(|e| format!("获取程序路径失败: {}", e))?
        .to_str()
        .ok_or_else(|| "路径转换失败".to_string())
        .map(|s| s.to_string())
}

#[tauri::command]
fn enable_autostart() -> Result<String, String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let path = r"Software\Microsoft\Windows\CurrentVersion\Run";
    
    let (key, _) = hkcu
        .create_subkey(path)
        .map_err(|e| format!("打开注册表失败: {}", e))?;
    
    let exe_path = get_exe_path()?;
    
    key.set_value("FuckACE", &exe_path)
        .map_err(|e| format!("设置注册表值失败: {}", e))?;
    
    Ok("开机自启动已启用".to_string())
}

#[tauri::command]
fn disable_autostart() -> Result<String, String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let path = r"Software\Microsoft\Windows\CurrentVersion\Run";
    
    let key = hkcu
        .open_subkey_with_flags(path, KEY_WRITE)
        .map_err(|e| format!("打开注册表失败: {}", e))?;
    
    key.delete_value("FuckACE")
        .map_err(|e| format!("删除注册表值失败: {}", e))?;
    
    Ok("开机自启动已禁用".to_string())
}

#[tauri::command]
fn check_autostart() -> Result<bool, String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let path = r"Software\Microsoft\Windows\CurrentVersion\Run";
    
    let key = hkcu
        .open_subkey(path)
        .map_err(|_| "打开注册表失败".to_string())?;
    
    match key.get_value::<String, _>("FuckACE") {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}

#[tauri::command]
fn lower_ace_priority() -> Result<String, String> {
    if !is_elevated() {
        return Err("需要管理员权限才能修改注册表".to_string());
    }
    
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let base_path = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options";
    
    let mut results = Vec::new();
    
    let configs = vec![
        ("SGuard64.exe", 1u32, 1u32),
        ("SGuardSvc64.exe", 1u32, 1u32),
    ];
    
    for (exe_name, cpu_priority, io_priority) in configs {
        let key_path = format!(r"{}\{}\PerfOptions", base_path, exe_name);
        
        match hklm.create_subkey(&key_path) {
            Ok((key, _)) => {
                let mut success = true;
                
                // 设置 CPU 优先级
                if let Err(e) = key.set_value("CpuPriorityClass", &cpu_priority) {
                    results.push(format!("{}:设置CPU优先级失败:{}", exe_name, e));
                    success = false;
                }
                
                // 设置 I/O 优先级
                if let Err(e) = key.set_value("IoPriority", &io_priority) {
                    results.push(format!("{}:设置I/O优先级失败:{}", exe_name, e));
                    success = false;
                }
                
                if success {
                    results.push(format!("{}:设置成功(CPU:{},I/O:{})", exe_name, cpu_priority, io_priority));
                }
            }
            Err(e) => {
                results.push(format!("{}:创建注册表项失败:{}", exe_name, e));
            }
        }
    }
    
    Ok(results.join("\n"))
}

#[tauri::command]
fn raise_delta_priority() -> Result<String, String> {
    if !is_elevated() {
        return Err("需要管理员权限才能修改注册表".to_string());
    }
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let base_path = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options";   
    let mut results = Vec::new();
    let configs = vec![
        ("DeltaForceClient-Win64-Shipping.exe", 3u32, 3u32),
    ];
    
    for (exe_name, cpu_priority, io_priority) in configs {
        let key_path = format!(r"{}\{}\PerfOptions", base_path, exe_name);
        
        match hklm.create_subkey(&key_path) {
            Ok((key, _)) => {
                let mut success = true;
                if let Err(e) = key.set_value("CpuPriorityClass", &cpu_priority) {
                    results.push(format!("{}:设置CPU优先级失败:{}", exe_name, e));
                    success = false;
                }
                if let Err(e) = key.set_value("IoPriority", &io_priority) {
                    results.push(format!("{}:设置I/O优先级失败:{}", exe_name, e));
                    success = false;
                }
                if success {
                    results.push(format!("{}:设置成功(CPU:{},I/O:{})", exe_name, cpu_priority, io_priority));
                }
            }
            Err(e) => {
                results.push(format!("{}:创建注册表项失败:{}", exe_name, e));
            }
        }
    }
    
    Ok(results.join("\n"))
}

#[tauri::command]
fn modify_valorant_registry_priority() -> Result<String, String> {
    if !is_elevated() {
        return Err("需要管理员权限才能修改注册表".to_string());
    }
    
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let base_path = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options";
    
    let mut results = Vec::new();
    let configs = vec![
        ("VALORANT-Win64-Shipping.exe", 3u32, 3u32),
    ];
    
    for (exe_name, cpu_priority, io_priority) in configs {
        let key_path = format!(r"{}\{}\PerfOptions", base_path, exe_name);
        
        match hklm.create_subkey(&key_path) {
            Ok((key, _)) => {
                let mut success = true;
                
                if let Err(e) = key.set_value("CpuPriorityClass", &cpu_priority) {
                    results.push(format!("{}:设置CPU优先级失败:{}", exe_name, e));
                    success = false;
                }
                
                if let Err(e) = key.set_value("IoPriority", &io_priority) {
                    results.push(format!("{}:设置I/O优先级失败:{}", exe_name, e));
                    success = false;
                }
                
                if success {
                    results.push(format!("{}:设置成功(CPU:{},I/O:{})", exe_name, cpu_priority, io_priority));
                }
            }
            Err(e) => {
                results.push(format!("{}:创建注册表项失败:{}", exe_name, e));
            }
        }
    }
    
    Ok(results.join("\n"))
}

#[tauri::command]
fn check_registry_priority() -> Result<String, String> {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let base_path = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options";
    
    let mut results = Vec::new();
    
    let exe_names = vec![
        "DeltaForceClient-Win64-Shipping.exe",
        "SGuard64.exe",
        "SGuardSvc64.exe",
        "VALORANT-Win64-Shipping.exe",
    ];
    
    for exe_name in exe_names {
        let key_path = format!(r"{}\{}\PerfOptions", base_path, exe_name);
        
        match hklm.open_subkey(&key_path) {
            Ok(key) => {
                let cpu_priority: Result<u32, _> = key.get_value("CpuPriorityClass");
                let io_priority: Result<u32, _> = key.get_value("IoPriority");
                
                let cpu_str = match cpu_priority {
                    Ok(v) => format!("CPU:{}", v),
                    Err(_) => "CPU:未设置".to_string(),
                };
                
                let io_str = match io_priority {
                    Ok(v) => format!("I/O:{}", v),
                    Err(_) => "I/O:未设置".to_string(),
                };
                
                results.push(format!("{}:[{},{}]", exe_name, cpu_str, io_str));
            }
            Err(_) => {
                results.push(format!("{}:未配置", exe_name));
            }
        }
    }
    
    Ok(results.join("\n"))
}


#[tauri::command]
fn reset_registry_priority() -> Result<String, String> {
    if !is_elevated() {
        return Err("需要管理员权限才能修改注册表".to_string());
    }
    
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let base_path = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options";
    
    let mut results = Vec::new();
    
    let exe_names = vec![
        "DeltaForceClient-Win64-Shipping.exe",
        "SGuard64.exe",
        "SGuardSvc64.exe",
        "VALORANT-Win64-Shipping.exe",
    ];
    
    for exe_name in exe_names {
        let exe_key_path = format!(r"{}\{}", base_path, exe_name);
        
        match hklm.open_subkey_with_flags(&exe_key_path, KEY_WRITE) {
            Ok(exe_key) => {
                match exe_key.delete_subkey("PerfOptions") {
                    Ok(_) => {
                        results.push(format!("{}:已恢复默认", exe_name));
                    }
                    Err(e) => {
                        results.push(format!("{}:删除失败:{}", exe_name, e));
                    }
                }
            }
            Err(_) => {
                results.push(format!("{}:未找到配置项", exe_name));
            }
        }
    }
    
    Ok(results.join("\n"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .manage(AppState)
        .setup(|app| {
            setup_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    if let Err(e) = window.emit("show-close-confirm", ()) {
                        eprintln!("发送关闭确认事件失败: {}", e);
                        if let Some(window) = window.app_handle().get_webview_window("main") {
                            let _ = window.hide();
                        }
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            restrict_processes, 
            get_system_info, 
            get_process_performance, 
            show_close_dialog, 
            close_application,
            enable_autostart, 
            disable_autostart, 
            check_autostart, 
            lower_ace_priority,
            raise_delta_priority, 
            modify_valorant_registry_priority,
            check_registry_priority, 
            reset_registry_priority,
            check_game_processes,
            set_game_process_priority])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}