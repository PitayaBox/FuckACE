use sysinfo::{Pid, System};
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::Threading::{
    OpenProcess, SetPriorityClass, SetProcessAffinityMask, SetProcessInformation,
    IDLE_PRIORITY_CLASS, PROCESS_INFORMATION_CLASS, PROCESS_POWER_THROTTLING_EXECUTION_SPEED,
    PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION, PROCESS_POWER_THROTTLING_STATE,
    PROCESS_QUERY_INFORMATION, PROCESS_SET_INFORMATION, ProcessPowerThrottling,
};

// 定义一个简单的 Result 类型别名，方便错误处理
type Result<T> = std::result::Result<T, String>;

/// RAII 包装器：确保 Handle 总是被关闭
struct ScopedHandle(HANDLE);

impl Drop for ScopedHandle {
    fn drop(&mut self) {
        if !self.0.is_invalid() {
            unsafe { let _ = CloseHandle(self.0); }
        }
    }
}

impl ScopedHandle {
    fn open(pid: u32) -> Result<Self> {
        unsafe {
            let handle = OpenProcess(
                PROCESS_SET_INFORMATION | PROCESS_QUERY_INFORMATION,
                false,
                pid,
            ).map_err(|e| format!("无法打开进程 (PID: {}): {}", pid, e))?;

            if handle.is_invalid() {
                return Err("进程句柄无效".to_string());
            }
            Ok(Self(handle))
        }
    }
    
    // 获取原始 Handle 用于 API 调用
    fn raw(&self) -> HANDLE {
        self.0
    }
}

// --- 核心功能封装 ---

pub fn set_cpu_affinity(pid: u32, core_mask: u64) -> Result<()> {
    let handle = ScopedHandle::open(pid)?;
    unsafe {
        SetProcessAffinityMask(handle.raw(), core_mask as usize)
            .map_err(|e| format!("设置 CPU 亲和性失败: {}", e))?;
    }
    Ok(())
}

pub fn set_idle_priority(pid: u32) -> Result<()> {
    let handle = ScopedHandle::open(pid)?;
    unsafe {
        SetPriorityClass(handle.raw(), IDLE_PRIORITY_CLASS)
            .map_err(|e| format!("设置进程优先级失败: {}", e))?;
    }
    Ok(())
}

pub fn set_efficiency_mode(pid: u32) -> Result<()> {
    let handle = ScopedHandle::open(pid)?;
    unsafe {
        let mut policy = PROCESS_POWER_THROTTLING_STATE {
            Version: 1,
            ControlMask: PROCESS_POWER_THROTTLING_EXECUTION_SPEED | PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION,
            StateMask: PROCESS_POWER_THROTTLING_EXECUTION_SPEED | PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION,
        };

        SetProcessInformation(
            handle.raw(),
            ProcessPowerThrottling,
            &mut policy as *mut _ as *mut _,
            std::mem::size_of::<PROCESS_POWER_THROTTLING_STATE>() as u32,
        ).map_err(|e| format!("设置效率模式失败: {}", e))?;
    }
    Ok(())
}

pub fn set_io_priority(pid: u32, priority: u32) -> Result<()> {
    let handle = ScopedHandle::open(pid)?;
    unsafe {
        SetProcessInformation(
            handle.raw(),
            PROCESS_INFORMATION_CLASS(33), // ProcessIoPriority
            &priority as *const _ as *const _,
            std::mem::size_of::<u32>() as u32,
        ).map_err(|e| format!("设置 I/O 优先级失败: {}", e))?;
    }
    Ok(())
}

pub fn set_memory_priority(pid: u32, priority: u32) -> Result<()> {
    let handle = ScopedHandle::open(pid)?;
    unsafe {
        SetProcessInformation(
            handle.raw(),
            PROCESS_INFORMATION_CLASS(39), // ProcessMemoryPriority
            &priority as *const _ as *const _,
            std::mem::size_of::<u32>() as u32,
        ).map_err(|e| format!("设置内存优先级失败: {}", e))?;
    }
    Ok(())
}

// --- 辅助逻辑 ---

pub fn find_target_core() -> (u32, u64) {
    let system = System::new_all();
    let total_cores = system.cpus().len() as u32;
    let target_core = if total_cores > 0 { total_cores - 1 } else { 0 };
    let core_mask = 1u64 << target_core;
    (target_core, core_mask)
}