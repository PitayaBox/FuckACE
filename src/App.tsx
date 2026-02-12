import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  Paper, Typography, Button, Box, Chip, Divider, ThemeProvider, createTheme, CssBaseline, Avatar, Switch,
  FormControlLabel, IconButton, GlobalStyles, Dialog, DialogTitle,
  DialogContent, DialogContentText, DialogActions, TextField, Tooltip, styled, SwitchProps, useTheme
} from '@mui/material';
// 引入窗口控制图标 (已移除无用的 Minimize/Maximize/Close)
import {
  PlayArrow as StartIcon, DarkMode as DarkModeIcon, LightMode as LightModeIcon,
  Tune as ActiveIcon, Terminal as TerminalIcon,
  Warning as WarningIcon,
  InfoOutlined as InfoIcon,
  SportsEsports as GameIcon, Shield as ShieldIcon,
  GitHub as GitHubIcon,
  Memory as MemoryIcon, Speed as SpeedIcon,
  Storage as StorageIcon, Bolt as BoltIcon
} from '@mui/icons-material';

// --- 辅助函数 ---
const getSavedState = (key: string, defaultValue: boolean) => {
  const saved = localStorage.getItem(key);
  return saved !== null ? saved === 'true' : defaultValue;
};

// --- 图一风格 Switch ---
const Figure1Switch = styled((props: SwitchProps) => (
  <Switch focusVisibleClassName=".Mui-focusVisible" disableRipple {...props} />
))(({ theme }) => ({
  width: 48, height: 26, padding: 0,
  '& .MuiSwitch-switchBase': {
    padding: 0, margin: 2, transitionDuration: '300ms',
    '&.Mui-checked': {
      transform: 'translateX(22px)', color: '#fff',
      '& + .MuiSwitch-track': { backgroundColor: '#3b82f6', opacity: 1, border: 0 },
    },
    '&.Mui-focusVisible .MuiSwitch-thumb': { color: '#33cf4d', border: '6px solid #fff' },
  },
  '& .MuiSwitch-thumb': { boxSizing: 'border-box', width: 22, height: 22 },
  '& .MuiSwitch-track': {
    borderRadius: 13,
    backgroundColor: theme.palette.mode === 'dark' ? '#4b5563' : '#d1d5db',
    opacity: 1, transition: theme.transitions.create(['background-color'], { duration: 500 }),
  },
}));

interface ProcessStatus { target_core: number; sguard64_restricted: boolean; message: string; }
interface LogEntry { id: number; timestamp: string; message: string; }
interface SystemInfo { cpu_model: string; os_name: string; os_version: string; cpu_logical_cores: number; }
interface ProcessPerformance { pid: number; name: string; cpu_usage: number; memory_mb: number; }

function App() {
  const [targetCore, setTargetCore] = useState<number | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [darkMode, setDarkMode] = useState(true); 
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [performance, setPerformance] = useState<ProcessPerformance[]>([]);
  
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [disclaimerInput, setDisclaimerInput] = useState('');
  const [showExitDialog, setShowExitDialog] = useState(false);

  const [enableCpuAffinity, setEnableCpuAffinity] = useState(() => getSavedState('sw_cpu', true));
  const [enableProcessPriority, setEnableProcessPriority] = useState(() => getSavedState('sw_priority', true));
  const [enableEfficiencyMode, setEnableEfficiencyMode] = useState(() => getSavedState('sw_efficiency', false));
  const [enableIoPriority, setEnableIoPriority] = useState(() => getSavedState('sw_io', false));
  const [enableMemoryPriority, setEnableMemoryPriority] = useState(() => getSavedState('sw_mem', false));
  const [enableAutoLimit, setEnableAutoLimit] = useState(() => getSavedState('sw_auto_loop', false));
  const [autoStartEnabled, setAutoStartEnabled] = useState(false);

  useEffect(() => { localStorage.setItem('sw_cpu', String(enableCpuAffinity)); }, [enableCpuAffinity]);
  useEffect(() => { localStorage.setItem('sw_priority', String(enableProcessPriority)); }, [enableProcessPriority]);
  useEffect(() => { localStorage.setItem('sw_efficiency', String(enableEfficiencyMode)); }, [enableEfficiencyMode]);
  useEffect(() => { localStorage.setItem('sw_io', String(enableIoPriority)); }, [enableIoPriority]);
  useEffect(() => { localStorage.setItem('sw_mem', String(enableMemoryPriority)); }, [enableMemoryPriority]);
  useEffect(() => { localStorage.setItem('sw_auto_loop', String(enableAutoLimit)); }, [enableAutoLimit]);

  const theme = useMemo(() => createTheme({
    palette: {
      mode: darkMode ? 'dark' : 'light',
      primary: { main: '#409eff' },
      secondary: { main: '#67c23a' },
      error: { main: '#f56c6c' },
      background: { default: darkMode ? '#1b1d23' : '#f0f2f5', paper: darkMode ? '#252a34' : '#ffffff' },
      text: { primary: darkMode ? '#ffffff' : '#303133', secondary: darkMode ? '#a1a1aa' : '#606266' }
    },
    shape: { borderRadius: 12 },
    typography: { fontFamily: '"Segoe UI", "Microsoft YaHei", sans-serif', fontSize: 13 },
    components: {
      MuiPaper: { styleOverrides: { root: { backgroundImage: 'none', boxShadow: darkMode ? '0 4px 12px rgba(0,0,0,0.2)' : '0 2px 10px rgba(0,0,0,0.05)', border: darkMode ? '1px solid #363b40' : '1px solid #ebeef5' } } },
      MuiButton: { styleOverrides: { root: { textTransform: 'none', fontWeight: 600, boxShadow: 'none' } } },
      MuiTooltip: { styleOverrides: { tooltip: { backgroundColor: darkMode ? '#303133' : '#fff', color: darkMode ? '#fff' : '#333', border: '1px solid', borderColor: darkMode ? '#444' : '#eee', fontSize: '0.75rem', padding: '8px 12px', maxWidth: 300 }, arrow: { color: darkMode ? '#303133' : '#fff' } } },
      MuiDialog: { styleOverrides: { paper: { backgroundColor: darkMode ? '#252a34' : '#fff' } } },
      MuiIconButton: { styleOverrides: { root: { borderRadius: 4, padding: 6 } } },
      MuiOutlinedInput: { styleOverrides: { root: { '& .MuiOutlinedInput-notchedOutline': { borderColor: darkMode ? 'rgba(255, 255, 255, 0.23)' : 'rgba(0, 0, 0, 0.23)' } } } }
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
    const hasAgreed = localStorage.getItem('pitayabox_disclaimer_agreed_v18'); 
    if (hasAgreed !== 'true') setShowDisclaimer(true);
    const unlistenPromise = listen('tauri://close-requested', () => setShowExitDialog(true));
    addLog('核心服务已就绪');
    invoke<SystemInfo>('get_system_info').then(info => {
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

  const handleDisclaimerAgree = () => {
    if (disclaimerInput === '我已知晓风险并自愿承担后果') {
      localStorage.setItem('pitayabox_disclaimer_agreed_v18', 'true');
      setShowDisclaimer(false);
    }
  };

  // Tooltips
  const CoreRiskTooltipContent = (
    <Box sx={{ p: 0.5 }}>
      <Typography variant="subtitle2" fontWeight="bold" color="secondary.main" gutterBottom>
        详细风险评估与推荐配置
      </Typography>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.75rem', color: 'inherit' }}>
        <li><strong>CPU 亲和性 (强烈推荐)</strong>: <span style={{color:'#67c23a'}}>极低风险</span>。将反作弊绑定到单一核心，防止其频繁抢占游戏资源。</li>
        <li><strong>进程优先级 (推荐)</strong>: <span style={{color:'#67c23a'}}>低风险</span>。将反作弊设为“空闲”级别。</li>
        <li><strong>效率模式 (推荐)</strong>: <span style={{color:'#67c23a'}}>低风险</span>。利用 Win11 原生 API 降低能耗。</li>
        <li><strong>I/O 读写降权 (可选)</strong>: <span style={{color:'#e6a23c'}}>中风险</span>。限制硬盘读写速度。</li>
        <li><strong>内存驻留降权 (可选)</strong>: <span style={{color:'#e6a23c'}}>中风险</span>。强制释放内存。</li>
      </ul>
    </Box>
  );

  const GameOptTooltipContent = (
    <Box sx={{ p: 0.5 }}>
       <Typography variant="subtitle2" fontWeight="bold" color="primary.main" gutterBottom>
        注册表优化原理说明
      </Typography>
      <Typography variant="caption" display="block">
        通过修改 Windows 注册表 IFEO 项，给予游戏更高 CPU 权重。
      </Typography>
      <Typography variant="caption" display="block" sx={{ mt: 1, fontWeight: 'bold' }}>
        安全说明：
      </Typography>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.7rem', color: 'inherit', opacity: 0.9 }}>
        <li>不修改游戏文件。</li>
        <li>利用 Windows 系统原生功能。</li>
        <li>通常安全，极低概率被反作弊误判。</li>
      </ul>
    </Box>
  );

  // ❌ 彻底删除了 CustomTitleBar 组件定义

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

  const CoreCard = ({ children }: any) => {
    const theme = useTheme();
    return (
    <Paper sx={{ 
      p: 0, height: '100%', display: 'flex', flexDirection: 'column', 
      bgcolor: 'background.paper',
      border: 1, borderColor: 'divider',
      position: 'relative', overflow: 'hidden',
      boxShadow: theme.shadows[2]
    }}>
      <Box p={2.5} pb={0} display="flex" justifyContent="space-between" alignItems="center">
        <Box display="flex" alignItems="center" gap={1.2} color="text.primary">
          <ActiveIcon /> <Typography variant="h6" fontWeight="bold" fontSize="0.95rem">核心主动限制</Typography>
        </Box>
        <Tooltip title={CoreRiskTooltipContent} arrow placement="right-start">
            <IconButton size="small" sx={{color:'text.secondary', cursor: 'help'}}>
                <InfoIcon fontSize="small" />
            </IconButton>
        </Tooltip>
      </Box>
      <Box p={2.5} pt={1}>{children}</Box>
    </Paper>
  )};

  const CoreSettingRow = ({ checked, onChange, label, desc, icon }: any) => (
    <Box display="flex" justifyContent="space-between" alignItems="center" py={1.8} borderBottom={1} borderColor="divider">
      <Box display="flex" gap={2} alignItems="center">
         <Box color="primary.main">{icon}</Box>
         <Box>
            <Typography variant="body2" fontWeight="bold" fontSize="0.95rem" color="text.primary">{label}</Typography>
            <Typography variant="caption" color="text.secondary" fontSize="0.75rem">{desc}</Typography>
         </Box>
      </Box>
      <Figure1Switch checked={checked} onChange={onChange} />
    </Box>
  );

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <GlobalStyles styles={{ '*::-webkit-scrollbar': { width: '4px' }, '*::-webkit-scrollbar-thumb': { backgroundColor: darkMode ? '#4c4d4f' : '#ccc', borderRadius: '2px' } }} />

      <Dialog open={showDisclaimer} disableEscapeKeyDown fullWidth maxWidth="sm">
        <DialogTitle sx={{ textAlign: 'center', pt: 3 }}><Typography variant="h5" fontWeight="bold">风险告知</Typography></DialogTitle>
        <DialogContent sx={{ px: 4 }}>
          <Box sx={{ bgcolor: 'background.default', p: 2, borderRadius: 2, mb: 3, border: 1, borderColor: 'divider' }}>
            <DialogContentText sx={{ textAlign: 'justify', fontSize: '0.9rem', lineHeight: 1.6, color: 'text.primary' }}>
              1. <strong>PitayaBox</strong> 仅供技术研究使用，开发者不承担任何责任。<br/>2. 您的操作可能存在风险。<br/>3. 请确认您完全理解。
            </DialogContentText>
          </Box>
          <Box>
             <Typography variant="caption" color="error" sx={{ display: 'block', mb: 1, fontWeight: 'bold', textAlign: 'center', fontSize: '1rem' }}>
                请严格输入：我已知晓风险并自愿承担后果
             </Typography>
             <TextField 
                variant="outlined" placeholder="在此输入上方红色文字..." value={disclaimerInput} onChange={(e) => setDisclaimerInput(e.target.value)} fullWidth size="small"
                sx={{ input: { textAlign: 'center', fontWeight: 'bold' }, bgcolor: 'background.paper' }}
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 3, justifyContent: 'center', gap: 2 }}>
          <Button onClick={() => invoke('exit_app')} color="error">退出</Button>
          <Button onClick={handleDisclaimerAgree} variant="contained" disabled={disclaimerInput !== '我已知晓风险并自愿承担后果'}>进入软件</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={showExitDialog} onClose={() => setShowExitDialog(false)}>
        <DialogTitle sx={{ textAlign: 'center' }}>关闭程序</DialogTitle>
        <DialogContent><DialogContentText sx={{ textAlign: 'center' }}>是否确认退出 PitayaBox？</DialogContentText></DialogContent>
        <DialogActions sx={{ p: 3, justifyContent: 'center', gap: 2 }}>
          <Button variant="contained" onClick={() => setShowExitDialog(false)}>取消</Button>
          <Button color="error" onClick={() => invoke('exit_app')}>彻底退出</Button>
        </DialogActions>
      </Dialog>

      <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', bgcolor: 'background.default', color: 'text.primary' }}>
        
        {/* 已移除 CustomTitleBar */}

        <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            {/* 左侧侧边栏 */}
            <Box sx={{ width: 260, display: 'flex', flexDirection: 'column', bgcolor: 'background.paper', borderRight: 1, borderColor: 'divider' }}>
            
            <Box p={3} pb={2} display="flex" flexDirection="column" justifyContent="center" alignItems="center">
                <Avatar src="/logo.png" variant="rounded" sx={{ width: 64, height: 64, mb: 1.5 }} />
                <Typography variant="h6" fontWeight="bold" sx={{ fontSize: '1rem', letterSpacing: 1, color: 'text.primary' }}>
                    火龙果纸箱
                </Typography>
            </Box>

            <Box px={3} py={2}>
                <Typography variant="caption" fontWeight="bold" color="text.secondary" mb={1} display="block">概览</Typography>
                <Box p={2} borderRadius={2} bgcolor="background.default" mb={2} border={1} borderColor="divider">
                    <Box display="flex" alignItems="center" gap={1} mb={0.5}><MemoryIcon fontSize="small" color="primary"/><Typography variant="caption" color="text.secondary">目标核心</Typography></Box>
                    <Typography variant="h4" fontWeight="bold" color="primary.main">#{targetCore !== null ? targetCore : '-'}</Typography>
                </Box>
            </Box>

            <Box flex={1} overflow="auto" px={3}>
                <Typography variant="caption" fontWeight="bold" color="text.secondary" mb={1} display="block">进程雷达</Typography>
                {performance.map(p => (
                <Box key={p.pid} mb={1} p={1} borderRadius={1} bgcolor="background.default" display="flex" justifyContent="space-between" alignItems="center" border={1} borderColor="divider">
                    <Box><Typography variant="body2" fontSize="0.8rem" fontWeight="bold" color="text.primary">{p.name}</Typography></Box>
                    <Chip label={`${p.cpu_usage.toFixed(0)}%`} size="small" sx={{ height: 18, fontSize: '0.7rem', bgcolor: p.cpu_usage > 5 ? '#f56c6c' : '#67c23a', color: '#fff' }} />
                </Box>
                ))}
            </Box>

            <Box p={2} bgcolor={darkMode ? '#1e1e2e' : '#e0e4e8'} color="text.primary" height={160} sx={{ fontFamily: 'Consolas, monospace', fontSize: '0.75rem', overflowY: 'auto', borderTop: 1, borderColor: 'divider' }} ref={logContainerRef}>
                <Box display="flex" alignItems="center" gap={1} mb={1} position="sticky" top={0} bgcolor={darkMode ? '#1e1e2e' : '#e0e4e8'}>
                    <TerminalIcon sx={{ fontSize: 12, color: 'primary.main' }} /> <span style={{color: darkMode ? '#aaa' : '#666', fontWeight:'bold'}}>运行日志</span>
                </Box>
                {logs.map(log => (<div key={log.id} style={{ marginBottom: 2, display: 'flex', color: log.message.includes('失败')?'#f56c6c': (darkMode ? '#ccc' : '#333') }}><span style={{ opacity: 0.5, marginRight: 8, minWidth: 50 }}>{log.timestamp.split(' ')[0]}</span><span>{log.message}</span></div>))}
            </Box>

            <Box p={1.5} borderTop={1} borderColor="divider" display="flex" justifyContent="flex-start" alignItems="center" bgcolor="background.paper" gap={1}>
                <Tooltip title="切换模式" arrow><IconButton size="small" onClick={() => setDarkMode(!darkMode)} sx={{color:'text.secondary'}}>{darkMode ? <LightModeIcon fontSize="small"/> : <DarkModeIcon fontSize="small"/>}</IconButton></Tooltip>
                <Tooltip title="访问 GitHub" arrow><IconButton size="small" onClick={openGitHub} sx={{color:'text.secondary'}}><GitHubIcon fontSize="small"/></IconButton></Tooltip>
            </Box>
            </Box>

            {/* 右侧内容区 */}
            <Box flex={1} p={3} overflow="auto" display="flex" flexDirection="column" gap={3} bgcolor="background.default">
            <Box display="flex" justifyContent="space-between" alignItems="center">
                <Typography variant="h5" fontWeight="bold" color="text.primary">控制面板</Typography>
                <Box display="flex" flexDirection="column" alignItems="flex-end">
                <Button variant="contained" startIcon={<StartIcon />} onClick={() => executeRestriction(false)} disabled={loading} sx={{ px: 3, py:0.8, borderRadius: 2, background: 'linear-gradient(90deg, #409eff 0%, #3a8ee6 100%)', boxShadow: '0 4px 12px rgba(64,158,255,0.3)' }}>一键优化</Button>
                <Typography variant="caption" color="text.secondary" sx={{mt:0.5, fontSize:'0.75rem', fontWeight:'bold', color: 'error.main'}}>
                    请在进入游戏大厅后点击 (非永久生效)
                </Typography>
                </Box>
            </Box>

            <Box display="grid" gridTemplateColumns={{ xs: '1fr', lg: '3fr 2fr' }} gap={3}>
                <CoreCard>
                    <CoreSettingRow checked={enableCpuAffinity} onChange={(e:any)=>setEnableCpuAffinity(e.target.checked)} label="CPU 亲和性锁定" desc="强制绑定至最后一核" icon={<MemoryIcon/>} />
                    <CoreSettingRow checked={enableProcessPriority} onChange={(e:any)=>setEnableProcessPriority(e.target.checked)} label="进程优先级压制" desc="设为空闲(Idle)级别" icon={<SpeedIcon/>} />
                    <CoreSettingRow checked={enableEfficiencyMode} onChange={(e:any)=>setEnableEfficiencyMode(e.target.checked)} label="Windows 效率模式" desc="系统级能耗限制 (EcoQoS)" icon={<BoltIcon/>} />
                    <CoreSettingRow checked={enableIoPriority} onChange={(e:any)=>setEnableIoPriority(e.target.checked)} label="I/O 读写降权" desc="降低硬盘占用权重" icon={<StorageIcon/>} />
                    <CoreSettingRow checked={enableMemoryPriority} onChange={(e:any)=>setEnableMemoryPriority(e.target.checked)} label="内存驻留降权" desc="降低RAM分配优先级" icon={<MemoryIcon/>} />
                    <Box mt={2.5} p={2} bgcolor={darkMode ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)"} borderRadius={2} display="flex" alignItems="center" justifyContent="space-between">
                        <Box display="flex" flexDirection="column">
                            <Box display="flex" alignItems="center" gap={1}>
                                <Typography variant="body2" fontWeight="bold" color="text.primary">自动化托管</Typography>
                                <Chip size="small" label="SERVICE" sx={{height:16, fontSize:9, fontWeight:'bold', bgcolor:'primary.main', color:'#fff'}} />
                            </Box>
                            <Typography variant="caption" sx={{color:'text.secondary', fontSize:'0.7rem', mt:0.5}}>开机自启 & 循环扫描</Typography>
                        </Box>
                        <Box display="flex" gap={2}>
                            <FormControlLabel control={<Figure1Switch size="small" checked={autoStartEnabled} onChange={toggleAutoStart} />} label={<Typography variant="caption" fontWeight="bold" color="text.primary">自启</Typography>} sx={{mr:0}} />
                            <FormControlLabel control={<Figure1Switch size="small" checked={enableAutoLimit} onChange={(e:any)=>setEnableAutoLimit(e.target.checked)} />} label={<Typography variant="caption" fontWeight="bold" color="text.primary">循环</Typography>} sx={{mr:0}} />
                        </Box>
                    </Box>
                </CoreCard>

                <Box display="flex" flexDirection="column" gap={3}>
                <ClashCard title="游戏专项优化" icon={<GameIcon />} color="green" 
                  action={
                    <Tooltip title={GameOptTooltipContent} arrow placement="left">
                      <IconButton size="small" sx={{color:'text.secondary', cursor: 'help'}}><InfoIcon fontSize="small" /></IconButton>
                    </Tooltip>
                  }>
                    <Box mb={2} mt={1}>
                    <Box display="flex" justifyContent="space-between" mb={1}><Typography variant="body2" fontWeight="bold" color="text.primary">三角洲行动</Typography></Box>
                    <Box display="flex" gap={1}>
                        <Button variant="contained" fullWidth size="small" color="secondary" onClick={() => runRegistryCommand('raise_delta_priority', '三角洲优化')} sx={{fontSize:'0.8rem', py:0.5}}>优化</Button>
                        <Button variant="text" color="inherit" size="small" onClick={() => runRegistryCommand('reset_delta_priority', '恢复')} sx={{fontSize:'0.8rem', color: 'text.secondary'}}>撤销</Button>
                    </Box>
                    </Box>
                    <Divider sx={{ my: 1.5 }} />
                    <Box mb={1}>
                    <Box display="flex" justifyContent="space-between" mb={1}><Typography variant="body2" fontWeight="bold" color="text.primary">无畏契约</Typography></Box>
                    <Box display="flex" gap={1}>
                        <Button variant="contained" fullWidth size="small" color="secondary" onClick={() => runRegistryCommand('modify_valorant_registry_priority', '无畏契约优化')} sx={{fontSize:'0.8rem', py:0.5}}>优化</Button>
                        <Button variant="text" color="inherit" size="small" onClick={() => runRegistryCommand('reset_valorant_priority', '恢复')} sx={{fontSize:'0.8rem', color: 'text.secondary'}}>撤销</Button>
                    </Box>
                    </Box>
                </ClashCard>

                <ClashCard title="注册表修改 (慎用)" icon={<WarningIcon />} danger>
                    <Typography variant="caption" color="error" mb={2} display="block" fontWeight="bold">⚠️ 警告：修改注册表可能导致反作弊异常或封号。</Typography>
                    <Box display="flex" gap={1} mb={2}>
                    <Button variant="contained" fullWidth color="error" onClick={() => runRegistryCommand('lower_ace_priority', 'ACE 降权')} sx={{fontSize:'0.8rem'}}>🔥 永久降权</Button>
                    <Button variant="outlined" color="inherit" onClick={() => runRegistryCommand('reset_ace_priority', '恢复默认')} sx={{fontSize:'0.8rem', color: 'text.primary', borderColor: 'divider'}}>恢复</Button>
                    </Box>
                    <Button fullWidth variant="text" size="small" startIcon={<ShieldIcon />} onClick={() => runRegistryCommand('check_registry_priority', '检查状态')} sx={{ color: 'text.secondary', fontSize:'0.8rem' }}>检查 ACE 状态</Button>
                </ClashCard>
                </Box>
            </Box>
            </Box>
        </Box>
      </Box>
    </ThemeProvider>
  );
}

export default App;