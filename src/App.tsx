import { useState, useEffect, useCallback, useRef } from 'react';
import { useInitialData } from './hooks/useOptimizedSupabase';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';
import { Window } from '@tauri-apps/api/window';
import {
  Container,
  Paper,
  Typography,
  Button,
  Box,
  Chip,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  Divider,
  ThemeProvider,
  createTheme,
  CssBaseline,
  Avatar,
  Switch,
  FormControlLabel,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Badge
} from '@mui/material';
import {
  PlayArrow as StartIcon,
  CheckCircle,
  DarkMode as DarkModeIcon,
  LightMode as LightModeIcon,
  SportsEsports as GameIcon,
  Extension as ModIcon,
  GitHub as GitHubIcon,
  Notifications as NotificationsIcon,
  SystemUpdate as UpdateIcon,
  Close as CloseIcon,
  Warning as WarningIcon
} from '@mui/icons-material';

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#90caf9',
    },
    secondary: {
      main: '#f48fb1',
    },
    success: {
      main: '#81c784',
    },
    warning: {
      main: '#ffb74d',
    },
    error: {
      main: '#f44336',
    },
    background: {
      default: '#121212',
      paper: '#1e1e1e',
    },
    text: {
      primary: '#ffffff',
      secondary: 'rgba(255, 255, 255, 0.7)',
    },
  },
  typography: {
    h3: {
      fontWeight: 600,
    },
    h6: {
      fontWeight: 500,
    },
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 500,
        },
      },
    },
  },
});

interface ProcessStatus {
  target_core: number;
  sguard64_found: boolean;
  sguard64_restricted: boolean;
  sguardsvc64_found: boolean;
  sguardsvc64_restricted: boolean;
  weixin_found: boolean;
  weixin_restricted: boolean;
  message: string;
}

interface LogEntry {
  id: number;
  timestamp: string;
  message: string;
}

interface SystemInfo {
  cpu_model: string;
  cpu_cores: number;
  cpu_logical_cores: number;
  os_name: string;
  os_version: string;
  is_admin: boolean;
  total_memory_gb: number;
  webview2_env: string;
}

interface ProcessPerformance {
  pid: number;
  name: string;
  cpu_usage: number;
  memory_mb: number;
}

function App() {
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [targetCore, setTargetCore] = useState<number | null>(null);
  const [processStatus, setProcessStatus] = useState<ProcessStatus | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [darkMode, setDarkMode] = useState(true);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [performance, setPerformance] = useState<ProcessPerformance[]>([]);
  const [enableBasicCpuLimit, setEnableBasicCpuLimit] = useState(true);
  const [enableEfficiencyMode, setEnableEfficiencyMode] = useState(false);
  const [enableIoPriority, setEnableIoPriority] = useState(false);
  const [enableMemoryPriority, setEnableMemoryPriority] = useState(false);
  const [autoStartEnabled, setAutoStartEnabled] = useState(false);
  const [showAnnouncements, setShowAnnouncements] = useState(false);
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [gameProcesses] = useState<string[]>([]);


  const { announcements, latestVersion, hasUpdate } = useInitialData('0.5.0');

  const addLog = useCallback((message: string) => {
    const newLog: LogEntry = {
      id: Date.now() + Math.random(),
      timestamp: new Date().toLocaleTimeString(),
      message,
    };
    setLogs(prev => [...prev, newLog]);
  }, []);

  const executeProcessRestriction = useCallback(async () => {
    try {
      addLog('进程限制开始b（￣▽￣）d　');
      setLoading(true);

      const result = await invoke<ProcessStatus>('restrict_processes', {
        enableBasicCpuLimit,
        enableEfficiencyMode,
        enableIoPriority,
        enableMemoryPriority
      });
      setProcessStatus(result);
      setTargetCore(result.target_core);

      addLog(result.message);
    } catch (error) {
      addLog(`执行失败: ${error}`);
      console.error('执行进程限制失败/(ㄒoㄒ)/~~', error);
    } finally {
      setLoading(false);
    }
  }, [addLog, enableBasicCpuLimit, enableEfficiencyMode, enableIoPriority, enableMemoryPriority]);

  const executeOnce = useCallback(async () => {
    try {
      setIsMonitoring(true);
      const modeStr = [
        enableBasicCpuLimit && '基础CPU限制',
        enableEfficiencyMode && '效率模式',
        enableIoPriority && 'I/O优先级',
        enableMemoryPriority && '内存优先级'
      ].filter(Boolean).join('+') || '标准模式';
      addLog(`执行进程限制 (${modeStr})`);
      await executeProcessRestriction();
      setIsMonitoring(false);
    } catch (error) {
      addLog(`执行失败: ${error}`);
      setIsMonitoring(false);
    }
  }, [addLog, executeProcessRestriction, enableBasicCpuLimit, enableEfficiencyMode, enableIoPriority, enableMemoryPriority]);

  const fetchSystemInfo = useCallback(async () => {
    try {
      const info = await invoke<SystemInfo>('get_system_info');
      setSystemInfo(info);
      const lastCore = info.cpu_logical_cores - 1;
      setTargetCore(lastCore);
      addLog(`系统信息已加载: ${info.os_name} ${info.os_version}`);
      addLog(`CPU: ${info.cpu_model}`);
      addLog(`核心: ${info.cpu_cores}物理/${info.cpu_logical_cores}逻辑`);
      addLog(`内存: ${info.total_memory_gb.toFixed(2)} GB`);
      addLog(`WebView2环境: ${info.webview2_env}`);

      if (!info.is_admin) {
        addLog('小春未以管理员权限运行，部分功能可能受限');
      } else {
        addLog('小春已获取管理员权限，正在降低ACE占用');
      }
    } catch (error) {
      addLog(`获取系统信息失败: ${error}`);
    }
  }, [addLog]);

  const fetchPerformance = useCallback(async () => {
    try {
      const perf = await invoke<ProcessPerformance[]>('get_process_performance');
      setPerformance(perf);
    } catch (error) {
      console.error('获取性能数据失败:', error);
    }
  }, []);

  const checkAutoStart = useCallback(async () => {
    try {
      const enabled = await invoke<boolean>('check_autostart');
      setAutoStartEnabled(enabled);
    } catch (error) {
      console.error('检查自启动状态失败:', error);
    }
  }, []);

  const toggleAutoStartup = useCallback(async () => {
    try {
      if (autoStartEnabled) {
        await invoke<string>('disable_autostart');
        setAutoStartEnabled(false);
        addLog('已禁用开机自启动');
      } else {
        await invoke<string>('enable_autostart');
        setAutoStartEnabled(true);
        addLog('已启用开机自启动');
      }
    } catch (error) {
      addLog(`切换自启动失败: ${error}`);
      console.error('切换自启动失败:', error);
    }
  }, [autoStartEnabled, addLog]);



  const modifyRegistryPriority = useCallback(async () => {
    try {
      setLoading(true);
      addLog('开始修改注册表优先级...');
      const result = await invoke<string>('modify_registry_priority');
      addLog('注册表修改完成:');
      result.split('\n').forEach(line => addLog(line));
    } catch (error) {
      addLog(`修改注册表失败: ${error}`);
      console.error('修改注册表失败:', error);
    } finally {
      setLoading(false);
    }
  }, [addLog]);

  const modifyValorantRegistryPriority = useCallback(async () => {
    try {
      setLoading(true);
      addLog('开始修改瓦罗兰特注册表优先级...');
      const result = await invoke<string>('modify_valorant_registry_priority');
      addLog('瓦罗兰特注册表修改完成:');
      result.split('\n').forEach(line => addLog(line));
    } catch (error) {
      addLog(`修改瓦罗兰特注册表失败: ${error}`);
      console.error('修改瓦罗兰特注册表失败:', error);
    } finally {
      setLoading(false);
    }
  }, [addLog]);

  const checkRegistryPriority = useCallback(async () => {
    try {
      setLoading(true);
      addLog('正在检查注册表状态...');
      const result = await invoke<string>('check_registry_priority');
      addLog('注册表状态:');
      result.split('\n').forEach(line => addLog(line));
    } catch (error) {
      addLog(`检查注册表失败: ${error}`);
      console.error('检查注册表失败:', error);
    } finally {
      setLoading(false);
    }
  }, [addLog]);

  const resetRegistryPriority = useCallback(async () => {
    try {
      setLoading(true);
      addLog('开始恢复注册表默认设置...');
      const result = await invoke<string>('reset_registry_priority');
      addLog('注册表恢复完成:');
      result.split('\n').forEach(line => addLog(line));
    } catch (error) {
      addLog(`恢复注册表失败: ${error}`);
      console.error('恢复注册表失败:', error);
    } finally {
      setLoading(false);
    }
  }, [addLog]);

  useEffect(() => {
    addLog('FuckACE已启动，开始法克ACE');
    fetchSystemInfo();
    checkAutoStart();

    const perfInterval = setInterval(fetchPerformance, 5000);

    return () => {
      clearInterval(perfInterval);
    };
  }, [addLog, fetchSystemInfo, fetchPerformance, checkAutoStart]);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  useEffect(() => {
    const unlisten = Window.getCurrent().listen('show-close-confirm', () => {
      setShowCloseConfirm(true);
    });

    return () => {
      unlisten.then((fn: () => void) => fn());
    };
  }, []);

  useEffect(() => {
    if (hasUpdate) {
      setShowUpdateDialog(true);
    }
  }, [hasUpdate]);

  const getProcessStatusColor = (found: boolean, restricted: boolean) => {
    if (!found) return 'default';
    return restricted ? 'warning' : 'success';
  };

  const getProcessStatusText = (found: boolean, restricted: boolean) => {
    if (!found) return '未找到';
    return restricted ? '已限制' : '运行中';
  };

  const toggleDarkMode = () => {
    setDarkMode(!darkMode);
  };

  const openExternalLink = async (url: string) => {
    try {
      await open(url);
    } catch (error) {
      console.error('打开链接失败:', error);
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <ThemeProvider theme={darkMode ? darkTheme : createTheme()}>
      <CssBaseline />
      <Container maxWidth="lg" sx={{ py: 1, height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <Paper elevation={3} sx={{ p: 1.5, mb: 1 }}>
          <Box display="flex" justifyContent="space-between" alignItems="center">
            <Box display="flex" alignItems="center" gap={2}>
              <Avatar
                src="/logo.png"
                sx={{ width: 36, height: 36 }}
                variant="rounded"
              />
              <Box>
                <Typography variant="h5" component="h1" color="primary" sx={{ lineHeight: 1.2 }}>
                  FuckACE v0.5.0
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  小春正在持续监控并限制ACE占用
                </Typography>
              </Box>
            </Box>
            <Box display="flex" gap={0.5} alignItems="center" flexWrap="wrap">
              <Badge badgeContent={announcements.length > 0 ? announcements.length : 0} color="info">
                <Button
                  variant="outlined"
                  startIcon={<NotificationsIcon />}
                  onClick={() => setShowAnnouncements(true)}
                  sx={{ minWidth: 'auto', px: 0.8 }}
                  size="small"
                >
                  公告
                </Button>
              </Badge>
              <Badge badgeContent={hasUpdate ? 1 : 0} color="error">
                <Button
                  variant="outlined"
                  startIcon={<UpdateIcon />}
                  onClick={() => setShowUpdateDialog(true)}
                  sx={{ minWidth: 'auto', px: 0.8 }}
                  size="small"
                  color={hasUpdate ? "error" : "success"}
                >
                  更新
                </Button>
              </Badge>
              <Button
                variant="outlined"
                startIcon={<GameIcon />}
                onClick={async () => await openExternalLink('https://www.mikugame.icu/')}
                sx={{ minWidth: 'auto', px: 0.8 }}
                size="small"
                title="MikuGame - 初音游戏库"
              >
                游戏资源
              </Button>
              <Button
                variant="outlined"
                startIcon={<ModIcon />}
                onClick={async () => await openExternalLink('https://www.mikumod.com/')}
                sx={{ minWidth: 'auto', px: 0.8 }}
                size="small"
                title="MikuMod - 游戏模组社区"
              >
                模组社区
              </Button>
              <Button
                variant="outlined"
                startIcon={<GitHubIcon />}
                onClick={async () => await openExternalLink('https://afdian.com/a/shshouse')}
                sx={{ minWidth: 'auto', px: 0.8 }}
                size="small"
                title="作者: shshouse"
              >
                投喂作者
              </Button>
              <Button
                variant="outlined"
                startIcon={darkMode ? <LightModeIcon /> : <DarkModeIcon />}
                onClick={toggleDarkMode}
                sx={{ minWidth: 'auto', px: 0.8 }}
                size="small"
              >
                {darkMode ? '浅色' : '暗色'}
              </Button>
            </Box>
          </Box>
        </Paper>

        <Box display="flex" flexDirection="column" gap={1} sx={{ flex: 1, overflow: 'hidden' }}>
          <Box display="flex" gap={1}>
            <Paper elevation={2} sx={{ p: 1.5, flex: 1, minWidth: 0, maxWidth: '100%', display: 'flex', flexDirection: 'column' }}
            >
              <Typography variant="subtitle1" gutterBottom sx={{ mb: 1, fontWeight: 600 }}>监控状态</Typography>
              <Box display="flex" flexDirection="column" gap={0.8} sx={{ maxHeight: 150, overflow: 'hidden' }}>


          <Box display="flex" justifyContent="space-between" alignItems="center">
            <Typography variant="body2">目标核心:</Typography>
            <Chip
              label={targetCore !== null ? `核心 ${targetCore}` : '检测中...'}
              color="info"
              variant="outlined"
              size="small"
            />
          </Box>

          <Box display="flex" justifyContent="space-between" alignItems="center">
            <Typography variant="body2">游戏进程:</Typography>
            <Chip
              label={gameProcesses.length > 0 ? gameProcesses.join(', ') : '未检测到'}
              color={gameProcesses.length > 0 ? 'success' : 'default'}
              size="small"
            />
          </Box>

          {loading && <LinearProgress sx={{ mt: 1 }} />}
        </Box>
            </Paper>

            <Paper elevation={2} sx={{ p: 1.5, flex: 1, minWidth: 0, maxWidth: '100%' }}>
              <Typography variant="subtitle1" gutterBottom sx={{ mb: 1, fontWeight: 600 }}>进程状态</Typography>
              <List dense sx={{ maxHeight: 150, overflowY: 'auto' }}>
                <ListItem secondaryAction={
                  <Chip
                    label={getProcessStatusText(processStatus?.sguard64_found || false, processStatus?.sguard64_restricted || false)}
                    color={getProcessStatusColor(processStatus?.sguard64_found || false, processStatus?.sguard64_restricted || false)}
                    size="small"
                  />
                }
                  sx={{ py: 0.3 }}
                >
                  <ListItemText primary="SGuard64.exe" primaryTypographyProps={{ variant: 'body2', fontSize: '0.85rem' }} />
                </ListItem>
                <Divider />
                <ListItem secondaryAction={
                  <Chip
                    label={getProcessStatusText(processStatus?.sguardsvc64_found || false, processStatus?.sguardsvc64_restricted || false)}
                    color={getProcessStatusColor(processStatus?.sguardsvc64_found || false, processStatus?.sguardsvc64_restricted || false)}
                    size="small"
                  />
                }
                  sx={{ py: 0.3 }}
                >
                  <ListItemText primary="SGuardSvc64.exe" primaryTypographyProps={{ variant: 'body2', fontSize: '0.85rem' }} />
                </ListItem>
                <Divider />
                <ListItem secondaryAction={
                  <Chip
                    label={getProcessStatusText(processStatus?.weixin_found || false, processStatus?.weixin_restricted || false)}
                    color={getProcessStatusColor(processStatus?.weixin_found || false, processStatus?.weixin_restricted || false)}
                    size="small"
                  />
                }
                  sx={{ py: 0.3 }}
                >
                  <ListItemText primary="Weixin.exe" primaryTypographyProps={{ variant: 'body2', fontSize: '0.85rem' }} />
                </ListItem>
              </List>
            </Paper>

            <Paper elevation={2} sx={{ p: 1.5, flex: 1, minWidth: 0, maxWidth: '100%' }}>
              <Typography variant="subtitle1" gutterBottom sx={{ mb: 1, fontWeight: 600 }}>系统信息</Typography>
              {systemInfo ? (
                <Box display="flex" flexDirection="column" gap={0.5} sx={{ maxHeight: 150, overflow: 'hidden' }}>
                  <Box display="flex" justifyContent="space-between" alignItems="center">
                    <Typography variant="caption" color="text.secondary">CPU:</Typography>
                    <Typography variant="caption" noWrap sx={{ maxWidth: '65%' }} title={systemInfo.cpu_model}>
                      {systemInfo.cpu_model.split(' ').slice(-2).join(' ')}
                    </Typography>
                  </Box>
                  <Box display="flex" justifyContent="space-between" alignItems="center">
                    <Typography variant="caption" color="text.secondary">核心:</Typography>
                    <Typography variant="caption">{systemInfo.cpu_cores}P / {systemInfo.cpu_logical_cores}L</Typography>
                  </Box>
                  <Box display="flex" justifyContent="space-between" alignItems="center">
                    <Typography variant="caption" color="text.secondary">系统:</Typography>
                    <Typography variant="caption">{systemInfo.os_name} {systemInfo.os_version.split('.')[0]}</Typography>
                  </Box>
                  <Box display="flex" justifyContent="space-between" alignItems="center">
                    <Typography variant="caption" color="text.secondary">内存:</Typography>
                    <Typography variant="caption">{systemInfo.total_memory_gb.toFixed(1)} GB</Typography>
                  </Box>
                  <Box display="flex" justifyContent="space-between" alignItems="center">
                    <Typography variant="caption" color="text.secondary">权限:</Typography>
                    <Box display="flex" alignItems="center" gap={0.5}>
                      <Typography variant="caption">{systemInfo.is_admin ? '管理员' : '普通用户'}</Typography>
                      {systemInfo.is_admin && <CheckCircle color="success" sx={{ fontSize: 14 }} />}
                    </Box>
                  </Box>
                </Box>
              ) : (
                <Typography variant="body2" color="text.secondary">加载中...</Typography>
              )}
            </Paper>
          </Box>

          <Box display="flex" gap={1}>
            <Paper elevation={2} sx={{ p: 1.5, flex: 1, minWidth: 0, maxWidth: '100%' }}>
              <Typography variant="subtitle1" gutterBottom sx={{ mb: 1, fontWeight: 600 }}>性能监控</Typography>
              {performance.length > 0 ? (
                <List dense sx={{ maxHeight: 180, overflowY: 'auto' }}>
                  {performance.map((proc) => (
                    <Box key={proc.pid}>
                      <ListItem sx={{ py: 1 }}>
                        <ListItemText
                          primary={
                            <Box display="flex" justifyContent="space-between" alignItems="center">
                              <Typography variant="body2" fontWeight="500">
                                {proc.name} (PID: {proc.pid})
                              </Typography>
                              <Chip
                                label={`CPU: ${proc.cpu_usage.toFixed(1)}%`}
                                size="small"
                                color={proc.cpu_usage > 10 ? 'error' : proc.cpu_usage > 5 ? 'warning' : 'success'}
                              />
                            </Box>
                          }
                          secondary={
                            <Box mt={0.5}>
                              <Typography variant="caption" display="block">
                                内存: {proc.memory_mb.toFixed(2)} MB
                              </Typography>
                              <LinearProgress
                                variant="determinate"
                                value={Math.min(proc.cpu_usage, 100)}
                                sx={{ mt: 0.5, height: 6, borderRadius: 1 }}
                                color={proc.cpu_usage > 10 ? 'error' : proc.cpu_usage > 5 ? 'warning' : 'success'}
                              />
                            </Box>
                          }
                        />
                      </ListItem>
                      <Divider />
                    </Box>
                  ))}
                </List>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  未检测到目标进程
                </Typography>
              )}
            </Paper>

            <Paper elevation={2} sx={{ p: 1.5, flex: 1, minWidth: 0, maxWidth: '100%', display: 'flex', flexDirection: 'column' }}
            >
              <Typography variant="subtitle1" gutterBottom sx={{ mb: 1, fontWeight: 600 }}>被动限制(不直接干涉ACE,较安全)</Typography>
              <Box display="flex" flexDirection="column" gap={0.6} sx={{ flex: 1, justifyContent: 'flex-end' }}>
                <Button
                  variant="contained"
                  onClick={modifyRegistryPriority}
                  disabled={loading || !systemInfo?.is_admin}
                  color="error"
                  size="small"
                  fullWidth
                >
                  一键优化三角洲注册表(需管理员)
                </Button>
                <Button
                  variant="contained"
                  onClick={modifyValorantRegistryPriority}
                  disabled={loading || !systemInfo?.is_admin}
                  color="secondary"
                  size="small"
                  fullWidth
                >
                  一键优化瓦罗兰特注册表(需管理员)
                </Button>
                <Box display="flex" gap={0.6}>
                  <Button
                    variant="outlined"
                    onClick={checkRegistryPriority}
                    disabled={loading}
                    color="info"
                    size="small"
                    fullWidth
                  >
                    检查状态
                  </Button>
                  <Button
                    variant="outlined"
                    onClick={resetRegistryPriority}
                    disabled={loading || !systemInfo?.is_admin}
                    color="warning"
                    size="small"
                    fullWidth
                  >
                    恢复默认
                  </Button>
                </Box>
              </Box>
            </Paper>

            <Paper elevation={2} sx={{ p: 1.5, flex: 1, minWidth: 0, maxWidth: '100%', display: 'flex', flexDirection: 'column' }}
            >
              <Typography variant="subtitle1" gutterBottom sx={{ mb: 1, fontWeight: 600 }}>主动限制(小白不建议使用)</Typography>
              <Box display="grid" gridTemplateColumns="1fr 1fr 1fr" gap={0.8} sx={{ mb: 1 }}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={enableBasicCpuLimit}
                      onChange={(e) => setEnableBasicCpuLimit(e.target.checked)}
                      disabled={isMonitoring}
                      color="success"
                      size="small"
                    />
                  }
                  label={
                    <Typography variant="caption">基础CPU限制</Typography>
                  }
                  sx={{ m: 0 }}
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={enableEfficiencyMode}
                      onChange={(e) => setEnableEfficiencyMode(e.target.checked)}
                      disabled={isMonitoring}
                      color="warning"
                      size="small"
                    />
                  }
                  label={
                    <Typography variant="caption">效率模式</Typography>
                  }
                  sx={{ m: 0 }}
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={enableIoPriority}
                      onChange={(e) => setEnableIoPriority(e.target.checked)}
                      disabled={isMonitoring}
                      color="error"
                      size="small"
                    />
                  }
                  label={
                    <Typography variant="caption">I/O优先级</Typography>
                  }
                  sx={{ m: 0 }}
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={enableMemoryPriority}
                      onChange={(e) => setEnableMemoryPriority(e.target.checked)}
                      disabled={isMonitoring}
                      color="error"
                      size="small"
                    />
                  }
                  label={
                    <Typography variant="caption">内存优先级</Typography>
                  }
                  sx={{ m: 0 }}
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={autoStartEnabled}
                      onChange={toggleAutoStartup}
                      color="primary"
                      size="small"
                    />
                  }
                  label={
                    <Typography variant="caption">开机自启动</Typography>
                  }
                  sx={{ m: 0 }}
                />
              </Box>
              <Box display="flex" flexDirection="column" gap={0.6} sx={{ flex: 1, justifyContent: 'flex-end' }}>
                <Button
                  variant="contained"
                  startIcon={<StartIcon />}
                  onClick={executeOnce}
                  disabled={loading || isMonitoring}
                  color="primary"
                  size="small"
                  fullWidth
                >
                  执行限制
                </Button>
              </Box>
            </Paper>
          </Box>

          <Paper elevation={2} sx={{ p: 1.5, flex: '0 0 auto', maxWidth: '100%' }}>
            <Box
              ref={logContainerRef}
              sx={{
                height: 80,
                maxHeight: 80,
                overflowY: 'auto',
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                p: 0.75,
                backgroundColor: 'background.default',
              }}
            >
              {logs.map((log) => (
                <Typography
                  key={log.id}
                  variant="body2"
                  sx={{
                    fontFamily: 'monospace',
                    fontSize: '0.7rem',
                    py: 0.15,
                    lineHeight: 1.4,
                  }}
                >
                  [{log.timestamp}] {log.message}
                </Typography>
              ))}
            </Box>
          </Paper>
        </Box>

        {/* 公告对话框 */}
        <Dialog
          open={showAnnouncements}
          onClose={() => setShowAnnouncements(false)}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>
            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Typography variant="h6">公告</Typography>
              <Button onClick={() => setShowAnnouncements(false)} size="small">
                <CloseIcon />
              </Button>
            </Box>
          </DialogTitle>
          <DialogContent dividers>
            {announcements.map((announcement) => (
              <Alert
                key={announcement.id}
                severity={
                  announcement.priority === 'urgent' ? 'error' :
                    announcement.priority === 'high' ? 'warning' :
                      announcement.priority === 'low' ? 'info' : 'success'
                }
                sx={{ mb: 2 }}
              >
                <Typography variant="subtitle2" fontWeight="bold">
                  {announcement.title}
                </Typography>
                <Typography variant="body2" sx={{ whiteSpace: 'pre-line', mb: 2 }}>
                  {announcement.content}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                  发布时间: {new Date(announcement.created_at).toLocaleDateString('zh-CN')}
                </Typography>
              </Alert>
            ))}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setShowAnnouncements(false)}>关闭</Button>
          </DialogActions>
        </Dialog>

        <Dialog
          open={showUpdateDialog}
          onClose={() => setShowUpdateDialog(false)}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>
            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Typography variant="h6">{hasUpdate ? '发现新版本' : '版本检查'}</Typography>
              <Button onClick={() => setShowUpdateDialog(false)} size="small">
                <CloseIcon />
              </Button>
            </Box>
          </DialogTitle>
          <DialogContent dividers>
            {hasUpdate && latestVersion ? (
              <Box>
                <Alert severity={latestVersion.is_critical ? 'error' : 'info'} sx={{ mb: 2 }}>
                  <Typography variant="subtitle1" fontWeight="bold">
                    版本 {latestVersion.version}
                    {latestVersion.is_critical && ' (重要更新)'}
                  </Typography>
                </Alert>

                <Typography variant="subtitle2" gutterBottom fontWeight="bold">
                  更新内容:
                </Typography>
                <Typography variant="body2" sx={{ whiteSpace: 'pre-line', mb: 2 }}>
                  {latestVersion.changelog}
                </Typography>

                <Typography variant="caption" color="text.secondary">
                  发布时间: {new Date(latestVersion.created_at).toLocaleDateString('zh-CN')}
                </Typography>
              </Box>
            ) : (
              <Box>
                <Alert severity="success" sx={{ mb: 2 }}>
                  <Typography variant="subtitle1" fontWeight="bold">
                    已是最新版本
                  </Typography>
                </Alert>
                <Typography variant="body2" color="text.secondary">
                  当前版本: v0.5.0
                </Typography>
              </Box>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setShowUpdateDialog(false)}>{hasUpdate ? '稍后更新' : '关闭'}</Button>
            {hasUpdate && latestVersion && (
              <Button
                variant="contained"
                onClick={async () => {
                  await openExternalLink(latestVersion.download_url);
                }}
                color="primary"
              >
                立即下载
              </Button>
            )}
          </DialogActions>
        </Dialog>

        <Dialog
          open={showCloseConfirm}
          onClose={() => setShowCloseConfirm(false)}
          maxWidth="xs"
          fullWidth
        >
          <DialogTitle>
            <Box display="flex" alignItems="center" gap={1}>
              <WarningIcon color="warning" />
              <Typography variant="h6">确认关闭</Typography>
            </Box>
          </DialogTitle>
          <DialogContent>
            <Typography variant="body1" sx={{ mt: 1 }}>
              您确定要关闭应用程序吗？
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              选择"最小化到托盘"将保持程序在后台运行，选择"彻底退出"将关闭程序。
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => setShowCloseConfirm(false)}
              color="inherit"
            >
              取消
            </Button>
            <Button
              onClick={async () => {
                await invoke('show_close_dialog');
                setShowCloseConfirm(false);
              }}
              variant="outlined"
              color="primary"
            >
              最小化到托盘
            </Button>
            <Button
              onClick={async () => {
                // 彻底退出程序
                await invoke('close_application');
              }}
              variant="contained"
              color="error"
            >
              彻底退出
            </Button>
          </DialogActions>
        </Dialog>
      </Container>
    </ThemeProvider>
  );
}

export default App;