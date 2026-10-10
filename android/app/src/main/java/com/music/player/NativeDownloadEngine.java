package com.music.player;

import org.json.JSONObject;
import java.io.File;

/** Fake implementations can exercise task persistence without contacting music platforms. */
interface NativeDownloadEngine {
    interface Progress { void update(String phase, int percent); }
    interface Cancelled { boolean get(); }
    void initialize() throws Exception;
    JSONObject inspect(String url) throws Exception;
    JSONObject search(JSONObject value) throws Exception;
    default JSONObject catalog(JSONObject value) throws Exception { throw new java.io.IOException("此版本暂不支持歌手与专辑浏览，请更新应用。"); }
    JSONObject radio(JSONObject value) throws Exception;
    JSONObject match(JSONObject value) throws Exception;
    JSONObject download(JSONObject source, File directory, String processId, Progress progress, Cancelled cancelled) throws Exception;
    void cancel(String processId);
}
