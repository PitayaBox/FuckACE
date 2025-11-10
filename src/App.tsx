import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
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
  CssBaseline
} from '@mui/material';
import {
  PlayArrow as StartIcon,
  Stop as StopIcon,
  Refresh as ManualIcon,
  CheckCircle,
  Schedule,
  DarkMode as DarkModeIcon,
  LightMode as LightModeIcon
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
  message: string;
}

interface LogEntry {
  id: number;
  timestamp: string;
  message: string;
}

function App() {
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const [targetCore, setTargetCore] = useState<number | null>(null);
  const [processStatus, setProcessStatus] = useState<ProcessStatus | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [darkMode, setDarkMode] = useState(true);

  let countdownTimer: number | null = null;

  const addLog = useCallback((message: string) => {
    const newLog: LogEntry = {
      id: Date.now(),
      timestamp: new Date().toLocaleTimeString(),
      message,
    };
    setLogs(prev => [...prev, newLog]);
  }, []);

  const executeProcessRestriction = useCallback(async () => {
    try {
      addLog('进程限制开始b（￣▽￣）d　');
      setLoading(true);
      
      const result = await invoke<ProcessStatus>('restrict_processes');
      setProcessStatus(result);
      setTargetCore(result.target_core);
      
      addLog(result.message);
    } catch (error) {
      addLog(`执行失败: ${error}`);
      console.error('执行进程限制失败/(ㄒoㄒ)/~~', error);
    } finally {
      setLoading(false);
    }
  }, [addLog]);

  const startMonitoring = useCallback(async () => {
    try {
      await invoke('start_timer');
      setIsMonitoring(true);
      addLog('启动进程监控');
      await executeProcessRestriction();
    } catch (error) {
      addLog(`启动监控失败: ${error}`);
      setIsMonitoring(false);
    }
  }, [addLog, executeProcessRestriction]);

  const stopMonitoring = useCallback(async () => {
    try {
      await invoke('stop_timer');
      setIsMonitoring(false);
      if (countdownTimer) {
        clearInterval(countdownTimer);
        countdownTimer = null;
      }
      addLog('停止进程监控');
    } catch (error) {
      addLog(`停止监控失败: ${error}`);
    }
  }, [addLog]);

  const manualExecute = useCallback(async () => {
    if (!isMonitoring) {
      addLog('请先启动监控');
      return;
    }
    addLog('手动执行限制操作');
    await executeProcessRestriction();
  }, [isMonitoring, addLog, executeProcessRestriction]);

  useEffect(() => {
    if (isMonitoring) {
      countdownTimer = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            executeProcessRestriction();
            return 60;
          }
          return prev - 1;
        });
      }, 1000);
    }

    return () => {
      if (countdownTimer) {
        clearInterval(countdownTimer);
      }
    };
  }, [isMonitoring, executeProcessRestriction]);

  useEffect(() => {
    addLog('FuckACE已启动，开始法克');
  }, [addLog]);

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

  return (
    <ThemeProvider theme={darkMode ? darkTheme : createTheme()}>
      <CssBaseline />
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Paper elevation={3} sx={{ p: 4, mb: 3, position: 'relative' }}>
          <Box display="flex" justifyContent="space-between" alignItems="center">
            <Box flex={1}>
              <Typography variant="h3" component="h1" align="center" gutterBottom color="primary">
                FuckACE
              </Typography>
              <Typography variant="subtitle1" align="center" color="text.secondary" gutterBottom>
                自动监控并限制ACE进程
              </Typography>
            </Box>
            <Button
              variant="outlined"
              startIcon={darkMode ? <LightModeIcon /> : <DarkModeIcon />}
              onClick={toggleDarkMode}
              sx={{ minWidth: 'auto', px: 2 }}
              size="small"
            >
              {darkMode ? '浅色' : '暗色'}
            </Button>
          </Box>
        </Paper>

        
        <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
          <Box display="flex" flexDirection="column" gap={2}>
            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Typography variant="body1">
                <strong>监控状态:</strong>
              </Typography>
              <Chip
                icon={isMonitoring ? <CheckCircle /> : <Schedule />}
                label={isMonitoring ? '监控中' : '已停止'}
                color={isMonitoring ? 'success' : 'default'}
              />
            </Box>
            
            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Typography variant="body1">
                <strong>下次执行:</strong>
              </Typography>
              <Chip
                label={`${countdown}秒`}
                color="primary"
                variant="outlined"
              />
            </Box>

            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Typography variant="body1">
                <strong>目标核心:</strong>
              </Typography>
              <Chip
                label={targetCore !== null ? `核心 ${targetCore}` : '检测中...'}
                color="info"
                variant="outlined"
              />
            </Box>

            {loading && <LinearProgress />}
          </Box>
        </Paper>

        
        <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" gutterBottom>
            目标进程状态
          </Typography>
          <List>
            <ListItem
              secondaryAction={
                <Chip
                  label={getProcessStatusText(
                    processStatus?.sguard64_found || false,
                    processStatus?.sguard64_restricted || false
                  )}
                  color={getProcessStatusColor(
                    processStatus?.sguard64_found || false,
                    processStatus?.sguard64_restricted || false
                  )}
                />
              }
            >
              <ListItemText primary="SGuard64.exe" />
            </ListItem>
            <Divider />
            <ListItem
              secondaryAction={
                <Chip
                  label={getProcessStatusText(
                    processStatus?.sguardsvc64_found || false,
                    processStatus?.sguardsvc64_restricted || false
                  )}
                  color={getProcessStatusColor(
                    processStatus?.sguardsvc64_found || false,
                    processStatus?.sguardsvc64_restricted || false
                  )}
                />
              }
            >
              <ListItemText primary="SGuardSvc64.exe" />
            </ListItem>
          </List>
        </Paper>

        
        <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
          <Box display="flex" gap={2} justifyContent="center" flexWrap="wrap">
            <Button
              variant="contained"
              startIcon={<StartIcon />}
              onClick={startMonitoring}
              disabled={isMonitoring || loading}
              size="large"
            >
              启动监控
            </Button>
            <Button
              variant="contained"
              startIcon={<StopIcon />}
              onClick={stopMonitoring}
              disabled={!isMonitoring || loading}
              color="secondary"
              size="large"
            >
              停止监控
            </Button>
            <Button
              variant="contained"
              startIcon={<ManualIcon />}
              onClick={manualExecute}
              disabled={!isMonitoring || loading}
              color="info"
              size="large"
            >
              立即执行
            </Button>
          </Box>
        </Paper>    <Paper elevation={2} sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            操作日志
          </Typography>
          <Box
            sx={{
              maxHeight: 200,
              overflowY: 'auto',
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
              p: 2,
              backgroundColor: 'background.default',
            }}
          >
            {logs.map((log) => (
              <Typography
                key={log.id}
                variant="body2"
                sx={{
                  fontFamily: 'monospace',
                  fontSize: '0.875rem',
                  py: 0.5,
                  borderBottom: '1px solid #eee',
                }}
              >
                [{log.timestamp}] {log.message}
              </Typography>
            ))}
          </Box>
        </Paper>
      </Container>
    </ThemeProvider>
  );
}

export default App;