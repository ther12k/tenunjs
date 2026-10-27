package com.polytron.wash;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelUuid;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.Arrays;
import java.util.UUID;

/**
 * Native GATT client for the washer's v4 BLE service — the WebView calls
 * this through the "PolytronNative" JS interface, so the app never depends
 * on a browser for Bluetooth. Line protocol identical to the Web Bluetooth
 * path: replies/status lines arrive via window.__nativeLine(), link state
 * via window.__nativeLink({connected, name}).
 */
public class PolytronBle {
    private static final String TAG = "PolytronBle";
    private static final UUID SVC = UUID.fromString("9f6d1c30-5f2e-4d8a-b7c3-00a1b2c3e001");
    private static final UUID CMD = UUID.fromString("9f6d1c30-5f2e-4d8a-b7c3-00a1b2c3e002");
    private static final UUID STAT = UUID.fromString("9f6d1c30-5f2e-4d8a-b7c3-00a1b2c3e003");
    private static final UUID CCCD = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
    private static final long WRITE_GAP_MS = 80;

    private final Context ctx;
    private final WebView web;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ArrayDeque<String> queue = new ArrayDeque<>();

    private BluetoothGatt gatt;
    private BluetoothGattCharacteristic cmdCh, statCh;
    private BluetoothDevice target;
    private String devName;
    private boolean writing = false;
    private boolean userStop = false;
    private int retries = 0;
    private boolean connected = false;

    public PolytronBle(Context ctx, WebView web) {
        this.ctx = ctx;
        this.web = web;
    }

    /* ---------------- JS interface (called from the WebView) ---------------- */

    @JavascriptInterface
    public void connect() {
        userStop = false;
        retries = 0;
        main.post(this::startScan);
    }

    @JavascriptInterface
    public void disconnect() {
        userStop = true;
        main.post(this::closeGatt);
        notifyLink(false, null);
    }

    @JavascriptInterface
    public boolean write(String cmd) {
        if (cmd == null || cmd.isEmpty()) return false;
        synchronized (queue) {
            if (queue.size() >= 8) return false;
            queue.addLast(cmd);
        }
        main.post(this::drain);
        return true;
    }

    public void shutdown() {
        userStop = true;
        closeGatt();
    }

    /* ------------------------------- scanning ------------------------------- */

    @SuppressLint("MissingPermission")
    private void startScan() {
        BluetoothManager bm = (BluetoothManager) ctx.getSystemService(Context.BLUETOOTH_SERVICE);
        BluetoothAdapter adapter = bm == null ? null : bm.getAdapter();
        if (adapter == null || !adapter.isEnabled()) {
            notifyLine("ERR bluetooth mati — nyalakan Bluetooth");
            notifyLink(false, null);
            return;
        }
        ScanFilter bySvc = new ScanFilter.Builder().setServiceUuid(ParcelUuid.fromString(SVC.toString())).build();
        ScanFilter byName = new ScanFilter.Builder().setDeviceName("Polytron Wash").build();
        ScanSettings settings = new ScanSettings.Builder()
                .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                .build();
        try {
            adapter.getBluetoothLeScanner().startScan(
                    Arrays.asList(bySvc, byName), settings, scanCb);
        } catch (Exception e) {
            Log.w(TAG, "scan failed", e);
            notifyLine("ERR scan gagal — cek izin lokasi/bluetooth");
            notifyLink(false, null);
            return;
        }
        main.postDelayed(() -> {
            try {
                adapter.getBluetoothLeScanner().stopScan(scanCb);
            } catch (Exception ignored) {
            }
        }, 12_000);
    }

    private final ScanCallback scanCb = new ScanCallback() {
        @Override
        public void onScanResult(int callbackType, ScanResult result) {
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            try {
                adapter.getBluetoothLeScanner().stopScan(this);
            } catch (Exception ignored) {
            }
            target = result.getDevice();
            devName = result.getScanRecord() != null ? result.getScanRecord().getDeviceName() : null;
            if (devName == null || devName.isEmpty()) devName = target.getName();
            connectTarget();
        }

        @Override
        public void onScanFailed(int errorCode) {
            notifyLine("ERR scan gagal (" + errorCode + ")");
            notifyLink(false, null);
        }
    };

    /* -------------------------------- GATT ---------------------------------- */

    private void connectTarget() {
        if (target == null) return;
        notifyLink(false, devName);
        try {
            gatt = target.connectGatt(ctx, false, gattCb, BluetoothDevice.TRANSPORT_LE);
        } catch (Exception e) {
            Log.w(TAG, "connectGatt failed", e);
            notifyLink(false, null);
        }
    }

    private final BluetoothGattCallback gattCb = new BluetoothGattCallback() {
        @Override
        public void onConnectionStateChange(BluetoothGatt g, int status, int newState) {
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                g.discoverServices();
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                connected = false;
                cmdCh = statCh = null;
                synchronized (queue) { queue.clear(); }
                writing = false;
                if (userStop) {
                    closeGatt();
                    notifyLink(false, null);
                } else if (retries < 3) {
                    retries++;
                    int delay = 2000 * retries;
                    BluetoothGatt stale = g;
                    main.postDelayed(() -> {
                        try {
                            if (stale != null) stale.close();
                        } catch (Exception ignored) {
                        }
                        connectTarget();
                    }, delay);
                } else {
                    closeGatt();
                    notifyLine("ERR sambungan terputus");
                    notifyLink(false, null);
                }
            }
        }

        @Override
        public void onServicesDiscovered(BluetoothGatt g, int status) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                notifyLine("ERR service tidak ditemukan");
                closeGatt();
                notifyLink(false, null);
                return;
            }
            BluetoothGattService svc = g.getService(SVC);
            if (svc == null) {
                notifyLine("ERR service v4 tidak ada");
                closeGatt();
                notifyLink(false, null);
                return;
            }
            cmdCh = svc.getCharacteristic(CMD);
            statCh = svc.getCharacteristic(STAT);
            if (cmdCh == null || statCh == null) {
                notifyLine("ERR characteristic tidak ada");
                closeGatt();
                notifyLink(false, null);
                return;
            }
            g.setCharacteristicNotification(statCh, true);
            BluetoothGattDescriptor cccd = statCh.getDescriptor(CCCD);
            if (cccd != null) {
                cccd.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                g.writeDescriptor(cccd);
            } else {
                onReady();
            }
        }

        @Override
        public void onDescriptorWrite(BluetoothGatt g, BluetoothGattDescriptor d, int status) {
            if (d.getUuid().equals(CCCD)) onReady();
        }

        @Override
        public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic c) {
            handleCharacteristicBytes(c.getValue());
        }

        @Override
        public void onCharacteristicWrite(BluetoothGatt g, BluetoothGattCharacteristic c, int status) {
            main.postDelayed(() -> {
                writing = false;
                drain();
            }, WRITE_GAP_MS);
        }
    };

    private void handleCharacteristicBytes(byte[] bytes) {
        if (bytes == null || bytes.length == 0) return;
        String line = new String(bytes, StandardCharsets.UTF_8).trim();
        if (!line.isEmpty()) notifyLine(line);
    }

    private void onReady() {
        connected = true;
        retries = 0;
        String n = devName != null && !devName.isEmpty() ? devName : "Polytron Wash";
        notifyLink(true, n);
    }

    /* ------------------------- writes + notifications ------------------------ */

    private void drain() {
        if (!connected || writing) return;
        String cmd;
        synchronized (queue) {
            cmd = queue.pollFirst();
        }
        if (cmd == null) return;
        writing = true;
        try {
            cmdCh.setValue(cmd.getBytes(StandardCharsets.UTF_8));
            gatt.writeCharacteristic(cmdCh);
        } catch (Exception e) {
            writing = false;
            notifyLine("ERR kirim gagal — cek sambungan");
        }
    }

    private void closeGatt() {
        try {
            if (gatt != null) gatt.close();
        } catch (Exception ignored) {
        }
        gatt = null;
        connected = false;
    }

    /* ------------------------------ JS bridge ------------------------------- */

    private void notifyLink(boolean up, String name) {
        main.post(() -> {
            String n = name == null ? "null" : "\"" + name.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
            web.evaluateJavascript(
                    "window.__nativeLink && window.__nativeLink({connected:" + up + ",name:" + n + "})", null);
        });
    }

    private void notifyLine(String line) {
        main.post(() -> {
            String safe = line.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n");
            web.evaluateJavascript("window.__nativeLine && window.__nativeLine(\"" + safe + "\")", null);
        });
    }
}
