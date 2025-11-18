import { invoke } from "@tauri-apps/api/core";

let startBtn: HTMLButtonElement | null;
let stopBtn: HTMLButtonElement | null;
let manualBtn: HTMLButtonElement | null;
let monitorStatusEl: HTMLElement | null;
let countdownEl: HTMLElement | null;
let targetCoreEl: HTMLElement | null;
let sguard64StatusEl: HTMLElement | null;
let sguardsvc64StatusEl: HTMLElement | null;
let logContainerEl: HTMLElement | null;

let isMonitoring = false;
let countdownTimer: number | null = null;
let countdownSeconds = 60;

function addLogEntry(message: string) {
  if (!logContainerEl) return;
  
  const logEntry = document.createElement('div');
  logEntry.className = 'log-entry';
  logEntry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  
  logContainerEl.appendChild(logEntry);
  logContainerEl.scrollTop = logContainerEl.scrollHeight;
}


function updateCountdown(seconds: number) {
  if (countdownEl) {
    countdownEl.textContent = `${seconds}秒`;
  }
}

function startCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
  }
  
  countdownSeconds = 60;
  updateCountdown(countdownSeconds);
  
  countdownTimer = window.setInterval(() => {
    countdownSeconds--;
    updateCountdown(countdownSeconds);
    
    if (countdownSeconds <= 0) {
      if (isMonitoring) {
        executeProcessRestriction();
        countdownSeconds = 60;
        updateCountdown(countdownSeconds);
      }
    }
  }, 1000);
}
async function executeProcessRestriction() {
  try {
    addLogEntry('进程限制开始b（￣▽￣）d　');
    
    const result = await invoke('restrict_processes') as {
      target_core: number;
      sguard64_found: boolean;
      sguard64_restricted: boolean;
      sguardsvc64_found: boolean;
      sguardsvc64_restricted: boolean;
      message: string;
    };
    
    if (targetCoreEl) {
      targetCoreEl.textContent = `核心 ${result.target_core}`;
    }
    
    if (sguard64StatusEl) {
      if (result.sguard64_found) {
        sguard64StatusEl.textContent = result.sguard64_restricted ? '已限制' : '已发现，未限制';
        sguard64StatusEl.setAttribute('data-status', result.sguard64_restricted ? 'restricted' : 'running');
      } else {
        sguard64StatusEl.textContent = '未找到';
        sguard64StatusEl.removeAttribute('data-status');
      }
    }
    
    if (sguardsvc64StatusEl) {
      if (result.sguardsvc64_found) {
        sguardsvc64StatusEl.textContent = result.sguardsvc64_restricted ? '已限制' : '已发现，未限制';
        sguardsvc64StatusEl.setAttribute('data-status', result.sguardsvc64_restricted ? 'restricted' : 'running');
      } else {
        sguardsvc64StatusEl.textContent = '未找到';
        sguardsvc64StatusEl.removeAttribute('data-status');
      }
    }
    
    addLogEntry(result.message);
    
  } catch (error) {
    addLogEntry(`执行失败: ${error}`);
    console.error('执行进程限制失败/(ㄒoㄒ)/~~', error);
  }
}

async function startMonitoring() {
  if (isMonitoring) return;
  
  isMonitoring = true;
  
  try {
    await invoke('start_timer');
    if (startBtn) startBtn.disabled = true;
    if (stopBtn) stopBtn.disabled = false;
    if (monitorStatusEl) monitorStatusEl.textContent = '监控中';
    addLogEntry('启动进程监控');
    await executeProcessRestriction();
    startCountdown();
  } catch (error) {
    addLogEntry(`启动监控失败: ${error}`);
    isMonitoring = false;
    if (startBtn) startBtn.disabled = false;
    if (stopBtn) stopBtn.disabled = true;
    if (monitorStatusEl) monitorStatusEl.textContent = '已停止';
  }
}
async function stopMonitoring() {
  if (!isMonitoring) return;
  isMonitoring = false;
  try {
    await invoke('stop_timer');
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    
    if (startBtn) startBtn.disabled = false;
    if (stopBtn) stopBtn.disabled = true;
    if (monitorStatusEl) monitorStatusEl.textContent = '已停止';
    if (countdownEl) countdownEl.textContent = '--';
    
    addLogEntry('停止进程监控');
  } catch (error) {
    addLogEntry(`停止监控失败: ${error}`);
  }
}


async function manualExecute() {
  if (!isMonitoring) {
    addLogEntry('请先启动监控');
    return;
  }
  addLogEntry('手动执行限制操作');
  await executeProcessRestriction();
  if (countdownTimer) {
    clearInterval(countdownTimer);
    startCountdown();
  }
}
function initializeUI() {
  startBtn = document.querySelector('#start-btn');
  stopBtn = document.querySelector('#stop-btn');
  manualBtn = document.querySelector('#manual-btn');
  monitorStatusEl = document.querySelector('#monitor-status');
  countdownEl = document.querySelector('#countdown');
  targetCoreEl = document.querySelector('#target-core');
  sguard64StatusEl = document.querySelector('#sguard64-status');
  sguardsvc64StatusEl = document.querySelector('#sguardsvc64-status');
  logContainerEl = document.querySelector('#log-container');
  
  if (startBtn) {
    startBtn.addEventListener('click', startMonitoring);
  }
  
  if (stopBtn) {
    stopBtn.addEventListener('click', stopMonitoring);
  }
  
  if (manualBtn) {
    manualBtn.addEventListener('click', manualExecute);
  }
  if (monitorStatusEl) monitorStatusEl.textContent = '等待启动';
  if (countdownEl) countdownEl.textContent = '60秒';
  if (targetCoreEl) targetCoreEl.textContent = '检测中...';
  
  addLogEntry('UI初始化完成');
}

window.addEventListener('DOMContentLoaded', initializeUI);
