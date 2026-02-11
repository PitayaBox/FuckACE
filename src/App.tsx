import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useInitialData } from './hooks/useOptimizedSupabase';
import { invoke } from '@tauri-apps/api/core';
import {
  Container, Paper, Typography, Button, Box, Chip, LinearProgress, List, ListItem,
  ListItemText, Divider, ThemeProvider, createTheme, CssBaseline, Avatar, Switch,
  FormControlLabel, IconButton, useMediaQuery, GlobalStyles
} from '@mui/material';
import {
  PlayArrow as StartIcon, DarkMode as DarkModeIcon, LightMode as LightModeIcon,
  Speed as SpeedIcon, Memory as MemoryIcon, Computer as ComputerIcon,
  SettingsSuggest as PassiveIcon, Tune as ActiveIcon, Terminal as TerminalIcon,
  CheckCircleOutline, HighlightOff, Storage as StorageIcon, Bolt as BoltIcon
} from '@mui/icons-material';

// --- 类型定义 ---
interface ProcessStatus { target_core: number; sguard64_found: boolean; sguard64_restricted: boolean; sguardsvc64_found: boolean; sguardsvc64_restricted: boolean; message: string; }
interface LogEntry { id: number; timestamp: string; message: string; }
interface SystemInfo { cpu_model: string; cpu_cores: number; cpu_logical_cores: number; os_name: string; os_version: string; is_admin: boolean; total_memory_gb: number; webview2_env: string; }
interface ProcessPerformance { pid: number; name: string; cpu_usage: number; memory_mb: number; }

function App() {
  // --- 状态管理 ---
  const [targetCore, setTargetCore] = useState<number | null>(null);
  const [processStatus, setProcessStatus] = useState<ProcessStatus | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const prefersDarkMode = useMediaQuery('(prefers-color-scheme: dark)');
  const [darkMode, setDarkMode] = useState(prefersDarkMode);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [performance, setPerformance] = useState<ProcessPerformance[]>([]);
  
  // 开关状态
  const [enableCpuAffinity, setEnableCpuAffinity] = useState(true);
  const [enableProcessPriority, setEnableProcessPriority] = useState(true);
  const [enableEfficiencyMode, setEnableEfficiencyMode] = useState(false);
  const [enableIoPriority, setEnableIoPriority] = useState(false);
  const [enableMemoryPriority, setEnableMemoryPriority] = useState(false);
  const [enableAutoLimit, setEnableAutoLimit] = useState(false);
  const [autoStartEnabled, setAutoStartEnabled] = useState(false);

  // --- 主题定制 ---
  const theme = useMemo(() => createTheme({
    palette: {
      mode: darkMode ? 'dark' : 'light',
      primary: { main: '#2979ff' }, 
      secondary: { main: '#00e5ff' },
      background: {
        default: darkMode ? '#0b1120' : '#f0f2f5', 
        paper: darkMode ? '#1e293b' : '#ffffff',
      },
      text: {
        primary: darkMode ? '#f1f5f9' : '#1e293b',
        secondary: darkMode ? '#94a3b8' : '#64748b',
      }
    },
    shape: { borderRadius: 12 },
    typography: { 
      fontFamily: '"Segoe UI", "Roboto", "Helvetica", "Arial", sans-serif',
      button: { fontWeight: 600 }
    },
    components: {
      MuiPaper: { styleOverrides: { root: { backgroundImage: 'none', boxShadow: 'none', border: darkMode ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(0,0,0,0.05)' } } },
      MuiButton: { styleOverrides: { root: { boxShadow: 'none', '&:hover': { boxShadow: 'none' } } } },
      MuiChip: { styleOverrides: { root: { fontWeight: 600 } } },
    }
  }), [darkMode]);

  const addLog = useCallback((message: string) => {
    setLogs(prev => [...prev, { id: Date.now() + Math.random(), timestamp: new Date().toLocaleTimeString(), message }].slice(-100));
  }, []);

  // --- 核心逻辑 ---
  
  // 新增：专门处理注册表按钮反馈的函数
  const runRegistryCommand = async (command: string, desc: string) => {
    addLog(`正在执行: ${desc}...`);
    try {
      const msg = await invoke<string>(command);
      addLog(msg); // 把后端返回的字符串打印出来
    } catch (e) {
      addLog(`❌ 执行失败: ${e}`);
    }
  };

  const executeRestriction = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const result = await invoke<ProcessStatus>('restrict_processes', {
        enableCpuAffinity, enableProcessPriority, enableEfficiencyMode, enableIoPriority, enableMemoryPriority
      });
      setProcessStatus(result);
      setTargetCore(result.target_core);
      if (!silent) addLog(result.message);
    } catch (e) { if (!silent) addLog(`执行失败: ${e}`); }
    if (!silent) setLoading(false);
  }, [addLog, enableCpuAffinity, enableProcessPriority, enableEfficiencyMode, enableIoPriority, enableMemoryPriority]);

  const toggleAutoStart = async () => {
    try {
      if (autoStartEnabled) { await invoke('disable_autostart'); addLog('已取消开机自启动'); } 
      else { await invoke('enable_autostart'); addLog('开机自启动设置成功'); }
      setAutoStartEnabled(!autoStartEnabled);
    } catch (e) { addLog(`自启动设置失败: ${e}`); }
  };

  useEffect(() => {
    addLog('PitayaBox 内核已加载');
    invoke<SystemInfo>('get_system_info').then(info => {
        setSystemInfo(info);
        if (info.cpu_logical_cores > 0) {
            setTargetCore(info.cpu_logical_cores - 1);
        }
        addLog(info.is_admin ? '✅ 已获取管理员权限' : '⚠️ 警告：未以管理员身份运行');
    });
    invoke<boolean>('check_autostart').then(setAutoStartEnabled);
    
    const interval = setInterval(async () => {
      setPerformance(await invoke<ProcessPerformance[]>('get_process_performance'));
      if (enableAutoLimit) executeRestriction(true);
    }, 5000);
    return () => clearInterval(interval);
  }, [addLog, enableAutoLimit, executeRestriction]);

  useEffect(() => { if (logContainerRef.current) logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight; }, [logs]);

  useInitialData(); 

  // --- UI 组件 ---
  const ModernSwitch = ({ checked, onChange, icon, label, desc, color = "primary" }: any) => (
    <Paper elevation={0} sx={{ p: 1.2, mb: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)' }}>
      <Box display="flex" gap={1.5} alignItems="center">
        <Box sx={{ color: `${color}.main`, display: 'flex' }}>{icon}</Box>
        <Box>
          <Typography variant="body2" fontWeight="bold" sx={{ fontSize: '0.85rem' }}>{label}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: '0.65rem' }}>{desc}</Typography>
        </Box>
      </Box>
      <Switch checked={checked} onChange={onChange} color={color} size="small" />
    </Paper>
  );

  const StatusChip = ({ condition, labelTrue, labelFalse }: any) => (
    <Chip 
      icon={condition ? <CheckCircleOutline fontSize="small" /> : <HighlightOff fontSize="small" />}
      label={condition ? labelTrue : labelFalse} 
      color={condition ? 'success' : 'default'} 
      size="medium" 
      variant={condition ? 'filled' : 'outlined'}
      sx={{ px: 1, height: 32, minWidth: 100, justifyContent: 'flex-start' }} 
    />
  );

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <GlobalStyles styles={{
        '*::-webkit-scrollbar': { width: '6px', height: '6px' },
        '*::-webkit-scrollbar-track': { background: 'transparent' },
        '*::-webkit-scrollbar-thumb': { backgroundColor: darkMode ? '#475569' : '#cbd5e1', borderRadius: '3px' },
        '*::-webkit-scrollbar-thumb:hover': { backgroundColor: darkMode ? '#64748b' : '#94a3b8' }
      }} />

      <Container maxWidth={false} sx={{ height: '100vh', display: 'flex', flexDirection: 'column', p: 0, overflow: 'hidden' }}>
        
        {/* 顶部导航栏 */}
        <Box sx={{ px: 3, py: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', bgcolor: 'background.default', borderBottom: 1, borderColor: 'divider' }}>
          <Box display="flex" alignItems="center" gap={1.5}>
            <Avatar src="/logo.png" variant="rounded" sx={{ width: 32, height: 32, bgcolor: 'transparent' }} />
            <Typography variant="h6" fontWeight="800" sx={{ letterSpacing: -0.5 }}>
              Pitaya<Box component="span" color="primary.main">Box</Box>
            </Typography>
          </Box>
          <IconButton onClick={() => setDarkMode(!darkMode)} size="small" sx={{ border: 1, borderColor: 'divider', borderRadius: 2 }}>
            {darkMode ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
          </IconButton>
        </Box>

        {/* 主内容滚动区 */}
        <Box sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
          <Container maxWidth="xl" disableGutters sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            
            {/* 核心横幅 */}
            <Paper sx={{ 
                p: 3, 
                display: 'flex', 
                flexWrap: 'wrap', 
                alignItems: 'center', 
                justifyContent: 'space-between',
                gap: 3,
                background: darkMode ? 'linear-gradient(to right, #1e293b, #0f172a)' : '#fff'
              }}>
              <Box display="flex" gap={4} flexWrap="wrap" sx={{ flex: 1, minWidth: '300px' }}>
                <Box>
                  <Typography variant="caption" color="text.secondary" fontWeight="bold" display="block" mb={0.8}>目标核心</Typography>
                  <Chip 
                    icon={<MemoryIcon sx={{ fontSize: '1rem !important' }} />} 
                    label={targetCore !== null ? `Core ${targetCore} (Ready)` : '检测中...'} 
                    color="primary" 
                    sx={{ py: 2.5, px: 2, fontSize: '0.95rem', borderRadius: 2, minWidth: 140, justifyContent: 'center' }} 
                  />
                </Box>
                <Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', sm: 'block' } }} />
                <Box>
                  <Typography variant="caption" color="text.secondary" fontWeight="bold" display="block" mb={0.8}>防护状态</Typography>
                  <StatusChip condition={processStatus?.sguard64_restricted} labelTrue="ACTIVE / 已生效" labelFalse="STANDBY / 待命" />
                </Box>
              </Box>
              <Button 
                variant="contained" 
                startIcon={<StartIcon />} 
                onClick={() => executeRestriction(false)} 
                disabled={loading}
                sx={{ 
                  whiteSpace: 'nowrap', 
                  px: 5, 
                  py: 1.5, 
                  fontSize: '1rem',
                  background: 'linear-gradient(45deg, #2979ff, #00e5ff)',
                  boxShadow: '0 4px 12px rgba(41, 121, 255, 0.3)',
                  flexGrow: { xs: 1, sm: 0 }
                }}
              >
                一键优化
              </Button>
            </Paper>

            {/* 主内容区域 */}
            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 2 }}>
              
              {/* 左侧：信息面板 */}
              <Box sx={{ width: { xs: '100%', md: '33.3%' }, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Paper sx={{ p: 2 }}>
                  <Box display="flex" alignItems="center" gap={1.5} mb={2}>
                    <Box p={0.8} borderRadius={2} bgcolor={theme.palette.primary.main + '20'} color="primary.main"><ComputerIcon /></Box>
                    <Typography variant="h6" fontWeight="bold">系统摘要</Typography>
                  </Box>
                  {systemInfo ? (
                    <List dense disablePadding>
                      <ListItem sx={{ px:0 }}><ListItemText primary="CPU" secondary={systemInfo.cpu_model.replace('(R)', '').replace('(TM)', '').replace('Core', '')} primaryTypographyProps={{variant:'caption', color:'text.secondary', fontWeight:'bold'}} secondaryTypographyProps={{variant:'body2', color:'text.primary', noWrap: true, title: systemInfo.cpu_model}} /></ListItem>
                      <Divider component="li" sx={{ my:1 }} />
                      <ListItem sx={{ px:0 }}><ListItemText primary="配置" secondary={`${systemInfo.cpu_cores} P-Cores / ${systemInfo.cpu_logical_cores} Threads`} primaryTypographyProps={{variant:'caption', color:'text.secondary', fontWeight:'bold'}} secondaryTypographyProps={{variant:'body2', color:'text.primary'}} /></ListItem>
                      <Divider component="li" sx={{ my:1 }} />
                      <ListItem sx={{ px:0 }}><ListItemText primary="环境" secondary={`${systemInfo.os_name} ${systemInfo.os_version}`} primaryTypographyProps={{variant:'caption', color:'text.secondary', fontWeight:'bold'}} secondaryTypographyProps={{variant:'body2', color:'text.primary'}} /></ListItem>
                    </List>
                  ) : <LinearProgress />}
                </Paper>

                <Paper sx={{ p: 2, flex: 1, minHeight: 200, display: 'flex', flexDirection: 'column' }}>
                  <Box display="flex" alignItems="center" gap={1.5} mb={2}>
                    <Box p={0.8} borderRadius={2} bgcolor={theme.palette.secondary.main + '20'} color="secondary.main"><SpeedIcon /></Box>
                    <Typography variant="h6" fontWeight="bold">进程雷达</Typography>
                  </Box>
                  <Box sx={{ flex: 1, overflowY: 'auto', pr: 0.5 }}>
                    {performance.length > 0 ? performance.map(p => (
                      <Box key={p.pid} mb={1.5} p={1} borderRadius={2} bgcolor={darkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)'}>
                        <Box display="flex" justifyContent="space-between" mb={0.5}>
                          <Typography variant="caption" fontWeight="bold">{p.name}</Typography>
                          <Typography variant="caption" fontWeight="bold" color={p.cpu_usage > 5 ? 'error.main' : 'success.main'}>{p.cpu_usage.toFixed(1)}%</Typography>
                        </Box>
                        <LinearProgress variant="determinate" value={Math.min(p.cpu_usage, 100)} color={p.cpu_usage > 5 ? 'error' : 'success'} sx={{ height: 4, borderRadius: 2 }} />
                      </Box>
                    )) : (
                      <Box display="flex" flexDirection="column" alignItems="center" justifyContent="center" height="100%" color="text.secondary" gap={1} sx={{ opacity: 0.5 }}>
                        <CheckCircleOutline />
                        <Typography variant="caption">无活跃目标</Typography>
                      </Box>
                    )}
                  </Box>
                </Paper>
              </Box>

              {/* 右侧：控制面板 */}
              <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Paper sx={{ p: 2 }}>
                  <Box display="flex" alignItems="center" gap={1} mb={1.5} color="text.secondary">
                    <PassiveIcon fontSize="small" />
                    <Typography variant="subtitle2" fontWeight="bold">注册表优化 (只需一次)</Typography>
                  </Box>
                  {/* 使用 runRegistryCommand 包装函数 */}
                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' }, gap: 1 }}>
                    <Button variant="contained" color="error" fullWidth onClick={() => runRegistryCommand('lower_ace_priority', 'ACE 降权')} size="small">🔥 降低 ACE 优先级</Button>
                    <Button variant="contained" fullWidth onClick={() => runRegistryCommand('raise_delta_priority', '三角洲优化')} size="small" sx={{ bgcolor: 'rgba(76, 175, 80, 0.1)', color: 'success.main', '&:hover': { bgcolor: 'rgba(76, 175, 80, 0.2)' }, boxShadow: 'none' }}>三角洲优化</Button>
                    <Button variant="contained" fullWidth onClick={() => runRegistryCommand('modify_valorant_registry_priority', '瓦罗兰特优化')} size="small" sx={{ bgcolor: 'rgba(76, 175, 80, 0.1)', color: 'success.main', '&:hover': { bgcolor: 'rgba(76, 175, 80, 0.2)' }, boxShadow: 'none' }}>瓦罗兰特优化</Button>
                  </Box>
                  <Button variant="outlined" fullWidth onClick={() => runRegistryCommand('check_registry_priority', '状态检查')} size="small" sx={{ mt: 1, borderStyle: 'dashed' }}>检查注册表状态</Button>
                </Paper>

                <Paper sx={{ p: 2, flex: 1 }}>
                  <Box display="flex" alignItems="center" gap={1} mb={1.5} color="text.secondary">
                    <ActiveIcon fontSize="small" />
                    <Typography variant="subtitle2" fontWeight="bold">核心主动限制</Typography>
                  </Box>
                  
                  <ModernSwitch checked={enableCpuAffinity} onChange={(e:any)=>setEnableCpuAffinity(e.target.checked)} icon={<MemoryIcon fontSize="small"/>} label="CPU 亲和性锁定" desc="强制绑定至最后一核" />
                  <ModernSwitch checked={enableProcessPriority} onChange={(e:any)=>setEnableProcessPriority(e.target.checked)} icon={<SpeedIcon fontSize="small"/>} label="进程优先级压制" desc="设为空闲(Idle)级别" />
                  <ModernSwitch checked={enableEfficiencyMode} onChange={(e:any)=>setEnableEfficiencyMode(e.target.checked)} icon={<BoltIcon fontSize="small" color="warning"/>} label="Windows 效率模式" desc="系统级能耗限制 (EcoQoS)" />
                  
                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 1.5, my: 1 }}>
                    <ModernSwitch checked={enableIoPriority} onChange={(e:any)=>setEnableIoPriority(e.target.checked)} icon={<StorageIcon fontSize="small"/>} label="I/O 读写降权" desc="降低硬盘占用权重" />
                    <ModernSwitch checked={enableMemoryPriority} onChange={(e:any)=>setEnableMemoryPriority(e.target.checked)} icon={<MemoryIcon fontSize="small"/>} label="内存驻留降权" desc="降低RAM分配优先级" />
                  </Box>

                  <Box sx={{ mt: 2, p: 1.5, borderRadius: 2, bgcolor: theme.palette.mode === 'dark' ? 'rgba(41, 121, 255, 0.08)' : '#e3f2fd', border: '1px dashed', borderColor: 'primary.main', display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 2, alignItems: 'center' }}>
                     <FormControlLabel control={<Switch checked={autoStartEnabled} onChange={toggleAutoStart} size="small" />} label={<Typography variant="caption" fontWeight="bold">🚀 开机自启</Typography>} sx={{ m: 0 }} />
                     <Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', sm: 'block' } }} />
                     <FormControlLabel control={<Switch checked={enableAutoLimit} onChange={(e)=>setEnableAutoLimit(e.target.checked)} size="small" color="secondary" />} label={<Typography variant="caption" fontWeight="bold" color="secondary.main">⚡ 自动循环限制</Typography>} sx={{ m: 0 }} />
                  </Box>
                </Paper>
              </Box>
            </Box>
          </Container>
        </Box>

        {/* 底部固定日志 */}
        <Box sx={{ p: 1, borderTop: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
          <Box display="flex" alignItems="center" gap={1} mb={0.5} px={1}>
            <TerminalIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
            <Typography variant="caption" fontFamily="monospace" color="text.secondary">TERMINAL</Typography>
          </Box>
          <Paper elevation={0} sx={{ 
              p: 1, 
              bgcolor: darkMode ? '#000' : '#f5f5f5', 
              height: 100, 
              overflow: 'hidden', 
              borderRadius: 1,
              fontFamily: 'monospace'
            }}>
            <Box ref={logContainerRef} sx={{ height: '100%', overflowY: 'auto' }}>
              {logs.map(log => (
                <Typography key={log.id} variant="caption" sx={{ display: 'block', color: log.message.includes('失败') || log.message.includes('警告') ? '#ef5350' : (darkMode ? '#66bb6a' : '#2e7d32'), fontSize: '0.7rem', lineHeight: 1.4 }}>
                  <span style={{color: theme.palette.text.disabled, marginRight: 8}}>[{log.timestamp}]</span>{log.message}
                </Typography>
              ))}
            </Box>
          </Paper>
        </Box>

      </Container>
    </ThemeProvider>
  );
}

export default App;