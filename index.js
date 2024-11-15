const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "http://localhost:3000" }
});

const PORT = 3001;

async function getAudioDevices() {
  const command = `
    Add-Type -TypeDefinition @'
    using System.Runtime.InteropServices;
    
    public class AudioDeviceManager {
        [DllImport("winmm.dll", SetLastError = true)]
        public static extern uint waveOutGetNumDevs();
        
        [DllImport("winmm.dll", SetLastError = true)]
        public static extern uint waveOutSetVolume(uint deviceID, uint Volume);
        
        [DllImport("winmm.dll", SetLastError = true)]
        public static extern uint waveOutGetVolume(uint deviceID, out uint Volume);
    }
'@

    Get-AudioDevice -List | Where-Object { $_.Type -eq 'Playback' } | Select-Object Name, ID, Default | ConvertTo-Json
  `;
  
  const output = await execPromise(`powershell.exe -Command "${command}"`);
  return JSON.parse(output || '[]');
}

async function setDefaultAudioDevice(deviceId) {
  const command = `
    $devices = Get-AudioDevice -List
    $device = $devices | Where-Object { $_.ID -eq '${deviceId}' }
    if ($device) {
      Set-AudioDevice -ID $device.ID
      return $true
    }
    return $false
  `;
  
  await execPromise(`powershell.exe -Command "${command}"`);
}

async function reconnectBluetoothDevice(deviceId) {
  const command = `
    $device = Get-PnpDevice -InstanceId '${deviceId}'
    $device | Disable-PnpDevice -Confirm:$false
    Start-Sleep -Seconds 1
    $device | Enable-PnpDevice -Confirm:$false
  `;
  
  await execPromise(`powershell.exe -Command "${command}"`);
}

io.on('connection', (socket) => {
  socket.on('getDevices', async () => {
    try {
      const devices = await getAudioDevices();
      socket.emit('deviceList', devices);
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  socket.on('setDefaultDevice', async ({ deviceId }) => {
    try {
      await setDefaultAudioDevice(deviceId);
      await reconnectBluetoothDevice(deviceId);
      socket.emit('deviceSet', { deviceId, status: 'success' });
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });
});

app.get('/devices', async (req, res) => {
  try {
    const devices = await getAudioDevices();
    res.json(devices);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Note: This application requires running PowerShell as Administrator');
});