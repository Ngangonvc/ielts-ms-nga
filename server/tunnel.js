const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

const DEFAULT_TOOLS_CF = 'C:\\Users\\Nga Ngo\\.gemini\\antigravity\\tools\\cloudflared\\cloudflared.exe';

let tunnelProcess = null;
let manualStopRequested = false;

const tunnelState = {
  status: 'DISCONNECTED', // DISCONNECTED | CONNECTING | CONNECTED | ERROR
  publicUrl: null,
  startedAt: null,
  disconnectedAt: null,
  lastError: null,
  disconnectReason: null,
  recentLogs: []
};

function pushLog(line) {
  if (!line) return;
  const trimmed = line.toString().trim();
  if (!trimmed) return;
  tunnelState.recentLogs.push(`[${new Date().toLocaleTimeString('vi-VN')}] ${trimmed}`);
  if (tunnelState.recentLogs.length > 30) {
    tunnelState.recentLogs.shift();
  }
}

function findCloudflaredBinary() {
  const candidates = [
    process.env.CLOUDFLARED_PATH,
    DEFAULT_TOOLS_CF,
    path.join(__dirname, '..', 'tools', 'cloudflared.exe'),
    path.join(__dirname, '..', 'bin', 'cloudflared.exe')
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // Fallback: check system PATH
  try {
    const out = execSync('where cloudflared', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const first = out.split(/\r?\n/)[0]?.trim();
    if (first && fs.existsSync(first)) return first;
  } catch (_) {}

  return null;
}

function getTunnelStatus() {
  const binaryPath = findCloudflaredBinary();
  return {
    binaryInstalled: Boolean(binaryPath),
    status: tunnelState.status,
    publicUrl: tunnelState.publicUrl,
    startedAt: tunnelState.startedAt,
    disconnectedAt: tunnelState.disconnectedAt,
    lastError: tunnelState.lastError,
    disconnectReason: tunnelState.disconnectReason,
    recentLogs: tunnelState.recentLogs.slice(-10)
  };
}

function startTunnel(localPort = 5000) {
  return new Promise((resolve, reject) => {
    const binaryPath = findCloudflaredBinary();
    if (!binaryPath) {
      tunnelState.status = 'ERROR';
      tunnelState.lastError = 'Chưa tìm thấy chương trình cloudflared.exe trên máy tính.';
      return reject(new Error(tunnelState.lastError));
    }

    if (tunnelProcess && (tunnelState.status === 'CONNECTED' || tunnelState.status === 'CONNECTING')) {
      return resolve(getTunnelStatus());
    }

    manualStopRequested = false;
    tunnelState.status = 'CONNECTING';
    tunnelState.publicUrl = null;
    tunnelState.lastError = null;
    tunnelState.disconnectReason = null;
    tunnelState.disconnectedAt = null;
    tunnelState.recentLogs = [];

    const args = [
      'tunnel',
      '--url',
      `http://127.0.0.1:${localPort}`,
      '--protocol',
      'http2',
      '--no-autoupdate'
    ];

    pushLog('Đang khởi động Cloudflare Quick Tunnel...');

    const child = spawn(binaryPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    tunnelProcess = child;

    let settled = false;
    const urlRegex = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

    const timeoutHandle = setTimeout(() => {
      if (!settled) {
        settled = true;
        tunnelState.status = 'ERROR';
        tunnelState.lastError = 'Hết thời gian chờ kết nối Cloudflare Quick Tunnel. Vui lòng kiểm tra kết nối Internet của máy tính.';
        stopTunnel().catch(() => {});
        reject(new Error(tunnelState.lastError));
      }
    }, 25000);

    function handleChunk(chunk) {
      const text = chunk.toString('utf8');
      const lines = text.split(/\r?\n/);
      for (const line of lines) {
        if (line.trim()) pushLog(line);
        const match = line.match(urlRegex);
        if (match && !settled) {
          settled = true;
          clearTimeout(timeoutHandle);
          tunnelState.status = 'CONNECTED';
          tunnelState.publicUrl = match[0];
          tunnelState.startedAt = Date.now();
          tunnelState.lastError = null;
          tunnelState.disconnectReason = null;
          pushLog(`Đã tạo link công khai: ${match[0]}`);
          resolve(getTunnelStatus());
        }
      }
    }

    child.stdout.on('data', handleChunk);
    child.stderr.on('data', handleChunk);

    child.on('error', (err) => {
      clearTimeout(timeoutHandle);
      tunnelProcess = null;
      tunnelState.status = 'ERROR';
      tunnelState.publicUrl = null;
      tunnelState.lastError = `Lỗi chạy cloudflared: ${err.message}`;
      if (!settled) {
        settled = true;
        reject(new Error(tunnelState.lastError));
      }
    });

    child.on('exit', (code, signal) => {
      clearTimeout(timeoutHandle);
      if (tunnelProcess === child) {
        tunnelProcess = null;
      }

      if (manualStopRequested) {
        tunnelState.status = 'DISCONNECTED';
        tunnelState.publicUrl = null;
        tunnelState.disconnectReason = null;
        pushLog('Giáo viên đã tắt Quick Tunnel an toàn.');
      } else {
        const wasConnected = tunnelState.status === 'CONNECTED';
        tunnelState.status = 'DISCONNECTED';
        tunnelState.publicUrl = null;
        tunnelState.disconnectedAt = Date.now();
        tunnelState.disconnectReason = wasConnected
          ? `Kết nối Cloudflare Quick Tunnel vừa bị ngắt đột ngột (mã ${code ?? signal ?? 'không rõ'}). Học sinh dùng 4G/5G sẽ không truy cập được cho tới khi bật lại.`
          : 'Không thể giữ kết nối Cloudflare Quick Tunnel. Kiểm tra Internet hoặc tường lửa trên máy tính.';
        tunnelState.lastError = tunnelState.disconnectReason;
        pushLog(tunnelState.disconnectReason);

        if (!settled) {
          settled = true;
          reject(new Error(tunnelState.disconnectReason));
        }
      }
    });
  });
}

function stopTunnel() {
  return new Promise((resolve) => {
    manualStopRequested = true;
    const child = tunnelProcess;
    tunnelProcess = null;

    if (!child) {
      tunnelState.status = 'DISCONNECTED';
      tunnelState.publicUrl = null;
      tunnelState.disconnectReason = null;
      return resolve(getTunnelStatus());
    }

    try {
      child.kill();
    } catch (_) {}

    if (process.platform === 'win32' && child.pid) {
      try {
        execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' });
      } catch (_) {}
    }

    tunnelState.status = 'DISCONNECTED';
    tunnelState.publicUrl = null;
    tunnelState.disconnectReason = null;
    pushLog('Đã tắt Cloudflare Quick Tunnel.');
    resolve(getTunnelStatus());
  });
}

// Cleanup child tunnel process when Node server shuts down
function cleanupTunnelSync() {
  if (tunnelProcess && tunnelProcess.pid) {
    manualStopRequested = true;
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /PID ${tunnelProcess.pid} /T /F`, { stdio: 'ignore' });
      } else {
        tunnelProcess.kill('SIGTERM');
      }
    } catch (_) {}
    tunnelProcess = null;
  }
}

process.on('exit', cleanupTunnelSync);
process.on('SIGINT', () => {
  cleanupTunnelSync();
  process.exit(0);
});
process.on('SIGTERM', () => {
  cleanupTunnelSync();
  process.exit(0);
});

module.exports = {
  findCloudflaredBinary,
  getTunnelStatus,
  startTunnel,
  stopTunnel
};
