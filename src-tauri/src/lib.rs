use serde::{Deserialize, Serialize};
use sysinfo::{System, Pid};
use tauri::{Emitter, State};

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
}

#[derive(Debug, Serialize, Deserialize)]
struct ProcessPerformance {
    pid: u32,
    name: String,
    cpu_usage: f32,
    memory_mb: f64,
}

struct AppState;

#[repr(C)]
struct GROUP_AFFINITY {
    mask: usize,
    group: u16,
    reserved: [u16; 3],
}

#[repr(C)]
struct PROCESSOR_RELATIONSHIP {
    flags: u8,
    efficiency_class: u8,
    reserved: [u8; 20],
    group_count: u16,
    group_mask: [GROUP_AFFINITY; 1],
}

#[repr(C)]
struct SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX {
    relationship: u32,
    size: u32,
    processor: PROCESSOR_RELATIONSHIP,
}

fn find_target_core() -> (u32, u64, bool) {
    match detect_e_cores() {
        Some((target_core, core_mask)) => {
            (target_core, core_mask, true)
        }
        None => {
            let system = System::new_all();
            let total_cores = system.cpus().len() as u32;
            let target_core = if total_cores > 0 { total_cores - 1 } else { 0 };
            let core_mask = 1u64 << target_core;
            
            (target_core, core_mask, false)
        }
    }
}

fn detect_e_cores() -> Option<(u32, u64)> {
    unsafe {
        use windows::Win32::System::SystemInformation::{
            GetLogicalProcessorInformationEx, RelationProcessorCore
        };
        
        let mut buffer_size: u32 = 0;
        
        let _ = GetLogicalProcessorInformationEx(
            RelationProcessorCore,
            None,
            &mut buffer_size
        );
        
        if buffer_size == 0 {
            eprintln!("[E-Core检测] 无法获取处理器信息缓冲区大小");
            return None;
        }
        
        let mut buffer: Vec<u8> = vec![0; buffer_size as usize];
        
        if GetLogicalProcessorInformationEx(
            RelationProcessorCore,
            Some(buffer.as_mut_ptr() as *mut _),
            &mut buffer_size
        ).is_err() {
            eprintln!("[E-Core检测] 获取处理器信息失败");
            return None;
        }
        
        let mut offset = 0usize;
        let mut all_cores: Vec<(u32, u8)> = Vec::new();
        
        while offset < buffer_size as usize {
            let info = &*(buffer.as_ptr().add(offset) as *const SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX);
            
            if info.relationship == 0 {
                let proc_rel = &info.processor;
                
                for i in 0..proc_rel.group_count as usize {
                    let group_affinity_ptr = (&proc_rel.group_mask[0] as *const GROUP_AFFINITY)
                        .add(i);
                    let group_affinity = &*group_affinity_ptr;
                    
                    let mask = group_affinity.mask;
                    let group = group_affinity.group;
                    
                    for j in 0..64 {
                        if (mask & (1 << j)) != 0 {
                            let cpu_index = (group as u32 * 64) + j;
                            all_cores.push((cpu_index, proc_rel.efficiency_class));
                        }
                    }
                }
            }
            
            if info.size == 0 {
                break;
            }
            offset += info.size as usize;
        }
        
        if !all_cores.is_empty() {
            eprintln!("E-Core检测 发现 {} 个逻辑处理器", all_cores.len());
            let unique_efficiency: std::collections::HashSet<u8> = all_cores.iter().map(|(_, e)| *e).collect();
            eprintln!("E-Core检测 效率等级: {:?}", unique_efficiency);
        }
        
        if all_cores.len() > 1 {
            let max_efficiency = all_cores.iter().map(|(_, e)| *e).max()?;
            let min_efficiency = all_cores.iter().map(|(_, e)| *e).min()?;
            
            if max_efficiency > min_efficiency {
                let e_cores: Vec<u32> = all_cores.iter()
                    .filter(|(_, e)| *e == max_efficiency)
                    .map(|(core, _)| *core)
                    .collect();
                
                if !e_cores.is_empty() {
                    let target_e_core = *e_cores.last().unwrap();
                    let core_mask = 1u64 << target_e_core;
                    eprintln!("E-Core检测 识别到混合架构CPU，E-Core效率等级: {}", max_efficiency);
                    eprintln!("E-Core检测 发现 {} 个E-Core: {:?}", e_cores.len(), e_cores);
                    eprintln!("E-Core检测 选择最后一个E-Core: {}", target_e_core);
                    return Some((target_e_core, core_mask));
                }
            } else {
                eprintln!("E-Core检测 所有核心效率等级相同 ({}), 非混合架构CPU", min_efficiency);
            }
        }
        
        eprintln!("E-Core检测 未检测到E-Core，将使用备用方案");
        None
    }
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

fn restrict_target_processes(aggressive_mode: bool) -> RestrictResult {
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
    
    let mode_str = if aggressive_mode { "激进模式" } else { "标准模式" };
    message.push_str(&format!("限制模式: {}\n", mode_str));
    
    if is_e_core {
        message.push_str(&format!("识别到能效核 (E-Core)\n"));
        message.push_str(&format!("采用最佳方案：绑定到能效核心 {}\n", target_core));
    } else {
        message.push_str(&format!("未识别到能效核，启用备用方案\n"));
        message.push_str(&format!("备用方案：绑定到最后一个逻辑核心 {}\n", target_core));
    }
    
    for (pid, process) in system.processes() {
        let process_name = process.name().to_lowercase();
        
        if process_name.contains("sguard64.exe") {
            sguard64_found = true;
            
            let (affinity_ok, affinity_err, actual_core) = set_process_affinity_with_fallback(*pid, core_mask, is_e_core);
            let priority_ok = set_process_priority(*pid);
            
            let (efficiency_ok, io_priority_ok, mem_priority_ok) = if aggressive_mode {
                let (eff_ok, _) = set_process_efficiency_mode(*pid);
                let (io_ok, _) = set_process_io_priority(*pid);
                let (mem_ok, _) = set_process_memory_priority(*pid);
                (eff_ok, io_ok, mem_ok)
            } else {
                let (eff_ok, _) = if !priority_ok {
                    set_process_efficiency_mode(*pid)
                } else {
                    (false, None)
                };
                let (io_ok, _) = if !priority_ok && !eff_ok {
                    set_process_io_priority(*pid)
                } else {
                    (false, None)
                };
                let (mem_ok, _) = if !priority_ok && !eff_ok && !io_ok {
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
            
            let (affinity_ok, affinity_err, actual_core) = set_process_affinity_with_fallback(*pid, core_mask, is_e_core);
            let priority_ok = set_process_priority(*pid);
            
            let (efficiency_ok, io_priority_ok, mem_priority_ok) = if aggressive_mode {
                let (eff_ok, _) = set_process_efficiency_mode(*pid);
                let (io_ok, _) = set_process_io_priority(*pid);
                let (mem_ok, _) = set_process_memory_priority(*pid);
                (eff_ok, io_ok, mem_ok)
            } else {
                let (eff_ok, _) = if !priority_ok {
                    set_process_efficiency_mode(*pid)
                } else {
                    (false, None)
                };
                let (io_ok, _) = if !priority_ok && !eff_ok {
                    set_process_io_priority(*pid)
                } else {
                    (false, None)
                };
                let (mem_ok, _) = if !priority_ok && !eff_ok && !io_ok {
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
            
            let (affinity_ok, affinity_err, actual_core) = set_process_affinity_with_fallback(*pid, core_mask, is_e_core);
            let priority_ok = set_process_priority(*pid);
            
            let (efficiency_ok, io_priority_ok, mem_priority_ok) = if aggressive_mode {
                let (eff_ok, _) = set_process_efficiency_mode(*pid);
                let (io_ok, _) = set_process_io_priority(*pid);
                let (mem_ok, _) = set_process_memory_priority(*pid);
                (eff_ok, io_ok, mem_ok)
            } else {
                let (eff_ok, _) = if !priority_ok {
                    set_process_efficiency_mode(*pid)
                } else {
                    (false, None)
                };
                let (io_ok, _) = if !priority_ok && !eff_ok {
                    set_process_io_priority(*pid)
                } else {
                    (false, None)
                };
                let (mem_ok, _) = if !priority_ok && !eff_ok && !io_ok {
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
fn restrict_processes(_state: State<AppState>, aggressive_mode: bool) -> RestrictResult {
    let result = restrict_target_processes(aggressive_mode);
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
    }
}

#[tauri::command]
async fn start_timer(app_handle: tauri::AppHandle, aggressive_mode: bool) -> Result<String, String> {
    let app_handle_clone = app_handle.clone();
    
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
        
        loop {
            interval.tick().await;
            
            let result = restrict_target_processes(aggressive_mode);
            
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState)
        .invoke_handler(tauri::generate_handler![restrict_processes, get_system_info, start_timer, stop_timer, get_process_performance])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
