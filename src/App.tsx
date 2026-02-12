import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useInitialData } from './hooks/useOptimizedSupabase';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-shell';
import {
  Paper, Typography, Button, Box, Chip, Divider, ThemeProvider, createTheme, CssBaseline, Avatar, Switch,
  FormControlLabel, IconButton, useMediaQuery, GlobalStyles, Dialog, DialogTitle,
  DialogContent, DialogContentText, DialogActions, TextField, Tooltip, styled, SwitchProps
} from '@mui/material';
import {
  PlayArrow as StartIcon, DarkMode as DarkModeIcon, LightMode as LightModeIcon,
  Tune as ActiveIcon, Terminal as TerminalIcon,
  Warning as WarningIcon,
  InfoOutlined as InfoIcon,
  SportsEsports as GameIcon, Shield as ShieldIcon,
  GitHub as GitHubIcon, PowerSettingsNew as QuitIcon,
  Memory as MemoryIcon
} from '@mui/icons-material';

// --- Clash 风格 Switch ---
const ClashSwitch = styled((props: SwitchProps) => (
  <Switch focusVisibleClassName=".Mui-focusVisible" disableRipple {...props} />
))(({ theme }) => ({
  width: 44, height: 24, padding: 0,
  '& .MuiSwitch-switchBase': {
    padding: 0, margin: 2, transitionDuration: '300ms',
    '&.Mui-checked': {
      transform: 'translateX(20px)', color: '#fff',
      '& + .MuiSwitch-track': { backgroundColor: '#409eff', opacity: 1, border: 0 },
    },
    '&.Mui-focusVisible .MuiSwitch-thumb': { color: '#33cf4d', border: '6px solid #fff' },
  },
  '& .MuiSwitch-thumb': { boxSizing: 'border-box', width: 20, height: 20 },
  '& .MuiSwitch-track': {
    borderRadius: 12, backgroundColor: theme.palette.mode === 'light' ? '#dcdfe6' : '#4c4d4f',
    opacity: 1, transition: theme.transitions.create(['background-color'], { duration: 500 }),
  },
}));

interface ProcessStatus { target_core: number; sguard64_restricted: boolean; message: string; }
interface LogEntry { id: number; timestamp: string; message: string; }
interface SystemInfo { cpu_model: string; os_name: string; os_version: string; cpu_logical_cores: number; }
interface ProcessPerformance { pid: number; name: string; cpu_usage: number; memory_mb: number; }

function App() {
  const [targetCore, setTargetCore] = useState<number | null>(null);
  const [processStatus, setProcessStatus] = useState<ProcessStatus | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const prefersDarkMode = useMediaQuery('(prefers-color-scheme: dark)');
  const [darkMode, setDarkMode] = useState(true); // 默认深色
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [performance, setPerformance] = useState<ProcessPerformance[]>([]);
  
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [disclaimerInput, setDisclaimerInput] = useState('');
  const [showExitDialog, setShowExitDialog] = useState(false);

  // 开关状态
  const [enableCpuAffinity, setEnableCpuAffinity] = useState(true);
  const [enableProcessPriority, setEnableProcessPriority] = useState(true);
  const [enableEfficiencyMode, setEnableEfficiencyMode] = useState(false);
  const [enableIoPriority, setEnableIoPriority] = useState(false);
  const [enableMemoryPriority, setEnableMemoryPriority] = useState(false);
  const [enableAutoLimit, setEnableAutoLimit] = useState(false);
  const [autoStartEnabled, setAutoStartEnabled] = useState(false);

  // Clash Verge 风格主题
  const theme = useMemo(() => createTheme({
    palette: {
      mode: darkMode ? 'dark' : 'light',
      primary: { main: '#409eff' },
      secondary: { main: '#67c23a' },
      error: { main: '#f56c6c' },
      background: { 
        default: darkMode ? '#1b1d23' : '#f0f2f5', 
        paper: darkMode ? '#252a34' : '#ffffff' 
      },
      text: { 
        primary: darkMode ? '#ffffff' : '#303133', 
        secondary: darkMode ? '#a1a1aa' : '#57606a' 
      }
    },
    shape: { borderRadius: 12 },
    typography: { fontFamily: '"Segoe UI", "Microsoft YaHei", sans-serif', fontSize: 13 },
    components: {
      MuiPaper: { styleOverrides: { root: { backgroundImage: 'none', boxShadow: darkMode ? '0 4px 12px rgba(0,0,0,0.2)' : '0 2px 10px rgba(0,0,0,0.05)' } } },
      MuiButton: { styleOverrides: { root: { textTransform: 'none', fontWeight: 600, boxShadow: 'none' } } },
      MuiTooltip: { styleOverrides: { tooltip: { backgroundColor: '#303133', fontSize: '0.75rem', padding: '8px 12px' }, arrow: { color: '#303133' } } },
      MuiDialog: { styleOverrides: { paper: { backgroundColor: darkMode ? '#252a34' : '#fff' } } }
    }
  }), [darkMode]);

  const addLog = useCallback((message: string) => {
    setLogs(prev => [...prev, { id: Date.now() + Math.random(), timestamp: new Date().toLocaleTimeString(), message }].slice(-100));
  }, []);

  const runRegistryCommand = async (command: string, desc: string) => {
    addLog(`指令: ${desc}`);
    try { const msg = await invoke<string>(command); addLog(msg); } catch (e) { addLog(`❌ 错误: ${e}`); }
  };

  const executeRestriction = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const result = await invoke<ProcessStatus>('restrict_processes', {
        enableCpuAffinity, enableProcessPriority, enableEfficiencyMode, enableIoPriority, enableMemoryPriority 
      });
      setProcessStatus(result);
      if (result.target_core) setTargetCore(result.target_core);
      if (!silent) addLog(result.message);
    } catch (e) { if (!silent) addLog(`失败: ${e}`); }
    if (!silent) setLoading(false);
  }, [addLog, enableCpuAffinity, enableProcessPriority, enableEfficiencyMode, enableIoPriority, enableMemoryPriority]);

  const toggleAutoStart = async () => {
    try {
      if (autoStartEnabled) { await invoke('disable_autostart'); addLog('自启动已关闭'); } 
      else { await invoke('enable_autostart'); addLog('自启动已开启'); }
      setAutoStartEnabled(!autoStartEnabled);
    } catch (e) { addLog(`自启动设置错误: ${e}`); }
  };

  const openGitHub = async () => {
    try { await invoke('open_github'); } catch (e) { addLog(`打开链接失败: ${e}`); }
  };

  useEffect(() => {
    const hasAgreed = localStorage.getItem('pitayabox_disclaimer_agreed_v11'); 
    if (hasAgreed !== 'true') setShowDisclaimer(true);
    const unlistenPromise = listen('request-close', () => setShowExitDialog(true));
    addLog('核心服务已就绪');
    invoke<SystemInfo>('get_system_info').then(info => {
        setSystemInfo(info);
        if (info.cpu_logical_cores > 0) setTargetCore(info.cpu_logical_cores - 1);
    });
    invoke<boolean>('check_autostart').then(setAutoStartEnabled);
    
    const interval = setInterval(async () => {
      setPerformance(await invoke<ProcessPerformance[]>('get_process_performance'));
      if (enableAutoLimit) executeRestriction(true);
    }, 30000); 
    
    return () => { unlistenPromise.then(f => f()); clearInterval(interval); };
  }, [addLog, enableAutoLimit, executeRestriction]);

  useEffect(() => { if (logContainerRef.current) logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight; }, [logs]);
  useInitialData(); 

  const handleDisclaimerAgree = () => {
    if (disclaimerInput === '我已知晓风险并自愿承担后果') {
      localStorage.setItem('pitayabox_disclaimer_agreed_v11', 'true');
      setShowDisclaimer(false);
    }
  };

  // --- Tooltips ---
  const CoreRiskTooltip = (
    <Box>
      <Typography variant="subtitle2" fontWeight="bold" color="#67c23a" gutterBottom>功能详解</Typography>
      <Box mb={0.5}>● <strong>CPU 亲和性 (推荐)</strong>: 风险极低。防止 ACE 抢占游戏核心。</Box>
      <Box mb={0.5}>● <strong>效率模式 (推荐)</strong>: 风险低。Win11 节能特性，降低资源占用。</Box>
      <Box mb={0.5}>● <strong>优先级压制 (推荐)</strong>: 风险中。极端情况可能被踢出游戏。</Box>
      <Box>● <strong>I/O与内存 (可选)</strong>: 风险中。高配电脑建议关闭。</Box>
    </Box>
  );

  const GameOptTooltip = (
    <Box>
      <Typography variant="subtitle2" fontWeight="bold" color="#409eff" gutterBottom>优化原理</Typography>
      <Typography variant="caption" display="block">通过注册表强制 Windows 以<strong>“高优先级”</strong>启动游戏，减少掉帧与卡顿。</Typography>
    </Box>
  );

  // --- UI 组件 ---
  const ClashCard = ({ children, title, icon, action, danger = false, color="default" }: any) => (
    <Paper sx={{ p: 0, height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'background.paper', position: 'relative', overflow: 'hidden' }}>
      <Box sx={{ height: 3, width: '100%', bgcolor: danger ? '#f56c6c' : (color === 'blue' ? '#409eff' : (color === 'green' ? '#67c23a' : 'transparent')) }} />
      <Box p={2.5} pb={0} display="flex" justifyContent="space-between" alignItems="center">
        <Box display="flex" alignItems="center" gap={1.2} color={danger ? 'error.main' : 'text.primary'}>
          {icon} <Typography variant="h6" fontWeight="bold" fontSize="0.95rem">{title}</Typography>
        </Box>
        {action}
      </Box>
      <Box p={2.5}>{children}</Box>
    </Paper>
  );

  const SettingRow = ({ checked, onChange, label, desc }: any) => (
    <Box display="flex" justifyContent="space-between" alignItems="center" py={1.2} borderBottom={darkMode ? '1px solid #363b40' : '1px solid #f0f0f0'}>
      <Box>
        <Typography variant="body2" fontWeight="bold" fontSize="0.9rem">{label}</Typography>
        <Typography variant="caption" color="text.secondary" fontSize="0.75rem">{desc}</Typography>
      </Box>
      <ClashSwitch checked={checked} onChange={onChange} />
    </Box>
  );

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <GlobalStyles styles={{ '*::-webkit-scrollbar': { width: '4px' }, '*::-webkit-scrollbar-thumb': { backgroundColor: darkMode ? '#4c4d4f' : '#ccc', borderRadius: '2px' } }} />

      {/* 免责声明 */}
      <Dialog open={showDisclaimer} disableEscapeKeyDown fullWidth maxWidth="sm">
        <DialogTitle sx={{ textAlign: 'center', pt: 3 }}><Typography variant="h5" fontWeight="bold">风险告知</Typography></DialogTitle>
        <DialogContent sx={{ px: 4 }}>
          <Box sx={{ bgcolor: darkMode ? '#1e1e2e' : '#f5f5f7', p: 2, borderRadius: 2, mb: 3, border: `1px solid ${darkMode?'#333':'#e0e0e0'}` }}>
            <DialogContentText sx={{ textAlign: 'justify', fontSize: '0.9rem', lineHeight: 1.6 }}>
              1. <strong>PitayaBox</strong> 仅供技术研究使用，开发者不承担任何责任。<br/>
              2. 修改注册表及干预系统进程属于高风险操作，可能导致账号封禁。<br/>
              3. 请确认您完全理解风险。
            </DialogContentText>
          </Box>
          <Box>
             {/* 修复点：将 color="primary" (蓝色) 改为 color="error" (红色) 
                以匹配下方的输入提示
             */}
             <Typography variant="caption" color="error" sx={{ display: 'block', mb: 1, fontWeight: 'bold', textAlign: 'center', fontSize: '1rem' }}>
                请严格输入：我已知晓风险并自愿承担后果
             </Typography>
             <TextField 
                variant="outlined" 
                placeholder="在此输入上方红色文字..."
                value={disclaimerInput} 
                onChange={(e) => setDisclaimerInput(e.target.value)} 
                fullWidth size="small"
                sx={{ 
                   input: { color: darkMode ? '#fff' : '#000', textAlign: 'center', fontWeight: 'bold' }, 
                   bgcolor: darkMode ? '#252a34' : '#fff',
                   fieldset: { borderColor: darkMode ? '#444' : '#ccc' }
                }}
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 3, justifyContent: 'center', gap: 2 }}>
          <Button onClick={() => invoke('exit_app')} color="error">退出</Button>
          <Button onClick={handleDisclaimerAgree} variant="contained" disabled={disclaimerInput !== '我已知晓风险并自愿承担后果'}>进入软件</Button>
        </DialogActions>
      </Dialog>

      {/* 退出弹窗 */}
      <Dialog open={showExitDialog} onClose={() => setShowExitDialog(false)}>
        <DialogTitle sx={{ textAlign: 'center' }}>关闭程序</DialogTitle>
        <DialogContent><DialogContentText sx={{ textAlign: 'center' }}>保持后台运行可确保持续压制 ACE 进程。</DialogContentText></DialogContent>
        <DialogActions sx={{ p: 3, justifyContent: 'center', gap: 2 }}>
          <Button variant="contained" onClick={() => { getCurrentWindow().minimize(); setShowExitDialog(false); }}>最小化 (推荐)</Button>
          <Button color="error" onClick={() => invoke('exit_app')}>彻底退出</Button>
        </DialogActions>
      </Dialog>

      <Box sx={{ height: '100vh', display: 'flex', overflow: 'hidden', bgcolor: 'background.default', color: 'text.primary' }}>
        
        {/* 左侧侧边栏 */}
        <Box sx={{ width: 260, display: 'flex', flexDirection: 'column', bgcolor: darkMode ? '#1b1d23' : '#f0f2f5', borderRight: `1px solid ${darkMode?'#1e1e2e':'#e0e0e0'}` }}>
          
          <Box p={3} pb={1} display="flex" alignItems="center" gap={2}>
            <Avatar src="/logo.png" variant="rounded" sx={{ width: 36, height: 36, borderRadius: '8px' }} />
            <Box>
                <Typography variant="h6" fontWeight="bold" lineHeight={1.1} fontSize="1.1rem">PitayaBox</Typography>
                <Typography variant="caption" color="text.secondary">v0.5.3</Typography>
            </Box>
          </Box>

          <Box px={3} py={2}>
             <Typography variant="caption" fontWeight="bold" color="text.secondary" mb={1} display="block">概览</Typography>
             <Box p={2} borderRadius={2} bgcolor={darkMode ? '#252a34' : '#ffffff'} mb={2} border={`1px solid ${darkMode?'#363b40':'#eee'}`}>
                 <Box display="flex" alignItems="center" gap={1} mb={0.5}>
                    <MemoryIcon fontSize="small" color="primary"/>
                    <Typography variant="caption" color="text.secondary">目标核心</Typography>
                 </Box>
                 <Typography variant="h4" fontWeight="bold" color="primary.main">#{targetCore !== null ? targetCore : '-'}</Typography>
                 <Divider sx={{ my: 1.5 }} />
                 <Box display="flex" justifyContent="space-between" alignItems="center">
                    <Typography variant="caption" color="text.secondary">防护状态</Typography>
                    <Chip size="small" label={processStatus?.sguard64_restricted ? "ACTIVE" : "READY"} 
                          sx={{ height: 20, fontSize: '0.65rem', fontWeight: 'bold', bgcolor: processStatus?.sguard64_restricted ? '#67c23a' : '#909399', color: '#fff' }} />
                 </Box>
             </Box>
          </Box>

          <Box flex={1} overflow="auto" px={3}>
             <Typography variant="caption" fontWeight="bold" color="text.secondary" mb={1} display="block">进程雷达</Typography>
             {performance.map(p => (
               <Box key={p.pid} mb={1} p={1} borderRadius={1} bgcolor={darkMode ? '#252a34' : '#ffffff'} display="flex" justifyContent="space-between" alignItems="center" border={`1px solid ${darkMode?'#363b40':'#eee'}`}>
                 <Box>
                    <Typography variant="body2" fontSize="0.8rem" fontWeight="bold">{p.name}</Typography>
                    <Typography variant="caption" color="text.secondary">PID: {p.pid}</Typography>
                 </Box>
                 <Chip label={`${p.cpu_usage.toFixed(0)}%`} size="small" sx={{ height: 18, fontSize: '0.7rem', bgcolor: p.cpu_usage > 5 ? '#f56c6c' : '#67c23a', color: '#fff' }} />
               </Box>
             ))}
          </Box>

          {/* 底部终端 - 修复配色：亮色模式下使用浅色背景+深色文字 */}
          <Box p={2} 
               bgcolor="#1e1e2e" 
               color="#fff" 
               height={160} 
               sx={{ fontFamily: 'Consolas, monospace', fontSize: '0.75rem', overflowY: 'auto', borderTop: '1px solid #333' }} 
               ref={logContainerRef}>
              <Box display="flex" alignItems="center" gap={1} mb={1} position="sticky" top={0} bgcolor="#1e1e2e">
                  <TerminalIcon sx={{ fontSize: 12, color: '#409eff' }} /> <span style={{color:'#aaa', fontWeight:'bold'}}>运行日志</span>
              </Box>
              {logs.map(log => (
                  <div key={log.id} style={{ marginBottom: 2, display: 'flex', color: log.message.includes('失败')?'#f56c6c':'#ccc' }}>
                      <span style={{ opacity: 0.5, marginRight: 8, minWidth: 50 }}>{log.timestamp.split(' ')[0]}</span>
                      <span>{log.message}</span>
                  </div>
              ))}
          </Box>

          <Box p={1.5} borderTop={`1px solid ${darkMode?'#2b2b2b':'#e0e0e0'}`} display="flex" justifyContent="space-between" alignItems="center" bgcolor={darkMode ? '#252a34' : '#ffffff'}>
             <Box display="flex" gap={1}>
                <Tooltip title="切换模式" arrow><IconButton size="small" onClick={() => setDarkMode(!darkMode)}>{darkMode ? <LightModeIcon fontSize="small"/> : <DarkModeIcon fontSize="small"/>}</IconButton></Tooltip>
                <Tooltip title="访问 GitHub" arrow><IconButton size="small" onClick={openGitHub}><GitHubIcon fontSize="small"/></IconButton></Tooltip>
             </Box>
             <IconButton size="small" color="error" onClick={() => invoke('exit_app')}><QuitIcon fontSize="small"/></IconButton>
          </Box>
        </Box>

        {/* 右侧内容区 */}
        <Box flex={1} p={3} overflow="auto" display="flex" flexDirection="column" gap={3} bgcolor="background.default">
          
          <Box display="flex" justifyContent="space-between" alignItems="center">
            <Typography variant="h5" fontWeight="bold">控制面板</Typography>
            <Button variant="contained" startIcon={<StartIcon />} onClick={() => executeRestriction(false)} disabled={loading} sx={{ px: 3, py:0.8, borderRadius: 2, background: 'linear-gradient(90deg, #409eff 0%, #3a8ee6 100%)', boxShadow: '0 4px 12px rgba(64,158,255,0.3)' }}>一键优化</Button>
          </Box>

          <Box display="grid" gridTemplateColumns={{ xs: '1fr', lg: '3fr 2fr' }} gap={3}>
            
            <ClashCard title="核心主动限制" icon={<ActiveIcon />} color="blue" action={
              <Tooltip title={CoreRiskTooltip} arrow placement="left">
                <IconButton size="small" sx={{color:'text.secondary'}}><InfoIcon fontSize="small" /></IconButton>
              </Tooltip>
            }>
              <Box display="flex" flexDirection="column" gap={0.2}>
                <SettingRow checked={enableCpuAffinity} onChange={(e:any)=>setEnableCpuAffinity(e.target.checked)} label="CPU 亲和性锁定" desc="推荐 (安全)" />
                <SettingRow checked={enableEfficiencyMode} onChange={(e:any)=>setEnableEfficiencyMode(e.target.checked)} label="Windows 效率模式" desc="推荐 (安全)" />
                <SettingRow checked={enableProcessPriority} onChange={(e:any)=>setEnableProcessPriority(e.target.checked)} label="进程优先级压制" desc="推荐 (防抢占)" />
                <SettingRow checked={enableIoPriority} onChange={(e:any)=>setEnableIoPriority(e.target.checked)} label="I/O 读写降权" desc="可选 (硬盘优化)" />
                <SettingRow checked={enableMemoryPriority} onChange={(e:any)=>setEnableMemoryPriority(e.target.checked)} label="内存驻留降权" desc="可选 (内存释放)" />
              </Box>
              
              <Box mt={2.5} p={2} bgcolor={darkMode ? '#1b1d23' : '#f5f7fa'} borderRadius={2} display="flex" alignItems="center" justifyContent="space-between">
                <Box display="flex" flexDirection="column">
                    <Box display="flex" alignItems="center" gap={1}>
                        <Typography variant="body2" fontWeight="bold">自动化托管</Typography>
                        <Chip size="small" label="SERVICE" sx={{height:16, fontSize:9, fontWeight:'bold', bgcolor:'#409eff', color:'#fff'}} />
                    </Box>
                    <Typography variant="caption" color="text.secondary" sx={{mt:0.5, fontSize:'0.7rem'}}>
                       开机以管理员自启 & 每30秒循环扫描
                    </Typography>
                </Box>
                <Box display="flex" gap={2}>
                   <FormControlLabel control={<ClashSwitch size="small" checked={autoStartEnabled} onChange={toggleAutoStart} />} label={<Typography variant="caption" fontWeight="bold">自启</Typography>} sx={{mr:0}} />
                   <FormControlLabel control={<ClashSwitch size="small" checked={enableAutoLimit} onChange={(e:any)=>setEnableAutoLimit(e.target.checked)} />} label={<Typography variant="caption" fontWeight="bold">循环</Typography>} sx={{mr:0}} />
                </Box>
              </Box>
            </ClashCard>

            <Box display="flex" flexDirection="column" gap={3}>
              <ClashCard title="游戏专项优化" icon={<GameIcon />} color="green" action={
                  <Tooltip title={GameOptTooltip} arrow placement="left">
                    <IconButton size="small" sx={{color:'text.secondary'}}><InfoIcon fontSize="small" /></IconButton>
                  </Tooltip>
              }>
                <Box mb={2} mt={1}>
                  <Box display="flex" justifyContent="space-between" mb={1}><Typography variant="body2" fontWeight="bold">三角洲行动</Typography></Box>
                  <Box display="flex" gap={1}>
                     <Button variant="contained" fullWidth size="small" color="secondary" onClick={() => runRegistryCommand('raise_delta_priority', '三角洲优化')} sx={{fontSize:'0.8rem', py:0.5}}>优化</Button>
                     <Button variant="text" color="inherit" size="small" onClick={() => runRegistryCommand('reset_delta_priority', '恢复')} sx={{fontSize:'0.8rem'}}>撤销</Button>
                  </Box>
                </Box>
                <Divider sx={{ my: 1.5 }} />
                <Box mb={1}>
                  <Box display="flex" justifyContent="space-between" mb={1}><Typography variant="body2" fontWeight="bold">无畏契约</Typography></Box>
                  <Box display="flex" gap={1}>
                     <Button variant="contained" fullWidth size="small" color="secondary" onClick={() => runRegistryCommand('modify_valorant_registry_priority', '无畏契约优化')} sx={{fontSize:'0.8rem', py:0.5}}>优化</Button>
                     <Button variant="text" color="inherit" size="small" onClick={() => runRegistryCommand('reset_valorant_priority', '恢复')} sx={{fontSize:'0.8rem'}}>撤销</Button>
                  </Box>
                </Box>
              </ClashCard>

              <ClashCard title="注册表修改 (慎用)" icon={<WarningIcon />} danger>
                <Typography variant="caption" color="error" mb={2} display="block" fontWeight="bold">⚠️ 警告：修改注册表可能导致反作弊异常或封号。</Typography>
                <Box display="flex" gap={1} mb={2}>
                  <Button variant="contained" fullWidth color="error" onClick={() => runRegistryCommand('lower_ace_priority', 'ACE 降权')} sx={{fontSize:'0.8rem'}}>🔥 永久降权</Button>
                  <Button variant="outlined" color="inherit" onClick={() => runRegistryCommand('reset_ace_priority', '恢复默认')} sx={{fontSize:'0.8rem'}}>恢复</Button>
                </Box>
                <Button fullWidth variant="text" size="small" startIcon={<ShieldIcon />} onClick={() => runRegistryCommand('check_registry_priority', '检查状态')} sx={{ color: 'text.secondary', fontSize:'0.8rem' }}>检查 ACE 状态</Button>
              </ClashCard>
            </Box>
          </Box>
        </Box>
      </Box>
    </ThemeProvider>
  );
}

export default App;