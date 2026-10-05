package com.music.player;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import org.json.JSONObject;

/** A user-started foreground transfer persists while the WebView or screen is closed. */
public class NativeDownloadsService extends Service {
    private static final String CHANNEL = "native-music-downloads";
    private static final int NOTIFICATION = 3027;
    private NativeDownloadsManager manager;
    private volatile int latestStartId;
    @Override public void onCreate() {
        super.onCreate();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel(CHANNEL, "音乐下载和云端上传", NotificationManager.IMPORTANCE_LOW));
        ServiceCompat.startForeground(this, NOTIFICATION, notification("正在准备手机下载", 0, true).build(), Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC : 0);
    }
    private NotificationCompat.Builder notification(String text, int percent, boolean working) {
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(this, CHANNEL).setSmallIcon(android.R.drawable.stat_sys_download).setContentTitle("云感音乐")
            .setContentText(text).setContentIntent(open).setOngoing(working).setOnlyAlertOnce(true).setProgress(100, percent, working && percent == 0);
    }
    @Override public int onStartCommand(Intent intent, int flags, int id) {
        latestStartId = id;
        ServiceCompat.startForeground(this, NOTIFICATION, notification("正在准备手机下载", 0, true).build(), Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC : 0);
        try { manager = NativeDownloadsManager.get(this); manager.attach(this); }
        catch (Exception error) { stopSelf(); }
        return START_NOT_STICKY;
    }
    void progress(JSONObject job) {
        String phase = job.optString("phase", "");
        String text = ("upload".equals(phase) ? "上传云端：" : "convert".equals(phase) ? "转换 MP3：" : "下载：") + job.optString("title", "音乐");
        getSystemService(NotificationManager.class).notify(NOTIFICATION, notification(text, job.optInt("progress", 0), "running".equals(job.optString("state"))).build());
    }
    void complete() {
        new android.os.Handler(getMainLooper()).post(() -> {
            if (manager != null && manager.idleForService(this) && stopSelfResult(latestStartId)) stopForeground(STOP_FOREGROUND_REMOVE);
        });
    }
    @Override public void onTimeout(int startId, int foregroundServiceType) { if (manager != null) manager.timeout(); stopForeground(STOP_FOREGROUND_REMOVE); stopSelf(); }
    @Override public void onDestroy() { if (manager != null) manager.detach(this); super.onDestroy(); }
    @Override public IBinder onBind(Intent intent) { return null; }
}
